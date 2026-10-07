package v1

import (
	"time"

	"github.com/FeaturePlus/backend/models"
	"github.com/FeaturePlus/backend/repositories"
)

// The workspace half of the API: the people on a project, the code a feature
// maps to, the files hanging off a task, and the templates a project can be
// started from. These are the screens Phase 7 brings across from htmx.

// UpdateUserRequest is the accepted body for changing a user.
//
// Password is absent: changing one is its own action with its own rules, and
// letting it ride along on a profile edit is how a password ends up updated by
// a form that never meant to.
type UpdateUserRequest struct {
	Name     *string `json:"name" binding:"omitempty,max=255"`
	Email    *string `json:"email" binding:"omitempty,email,max=255"`
	Username *string `json:"username" binding:"omitempty,min=1,max=255"`
	Role     *string `json:"role" binding:"omitempty,oneof=developer manager admin"`
}

// FeatureFileDTO is one source file mapped to a feature.
type FeatureFileDTO struct {
	ID        uint      `json:"id"`
	FeatureID uint      `json:"feature_id"`
	FilePath  string    `json:"file_path"`
	CreatedAt time.Time `json:"created_at"`
}

// NewFeatureFileDTO converts a file mapping for output.
func NewFeatureFileDTO(f models.FeatureFile) FeatureFileDTO {
	return FeatureFileDTO{
		ID:        f.ID,
		FeatureID: f.FeatureID,
		FilePath:  f.FilePath,
		CreatedAt: f.CreatedAt,
	}
}

// NewFeatureFileDTOs converts a slice, always returning a non-nil result.
func NewFeatureFileDTOs(files []models.FeatureFile) []FeatureFileDTO {
	out := make([]FeatureFileDTO, 0, len(files))
	for _, f := range files {
		out = append(out, NewFeatureFileDTO(f))
	}
	return out
}

// FeatureCommitDTO is one git commit mapped to a feature.
type FeatureCommitDTO struct {
	ID         uint      `json:"id"`
	FeatureID  uint      `json:"feature_id"`
	CommitHash string    `json:"commit_hash"`
	CreatedAt  time.Time `json:"created_at"`
}

// NewFeatureCommitDTO converts a commit mapping for output.
func NewFeatureCommitDTO(c models.FeatureCommit) FeatureCommitDTO {
	return FeatureCommitDTO{
		ID:         c.ID,
		FeatureID:  c.FeatureID,
		CommitHash: c.CommitHash,
		CreatedAt:  c.CreatedAt,
	}
}

// NewFeatureCommitDTOs converts a slice, always returning a non-nil result.
func NewFeatureCommitDTOs(commits []models.FeatureCommit) []FeatureCommitDTO {
	out := make([]FeatureCommitDTO, 0, len(commits))
	for _, c := range commits {
		out = append(out, NewFeatureCommitDTO(c))
	}
	return out
}

// LinkFileRequest maps a source file to a feature.
type LinkFileRequest struct {
	FilePath string `json:"file_path" binding:"required,min=1,max=500"`
}

// LinkCommitRequest maps a git commit to a feature.
type LinkCommitRequest struct {
	CommitHash string `json:"commit_hash" binding:"required,min=7,max=40"`
}

// ScopeDTO is one collaborator's access grant on a feature.
type ScopeDTO struct {
	ID          uint      `json:"id"`
	FeatureID   uint      `json:"feature_id"`
	ProjectID   int       `json:"project_id"`
	UserID      int       `json:"user_id"`
	User        *UserDTO  `json:"user,omitempty"`
	AccessLevel string    `json:"access_level"`
	GrantedByID int       `json:"granted_by_id"`
	CreatedAt   time.Time `json:"created_at"`
}

// NewScopeDTO converts a grant for output. The collaborator is included only
// when it was preloaded.
func NewScopeDTO(s models.FeatureScope) ScopeDTO {
	dto := ScopeDTO{
		ID:          s.ID,
		FeatureID:   s.FeatureID,
		ProjectID:   s.ProjectID,
		UserID:      s.UserID,
		AccessLevel: string(s.AccessLevel),
		GrantedByID: s.GrantedByID,
		CreatedAt:   s.CreatedAt,
	}
	if s.User.ID != 0 {
		user := NewUserDTO(s.User)
		dto.User = &user
	}
	return dto
}

