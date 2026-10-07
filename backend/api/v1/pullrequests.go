package v1

import (
	"sort"
	"strings"
	"time"

	"github.com/FeaturePlus/backend/api"
	"github.com/FeaturePlus/backend/internal/log"
	"github.com/FeaturePlus/backend/models"
	"github.com/FeaturePlus/backend/repositories"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// PullRequestsHandler serves /api/v1 pull request routes.
//
// A pull request hangs off a task, and reaches its project through that task's
// feature. There is no project_id column on pull_requests, so a project-wide
// list is assembled by resolving the project's features first — which is also
// why the list route lives under a project rather than at the top level.
//
// Two flags decide whether the work it represents is finished, and they are
// separate on purpose: Tested is a statement about the code, and an approval
// is a statement by a person. A task counts as done only when both hold.
type PullRequestsHandler struct {
	repo         repositories.PullRequestRepository
	approvalRepo repositories.ApprovedPRRepository
	featureRepo  *repositories.FeatureRepository
	taskRepo     repositories.TaskRepository
	projectRepo  *repositories.ProjectRepository
	db           *gorm.DB
}

// NewPullRequestsHandler builds the handler.
func NewPullRequestsHandler(db *gorm.DB) *PullRequestsHandler {
	return &PullRequestsHandler{
		repo:         repositories.NewPullRequestRepository(db),
		approvalRepo: repositories.NewApprovedPRRepository(db),
		featureRepo:  repositories.NewFeatureRepository(db),
		taskRepo:     repositories.NewTaskRepository(db),
		projectRepo:  repositories.NewProjectRepository(db),
		db:           db,
	}
}

// Register mounts the pull request routes onto an authenticated group.
func (h *PullRequestsHandler) Register(g *gin.RouterGroup) {
	g.GET("/projects/:id/pull-requests", h.ListForProject)
	g.POST("/tasks/:taskId/pull-requests", h.Create)

	prs := g.Group("/pull-requests")
	{
		prs.GET("/:prId", h.Get)
		prs.PATCH("/:prId", h.Update)
		prs.DELETE("/:prId", h.Delete)
		prs.POST("/:prId/review", h.Review)
		prs.POST("/:prId/tested", h.MarkTested)
	}
}

// ListForProject returns every pull request raised against a project.
//
// GET /api/v1/projects/:id/pull-requests?status=&tested=true|false&q=&mine=true
func (h *PullRequestsHandler) ListForProject(c *gin.Context) {
	projectID, err := api.IDParam(c, "id")
	if err != nil {
		api.Fail(c, err)
		return
	}

	if _, err := requireProject(c, h.db, projectID, canView); err != nil {
		api.Fail(c, err)
		return
	}

	features, dbErr := h.featureRepo.GetFeaturesByProject(projectID)
	if dbErr != nil {
		api.Fail(c, api.Internal(dbErr))
		return
	}

	if len(features) == 0 {
		api.List(c, []PullRequestDTO{}, api.ParsePage(c).Meta(0))
		return
	}

	// Rows written before feature_id was populated carry a zero there, so the
	// project's tasks are matched as well; without that those pull requests
	// belong to no project and appear on no screen.
	ids := featureIDs(features)
	var taskIDList []uint
	if dbErr := h.db.Model(&models.Task{}).
		Where("feature_id IN ? AND deleted_at IS NULL", ids).
		Pluck("id", &taskIDList).Error; dbErr != nil {
		api.Fail(c, api.Internal(dbErr))
		return
	}

	var prs []models.PullRequest
	query := h.db.Where("deleted_at IS NULL")
	if len(taskIDList) > 0 {
		query = query.Where("feature_id IN ? OR task_id IN ?", ids, taskIDList)
	} else {
		query = query.Where("feature_id IN ?", ids)
	}
	if dbErr := query.Find(&prs).Error; dbErr != nil {
		api.Fail(c, api.Internal(dbErr))
		return
	}

	filtered := filterPullRequests(prs, pullRequestFilters{
		statuses: lowerSet(c.QueryArray("status")),
		tested:   c.Query("tested"),
		query:    strings.ToLower(c.Query("q")),
	})

	// Waiting on someone first, settled work after: a pull request list is a
	// queue, and the queue is what the reader came for.
	sort.SliceStable(filtered, func(i, j int) bool {
		a, b := isSettled(filtered[i]), isSettled(filtered[j])
		if a != b {
			return !a
		}
		return filtered[i].ID > filtered[j].ID
	})

	page := api.ParsePage(c)
	total := int64(len(filtered))
	items := api.Slice(filtered, page)

	api.List(c, h.withContext(items, projectID), page.Meta(total))
}

// Get returns one pull request with its approvals.
//
// GET /api/v1/pull-requests/:prId
func (h *PullRequestsHandler) Get(c *gin.Context) {
	pr, err := h.load(c)
	if err != nil {
		api.Fail(c, err)
		return
	}

	projectID := 0
	if feature, dbErr := h.featureFor(pr); dbErr == nil {
		projectID = feature.ProjectID
	}

	dtos := h.withContext([]models.PullRequest{*pr}, projectID)
	dto := dtos[0]

	if approvals, dbErr := h.approvalRepo.FindByPullRequestID(pr.ID); dbErr == nil {
		dto.Approvals = NewApprovalDTOs(approvals)
	} else {
		log.WithError(dbErr).Warn("could not load pull request approvals")
	}

	api.OK(c, dto)
}

// Create attaches a pull request to a task.
//
// POST /api/v1/tasks/:taskId/pull-requests
func (h *PullRequestsHandler) Create(c *gin.Context) {
	taskID, err := api.IDParam(c, "taskId")
	if err != nil {
		api.Fail(c, err)
		return
	}

	task, dbErr := h.taskRepo.GetByID(uint(taskID))
	if dbErr != nil {
		api.Fail(c, api.FromDB(dbErr, "Task"))
		return
	}

	var req CreatePullRequestRequest
	if bindErr := api.Bind(c, &req); bindErr != nil {
		api.Fail(c, bindErr)
		return
	}

	feature, dbErr := h.featureRepo.GetFeatureByID(int(task.FeatureID))
	if dbErr != nil {
		api.Fail(c, api.FromDB(dbErr, "Feature"))
		return
	}

	if err := h.authoriseProject(c, feature.ProjectID); err != nil {
		api.Fail(c, err)
		return
	}

	// The same branch twice on one task is a mistake far more often than it is
	// intent, and it makes the completion rule ambiguous.
	var clash int64
	if dbErr := h.db.Model(&models.PullRequest{}).
		Where("task_id = ? AND branch = ? AND deleted_at IS NULL", task.ID, req.Branch).
		Count(&clash).Error; dbErr != nil {
		api.Fail(c, api.Internal(dbErr))
		return
	}
	if clash > 0 {
		api.Fail(c, api.Conflict("This task already has a pull request for branch "+req.Branch))
		return
	}

	pr := models.PullRequest{
		TaskID:      task.ID,
		FeatureID:   feature.ID,
		Title:       req.Title,
		URL:         req.URL,
		Branch:      req.Branch,
		Description: req.Description,
		Version:     req.Version,
		Status:      "Open",
	}

	if dbErr := h.repo.Create(&pr); dbErr != nil {
		api.Fail(c, api.FromDB(dbErr, "Pull request"))
		return
	}

	api.Created(c, NewPullRequestDTO(pr))
}

// Update changes a pull request's own fields.
//
// PATCH /api/v1/pull-requests/:prId
func (h *PullRequestsHandler) Update(c *gin.Context) {
	pr, err := h.loadForWrite(c)
	if err != nil {
		api.Fail(c, err)
		return
	}

	var req UpdatePullRequestRequest
	if bindErr := api.Bind(c, &req); bindErr != nil {
		api.Fail(c, bindErr)
		return
	}

	req.Apply(pr)

	if dbErr := h.repo.UpdatePR(pr); dbErr != nil {
		api.Fail(c, api.FromDB(dbErr, "Pull request"))
		return
	}

	api.OK(c, NewPullRequestDTO(*pr))
}

// Delete removes a pull request.
//
// DELETE /api/v1/pull-requests/:prId
//
// A pull request that is part of a release is refused: dropping it would
// quietly change what that release contains.
func (h *PullRequestsHandler) Delete(c *gin.Context) {
	pr, err := h.loadForWrite(c)
	if err != nil {
		api.Fail(c, err)
		return
	}

	var releaseCount int64
	if dbErr := h.db.Table("release_prs").
		Where("pull_request_id = ?", pr.ID).
		Count(&releaseCount).Error; dbErr != nil {
		api.Fail(c, api.Internal(dbErr))
		return
	}
	if releaseCount > 0 {
		api.Fail(c, api.Conflict(
			"This pull request is part of "+plural(int(releaseCount), "release")+
				". Remove it from those first."))
		return
	}

	if dbErr := h.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("pull_request_id = ?", pr.ID).Delete(&models.ApprovedPR{}).Error; err != nil {
			return err
		}
		return tx.Delete(&models.PullRequest{}, pr.ID).Error
	}); dbErr != nil {
		api.Fail(c, api.Internal(dbErr))
		return
	}

	api.NoContent(c)
}

