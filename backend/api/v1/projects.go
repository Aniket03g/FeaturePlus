package v1

import (
	"github.com/FeaturePlus/backend/api"
	"github.com/FeaturePlus/backend/internal/log"
	"github.com/FeaturePlus/backend/models"
	"github.com/FeaturePlus/backend/repositories"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// ProjectsHandler serves /api/v1/projects. It is the reference implementation
// for the rest of the migration: parse, authorise, act, respond — with every
// response going through the api package and every payload through a DTO.
type ProjectsHandler struct {
	repo *repositories.ProjectRepository
	db   *gorm.DB
}

// NewProjectsHandler builds the handler.
func NewProjectsHandler(repo *repositories.ProjectRepository, db *gorm.DB) *ProjectsHandler {
	return &ProjectsHandler{repo: repo, db: db}
}

// Register mounts the project routes onto an authenticated group.
func (h *ProjectsHandler) Register(g *gin.RouterGroup) {
	projects := g.Group("/projects")
	{
		projects.GET("", h.List)
		projects.POST("", h.Create)
		projects.GET("/:id", h.Get)
		projects.PATCH("/:id", h.Update)
		projects.DELETE("/:id", h.Delete)
	}
}

// List returns a page of projects.
//
// GET /api/v1/projects?page=1&per_page=50&mine=true&q=search
func (h *ProjectsHandler) List(c *gin.Context) {
	userID, err := api.UserID(c)
	if err != nil {
		api.Fail(c, err)
		return
	}

	var (
		projects []models.Project
		dbErr    error
	)

	// Only projects the caller owns or was added to. ?mine=true narrows that
	// to the ones they own; ?all=true is every project, for an admin.
	query := h.db.Preload("Owner")
	if c.Query("mine") == "true" {
		query = query.Where("owner_id = ?", userID)
	} else if c.Query("all") == "true" && api.IsAdmin(c) {
		// No filter.
	} else {
		ids, idErr := visibleProjectIDs(h.db, userID)
		if idErr != nil {
			api.Fail(c, api.Internal(idErr))
			return
		}
		query = query.Where("id IN ?", ids)
	}
	if dbErr = query.Order("id").Find(&projects).Error; dbErr != nil {
		api.Fail(c, api.Internal(dbErr))
		return
	}

	projects = filterProjects(projects, c.Query("q"))

	// The repository loads the full table, so the page is taken in memory.
	// Total is counted before slicing so the client sees the real total.
	page := api.ParsePage(c)
	total := int64(len(projects))
	pageItems := api.Slice(projects, page)

	dtos := NewProjectDTOs(pageItems)
	h.attachStats(dtos)
	if roles, roleErr := rolesIn(h.db, pageItems, userID); roleErr == nil {
		admin := api.IsAdmin(c)
		for i := range dtos {
			dtos[i].MyRole = roles[dtos[i].ID]
			if admin && dtos[i].MyRole != models.RoleOwner {
				dtos[i].MyRole = models.RoleAdmin
			}
		}
	}

	api.List(c, dtos, page.Meta(total))
}

// Get returns one project.
//
// GET /api/v1/projects/:id
func (h *ProjectsHandler) Get(c *gin.Context) {
	id, err := api.IDParam(c, "id")
	if err != nil {
		api.Fail(c, err)
		return
	}

	_, role, err := requireProjectRole(c, h.db, id, canView)
	if err != nil {
		api.Fail(c, err)
		return
	}

	project, dbErr := h.repo.GetProjectByID(id)
	if dbErr != nil {
		api.Fail(c, api.FromDB(dbErr, "Project"))
		return
	}

	dto := NewProjectDTO(*project)
	dto.MyRole = role
	dtos := []ProjectDTO{dto}
	h.attachStats(dtos)

	api.OK(c, dtos[0])
}

// Create adds a project owned by the caller.
//
// POST /api/v1/projects
func (h *ProjectsHandler) Create(c *gin.Context) {
	userID, err := api.UserID(c)
	if err != nil {
		api.Fail(c, err)
		return
	}

	var req CreateProjectRequest
	if bindErr := api.Bind(c, &req); bindErr != nil {
		api.Fail(c, bindErr)
		return
	}

	project := models.Project{
		Name:        req.Name,
		Description: req.Description,
		Brief:       req.Brief,
		OwnerID:     userID, // From the session, never from the request
		Config:      models.JSONB(req.Config),
	}

	if dbErr := h.repo.CreateProject(&project); dbErr != nil {
		api.Fail(c, api.FromDB(dbErr, "Project"))
		return
	}

	// Re-read so the response carries the owner and the defaults BeforeCreate
	// filled in, rather than the half-populated struct that was written.
	created, dbErr := h.repo.GetProjectByID(project.ID)
	if dbErr != nil {
		api.Created(c, NewProjectDTO(project))
		return
	}

	dto := NewProjectDTO(*created)
	dto.MyRole = models.RoleOwner
	api.Created(c, dto)
}

// Update changes the fields present in the request body.
//
// PATCH /api/v1/projects/:id
func (h *ProjectsHandler) Update(c *gin.Context) {
	id, err := api.IDParam(c, "id")
	if err != nil {
		api.Fail(c, err)
		return
	}

	if _, err := requireProject(c, h.db, id, canEdit); err != nil {
		api.Fail(c, err)
		return
	}

	project, dbErr := h.repo.GetProjectByID(id)
	if dbErr != nil {
		api.Fail(c, api.FromDB(dbErr, "Project"))
		return
	}

	var req UpdateProjectRequest
	if bindErr := api.Bind(c, &req); bindErr != nil {
		api.Fail(c, bindErr)
		return
	}

	req.Apply(project)

	if dbErr := h.repo.UpdateProject(project); dbErr != nil {
		api.Fail(c, api.FromDB(dbErr, "Project"))
		return
	}

	api.OK(c, NewProjectDTO(*project))
}

// Delete removes a project.
//
// DELETE /api/v1/projects/:id
func (h *ProjectsHandler) Delete(c *gin.Context) {
	id, err := api.IDParam(c, "id")
	if err != nil {
		api.Fail(c, err)
		return
	}

	if _, err := requireProject(c, h.db, id, ownerOnly); err != nil {
		api.Fail(c, err)
		return
	}

	if dbErr := h.repo.DeleteProject(id); dbErr != nil {
		api.Fail(c, api.FromDB(dbErr, "Project"))
		return
	}
	// Who it was shared with goes with it, so an id reused later is not
	// shared with them too.
	if dbErr := h.db.Where("project_id = ?", id).Delete(&models.ProjectMember{}).Error; dbErr != nil {
		log.WithError(dbErr).WithField("project", id).Warn("could not remove a deleted project's members")
	}
	// Its saved versions go too: they are copies of a list that no longer exists.
	if dbErr := h.db.Where("project_id = ?", id).Delete(&models.FeatureVersion{}).Error; dbErr != nil {
		log.WithError(dbErr).WithField("project", id).Warn("could not remove a deleted project's versions")
	}
	if dbErr := h.db.Where("project_id = ?", id).Delete(&models.FeatureCopy{}).Error; dbErr != nil {
		log.WithError(dbErr).WithField("project", id).Warn("could not remove a deleted project's copies")
	}
	if dbErr := h.db.Where("project_id = ?", id).Delete(&models.ProjectVisit{}).Error; dbErr != nil {
		log.WithError(dbErr).WithField("project", id).Warn("could not remove a deleted project's visits")
	}

	api.NoContent(c)
}

// filterProjects applies the ?q= search across name and description.
func filterProjects(projects []models.Project, query string) []models.Project {
	if query == "" {
		return projects
	}

	needle := lower(query)
	out := make([]models.Project, 0, len(projects))
	for _, p := range projects {
		if contains(lower(p.Name), needle) || contains(lower(p.Description), needle) {
			out = append(out, p)
		}
	}
	return out
}

// attachStats fills in the feature and task counts for the given projects.
//
// Two grouped queries cover the whole page, so listing fifty projects costs
// two queries. The handler this replaces did it per project: one query for the
// project's features, one for each feature's tasks, then a COUNT for every
// task — roughly three hundred queries for a project the size of Feature Plus.
//
// A failure leaves Stats nil rather than failing the request: a missing count
// is not a reason to refuse a list. The queries are checked, though, which is
// how the previous version hid a permanently-zero result.
func (h *ProjectsHandler) attachStats(dtos []ProjectDTO) {
	if len(dtos) == 0 {
		return
	}

	ids := make([]int, 0, len(dtos))
	for _, d := range dtos {
		ids = append(ids, d.ID)
	}

	type featureRow struct {
		ProjectID int
		Total     int
		Completed int
	}
	var featureRows []featureRow
	if err := h.db.Model(&models.Feature{}).
		Select("project_id, count(*) as total, "+
			"sum(case when lower(status) in ('done','completed') then 1 else 0 end) as completed").
		Where("project_id IN ? AND deleted_at IS NULL", ids).
		Group("project_id").
		Scan(&featureRows).Error; err != nil {
		log.WithError(err).Warn("project feature stats query failed")
		return
	}

	// A task is complete when one of its pull requests is both tested and
	// approved. Approval is recorded in pull_requests.status, whose casing is
	// inconsistent in existing data ("Approved" and "approved" both occur), so
	// the comparison is lowercased.
	type taskRow struct {
		ProjectID int
		Total     int
		Completed int
	}
	var taskRows []taskRow
	if err := h.db.Model(&models.Task{}).
		Select("features.project_id as project_id, count(*) as total, "+
			"sum(case when exists ("+
			"  select 1 from pull_requests pr"+
			"  where pr.task_id = tasks.id"+
			"    and pr.tested = 1"+
			"    and lower(pr.status) = 'approved'"+
			"    and pr.deleted_at is null"+
			") then 1 else 0 end) as completed").
		Joins("JOIN features ON features.id = tasks.feature_id").
		Where("features.project_id IN ? AND tasks.deleted_at IS NULL", ids).
		Group("features.project_id").
		Scan(&taskRows).Error; err != nil {
		log.WithError(err).Warn("project task stats query failed")
		return
	}

	features := map[int]featureRow{}
	for _, r := range featureRows {
		features[r.ProjectID] = r
	}
	tasks := map[int]taskRow{}
	for _, r := range taskRows {
		tasks[r.ProjectID] = r
	}

	for i := range dtos {
		f := features[dtos[i].ID]
		t := tasks[dtos[i].ID]
		dtos[i].Stats = &ProjectStats{
			FeatureCount:      f.Total,
			CompletedFeatures: f.Completed,
			TaskCount:         t.Total,
			CompletedTasks:    t.Completed,
		}
	}
}
