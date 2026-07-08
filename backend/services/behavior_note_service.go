package services

import (
	"fmt"
	"strings"

	"github.com/FeaturePlus/backend/internal/llm"
	"github.com/FeaturePlus/backend/models"
	"gorm.io/gorm"
)

// NoteGenerator produces a short behavior note from a prompt. It is an
// interface so the LLM can be swapped for a fake in tests (the note step is the
// only non-deterministic part of the contract pipeline).
type NoteGenerator interface {
	GenerateNote(prompt string) (string, error)
}

// geminiNoteGenerator is the production generator backed by Gemini.
type geminiNoteGenerator struct{}

func (geminiNoteGenerator) GenerateNote(prompt string) (string, error) {
	return llm.GenerateWithGemini(prompt)
}

// BehaviorNoteService generates the optional AI behavior note that accompanies a
// contract. Signatures alone don't explain *why* an error happens or what a
// caller should do about it; the note fills that gap in one or two sentences.
type BehaviorNoteService struct {
	db  *gorm.DB
	gen NoteGenerator
}

// NewBehaviorNoteService builds a service backed by the real LLM.
func NewBehaviorNoteService(db *gorm.DB) *BehaviorNoteService {
	return &BehaviorNoteService{db: db, gen: geminiNoteGenerator{}}
}

// SetGenerator overrides the note generator (used in tests).
func (s *BehaviorNoteService) SetGenerator(g NoteGenerator) {
	s.gen = g
}

// buildPrompt assembles the single LLM prompt from the stripped contract and the
// owning feature/task context. Only the public shape is shared — never the real
// implementation body.
func (s *BehaviorNoteService) buildPrompt(contract, featureDesc, taskDesc string) string {
	var b strings.Builder
	b.WriteString("You are documenting a code contract for a developer who can call this code but cannot see its implementation.\n")
	b.WriteString("Given the stripped signature/types below and the feature context, write ONE or TWO short sentences of behavior notes a caller needs: error semantics, when to call it, side effects, or idempotency.\n")
	b.WriteString("Do not restate the signature. Do not speculate about internal implementation. Output plain prose only, no code fences.\n\n")
	if featureDesc != "" {
		b.WriteString("Feature: ")
		b.WriteString(featureDesc)
		b.WriteString("\n")
	}
	if taskDesc != "" {
		b.WriteString("Task: ")
		b.WriteString(taskDesc)
		b.WriteString("\n")
	}
	b.WriteString("\nContract:\n")
	b.WriteString(contract)
	return b.String()
}

// formatNote wraps raw note prose into a comment block that can be appended
// directly to the contract text.
func formatNote(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	var b strings.Builder
	b.WriteString("// BEHAVIOR NOTE (auto-generated):\n")
	for _, line := range strings.Split(raw, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		b.WriteString("// ")
		b.WriteString(line)
		b.WriteString("\n")
	}
	return strings.TrimRight(b.String(), "\n")
}

// GenerateNote runs the single LLM call for a contract and returns the note
// formatted as a comment block. It does not persist anything — see EnsureNote
// for the cached, persisted path.
func (s *BehaviorNoteService) GenerateNote(contract, featureDesc, taskDesc string) (string, error) {
	if s.gen == nil {
		return "", fmt.Errorf("no note generator configured")
	}
	raw, err := s.gen.GenerateNote(s.buildPrompt(contract, featureDesc, taskDesc))
	if err != nil {
		return "", fmt.Errorf("behavior note generation failed: %w", err)
	}
	return formatNote(raw), nil
}

// loadArtifact fetches an artifact by id.
func (s *BehaviorNoteService) loadArtifact(id uint) (*models.ContractArtifact, error) {
	var a models.ContractArtifact
	if err := s.db.First(&a, id).Error; err != nil {
		return nil, err
	}
	return &a, nil
}

// EnsureNote returns the behavior note for a contract artifact, generating and
// persisting it on first request and returning the cached value thereafter.
//
// Caching is keyed by the artifact itself: artifacts are versioned per commit
// (feature+file+commit), so an unchanged source reuses the same artifact and
// its cached note (no LLM call), while drift produces a new artifact with an
// empty note that is regenerated once. force=true regenerates unconditionally.
func (s *BehaviorNoteService) EnsureNote(artifactID uint, featureDesc, taskDesc string, force bool) (string, error) {
	a, err := s.loadArtifact(artifactID)
	if err != nil {
		return "", err
	}
	if a.BehaviorNote != "" && !force {
		return a.BehaviorNote, nil // cached — no LLM call
	}
	note, err := s.GenerateNote(a.Contract, featureDesc, taskDesc)
	if err != nil {
		return "", err
	}
	a.BehaviorNote = note
	if err := s.db.Model(a).Update("behavior_note", note).Error; err != nil {
		return "", err
	}
	return note, nil
}

// ContractWithNote returns the contract text with the behavior note appended, if
// one has been generated. Used when serving a contract to a collaborator.
func ContractWithNote(a *models.ContractArtifact) string {
	if a == nil {
		return ""
	}
	if strings.TrimSpace(a.BehaviorNote) == "" {
		return a.Contract
	}
	return strings.TrimRight(a.Contract, "\n") + "\n\n" + a.BehaviorNote + "\n"
}