// Review records a decision on a pull request.
//
// POST /api/v1/pull-requests/:prId/review
//
// Approving writes a row naming who approved and when, which is what makes an
// approval auditable rather than just a word in a status column. Withdrawing
// an approval — any decision other than "approved" — removes this reviewer's
// row, so the record and the status cannot drift apart.
func (h *PullRequestsHandler) Review(c *gin.Context) {
	pr, err := h.loadForWrite(c)
	if err != nil {
		api.Fail(c, err)
		return
	}

	var req ReviewPullRequestRequest
	if bindErr := api.Bind(c, &req); bindErr != nil {
		api.Fail(c, bindErr)
		return
	}

	userID, err := api.UserID(c)
	if err != nil {
		api.Fail(c, err)
		return
	}

	// There is deliberately no rule against approving your own work. Write
	// access here already means owning the project or managing it, and on a
	// one-person project such a rule would mean no pull request could ever be
	// approved and so no task could ever be complete.
	status := reviewStatusLabel(req.Status)

	if dbErr := h.db.Transaction(func(tx *gorm.DB) error {
		updates := map[string]any{"status": status}
		if strings.TrimSpace(req.Comment) != "" {
			updates["description"] = strings.TrimSpace(req.Comment)
		}
		if err := tx.Model(&models.PullRequest{}).Where("id = ?", pr.ID).Updates(updates).Error; err != nil {
			return err
		}

		// One reviewer, one row: re-approving replaces the earlier entry
		// rather than stacking up duplicates.
		if err := tx.Where("pull_request_id = ? AND user_id = ?", pr.ID, userID).
			Delete(&models.ApprovedPR{}).Error; err != nil {
			return err
		}

		if req.Status != "approved" {
			return nil
		}

		return tx.Create(&models.ApprovedPR{
			PullRequestID: pr.ID,
			UserID:        userID,
			ApprovedAt:    time.Now().Unix(),
			Version:       pr.Version,
		}).Error
	}); dbErr != nil {
		api.Fail(c, api.Internal(dbErr))
		return
	}

	pr.Status = status
	if strings.TrimSpace(req.Comment) != "" {
		pr.Description = strings.TrimSpace(req.Comment)
	}

	dto := NewPullRequestDTO(*pr)
	if approvals, dbErr := h.approvalRepo.FindByPullRequestID(pr.ID); dbErr == nil {
		dto.Approvals = NewApprovalDTOs(approvals)
	}

	api.OK(c, dto)
}