// NewScopeDTOs converts a slice, always returning a non-nil result.
func NewScopeDTOs(scopes []models.FeatureScope) []ScopeDTO {
	out := make([]ScopeDTO, 0, len(scopes))
	for _, s := range scopes {
		out = append(out, NewScopeDTO(s))
	}
	return out
}

// GrantScopeRequest grants or changes a collaborator's access to a feature.
//
// "none" is not accepted: revoking is a delete, and having two ways to say the
// same thing means two places where the rule can be got wrong.
type GrantScopeRequest struct {
	UserID      int    `json:"user_id" binding:"required,gt=0"`
	AccessLevel string `json:"access_level" binding:"required,oneof=owner contract"`
}

// FileContentDTO is a source file as the caller is allowed to see it.
//
// A contract-scope collaborator gets the stripped contract and never the real
// implementation; the owner gets the source. IsSource says which arrived, so a
// screen never has to guess whether it is showing real code.
type FileContentDTO struct {
	FilePath string `json:"file_path"`
	Access   string `json:"access"`
	IsSource bool   `json:"is_source"`
	Content  string `json:"content"`
	Note     string `json:"note,omitempty"`
	Commit   string `json:"commit,omitempty"`

	// Stale marks a contract that has drifted from the current source, which
	// is the difference between out-of-date documentation and a lie.
	Stale bool `json:"stale"`
}

// MockFileDTO is a generated stand-in for a dependency the caller cannot see.
type MockFileDTO struct {
	FilePath     string `json:"file_path"`
	MockFilename string `json:"mock_filename"`
	Content      string `json:"content"`
}

// ContractArtifactDTO is one stored contract, as listed on a project.
type ContractArtifactDTO struct {
	ID           uint      `json:"id"`
	ProjectID    int       `json:"project_id"`
	FeatureID    uint      `json:"feature_id"`
	FilePath     string    `json:"file_path"`
	CommitHash   string    `json:"commit_hash"`
	Language     string    `json:"language"`
	BehaviorNote string    `json:"behavior_note,omitempty"`
	UpdatedAt    time.Time `json:"updated_at"`
}

// NewContractArtifactDTO converts an artifact for output. The contract text
// itself is left out: a list of twenty files should not carry twenty file
// bodies, and the content route serves one when it is actually being read.
func NewContractArtifactDTO(a models.ContractArtifact) ContractArtifactDTO {
	return ContractArtifactDTO{
		ID:           a.ID,
		ProjectID:    a.ProjectID,
		FeatureID:    a.FeatureID,
		FilePath:     a.FilePath,
		CommitHash:   a.CommitHash,
		Language:     a.Language,
		BehaviorNote: a.BehaviorNote,
		UpdatedAt:    a.UpdatedAt,
	}
}

// NewContractArtifactDTOs converts a slice, always returning a non-nil result.
func NewContractArtifactDTOs(artifacts []models.ContractArtifact) []ContractArtifactDTO {
	out := make([]ContractArtifactDTO, 0, len(artifacts))
	for _, a := range artifacts {
		out = append(out, NewContractArtifactDTO(a))
	}
	return out
}

// TemplateSummaryDTO is a project template as it appears in a list.
type TemplateSummaryDTO struct {
	ID           string   `json:"id"`
	Name         string   `json:"name"`
	Stack        string   `json:"stack"`
	TechStack    string   `json:"tech_stack"`
	Description  string   `json:"description"`
	FeatureCount int      `json:"feature_count"`
	TaskCount    int      `json:"task_count"`
	Categories   []string `json:"categories"`
	TaskTypes    []string `json:"task_types"`
}

// NewTemplateSummaryDTO converts a template for a list response.
func NewTemplateSummaryDTO(t repositories.Template) TemplateSummaryDTO {
	return TemplateSummaryDTO{
		ID:           t.ID,
		Name:         t.Name,
		Stack:        t.Stack,
		TechStack:    t.TechStack,
		Description:  t.Description,
		FeatureCount: len(t.Features),
		TaskCount:    len(t.Tasks),
		Categories:   emptyIfNil(t.FeatureCategories),
		TaskTypes:    emptyIfNil(t.TaskTypes),
	}
}

// NewTemplateSummaryDTOs converts a slice, always returning a non-nil result.
func NewTemplateSummaryDTOs(templates []repositories.Template) []TemplateSummaryDTO {
	out := make([]TemplateSummaryDTO, 0, len(templates))
	for _, t := range templates {
		out = append(out, NewTemplateSummaryDTO(t))
	}
	return out
}

