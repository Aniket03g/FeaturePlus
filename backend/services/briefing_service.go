package services

import (
	"errors"
	"fmt"
	"strings"

	"github.com/FeaturePlus/backend/models"
	"gorm.io/gorm"
)

// ErrNoScope is returned when a user holds no owner grant in a project, so
// there is no briefing to assemble for them. Callers translate this to 404:
// a user with no scope should not learn that the project exists.
var ErrNoScope = errors.New("no feature scope in this project")

// BriefingService assembles everything a scoped collaborator needs to build
// their feature — and nothing else.
//
// The three-tier model (owner/contract/none) already governs what a file
// *request* returns, but a developer arriving on a project has a harder
// problem: they don't yet know what to request, or what the app even is. A
// contract tells you how to call a function; it says nothing about the product.
//
// The briefing closes that gap without widening access. It is built *from* the
// user's grants rather than filtered after the fact, so anything outside their
// scope is never gathered in the first place. What it contains:
//
//	project brief   - owner-authored, explicitly shareable (never the raw repo)
//	owned features  - full spec + tasks for what they were asked to build
//	dependencies    - stripped contracts, behavior notes, and compilable mocks
//
// This is also the natural payload to hand an AI assistant: enough to build
// against the dependency, and nothing it could absorb or leak from code it was
// never given.
type BriefingService struct {
	db       *gorm.DB
	access   *AccessService
	contract *ContractService
}

// NewBriefingService constructs a BriefingService over an existing contract
// service (which carries the configured source reader and commit resolver).
func NewBriefingService(db *gorm.DB, contract *ContractService) *BriefingService {
	return &BriefingService{
		db:       db,
		access:   NewAccessService(db),
		contract: contract,
	}
}

// BriefingProject is the shareable identity of the project.
type BriefingProject struct {
	ID        int    `json:"id"`
	Name      string `json:"name"`
	Brief     string `json:"brief"`
	TechStack string `json:"tech_stack,omitempty"`
}

// BriefingTask is one planned task on an owned feature.
type BriefingTask struct {
	ID          uint   `json:"id"`
	Type        string `json:"type,omitempty"`
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
}

// BriefingFeature is a feature the collaborator owns: the work itself.
type BriefingFeature struct {
	ID          uint           `json:"id"`
	Title       string         `json:"title"`
	Description string         `json:"description,omitempty"`
	Status      string         `json:"status,omitempty"`
	Tasks       []BriefingTask `json:"tasks"`
}

// BriefingFile is one dependency file, served as a contract — never source.
type BriefingFile struct {
	Path         string `json:"path"`
	Contract     string `json:"contract"`
	BehaviorNote string `json:"behavior_note,omitempty"`
	Mock         string `json:"mock,omitempty"`
	MockFilename string `json:"mock_filename,omitempty"`
	Commit       string `json:"commit,omitempty"`
	// Unavailable records why a contract could not be produced (missing source
	// root, unsupported language). Surfacing this beats silently omitting a file
	// the collaborator genuinely depends on.
	Unavailable string `json:"unavailable,omitempty"`
}

// BriefingDependency is a feature the collaborator's work builds on, exposed at
// contract tier only.
type BriefingDependency struct {
	FeatureID   uint           `json:"feature_id"`
	Title       string         `json:"title"`
	Description string         `json:"description,omitempty"`
	Files       []BriefingFile `json:"files"`
}

// Briefing is the complete scoped hand-off bundle.
type Briefing struct {
	Project      BriefingProject      `json:"project"`
	YourFeatures []BriefingFeature    `json:"your_features"`
	Dependencies []BriefingDependency `json:"dependencies"`
	Rules        string               `json:"rules"`
}

// briefingRules is stated in the payload so both the developer and any AI
// assistant reading it know the boundary is deliberate, not an omission.
const briefingRules = "This briefing is the complete set of code you have access to in this project. " +
	"Dependency files are contracts: signatures and types only, with implementations removed at the syntax-tree level. " +
	"Build against them, and against the provided mocks, exactly as if they were the real implementation. " +
	"Any file not listed here is outside your scope and will not be served."

// techStack pulls the project's declared stack out of its config blob, if set.
func techStack(p *models.Project) string {
	if p.Config == nil {
		return ""
	}
	if v, ok := p.Config["tech_stack"].(string); ok {
		return v
	}
	return ""
}