// MarkTested sets or clears the tested flag.
//
// POST /api/v1/pull-requests/:prId/tested
func (h *PullRequestsHandler) MarkTested(c *gin.Context) {
	pr, err := h.loadForWrite(c)
	if err != nil {
		api.Fail(c, err)
		return
	}

	var req MarkTestedRequest
	if bindErr := api.Bind(c, &req); bindErr != nil {
		api.Fail(c, bindErr)
		return
	}

	if dbErr := h.db.Model(&models.PullRequest{}).Where("id = ?", pr.ID).
		Update("tested", *req.Tested).Error; dbErr != nil {
		api.Fail(c, api.FromDB(dbErr, "Pull request"))
		return
	}
	pr.Tested = *req.Tested

	api.OK(c, NewPullRequestDTO(*pr))
}

// withContext turns models into DTOs carrying the task and feature names a
// standalone list needs, loaded in two queries rather than one per row.
func (h *PullRequestsHandler) withContext(prs []models.PullRequest, projectID int) []PullRequestDTO {
	return pullRequestDTOsWithContext(h.db, prs, projectID)
}

// pullRequestDTOsWithContext names what each pull request is attached to.
//
// It is a package function rather than a method because the release screen
// needs exactly the same thing: a list of pull requests read outside a task
// has to say which task and feature it came from, or it is a list of branch
// names and nothing else.
//
// Pass a projectID of zero to leave that field out.
func pullRequestDTOsWithContext(db *gorm.DB, prs []models.PullRequest, projectID int) []PullRequestDTO {
	dtos := NewPullRequestDTOs(prs)
	if len(dtos) == 0 {
		return dtos
	}

	taskIDList := make([]uint, 0, len(prs))
	for _, pr := range prs {
		taskIDList = append(taskIDList, pr.TaskID)
	}

	taskNames := map[uint]string{}
	taskFeature := map[uint]uint{}
	var tasks []models.Task
	if err := db.Where("id IN ?", taskIDList).Find(&tasks).Error; err == nil {
		for _, task := range tasks {
			taskNames[task.ID] = task.TaskName
			taskFeature[task.ID] = task.FeatureID
		}
	} else {
		log.WithError(err).Warn("could not load task names for pull requests")
	}

	// Fill in the feature from the task where the column is empty, the same
	// fallback featureFor applies, so the two never disagree about which
	// feature a pull request belongs to.
	featureIDList := make([]uint, 0, len(dtos))
	for i := range dtos {
		if dtos[i].FeatureID == 0 {
			dtos[i].FeatureID = taskFeature[dtos[i].TaskID]
		}
		featureIDList = append(featureIDList, dtos[i].FeatureID)
	}

	featureTitles := map[uint]string{}
	var features []models.Feature
	if err := db.Where("id IN ?", featureIDList).Find(&features).Error; err == nil {
		for _, feature := range features {
			featureTitles[feature.ID] = feature.Title
		}
	} else {
		log.WithError(err).Warn("could not load feature titles for pull requests")
	}

	for i := range dtos {
		dtos[i].TaskName = taskNames[dtos[i].TaskID]
		dtos[i].FeatureTitle = featureTitles[dtos[i].FeatureID]
		dtos[i].ProjectID = projectID
	}

	return dtos
}

