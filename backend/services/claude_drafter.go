package services

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"strings"
	"time"

	"github.com/anthropics/anthropic-sdk-go"
	"github.com/anthropics/anthropic-sdk-go/option"
	"github.com/anthropics/anthropic-sdk-go/shared/constant"
)

// DefaultAIModel is the model the playground drafts with when FP_AI_MODEL is
// not set.
const DefaultAIModel = "claude-opus-5-5"

// NewDrafterFromEnv picks the playground's drafter: Claude when an
// ANTHROPIC_API_KEY is set, the stand-in otherwise. Adding the key to the
// environment (or .env) and restarting is all it takes to switch.
func NewDrafterFromEnv() Drafter {
	key := strings.TrimSpace(os.Getenv("ANTHROPIC_API_KEY"))
	if key == "" {
		return StandInDrafter{}
	}
	model := strings.TrimSpace(os.Getenv("FP_AI_MODEL"))
	if model == "" {
		model = DefaultAIModel
	}
	return NewClaudeDrafter(key, model)
}

// ClaudeDrafter drafts with Claude. One request per prompt: the list as it
// stands goes in, and the whole revised list comes back in a fixed JSON shape,
// which structured outputs guarantee parses. CleanDraft still runs over it, as
// over any drafter's answer, because a well-formed list can still name a
// parent that is not there.
type ClaudeDrafter struct {
	client anthropic.Client
	model  string
}

// NewClaudeDrafter builds a drafter for the given key and model.
func NewClaudeDrafter(apiKey, model string) *ClaudeDrafter {
	return &ClaudeDrafter{
		client: anthropic.NewClient(option.WithAPIKey(apiKey)),
		model:  model,
	}
}

// Name is the model, so the playground can say which AI answered.
func (d *ClaudeDrafter) Name() string { return d.model }

// draftTimeout bounds one answer. A draft is a few hundred tokens of JSON;
// anything near this long has gone wrong, and the person is waiting on it.
const draftTimeout = 120 * time.Second

// ErrAIDeclined is returned when the model declines the request, so the
// playground can say so plainly instead of reporting a fault.
var ErrAIDeclined = errors.New("the AI declined to answer that request")

const draftSystemPrompt = `You help people plan software products in FeaturePlus. You maintain a draft list of features that the person will review and then import into a project.

Each turn you get the current list (possibly empty) as JSON and what the person typed. Reply with the complete revised list, never a partial one.

The list:
- Each feature has a key, a title, a parent_key and needs.
- parent_key nests a feature inside another one ("" means top level). Nesting means "is part of". Two to three levels is usually enough.
- needs lists the keys of features that must be finished before this one can start. Only add a need when the order genuinely matters, such as a payment step that cannot work without a cart. Never make a feature need its own parent or anything nested inside it; nesting already says they belong together. Avoid loops.
- Keep the key of every feature you keep, even if you rename or move it. Give each new feature a new key that is not already used, such as "n1", "n2".
- Titles are short plain names a product team would use, two to five words, never the same as a sibling's (the same name under different parents is fine), without numbering or trailing punctuation.

What to do:
- If the person describes a product, draft its features: usually 8 to 30, grouped under a handful of top-level areas, including the basics the product cannot work without.
- If they ask for a change, make exactly that change and keep everything else as it is, including the needs already there.
- If the request is unclear, return the list unchanged and say in the message what you need.

Also reply with:
- title: a short name for the product when the list was empty and they described one; otherwise "".
- message: one or two plain sentences saying what you changed. No markdown.`