// BuildBriefing assembles the briefing for one collaborator in one project.
//
// Scope is derived from the user's explicit owner grants; a user with none gets
// ErrNoScope. Dependency contracts come from the same ContractService that
// serves /files, so the briefing can never contain anything that endpoint would
// refuse — it is a convenience over the boundary, not a hole in it.
func (s *BriefingService) BuildBriefing(userID, projectID int) (*Briefing, error) {
	ownedIDs, err := s.access.ownedFeatureIDs(userID, projectID)
	if err != nil {
		return nil, err
	}
	if len(ownedIDs) == 0 {
		return nil, ErrNoScope
	}

	var project models.Project
	if err := s.db.First(&project, projectID).Error; err != nil {
		return nil, err
	}
	brief := project.Brief
	if strings.TrimSpace(brief) == "" {
		brief = project.Description
	}

	b := &Briefing{
		Project: BriefingProject{
			ID:        project.ID,
			Name:      project.Name,
			Brief:     brief,
			TechStack: techStack(&project),
		},
		Rules: briefingRules,
	}

	// The features they own: full spec and tasks, since this is their work.
	for _, fid := range ownedIDs {
		var feature models.Feature
		if err := s.db.First(&feature, fid).Error; err != nil {
			continue // a grant pointing at a deleted feature is not fatal
		}
		var tasks []models.Task
		if err := s.db.Where("feature_id = ?", fid).Find(&tasks).Error; err != nil {
			return nil, err
		}
		bf := BriefingFeature{
			ID:          feature.ID,
			Title:       feature.Title,
			Description: feature.Description,
			Status:      string(feature.Status),
			Tasks:       make([]BriefingTask, 0, len(tasks)),
		}
		for _, t := range tasks {
			bf.Tasks = append(bf.Tasks, BriefingTask{
				ID:          t.ID,
				Type:        t.TaskType,
				Name:        t.TaskName,
				Description: t.Description,
			})
		}
		b.YourFeatures = append(b.YourFeatures, bf)
	}

	// Dependencies, grouped by the feature that owns them. TargetsForUser already
	// excludes files the user owns outright, so nothing is downgraded to a
	// contract that they are entitled to see in full.
	targets, err := s.contract.TargetsForUser(userID, projectID)
	if err != nil {
		return nil, err
	}
	byFeature := map[uint]*BriefingDependency{}
	var order []uint
	for _, t := range targets {
		dep, ok := byFeature[t.FeatureID]
		if !ok {
			dep = &BriefingDependency{FeatureID: t.FeatureID, Title: t.FeatureTitle}
			var depFeature models.Feature
			if err := s.db.Select("description").First(&depFeature, t.FeatureID).Error; err == nil {
				// The "what" of a dependency is safe to share; only its "how" is not.
				dep.Description = depFeature.Description
			}
			byFeature[t.FeatureID] = dep
			order = append(order, t.FeatureID)
		}
		dep.Files = append(dep.Files, s.briefingFile(projectID, t))
	}
	for _, fid := range order {
		b.Dependencies = append(b.Dependencies, *byFeature[fid])
	}

	return b, nil
}

// briefingFile resolves one dependency file to its contract, behavior note and
// mock. Failures are recorded on the file rather than aborting the briefing:
// one unextractable file should not deny the collaborator everything else.
func (s *BriefingService) briefingFile(projectID int, t ContractTarget) BriefingFile {
	f := BriefingFile{Path: t.FilePath}

	artifact, err := s.contract.ContractFor(projectID, t.FeatureID, t.FilePath, "")
	if err != nil {
		f.Unavailable = "contract could not be generated for this file"
		return f
	}
	f.Contract = artifact.Contract
	f.BehaviorNote = artifact.BehaviorNote
	f.Commit = artifact.CommitHash

	if mock, err := s.contract.MockFor(projectID, t.FeatureID, t.FilePath, ""); err == nil {
		f.Mock = mock
		f.MockFilename = mockFilename(t.FilePath)
	}
	return f
}

// mockFilename derives the filename a generated mock should be saved as.
func mockFilename(filePath string) string {
	base := filePath
	if i := strings.LastIndexAny(base, "/\\"); i >= 0 {
		base = base[i+1:]
	}
	if strings.HasSuffix(base, ".go") {
		base = strings.TrimSuffix(base, ".go")
	}
	return base + "_mock.go"
}

// Markdown renders the briefing as a single document, which is the form a
// developer actually pastes into an AI assistant or keeps open while working.
func (b *Briefing) Markdown() string {
	var sb strings.Builder

	fmt.Fprintf(&sb, "# %s — your briefing\n\n", b.Project.Name)
	if b.Project.TechStack != "" {
		fmt.Fprintf(&sb, "**Stack:** %s\n\n", b.Project.TechStack)
	}
	if b.Project.Brief != "" {
		fmt.Fprintf(&sb, "## About this project\n\n%s\n\n", b.Project.Brief)
	}

	sb.WriteString("## What you are building\n\n")
	if len(b.YourFeatures) == 0 {
		sb.WriteString("_No features assigned._\n\n")
	}
	for _, f := range b.YourFeatures {
		fmt.Fprintf(&sb, "### %s (feature %d)\n\n", f.Title, f.ID)
		if f.Description != "" {
			fmt.Fprintf(&sb, "%s\n\n", f.Description)
		}
		if len(f.Tasks) > 0 {
			sb.WriteString("**Tasks:**\n\n")
			for _, t := range f.Tasks {
				fmt.Fprintf(&sb, "- **%s**", t.Name)
				if t.Type != "" {
					fmt.Fprintf(&sb, " _(%s)_", t.Type)
				}
				if t.Description != "" {
					fmt.Fprintf(&sb, " — %s", t.Description)
				}
				sb.WriteString("\n")
			}
			sb.WriteString("\n")
		}
	}

	sb.WriteString("## What you build against (contracts only)\n\n")
	if len(b.Dependencies) == 0 {
		sb.WriteString("_This feature has no dependencies._\n\n")
	}
	for _, d := range b.Dependencies {
		fmt.Fprintf(&sb, "### %s (feature %d)\n\n", d.Title, d.FeatureID)
		if d.Description != "" {
			fmt.Fprintf(&sb, "%s\n\n", d.Description)
		}
		for _, f := range d.Files {
			fmt.Fprintf(&sb, "#### `%s`\n\n", f.Path)
			if f.Unavailable != "" {
				fmt.Fprintf(&sb, "_%s_\n\n", f.Unavailable)
				continue
			}
			if f.BehaviorNote != "" {
				fmt.Fprintf(&sb, "%s\n\n", f.BehaviorNote)
			}
			fmt.Fprintf(&sb, "```go\n%s\n```\n\n", strings.TrimRight(f.Contract, "\n"))
			if f.Mock != "" {
				fmt.Fprintf(&sb, "<details><summary>Compilable mock — `%s`</summary>\n\n```go\n%s\n```\n\n</details>\n\n",
					f.MockFilename, strings.TrimRight(f.Mock, "\n"))
			}
		}
	}

	fmt.Fprintf(&sb, "---\n\n%s\n", b.Rules)
	return sb.String()
}