// pullRequestProjects reports which project each of many pull requests belongs
// to, resolving the empty-feature_id case through the task as featureFor does.
func pullRequestProjects(db *gorm.DB, prs []models.PullRequest) (map[uint]int, error) {
	projects := map[uint]int{}
	if len(prs) == 0 {
		return projects, nil
	}

	taskIDList := make([]uint, 0, len(prs))
	for _, pr := range prs {
		taskIDList = append(taskIDList, pr.TaskID)
	}

	var tasks []models.Task
	if err := db.Where("id IN ?", taskIDList).Find(&tasks).Error; err != nil {
		return nil, err
	}
	taskFeature := map[uint]uint{}
	for _, task := range tasks {
		taskFeature[task.ID] = task.FeatureID
	}

	featureIDList := make([]uint, 0, len(prs))
	featureOf := map[uint]uint{}
	for _, pr := range prs {
		featureID := pr.FeatureID
		if featureID == 0 {
			featureID = taskFeature[pr.TaskID]
		}
		featureOf[pr.ID] = featureID
		featureIDList = append(featureIDList, featureID)
	}

	var features []models.Feature
	if err := db.Where("id IN ?", featureIDList).Find(&features).Error; err != nil {
		return nil, err
	}
	projectOf := map[uint]int{}
	for _, feature := range features {
		projectOf[feature.ID] = feature.ProjectID
	}

	for _, pr := range prs {
		projects[pr.ID] = projectOf[featureOf[pr.ID]]
	}
	return projects, nil
}

