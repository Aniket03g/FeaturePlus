package v1

import (
	"sort"
	"strings"

	"github.com/FeaturePlus/backend/api"
	"github.com/FeaturePlus/backend/internal/log"
	"github.com/FeaturePlus/backend/models"
	"github.com/FeaturePlus/backend/repositories"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// TasksHandler serves /api/v1 task routes.
//
// A task has no status column. Whether it is done is derived from its pull
// requests: complete once one of them is both tested and approved. That rule
// lives in taskCompletion below so every task response agrees on it.
type TasksHandler struct {
	repo        repositories.TaskRepository
	featureRepo *repositories.FeatureRepository
	projectRepo *repositories.ProjectRepository
	commentRepo *repositories.CommentRepository
	db          *gorm.DB
}

// NewTasksHandler builds the handler.
func NewTasksHandler(db *gorm.DB) *TasksHandler {
	return &TasksHandler{
		repo:        repositories.NewTaskRepository(db),
		featureRepo: repositories.NewFeatureRepository(db),
		projectRepo: repositories.NewProjectRepository(db),
		commentRepo: repositories.NewCommentRepository(db),
		db:          db,
	}
}

// Register mounts the task routes onto an authenticated group.
func (h *TasksHandler) Register(g *gin.RouterGroup) {
	g.GET("/features/:featureId/tasks", h.ListForFeature)
	g.POST("/features/:featureId/tasks", h.Create)

	tasks := g.Group("/tasks")
	{
		tasks.GET("/:taskId", h.Get)
		tasks.PATCH("/:taskId", h.Update)
		tasks.DELETE("/:taskId", h.Delete)
		tasks.GET("/:taskId/comments", h.ListComments)
		tasks.POST("/:taskId/comments", h.AddComment)
	}

	g.PATCH("/comments/:commentId", h.UpdateComment)
	g.DELETE("/comments/:commentId", h.DeleteComment)
}

// ListForFeature returns a feature's tasks.
//
// GET /api/v1/features/:featureId/tasks?type=&done=true|false&q=
func (h *TasksHandler) ListForFeature(c *gin.Context) {
	featureID, err := api.IDParam(c, "featureId")
	if err != nil {
		api.Fail(c, err)
		return
	}

	if _, dbErr := h.featureRepo.GetFeatureByID(featureID); dbErr != nil {
		api.Fail(c, api.FromDB(dbErr, "Feature"))
		return
	}

	tasks, dbErr := h.repo.GetByFeatureID(uint(featureID))
	if dbErr != nil {
		api.Fail(c, api.Internal(dbErr))
		return
	}

	ids := taskIDs(tasks)
	completion := h.taskCompletion(ids)
	counts := h.commentCounts(ids)
	prs := h.pullRequests(ids)

	filtered := filterTasks(tasks, completion, taskFilters{
		types: lowerSet(c.QueryArray("type")),
		query: strings.ToLower(c.Query("q")),
		done:  c.Query("done"),
	})

	// Outstanding work first: an unfinished task is what a person opening this
	// list is looking for, and a finished one is reference.
	sort.SliceStable(filtered, func(i, j int) bool {
		a, b := completion[filtered[i].ID], completion[filtered[j].ID]
		if a != b {
			return !a
		}
		return filtered[i].ID < filtered[j].ID
	})

	page := api.ParsePage(c)
	total := int64(len(filtered))
	items := api.Slice(filtered, page)

	api.List(c, NewTaskDTOs(items, completion, counts, prs), page.Meta(total))
}

// Get returns one task with its comments and pull requests.
//
// GET /api/v1/tasks/:taskId
func (h *TasksHandler) Get(c *gin.Context) {
	id, err := api.IDParam(c, "taskId")
	if err != nil {
		api.Fail(c, err)
		return
	}

	task, dbErr := h.repo.GetByID(uint(id))
	if dbErr != nil {
		api.Fail(c, api.FromDB(dbErr, "Task"))
		return
	}

	ids := []uint{task.ID}
	dto := NewTaskDTO(*task, h.taskCompletion(ids)[task.ID], h.commentCounts(ids)[task.ID], h.pullRequests(ids)[task.ID])

	comments, commentErr := h.commentRepo.GetByTaskID(task.ID)
	if commentErr == nil {
		dto.Comments = NewCommentDTOs(comments)
	}

	api.OK(c, dto)
}

// Create adds a task to a feature.
//
// POST /api/v1/features/:featureId/tasks
func (h *TasksHandler) Create(c *gin.Context) {
	featureID, err := api.IDParam(c, "featureId")
	if err != nil {
		api.Fail(c, err)
		return
	}

	feature, dbErr := h.featureRepo.GetFeatureByID(featureID)
	if dbErr != nil {
		api.Fail(c, api.FromDB(dbErr, "Feature"))
		return
	}

	var req CreateTaskRequest
	if bindErr := api.Bind(c, &req); bindErr != nil {
		api.Fail(c, bindErr)
		return
	}

	if err := h.authoriseFeatureWrite(c, feature); err != nil {
		api.Fail(c, err)
		return
	}

	userID, _ := api.UserID(c)
	task := models.Task{
		FeatureID:     feature.ID,
		TaskName:      req.TaskName,
		TaskType:      orDefault(req.TaskType, "Dev"),
		Description:   req.Description,
		CreatedByUser: uint(userID),
	}

	if dbErr := h.repo.Create(&task); dbErr != nil {
		api.Fail(c, api.FromDB(dbErr, "Task"))
		return
	}

	api.Created(c, NewTaskDTO(task, false, 0, nil))
}

// Update changes the fields present in the body.
//
// PATCH /api/v1/tasks/:taskId
func (h *TasksHandler) Update(c *gin.Context) {
	task, err := h.loadForWrite(c)
	if err != nil {
		api.Fail(c, err)
		return
	}

	var req UpdateTaskRequest
	if bindErr := api.Bind(c, &req); bindErr != nil {
		api.Fail(c, bindErr)
		return
	}

	req.Apply(task)

	if dbErr := h.repo.Update(task); dbErr != nil {
		api.Fail(c, api.FromDB(dbErr, "Task"))
		return
	}

	ids := []uint{task.ID}
	api.OK(c, NewTaskDTO(*task, h.taskCompletion(ids)[task.ID], h.commentCounts(ids)[task.ID], h.pullRequests(ids)[task.ID]))
}

// Delete removes a task.
//
// DELETE /api/v1/tasks/:taskId
func (h *TasksHandler) Delete(c *gin.Context) {
	task, err := h.loadForWrite(c)
	if err != nil {
		api.Fail(c, err)
		return
	}

	// A task carrying pull requests is a record of work, not a mistake to be
	// swept away. Refuse, and say what is attached.
	var prCount int64
	if dbErr := h.db.Model(&models.PullRequest{}).
		Where("task_id = ? AND deleted_at IS NULL", task.ID).
		Count(&prCount).Error; dbErr != nil {
		api.Fail(c, api.Internal(dbErr))
		return
	}
	if prCount > 0 {
		api.Fail(c, api.Conflict(
			"This task has "+plural(int(prCount), "pull request")+" attached. Detach them first."))
		return
	}

	// Comments and attachments belong to the task and go with it; unlike pull
	// requests they have no meaning on their own.
	if dbErr := h.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("task_id = ?", task.ID).Delete(&models.Comment{}).Error; err != nil {
			return err
		}
		return tx.Delete(&models.Task{}, task.ID).Error
	}); dbErr != nil {
		api.Fail(c, api.Internal(dbErr))
		return
	}

	api.NoContent(c)
}

