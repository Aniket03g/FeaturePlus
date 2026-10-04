package v1

import (
	"strings"
	"time"

	"github.com/FeaturePlus/backend/models"
)

// The delivery half of the API: releases, and the review side of pull
// requests. The pull request type itself lives in dto.go, because a task
// response carries one and this file would otherwise be a dependency of that.

// ApprovalDTO is one recorded sign-off on a pull request.
type ApprovalDTO struct {
	ID         uint      `json:"id"`
	UserID     int       `json:"user_id"`
	User       *UserDTO  `json:"user,omitempty"`
	ApprovedAt time.Time `json:"approved_at"`
	Version    string    `json:"version,omitempty"`
}

// NewApprovalDTO converts an approval for output. The approver is included
// only when it was preloaded.
func NewApprovalDTO(a models.ApprovedPR) ApprovalDTO {
	dto := ApprovalDTO{
		ID:         a.ID,
		UserID:     a.UserID,
		ApprovedAt: time.Unix(a.ApprovedAt, 0),
		Version:    a.Version,
	}
	if a.User.ID != 0 {
		user := NewUserDTO(a.User)
		dto.User = &user
	}
	return dto
}

// NewApprovalDTOs converts a slice, always returning a non-nil result.
func NewApprovalDTOs(approvals []models.ApprovedPR) []ApprovalDTO {
	out := make([]ApprovalDTO, 0, len(approvals))
	for _, a := range approvals {
		out = append(out, NewApprovalDTO(a))
	}
	return out
}

// CreatePullRequestRequest is the accepted body for attaching a pull request
// to a task. The feature is taken from the task rather than from the request,
// so a pull request cannot be filed against a feature its task does not
// belong to.
type CreatePullRequestRequest struct {
	Title       string `json:"title" binding:"required,min=1,max=255"`
	URL         string `json:"url" binding:"required,url,max=500"`
	Branch      string `json:"branch" binding:"required,min=1,max=255"`
	Description string `json:"description" binding:"max=20000"`
	Version     string `json:"version" binding:"max=50"`
}

// UpdatePullRequestRequest is the accepted body for a partial update.
//
// Status is deliberately absent: it moves through the review route, which also
// records who decided. Allowing it here would let a pull request become
// approved with nobody's name against it.
type UpdatePullRequestRequest struct {
	Title       *string `json:"title" binding:"omitempty,min=1,max=255"`
	URL         *string `json:"url" binding:"omitempty,url,max=500"`
	Branch      *string `json:"branch" binding:"omitempty,min=1,max=255"`
	Description *string `json:"description" binding:"omitempty,max=20000"`
	Version     *string `json:"version" binding:"omitempty,max=50"`
}

// Apply copies the fields that were present onto a pull request model.
func (r UpdatePullRequestRequest) Apply(pr *models.PullRequest) {
	if r.Title != nil {
		pr.Title = *r.Title
	}
	if r.URL != nil {
		pr.URL = *r.URL
	}
	if r.Branch != nil {
		pr.Branch = *r.Branch
	}
	if r.Description != nil {
		pr.Description = *r.Description
	}
	if r.Version != nil {
		pr.Version = *r.Version
	}
}

// ReviewPullRequestRequest is the accepted body for a review decision.
// "open" is included so a decision can be withdrawn without deleting the
// record of it.
type ReviewPullRequestRequest struct {
	Status  string `json:"status" binding:"required,oneof=approved rejected changes_requested open"`
	Comment string `json:"comment" binding:"max=20000"`
}

// MarkTestedRequest sets or clears a pull request's tested flag. It is a
// pointer so that sending false clears the flag rather than reading as an
// omitted field.
type MarkTestedRequest struct {
	Tested *bool `json:"tested" binding:"required"`
}

// ReleaseCounts is a "how many, and how many finished" pair. It describes both
// the features planned into a release and the pull requests linked to it.
type ReleaseCounts struct {
	Total int `json:"total"`
	Done  int `json:"done"`
}