// load fetches the pull request named in the path, if the caller can see
// the project it belongs to.
func (h *PullRequestsHandler) load(c *gin.Context) (*models.PullRequest, error) {
	id, err := api.IDParam(c, "prId")
	if err != nil {
		return nil, err
	}

	pr, dbErr := h.repo.GetByID(uint(id))
	if dbErr != nil {
		return nil, api.FromDB(dbErr, "Pull request")
	}

	feature, err := h.featureFor(pr)
	if err != nil {
		return nil, err
	}
	if _, err := requireProject(c, h.db, feature.ProjectID, canView); err != nil {
		return nil, asHidden(err, "Pull request")
	}

	return pr, nil
}

// loadForWrite fetches the pull request and checks the caller may change it.
// Permission follows the project it reaches through its feature.
func (h *PullRequestsHandler) loadForWrite(c *gin.Context) (*models.PullRequest, error) {
	pr, err := h.load(c)
	if err != nil {
		return nil, err
	}

	feature, err := h.featureFor(pr)
	if err != nil {
		return nil, err
	}

	if err := h.authoriseProject(c, feature.ProjectID); err != nil {
		return nil, err
	}

	return pr, nil
}

// featureFor resolves the feature a pull request belongs to, which is how it
// reaches a project and therefore how permission on it is decided.
//
// pull_requests.feature_id is zero on rows written before that column was
// filled in, and those rows are still live. The task always knows, so it is
// the fallback rather than treating the pull request as belonging to nothing.
func (h *PullRequestsHandler) featureFor(pr *models.PullRequest) (*models.Feature, error) {
	featureID := pr.FeatureID

	if featureID == 0 {
		task, dbErr := h.taskRepo.GetByID(pr.TaskID)
		if dbErr != nil {
			return nil, api.FromDB(dbErr, "Task")
		}
		featureID = task.FeatureID
	}

	feature, dbErr := h.featureRepo.GetFeatureByID(int(featureID))
	if dbErr != nil {
		return nil, api.FromDB(dbErr, "Feature")
	}

	return feature, nil
}

// authoriseProject permits changes by anyone who can edit the project.
func (h *PullRequestsHandler) authoriseProject(c *gin.Context, projectID int) error {
	_, err := requireProject(c, h.db, projectID, canEdit)
	return err
}

// reviewStatusLabel maps a review decision onto the status stored on the row.
//
// The stored values are capitalised because that is what is already in the
// table and what the htmx screens display; every comparison in the API is
// case-insensitive, so the casing is presentation rather than meaning.
func reviewStatusLabel(decision string) string {
	switch decision {
	case "approved":
		return "Approved"
	case "rejected":
		return "Rejected"
	case "changes_requested":
		return "Changes requested"
	default:
		return "Open"
	}
}

// statusKey reduces a stored status to the form a client filters on, so that
// ?status=changes_requested matches the row reading "Changes requested".
func statusKey(status string) string {
	return strings.ReplaceAll(strings.ToLower(strings.TrimSpace(status)), " ", "_")
}

// isSettled reports whether a pull request needs nothing further: it is either
// finished, or it has been turned down.
func isSettled(pr models.PullRequest) bool {
	if strings.EqualFold(pr.Status, "rejected") {
		return true
	}
	return pr.Tested && IsApproved(pr.Status)
}

// pullRequestFilters is the parsed query string for a pull request list.
type pullRequestFilters struct {
	statuses map[string]bool
	tested   string
	query    string
}

func filterPullRequests(prs []models.PullRequest, f pullRequestFilters) []models.PullRequest {
	out := make([]models.PullRequest, 0, len(prs))

	for _, pr := range prs {
		if len(f.statuses) > 0 && !f.statuses[statusKey(pr.Status)] {
			continue
		}
		if f.tested == "true" && !pr.Tested {
			continue
		}
		if f.tested == "false" && pr.Tested {
			continue
		}
		if f.query != "" &&
			!contains(lower(pr.Title), f.query) &&
			!contains(lower(pr.Branch), f.query) &&
			!contains(lower(pr.URL), f.query) {
			continue
		}
		out = append(out, pr)
	}

	return out
}
