// Package v1 is the first versioned JSON API. It is what the React frontend
// talks to, and — because the desktop build serves the same routes over
// loopback — what the desktop application talks to as well.
package v1

import (
	"strings"
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

// FeatureTaskCounts summarises the tasks under a feature.
type FeatureTaskCounts struct {
	Total     int `json:"total"`
	Completed int `json:"completed"`
}

// TagCount is a tag and how many features carry it.
type TagCount struct {
	Name  string `json:"name"`
	Count int    `json:"count"`
}

// FeatureDTO is a feature as the API presents one.
type FeatureDTO struct {
	ID              uint   `json:"id"`
	ProjectID       int    `json:"project_id"`
	ParentFeatureID *uint  `json:"parent_feature_id"`
	ReleaseID       *uint  `json:"release_id"`
	Title           string `json:"title"`
	Description     string `json:"description"`
	Category        string `json:"category"`
	Status          string `json:"status"`
	Priority        string `json:"priority"`
	AssigneeID      uint   `json:"assignee_id"`

	Tags  []string           `json:"tags"`
	Tasks *FeatureTaskCounts `json:"tasks,omitempty"`

	// SubFeatures is filled only on a detail response; a list would otherwise
	// carry the whole tree for every row.
	SubFeatures []FeatureDTO `json:"sub_features,omitempty"`

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// NewFeatureDTO converts a feature model for output.
func NewFeatureDTO(f models.Feature, tags []string, tasks *FeatureTaskCounts) FeatureDTO {
	return FeatureDTO{
		ID:              f.ID,
		ProjectID:       f.ProjectID,
		ParentFeatureID: f.ParentFeatureID,
		ReleaseID:       f.ReleaseID,
		Title:           f.Title,
		Description:     f.Description,
		Category:        f.Category,
		Status:          string(f.Status),
		Priority:        string(f.Priority),
		AssigneeID:      f.AssigneeID,
		Tags:            emptyIfNil(tags),
		Tasks:           tasks,
		CreatedAt:       f.CreatedAt,
		UpdatedAt:       f.UpdatedAt,
	}
}

// NewFeatureDTOs converts a slice, always returning a non-nil result.
func NewFeatureDTOs(
	features []models.Feature,
	tags map[uint][]string,
	tasks map[uint]*FeatureTaskCounts,
) []FeatureDTO {
	out := make([]FeatureDTO, 0, len(features))
	for _, f := range features {
		out = append(out, NewFeatureDTO(f, tags[f.ID], tasks[f.ID]))
	}
	return out
}

// CreateFeatureRequest is the accepted body for creating a feature. Status,
// priority and category fall back to the model's defaults when omitted.
type CreateFeatureRequest struct {
	Title           string   `json:"title" binding:"required,min=1,max=255"`
	Description     string   `json:"description" binding:"max=20000"`
	Category        string   `json:"category" binding:"max=50"`
	Status          string   `json:"status" binding:"omitempty,oneof=todo in_progress done"`
	Priority        string   `json:"priority" binding:"omitempty,oneof=low medium high"`
	ParentFeatureID *uint    `json:"parent_feature_id"`
	AssigneeID      *uint    `json:"assignee_id"`
	Tags            []string `json:"tags"`
}

// UpdateFeatureRequest is the accepted body for a partial update. Pointers
// distinguish "not sent" from "set to empty", so omitting a field leaves it
// alone while sending "" clears it.
type UpdateFeatureRequest struct {
	Title           *string `json:"title" binding:"omitempty,min=1,max=255"`
	Description     *string `json:"description" binding:"omitempty,max=20000"`
	Category        *string `json:"category" binding:"omitempty,max=50"`
	Status          *string `json:"status" binding:"omitempty,oneof=todo in_progress done"`
	Priority        *string `json:"priority" binding:"omitempty,oneof=low medium high"`
	ParentFeatureID *uint   `json:"parent_feature_id"`
	AssigneeID      *uint   `json:"assignee_id"`
}

// Apply copies the fields that were present onto a feature model.
func (r UpdateFeatureRequest) Apply(f *models.Feature) {
	if r.Title != nil {
		f.Title = *r.Title
	}
	if r.Description != nil {
		f.Description = *r.Description
	}
	if r.Category != nil {
		f.Category = *r.Category
	}
	if r.Status != nil {
		f.Status = models.FeatureStatus(*r.Status)
	}
	if r.Priority != nil {
		f.Priority = models.FeaturePriority(*r.Priority)
	}
	if r.ParentFeatureID != nil {
		f.ParentFeatureID = r.ParentFeatureID
	}
	if r.AssigneeID != nil {
		f.AssigneeID = *r.AssigneeID
	}
}

// ReplaceTagsRequest sets a feature's tags to exactly this list.
type ReplaceTagsRequest struct {
	Tags []string `json:"tags"`
}

func emptyIfNil(values []string) []string {
	if values == nil {
		return []string{}
	}
	return values
}

// PullRequestDTO is a pull request as attached to a task.
type PullRequestDTO struct {
	ID       uint   `json:"id"`
	TaskID   uint   `json:"task_id"`
	URL      string `json:"url"`
	Title    string `json:"title"`
	Branch   string `json:"branch"`
	Status   string `json:"status"`
	Tested   bool   `json:"tested"`
	Approved bool   `json:"approved"`
}

// NewPullRequestDTO converts a pull request for output.
//
// Approved is derived rather than read: pull_requests has no approved column,
// only a status whose casing varies in existing data.
func NewPullRequestDTO(pr models.PullRequest) PullRequestDTO {
	return PullRequestDTO{
		ID:       pr.ID,
		TaskID:   pr.TaskID,
		URL:      pr.URL,
		Title:    pr.Title,
		Branch:   pr.Branch,
		Status:   pr.Status,
		Tested:   pr.Tested,
		Approved: strings.EqualFold(pr.Status, "approved"),
	}
}

// CommentDTO is a comment as the API presents one.
type CommentDTO struct {
	ID           uint      `json:"id"`
	TaskID       uint      `json:"task_id"`
	AttachmentID *uint     `json:"attachment_id,omitempty"`
	Content      string    `json:"content"`
	Author       *UserDTO  `json:"author,omitempty"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

// NewCommentDTO converts a comment for output. The author is included only
// when it was preloaded.
func NewCommentDTO(c models.Comment) CommentDTO {
	dto := CommentDTO{
		ID:           c.ID,
		TaskID:       c.TaskID,
		AttachmentID: c.AttachmentID,
		Content:      c.Content,
		CreatedAt:    c.CreatedAt,
		UpdatedAt:    c.UpdatedAt,
	}
	if c.User.ID != 0 {
		author := NewUserDTO(c.User)
		dto.Author = &author
	}
	return dto
}

// NewCommentDTOs converts a slice, always returning a non-nil result.
func NewCommentDTOs(comments []models.Comment) []CommentDTO {
	out := make([]CommentDTO, 0, len(comments))
	for _, c := range comments {
		out = append(out, NewCommentDTO(c))
	}
	return out
}

// AttachmentDTO is a file attached to a task.
type AttachmentDTO struct {
	ID        uint      `json:"id"`
	TaskID    uint      `json:"task_id"`
	FileName  string    `json:"file_name"`
	FileSize  int64     `json:"file_size"`
	MimeType  string    `json:"mime_type"`
	CreatedAt time.Time `json:"created_at"`
}

// NewAttachmentDTO converts an attachment for output.
func NewAttachmentDTO(a models.TaskAttachment) AttachmentDTO {
	return AttachmentDTO{
		ID:        a.ID,
		TaskID:    a.TaskID,
		FileName:  a.FileName,
		FileSize:  a.FileSize,
		MimeType:  a.MimeType,
		CreatedAt: a.CreatedAt,
	}
}

// TaskDTO is a task as the API presents one.
//
// Done is derived, not stored: models.Task has no status column, and a task
// counts as complete once one of its pull requests is tested and approved.
type TaskDTO struct {
	ID          uint   `json:"id"`
	FeatureID   uint   `json:"feature_id"`
	TaskName    string `json:"task_name"`
	TaskType    string `json:"task_type"`
	Description string `json:"description"`
	Done        bool   `json:"done"`

	CommentCount int              `json:"comment_count"`
	PullRequests []PullRequestDTO `json:"pull_requests"`

	// Comments is filled only on a detail response.
	Comments []CommentDTO `json:"comments,omitempty"`

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// NewTaskDTO converts a task for output.
func NewTaskDTO(t models.Task, done bool, commentCount int, prs []PullRequestDTO) TaskDTO {
	if prs == nil {
		prs = []PullRequestDTO{}
	}
	return TaskDTO{
		ID:           t.ID,
		FeatureID:    t.FeatureID,
		TaskName:     t.TaskName,
		TaskType:     t.TaskType,
		Description:  t.Description,
		Done:         done,
		CommentCount: commentCount,
		PullRequests: prs,
		CreatedAt:    t.CreatedAt,
		UpdatedAt:    t.UpdatedAt,
	}
}

// NewTaskDTOs converts a slice, always returning a non-nil result.
func NewTaskDTOs(
	tasks []models.Task,
	completion map[uint]bool,
	counts map[uint]int,
	prs map[uint][]PullRequestDTO,
) []TaskDTO {
	out := make([]TaskDTO, 0, len(tasks))
	for _, t := range tasks {
		out = append(out, NewTaskDTO(t, completion[t.ID], counts[t.ID], prs[t.ID]))
	}
	return out
}

// CreateTaskRequest is the accepted body for creating a task.
type CreateTaskRequest struct {
	TaskName    string `json:"task_name" binding:"required,min=1,max=255"`
	TaskType    string `json:"task_type" binding:"max=50"`
	Description string `json:"description" binding:"max=20000"`
}

// UpdateTaskRequest is the accepted body for a partial update.
type UpdateTaskRequest struct {
	TaskName    *string `json:"task_name" binding:"omitempty,min=1,max=255"`
	TaskType    *string `json:"task_type" binding:"omitempty,max=50"`
	Description *string `json:"description" binding:"omitempty,max=20000"`
}

// Apply copies the fields that were present onto a task model.
func (r UpdateTaskRequest) Apply(t *models.Task) {
	if r.TaskName != nil {
		t.TaskName = *r.TaskName
	}
	if r.TaskType != nil {
		t.TaskType = *r.TaskType
	}
	if r.Description != nil {
		t.Description = *r.Description
	}
}

// CreateCommentRequest is the accepted body for posting a comment.
type CreateCommentRequest struct {
	Content      string `json:"content" binding:"required,min=1,max=20000"`
	AttachmentID *uint  `json:"attachment_id"`
}

// UpdateCommentRequest is the accepted body for editing a comment.
type UpdateCommentRequest struct {
	Content string `json:"content" binding:"required,min=1,max=20000"`
}

// GraphNode is a feature as drawn on the dependency canvas.
type GraphNode struct {
	ID       uint     `json:"id"`
	Title    string   `json:"title"`
	Status   string   `json:"status"`
	Priority string   `json:"priority"`
	Category string   `json:"category"`
	Tags     []string `json:"tags"`

	// Depth is the longest path leading into this node, which the canvas uses
	// to lay the graph out in columns without repeating the walk in the browser.
	Depth int `json:"depth"`
}

// GraphEdge is one dependency: ParentID must be done before ChildID.
type GraphEdge struct {
	ID          uint   `json:"id"`
	ParentID    uint   `json:"parent_id"`
	ChildID     uint   `json:"child_id"`
	Description string `json:"description,omitempty"`

	// InCycle marks an edge that takes part in a loop, so the canvas can draw
	// it differently rather than leaving the reader to spot it.
	InCycle bool `json:"in_cycle"`
}

// GraphCycle is one dependency loop, as the nodes and edges that form it.
type GraphCycle struct {
	NodeIDs []uint `json:"node_ids"`
	EdgeIDs []uint `json:"edge_ids"`
}

// DependencyGraph is a project's features and the dependencies between them.
type DependencyGraph struct {
	ProjectID int          `json:"project_id"`
	Nodes     []GraphNode  `json:"nodes"`
	Edges     []GraphEdge  `json:"edges"`
	Cycles    []GraphCycle `json:"cycles"`
}

// DependencyDTO is a single dependency as returned after a write.
type DependencyDTO struct {
	ID          uint   `json:"id"`
	ParentID    uint   `json:"parent_id"`
	ChildID     uint   `json:"child_id"`
	Description string `json:"description,omitempty"`

	// CreatesCycle warns that this edge closes a loop. Adding it is allowed:
	// the data can be correct while the plan is not, and the person adding it
	// is better placed to decide which edge should go.
	CreatesCycle bool `json:"creates_cycle"`
}

// NewDependencyDTO converts a dependency for output.
func NewDependencyDTO(d models.Dependency, createsCycle bool) DependencyDTO {
	return DependencyDTO{
		ID:           d.ID,
		ParentID:     d.ParentID,
		ChildID:      d.ChildID,
		Description:  d.Description,
		CreatesCycle: createsCycle,
	}
}

// CreateDependencyRequest is the accepted body for adding a dependency.
// ParentID must be completed before ChildID can start.
type CreateDependencyRequest struct {
	ParentID    uint   `json:"parent_id" binding:"required"`
	ChildID     uint   `json:"child_id" binding:"required"`
	Description string `json:"description" binding:"max=1000"`
}
