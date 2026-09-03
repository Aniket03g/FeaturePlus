// Package v1 is the first versioned JSON API. It is what the React frontend
// talks to, and — because the desktop build serves the same routes over
// loopback — what the desktop application talks to as well.
package v1

import (
	"time"

	"github.com/FeaturePlus/backend/models"
)

// Responses are built from the types below rather than from the GORM models.
//
// This is not ceremony. models.User carries a bcrypt hash, and models.Project
// preloads its Owner, so returning a model directly published every user's
// password hash for as long as that endpoint existed. A response type makes
// what is sent an explicit decision, and adding a column to a model can no
// longer widen the API by accident.

// UserDTO is a user as the API presents one. There is no password field, and
// there is no way to add one by accident.
type UserDTO struct {
	ID       int    `json:"id"`
	Username string `json:"username"`
	Email    string `json:"email"`
	Name     string `json:"name"`
	Role     string `json:"role"`
}

// NewUserDTO converts a user model for output.
func NewUserDTO(u models.User) UserDTO {
	return UserDTO{
		ID:       u.ID,
		Username: u.Username,
		Email:    u.Email,
		Name:     u.Name,
		Role:     u.Role,
	}
}

// ProjectDTO is a project as the API presents one.
type ProjectDTO struct {
	ID          int    `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`

	// Brief is the shareable summary handed to scoped collaborators. It falls
	// back to Description when unset, so a client always has something to show.
	Brief string `json:"brief"`

	OwnerID int      `json:"owner_id"`
	Owner   *UserDTO `json:"owner,omitempty"`

	// Config holds per-project settings: tech stack, task types, tags.
	Config map[string]any `json:"config"`

	// Stats is present on list and detail responses, so a dashboard can render
	// progress without a follow-up request per project.
	Stats *ProjectStats `json:"stats,omitempty"`

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// ProjectStats summarises a project's contents.
//
// The two notions of "done" are different, and neither is a task field:
//   - A feature is done when its own status says so.
//   - A task is done when it has a pull request that is both tested and
//     approved. models.Task has no status column at all.
type ProjectStats struct {
	FeatureCount      int `json:"feature_count"`
	CompletedFeatures int `json:"completed_features"`
	TaskCount         int `json:"task_count"`
	CompletedTasks    int `json:"completed_tasks"`
}

// NewProjectDTO converts a project model for output. The owner is included
// only when it was preloaded; a zero-id owner means it was not.
func NewProjectDTO(p models.Project) ProjectDTO {
	dto := ProjectDTO{
		ID:          p.ID,
		Name:        p.Name,
		Description: p.Description,
		Brief:       p.Brief,
		OwnerID:     p.OwnerID,
		Config:      map[string]any(p.Config),
		CreatedAt:   p.CreatedAt,
		UpdatedAt:   p.UpdatedAt,
	}

	if dto.Brief == "" {
		dto.Brief = p.Description
	}
	if dto.Config == nil {
		dto.Config = map[string]any{}
	}
	if p.Owner.ID != 0 {
		owner := NewUserDTO(p.Owner)
		dto.Owner = &owner
	}

	return dto
}

// NewProjectDTOs converts a slice of projects, always returning a non-nil
// slice so the JSON is an array rather than null.
func NewProjectDTOs(projects []models.Project) []ProjectDTO {
	out := make([]ProjectDTO, 0, len(projects))
	for _, p := range projects {
		out = append(out, NewProjectDTO(p))
	}
	return out
}

// CreateProjectRequest is the accepted body for creating a project. The owner
// is taken from the authenticated session, never from the request, so a caller
// cannot create a project owned by someone else.
type CreateProjectRequest struct {
	Name        string         `json:"name" binding:"required,min=1,max=255"`
	Description string         `json:"description" binding:"max=10000"`
	Brief       string         `json:"brief" binding:"max=10000"`
	Config      map[string]any `json:"config"`
}

// UpdateProjectRequest is the accepted body for updating a project.
//
// Every field is a pointer so that "absent" and "set to empty" are different:
// omitting description leaves it alone, while sending "" clears it. A plain
// string field cannot express that distinction, which is how partial updates
// silently wipe data.
type UpdateProjectRequest struct {
	Name        *string         `json:"name" binding:"omitempty,min=1,max=255"`
	Description *string         `json:"description" binding:"omitempty,max=10000"`
	Brief       *string         `json:"brief" binding:"omitempty,max=10000"`
	Config      *map[string]any `json:"config"`
}

// Apply copies the fields that were present onto a project model.
func (r UpdateProjectRequest) Apply(p *models.Project) {
	if r.Name != nil {
		p.Name = *r.Name
	}
	if r.Description != nil {
		p.Description = *r.Description
	}
	if r.Brief != nil {
		p.Brief = *r.Brief
	}
	if r.Config != nil {
		p.Config = models.JSONB(*r.Config)
	}
}