// ReleaseReadiness says whether a release can be published, and if not, why.
//
// The blockers are written for a person to read. The release screen shows them
// as they are rather than deriving its own sentences from the counts, so the
// rule for what "ready" means lives in exactly one place.
type ReleaseReadiness struct {
	Ready    bool     `json:"ready"`
	Blockers []string `json:"blockers"`
	// Warnings do not stop a publish; they are shown so it is a choice.
	Warnings []string `json:"warnings"`
}

// ReleaseDTO is a release as the API presents one.
type ReleaseDTO struct {
	ID        uint   `json:"id"`
	ProjectID int    `json:"project_id"`
	Tag       string `json:"tag"`
	Status    string `json:"status"`
	Notes     string `json:"notes"`

	// Counts are on both the list and the detail response, so a release list
	// can show progress without a follow-up request per row.
	Features     ReleaseCounts `json:"features"`
	PullRequests ReleaseCounts `json:"pull_requests"`

	// The three below are filled only on a detail response.
	PlannedFeatures    []FeatureDTO      `json:"planned_features,omitempty"`
	LinkedPullRequests []PullRequestDTO  `json:"linked_pull_requests,omitempty"`
	Readiness          *ReleaseReadiness `json:"readiness,omitempty"`

	// GitHubURL is the GitHub Release made when this release was published,
	// when the project is linked to a repository. GitHubError is set instead
	// when publishing it to GitHub failed; the release itself stays published
	// and the GitHub step can be retried.
	GitHubURL   string `json:"github_url,omitempty"`
	GitHubError string `json:"github_error,omitempty"`

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// NewReleaseDTO converts a release for output.
func NewReleaseDTO(r models.Release, features, prs ReleaseCounts) ReleaseDTO {
	return ReleaseDTO{
		ID:           r.ID,
		ProjectID:    r.ProjectID,
		Tag:          r.Tag,
		Status:       string(r.Status),
		Notes:        r.Notes,
		Features:     features,
		PullRequests: prs,
		CreatedAt:    r.CreatedAt,
		UpdatedAt:    r.UpdatedAt,
	}
}

// NewReleaseDTOs converts a slice, always returning a non-nil result.
func NewReleaseDTOs(
	releases []models.Release,
	features map[uint]ReleaseCounts,
	prs map[uint]ReleaseCounts,
) []ReleaseDTO {
	out := make([]ReleaseDTO, 0, len(releases))
	for _, r := range releases {
		out = append(out, NewReleaseDTO(r, features[r.ID], prs[r.ID]))
	}
	return out
}

// CreateReleaseRequest is the accepted body for planning a release. A release
// always starts as a draft; publishing is a separate, gated step.
type CreateReleaseRequest struct {
	Tag            string `json:"tag" binding:"required,min=1,max=50"`
	Notes          string `json:"notes" binding:"max=20000"`
	FeatureIDs     []uint `json:"feature_ids"`
	PullRequestIDs []uint `json:"pull_request_ids"`
}

// UpdateReleaseRequest is the accepted body for a partial update. Status is
// absent for the same reason it is absent from a pull request update: it moves
// through its own route, which checks readiness first.
type UpdateReleaseRequest struct {
	Tag   *string `json:"tag" binding:"omitempty,min=1,max=50"`
	Notes *string `json:"notes" binding:"omitempty,max=20000"`
}

// Apply copies the fields that were present onto a release model.
func (r UpdateReleaseRequest) Apply(release *models.Release) {
	if r.Tag != nil {
		release.Tag = strings.TrimSpace(*r.Tag)
	}
	if r.Notes != nil {
		release.Notes = *r.Notes
	}
}

// AssignFeaturesRequest plans features into a release.
type AssignFeaturesRequest struct {
	FeatureIDs []uint `json:"feature_ids" binding:"required,min=1"`
}

// LinkPullRequestsRequest attaches pull requests to a release.
type LinkPullRequestsRequest struct {
	PullRequestIDs []uint `json:"pull_request_ids" binding:"required,min=1"`
}