// ListComments returns a task's comments, oldest first.
//
// GET /api/v1/tasks/:taskId/comments
func (h *TasksHandler) ListComments(c *gin.Context) {
	id, err := api.IDParam(c, "taskId")
	if err != nil {
		api.Fail(c, err)
		return
	}

	if _, dbErr := h.repo.GetByID(uint(id)); dbErr != nil {
		api.Fail(c, api.FromDB(dbErr, "Task"))
		return
	}

	comments, dbErr := h.commentRepo.GetByTaskID(uint(id))
	if dbErr != nil {
		api.Fail(c, api.Internal(dbErr))
		return
	}

	dtos := NewCommentDTOs(comments)
	api.List(c, dtos, api.Meta{
		Total: int64(len(dtos)), Page: 1, PerPage: len(dtos), TotalPages: 1,
	})
}

// AddComment posts a comment on a task.
//
// POST /api/v1/tasks/:taskId/comments
func (h *TasksHandler) AddComment(c *gin.Context) {
	id, err := api.IDParam(c, "taskId")
	if err != nil {
		api.Fail(c, err)
		return
	}

	if _, dbErr := h.repo.GetByID(uint(id)); dbErr != nil {
		api.Fail(c, api.FromDB(dbErr, "Task"))
		return
	}

	var req CreateCommentRequest
	if bindErr := api.Bind(c, &req); bindErr != nil {
		api.Fail(c, bindErr)
		return
	}

	userID, err := api.UserID(c)
	if err != nil {
		api.Fail(c, err)
		return
	}

	// Validation runs against the raw string, so "   " satisfies a minimum
	// length and then trims away to nothing. Check the trimmed value.
	content := strings.TrimSpace(req.Content)
	if content == "" {
		api.Fail(c, api.Validation("The comment is empty").
			WithField("content", "This field is required"))
		return
	}

	// Commenting is open to any authenticated user: discussion is the point,
	// and unlike editing a task it changes nothing about the work itself.
	comment := models.Comment{
		TaskID:       uint(id),
		UserID:       uint(userID),
		Content:      content,
		AttachmentID: req.AttachmentID,
	}

	if dbErr := h.commentRepo.Create(&comment); dbErr != nil {
		api.Fail(c, api.FromDB(dbErr, "Comment"))
		return
	}

	// Re-read so the response carries the author, which the list needs to show
	// a name rather than an id.
	if saved, readErr := h.commentRepo.GetByID(comment.ID); readErr == nil {
		api.Created(c, NewCommentDTO(*saved))
		return
	}

	api.Created(c, NewCommentDTO(comment))
}