// draftSchema is the answer's shape. Structured outputs need every object to
// close its properties, and a recursive schema is not allowed, which is why
// the list is flat with parent keys rather than nested.
var draftSchema = map[string]any{
	"type":                 "object",
	"additionalProperties": false,
	"required":             []string{"title", "message", "features"},
	"properties": map[string]any{
		"title":   map[string]any{"type": "string"},
		"message": map[string]any{"type": "string"},
		"features": map[string]any{
			"type": "array",
			"items": map[string]any{
				"type":                 "object",
				"additionalProperties": false,
				"required":             []string{"key", "title", "parent_key", "needs"},
				"properties": map[string]any{
					"key":        map[string]any{"type": "string"},
					"title":      map[string]any{"type": "string"},
					"parent_key": map[string]any{"type": "string"},
					"needs":      map[string]any{"type": "array", "items": map[string]any{"type": "string"}},
				},
			},
		},
	},
}

// Draft sends the list and the prompt, and reads back the revised list.
func (d *ClaudeDrafter) Draft(ctx context.Context, req DraftRequest) (DraftReply, error) {
	current := req.Current
	if current == nil {
		current = []DraftFeature{}
	}
	listJSON, err := json.Marshal(current)
	if err != nil {
		return DraftReply{}, err
	}
	userText := "Current list:\n" + string(listJSON) + "\n\nThe person wrote:\n" + req.Prompt

	ctx, cancel := context.WithTimeout(ctx, draftTimeout)
	defer cancel()

	resp, err := d.client.Beta.Messages.New(ctx, anthropic.BetaMessageNewParams{
		Model:     anthropic.Model(d.model),
		MaxTokens: 16000,
		System:    []anthropic.BetaTextBlockParam{{Text: draftSystemPrompt}},
		Messages: []anthropic.BetaMessageParam{
			anthropic.NewBetaUserMessage(anthropic.NewBetaTextBlock(userText)),
		},
		OutputConfig: anthropic.BetaOutputConfigParam{
			Effort: anthropic.BetaOutputConfigEffortMedium,
			Format: anthropic.BetaJSONOutputFormatParam{Schema: draftSchema},
		},
		// If the model declines, the API retries on a fallback model inside the
		// same call, chosen by the reason it declined.
		Fallbacks: anthropic.BetaFallbacksParamUnion{OfDefault: constant.ValueOf[constant.Default]()},
		Betas:     []anthropic.AnthropicBeta{anthropic.AnthropicBetaServerSideFallback2026_07_01},
	})
	if err != nil {
		return DraftReply{}, describeAIError(err)
	}

	switch resp.StopReason {
	case anthropic.BetaStopReasonRefusal:
		return DraftReply{}, ErrAIDeclined
	case anthropic.BetaStopReasonMaxTokens:
		return DraftReply{}, errors.New("the AI's answer was too long to finish; try asking for a smaller list")
	}

	var text strings.Builder
	for _, block := range resp.Content {
		if b, ok := block.AsAny().(anthropic.BetaTextBlock); ok {
			text.WriteString(b.Text)
		}
	}
	var reply DraftReply
	if err := json.Unmarshal([]byte(text.String()), &reply); err != nil {
		return DraftReply{}, fmt.Errorf("the AI's answer could not be read: %w", err)
	}
	for i := range reply.Features {
		if reply.Features[i].Needs == nil {
			reply.Features[i].Needs = []string{}
		}
	}
	return reply, nil
}

// describeAIError turns an API failure into something worth showing the
// person, without passing on the raw response.
func describeAIError(err error) error {
	log.Printf("playground AI request failed: %v", err)
	var apiErr *anthropic.Error
	if errors.As(err, &apiErr) {
		switch apiErr.StatusCode {
		case 401, 403:
			return errors.New("the AI key was not accepted; check ANTHROPIC_API_KEY")
		case 404:
			return errors.New("the AI model was not found; check FP_AI_MODEL")
		case 429:
			return errors.New("the AI is busy or the usage limit was reached; try again in a minute")
		case 529, 500, 502, 503:
			return errors.New("the AI service is having trouble; try again shortly")
		}
		return fmt.Errorf("the AI request failed (status %d)", apiErr.StatusCode)
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return errors.New("the AI took too long to answer; try again")
	}
	return errors.New("could not reach the AI service")
}