// TemplateFeatureDTO is one feature a template would create.
type TemplateFeatureDTO struct {
	Name        string `json:"name"`
	Category    string `json:"category"`
	Description string `json:"description"`
}

// TemplateTaskDTO is one task a template would create.
type TemplateTaskDTO struct {
	Name        string `json:"name"`
	Type        string `json:"type"`
	Description string `json:"description"`
	Priority    string `json:"priority"`
}

// TemplateDTO is a template in full, as shown before applying one.
//
// Applying a template writes features and tasks into a project, so the detail
// response lists exactly what would be created. A preview is the difference
// between choosing a template and gambling on one.
type TemplateDTO struct {
	TemplateSummaryDTO
	Features             []TemplateFeatureDTO `json:"features"`
	Tasks                []TemplateTaskDTO    `json:"tasks"`
	Dependencies         []string             `json:"dependencies"`
	SetupSteps           []string             `json:"setup_steps"`
	EnvironmentVariables []string             `json:"environment_variables"`
	StarterRepo          string               `json:"starter_repo,omitempty"`
	DocsLinks            []string             `json:"docs_links"`
}

// NewTemplateDTO converts a template for a detail response.
func NewTemplateDTO(t repositories.Template) TemplateDTO {
	features := make([]TemplateFeatureDTO, 0, len(t.Features))
	for _, f := range t.Features {
		features = append(features, TemplateFeatureDTO{
			Name: f.Name, Category: f.Category, Description: f.Description,
		})
	}

	tasks := make([]TemplateTaskDTO, 0, len(t.Tasks))
	for _, task := range t.Tasks {
		tasks = append(tasks, TemplateTaskDTO{
			Name: task.Name, Type: task.Type,
			Description: task.Description, Priority: task.Priority,
		})
	}

	return TemplateDTO{
		TemplateSummaryDTO:   NewTemplateSummaryDTO(t),
		Features:             features,
		Tasks:                tasks,
		Dependencies:         emptyIfNil(t.Dependencies),
		SetupSteps:           emptyIfNil(t.SetupSteps),
		EnvironmentVariables: emptyIfNil(t.EnvironmentVariables),
		StarterRepo:          t.StarterRepo,
		DocsLinks:            emptyIfNil(t.DocsLinks),
	}
}

// ApplyTemplateRequest applies a template's features and tasks to a project.
type ApplyTemplateRequest struct {
	TemplateID string `json:"template_id" binding:"required,min=1,max=100"`
}

// ApplyTemplateResultDTO reports what a template actually created.
type ApplyTemplateResultDTO struct {
	TemplateID      string `json:"template_id"`
	TemplateName    string `json:"template_name"`
	FeaturesCreated int    `json:"features_created"`
	TasksCreated    int    `json:"tasks_created"`
	FeaturesSkipped int    `json:"features_skipped"`
	ProjectID       int    `json:"project_id"`
	ConfigUpdated   bool   `json:"config_updated"`
	SkippedBecause  string `json:"skipped_because,omitempty"`
}

// ImportSummaryDTO is a saved import, ready to be turned into a project.
type ImportSummaryDTO struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	TechStack    string `json:"tech_stack,omitempty"`
	FeatureCount int    `json:"feature_count"`
	TaskCount    int    `json:"task_count"`
}

// ImportProjectRequest creates a project from a saved import.
type ImportProjectRequest struct {
	ImportID    string `json:"import_id" binding:"required,min=1,max=200"`
	Name        string `json:"name" binding:"omitempty,max=255"`
	Description string `json:"description" binding:"omitempty,max=10000"`
}

// ImportGitHubRequest creates a project from a public GitHub repository.
type ImportGitHubRequest struct {
	RepoURL string `json:"repo_url" binding:"required,url,max=500"`
	Name    string `json:"name" binding:"omitempty,max=255"`
	Branch  string `json:"branch" binding:"omitempty,max=255"`
}

// ImportResultDTO reports what an import produced.
type ImportResultDTO struct {
	ProjectID       int    `json:"project_id"`
	Name            string `json:"name"`
	FeaturesCreated int    `json:"features_created"`
	TasksCreated    int    `json:"tasks_created"`
	Source          string `json:"source"`
}