// UpdateComment edits a comment's text.
//
// PATCH /api/v1/comments/:commentId
func (h *TasksHandler) UpdateComment(c *gin.Context) {
	comment, err := h.loadCommentForWrite(c)
	if err != nil {
		api.Fail(c, err)
		return
	}

	var req UpdateCommentRequest
	if bindErr := api.Bind(c, &req); bindErr != nil {
		api.Fail(c, bindErr)
		return
	}

	content := strings.TrimSpace(req.Content)
	if content == "" {
		api.Fail(c, api.Validation("The comment is empty").
			WithField("content", "This field is required"))
		return
	}
	comment.Content = content

	if dbErr := h.commentRepo.Update(comment); dbErr != nil {
		api.Fail(c, api.FromDB(dbErr, "Comment"))
		return
	}

	api.OK(c, NewCommentDTO(*comment))
}

// DeleteComment removes a comment.
//
// DELETE /api/v1/comments/:commentId
func (h *TasksHandler) DeleteComment(c *gin.Context) {
	comment, err := h.loadCommentForWrite(c)
	if err != nil {
		api.Fail(c, err)
		return
	}

	if dbErr := h.commentRepo.Delete(comment.ID); dbErr != nil {
		api.Fail(c, api.FromDB(dbErr, "Comment"))
		return
	}

	api.NoContent(c)
}

// loadForWrite fetches the task named in the path and checks the caller may
// change it. Permission follows the task's project, through its feature.
func (h *TasksHandler) loadForWrite(c *gin.Context) (*models.Task, error) {
	id, err := api.IDParam(c, "taskId")
	if err != nil {
		return nil, err
	}

	task, dbErr := h.repo.GetByID(uint(id))
	if dbErr != nil {
		return nil, api.FromDB(dbErr, "Task")
	}

	feature, dbErr := h.featureRepo.GetFeatureByID(int(task.FeatureID))
	if dbErr != nil {
		return nil, api.FromDB(dbErr, "Feature")
	}

	if err := h.authoriseFeatureWrite(c, feature); err != nil {
		return nil, err
	}

	return task, nil
}

// loadCommentForWrite fetches a comment and checks the caller may change it.
//
// A comment belongs to whoever wrote it: its author may edit or delete it, and
// so may a manager. The project owner deliberately cannot edit someone else's
// words, only remove the task they hang from.
func (h *TasksHandler) loadCommentForWrite(c *gin.Context) (*models.Comment, error) {
	id, err := api.IDParam(c, "commentId")
	if err != nil {
		return nil, err
	}

	comment, dbErr := h.commentRepo.GetByID(uint(id))
	if dbErr != nil {
		return nil, api.FromDB(dbErr, "Comment")
	}

	userID, err := api.UserID(c)
	if err != nil {
		return nil, err
	}

	if comment.UserID != uint(userID) && !api.IsManager(c) {
		return nil, api.Forbidden("Only the author can change this comment")
	}

	return comment, nil
}

// authoriseFeatureWrite permits changes by the owner of the feature's project,
// or a manager — the same rule the project and feature handlers apply.
func (h *TasksHandler) authoriseFeatureWrite(c *gin.Context, feature *models.Feature) error {
	userID, err := api.UserID(c)
	if err != nil {
		return err
	}

	if api.IsManager(c) {
		return nil
	}

	project, dbErr := h.projectRepo.GetProjectByID(feature.ProjectID)
	if dbErr != nil {
		return api.FromDB(dbErr, "Project")
	}
	if project.OwnerID == userID {
		return nil
	}

	return api.Forbidden("Only the project owner or a manager can change this project's tasks")
}

// taskCompletion reports, for many tasks at once, whether each has a pull
// request that is both tested and approved.
//
// Approval is recorded in pull_requests.status, whose casing is inconsistent
// in existing data ("Approved" and "approved" both occur), so the comparison
// is lowercased. There is no approved column, despite older code querying one.
func (h *TasksHandler) taskCompletion(ids []uint) map[uint]bool {
	done := map[uint]bool{}
	if len(ids) == 0 {
		return done
	}

	var completedIDs []uint
	if err := h.db.Model(&models.PullRequest{}).
		Distinct("task_id").
		Where("task_id IN ? AND tested = 1 AND lower(status) = 'approved' AND deleted_at IS NULL", ids).
		Pluck("task_id", &completedIDs).Error; err != nil {
		log.WithError(err).Warn("could not load task completion")
		return done
	}

	for _, id := range completedIDs {
		done[id] = true
	}
	return done
}

// commentCounts loads comment totals for many tasks in one query.
func (h *TasksHandler) commentCounts(ids []uint) map[uint]int {
	counts := map[uint]int{}
	if len(ids) == 0 {
		return counts
	}

	type row struct {
		TaskID uint
		Count  int
	}
	var rows []row

	if err := h.db.Model(&models.Comment{}).
		Select("task_id, count(*) as count").
		Where("task_id IN ?", ids).
		Group("task_id").
		Scan(&rows).Error; err != nil {
		log.WithError(err).Warn("could not load comment counts")
		return counts
	}

	for _, r := range rows {
		counts[r.TaskID] = r.Count
	}
	return counts
}

// pullRequests loads the pull requests attached to many tasks in one query.
func (h *TasksHandler) pullRequests(ids []uint) map[uint][]PullRequestDTO {
	result := map[uint][]PullRequestDTO{}
	if len(ids) == 0 {
		return result
	}

	var prs []models.PullRequest
	if err := h.db.Where("task_id IN ? AND deleted_at IS NULL", ids).
		Order("id DESC").Find(&prs).Error; err != nil {
		log.WithError(err).Warn("could not load task pull requests")
		return result
	}

	for _, pr := range prs {
		result[pr.TaskID] = append(result[pr.TaskID], NewPullRequestDTO(pr))
	}
	return result
}

// taskFilters is the parsed query string for a task list.
type taskFilters struct {
	types map[string]bool
	query string
	done  string
}

func filterTasks(tasks []models.Task, completion map[uint]bool, f taskFilters) []models.Task {
	out := make([]models.Task, 0, len(tasks))

	for _, task := range tasks {
		if len(f.types) > 0 && !f.types[strings.ToLower(task.TaskType)] {
			continue
		}
		if f.done == "true" && !completion[task.ID] {
			continue
		}
		if f.done == "false" && completion[task.ID] {
			continue
		}
		if f.query != "" &&
			!strings.Contains(strings.ToLower(task.TaskName), f.query) &&
			!strings.Contains(strings.ToLower(task.Description), f.query) {
			continue
		}
		out = append(out, task)
	}

	return out
}

func taskIDs(tasks []models.Task) []uint {
	ids := make([]uint, 0, len(tasks))
	for _, t := range tasks {
		ids = append(ids, t.ID)
	}
	return ids
}
