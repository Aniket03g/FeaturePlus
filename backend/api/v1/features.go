package v1

import (
	"sort"
	"strconv"
	"strings"

	"github.com/FeaturePlus/backend/api"
	"github.com/FeaturePlus/backend/internal/log"
	"github.com/FeaturePlus/backend/models"
	"github.com/FeaturePlus/backend/repositories"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// FeaturesHandler serves /api/v1/features, following the pattern the projects
// handler set: parse, authorise, act, respond, with DTOs on the way out.
type FeaturesHandler struct {
	repo        *repositories.FeatureRepository
	projectRepo *repositories.ProjectRepository
	db          *gorm.DB
}

// NewFeaturesHandler builds the handler.
func NewFeaturesHandler(db *gorm.DB) *FeaturesHandler {
	return &FeaturesHandler{
		repo:        repositories.NewFeatureRepository(db),
		projectRepo: repositories.NewProjectRepository(db),
		db:          db,
	}
}

// Register mounts the feature routes onto an authenticated group.
func (h *FeaturesHandler) Register(g *gin.RouterGroup) {
	g.GET("/projects/:id/features", h.ListForProject)
	g.POST("/projects/:id/features", h.Create)
	g.GET("/projects/:id/tags", h.ProjectTags)

	features := g.Group("/features")
	{
		features.GET("/:featureId", h.Get)
		features.PATCH("/:featureId", h.Update)
		features.DELETE("/:featureId", h.Delete)
		features.PUT("/:featureId/tags", h.ReplaceTags)
	}
}

// ListForProject returns a project's features.
//
// GET /api/v1/projects/:id/features
//
// Filters: ?status=, ?priority=, ?tag=, ?q=, ?assignee=, and ?root=true for
// top-level features only. Repeated status and priority values are OR-ed, so a
// board can ask for "todo or in_progress" in one request.
func (h *FeaturesHandler) ListForProject(c *gin.Context) {
	projectID, err := api.IDParam(c, "id")
	if err != nil {
		api.Fail(c, err)
		return
	}

	if _, dbErr := h.projectRepo.GetProjectByID(projectID); dbErr != nil {
		api.Fail(c, api.FromDB(dbErr, "Project"))
		return
	}

	features, dbErr := h.repo.GetFeaturesByProject(projectID)
	if dbErr != nil {
		api.Fail(c, api.Internal(dbErr))
		return
	}

	tags := h.tagsByFeature(featureIDs(features))
	taskCounts := h.taskCountsByFeature(featureIDs(features))

	filtered := filterFeatures(features, tags, featureFilters{
		statuses:   lowerSet(c.QueryArray("status")),
		priorities: lowerSet(c.QueryArray("priority")),
		tag:        strings.ToLower(c.Query("tag")),
		query:      strings.ToLower(c.Query("q")),
		rootOnly:   c.Query("root") == "true",
	})

	// Highest priority first, then oldest first, so a list opens on the work
	// that matters rather than on whatever the database returned first.
	sort.SliceStable(filtered, func(i, j int) bool {
		a, b := priorityRank(filtered[i].Priority), priorityRank(filtered[j].Priority)
		if a != b {
			return a < b
		}
		return filtered[i].ID < filtered[j].ID
	})

	page := api.ParsePage(c)
	total := int64(len(filtered))
	items := api.Slice(filtered, page)

	api.List(c, NewFeatureDTOs(items, tags, taskCounts), page.Meta(total))
}

// Get returns one feature, with its sub-features.
//
// GET /api/v1/features/:featureId
func (h *FeaturesHandler) Get(c *gin.Context) {
	id, err := api.IDParam(c, "featureId")
	if err != nil {
		api.Fail(c, err)
		return
	}

	feature, dbErr := h.repo.GetFeatureByID(id)
	if dbErr != nil {
		api.Fail(c, api.FromDB(dbErr, "Feature"))
		return
	}

	ids := []uint{feature.ID}
	dto := NewFeatureDTO(*feature, h.tagsByFeature(ids)[feature.ID], h.taskCountsByFeature(ids)[feature.ID])

	if children, err := h.repo.GetSubfeaturesByParentID(feature.ID); err == nil && len(children) > 0 {
		childIDs := featureIDs(children)
		childTags := h.tagsByFeature(childIDs)
		childCounts := h.taskCountsByFeature(childIDs)
		dto.SubFeatures = NewFeatureDTOs(children, childTags, childCounts)
	}

	api.OK(c, dto)
}

// Create adds a feature to a project.
//
// POST /api/v1/projects/:id/features
func (h *FeaturesHandler) Create(c *gin.Context) {
	projectID, err := api.IDParam(c, "id")
	if err != nil {
		api.Fail(c, err)
		return
	}

	project, dbErr := h.projectRepo.GetProjectByID(projectID)
	if dbErr != nil {
		api.Fail(c, api.FromDB(dbErr, "Project"))
		return
	}

	var req CreateFeatureRequest
	if bindErr := api.Bind(c, &req); bindErr != nil {
		api.Fail(c, bindErr)
		return
	}

	if err := h.authoriseProjectWrite(c, project); err != nil {
		api.Fail(c, err)
		return
	}

	feature := models.Feature{
		ProjectID:   projectID,
		Title:       req.Title,
		Description: req.Description,
		Category:    orDefault(req.Category, "general"),
		Status:      models.FeatureStatus(orDefault(req.Status, string(models.StatusTodo))),
		Priority:    models.FeaturePriority(orDefault(req.Priority, string(models.PriorityMedium))),
	}
	if req.ParentFeatureID != nil {
		feature.ParentFeatureID = req.ParentFeatureID
	}
	if req.AssigneeID != nil {
		feature.AssigneeID = *req.AssigneeID
	}

	if dbErr := h.repo.CreateFeature(&feature); dbErr != nil {
		api.Fail(c, api.FromDB(dbErr, "Feature"))
		return
	}

	userID, _ := api.UserID(c)
	if len(req.Tags) > 0 {
		if err := h.setTags(feature.ID, req.Tags, uint(userID)); err != nil {
			// The feature exists; losing its tags is not worth failing the
			// creation over, but it is worth a log line.
			log.WithError(err).Warn("could not attach tags to the new feature")
		}
	}

	ids := []uint{feature.ID}
	api.Created(c, NewFeatureDTO(feature, h.tagsByFeature(ids)[feature.ID], nil))
}

// Update changes the fields present in the body.
//
// PATCH /api/v1/features/:featureId
func (h *FeaturesHandler) Update(c *gin.Context) {
	feature, err := h.loadForWrite(c)
	if err != nil {
		api.Fail(c, err)
		return
	}

	var req UpdateFeatureRequest
	if bindErr := api.Bind(c, &req); bindErr != nil {
		api.Fail(c, bindErr)
		return
	}

	req.Apply(feature)

	if dbErr := h.repo.UpdateFeature(feature); dbErr != nil {
		api.Fail(c, api.FromDB(dbErr, "Feature"))
		return
	}

	ids := []uint{feature.ID}
	api.OK(c, NewFeatureDTO(*feature, h.tagsByFeature(ids)[feature.ID], h.taskCountsByFeature(ids)[feature.ID]))
}

// Delete removes a feature.
//
// DELETE /api/v1/features/:featureId
func (h *FeaturesHandler) Delete(c *gin.Context) {
	feature, err := h.loadForWrite(c)
	if err != nil {
		api.Fail(c, err)
		return
	}

	// Deleting a feature that still owns rows would orphan them: nothing lists
	// a task or sub-feature whose parent is gone, so the data survives in the
	// database while being unreachable everywhere else. Refuse instead, and say
	// what is in the way.
	children, childErr := h.repo.GetSubfeaturesByParentID(feature.ID)
	if childErr == nil && len(children) > 0 {
		api.Fail(c, api.Conflict("This feature has sub-features. Delete or reassign them first."))
		return
	}

	var taskCount int64
	if err := h.db.Model(&models.Task{}).
		Where("feature_id = ? AND deleted_at IS NULL", feature.ID).
		Count(&taskCount).Error; err != nil {
		api.Fail(c, api.Internal(err))
		return
	}
	if taskCount > 0 {
		api.Fail(c, api.Conflict(
			"This feature has "+plural(int(taskCount), "task")+". Delete or move them first."))
		return
	}

	if dbErr := h.repo.DeleteFeature(int(feature.ID)); dbErr != nil {
		api.Fail(c, api.FromDB(dbErr, "Feature"))
		return
	}

	api.NoContent(c)
}

// ReplaceTags sets a feature's tags to exactly the list given.
//
// PUT /api/v1/features/:featureId/tags
func (h *FeaturesHandler) ReplaceTags(c *gin.Context) {
	feature, err := h.loadForWrite(c)
	if err != nil {
		api.Fail(c, err)
		return
	}

	var req ReplaceTagsRequest
	if bindErr := api.Bind(c, &req); bindErr != nil {
		api.Fail(c, bindErr)
		return
	}

	userID, _ := api.UserID(c)
	if err := h.setTags(feature.ID, req.Tags, uint(userID)); err != nil {
		api.Fail(c, api.Internal(err))
		return
	}

	api.OK(c, h.tagsByFeature([]uint{feature.ID})[feature.ID])
}

// ProjectTags lists every tag used in a project, with how often, so a filter
// can offer real options instead of a free-text box.
//
// GET /api/v1/projects/:id/tags
func (h *FeaturesHandler) ProjectTags(c *gin.Context) {
	projectID, err := api.IDParam(c, "id")
	if err != nil {
		api.Fail(c, err)
		return
	}

	var rows []TagCount
	if dbErr := h.db.Model(&models.FeatureTag{}).
		Select("feature_tags.tag_name as name, count(*) as count").
		Joins("JOIN features ON features.id = feature_tags.feature_id").
		Where("features.project_id = ? AND features.deleted_at IS NULL", projectID).
		Group("feature_tags.tag_name").
		Order("count DESC, name ASC").
		Scan(&rows).Error; dbErr != nil {
		api.Fail(c, api.Internal(dbErr))
		return
	}

	api.List(c, api.EmptyIfNil(rows), api.Meta{
		Total: int64(len(rows)), Page: 1, PerPage: len(rows), TotalPages: 1,
	})
}

// loadForWrite fetches the feature named in the path and checks the caller may
// change it. Permission follows the feature's project, so there is one rule
// rather than two that can drift apart.
func (h *FeaturesHandler) loadForWrite(c *gin.Context) (*models.Feature, error) {
	id, err := api.IDParam(c, "featureId")
	if err != nil {
		return nil, err
	}

	feature, dbErr := h.repo.GetFeatureByID(id)
	if dbErr != nil {
		return nil, api.FromDB(dbErr, "Feature")
	}

	project, dbErr := h.projectRepo.GetProjectByID(feature.ProjectID)
	if dbErr != nil {
		return nil, api.FromDB(dbErr, "Project")
	}

	if err := h.authoriseProjectWrite(c, project); err != nil {
		return nil, err
	}

	return feature, nil
}

// authoriseProjectWrite permits changes by the project's owner or a manager,
// matching the rule the projects handler applies.
func (h *FeaturesHandler) authoriseProjectWrite(c *gin.Context, project *models.Project) error {
	userID, err := api.UserID(c)
	if err != nil {
		return err
	}

	if project.OwnerID == userID || api.IsManager(c) {
		return nil
	}

	return api.Forbidden("Only the project owner or a manager can change this project's features")
}

// setTags replaces a feature's tags in one transaction, so a failure halfway
// through cannot leave the feature with some of its old tags and some new.
func (h *FeaturesHandler) setTags(featureID uint, tags []string, userID uint) error {
	cleaned := normaliseTags(tags)

	return h.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("feature_id = ?", featureID).Delete(&models.FeatureTag{}).Error; err != nil {
			return err
		}
		if len(cleaned) == 0 {
			return nil
		}

		rows := make([]models.FeatureTag, 0, len(cleaned))
		for _, name := range cleaned {
			rows = append(rows, models.FeatureTag{
				TagName: name, FeatureID: featureID, CreatedByUser: userID,
			})
		}
		return tx.Create(&rows).Error
	})
}

// tagsByFeature loads the tags for many features in one query.
func (h *FeaturesHandler) tagsByFeature(ids []uint) map[uint][]string {
	result := map[uint][]string{}
	if len(ids) == 0 {
		return result
	}

	var rows []models.FeatureTag
	if err := h.db.Where("feature_id IN ?", ids).Order("tag_name").Find(&rows).Error; err != nil {
		log.WithError(err).Warn("could not load feature tags")
		return result
	}

	for _, row := range rows {
		result[row.FeatureID] = append(result[row.FeatureID], row.TagName)
	}
	return result
}

// taskCountsByFeature loads task totals and completion for many features in
// one query. A task counts as complete when it has a tested, approved pull
// request; there is no status column on tasks.
func (h *FeaturesHandler) taskCountsByFeature(ids []uint) map[uint]*FeatureTaskCounts {
	result := map[uint]*FeatureTaskCounts{}
	if len(ids) == 0 {
		return result
	}

	type row struct {
		FeatureID uint
		Total     int
		Completed int
	}
	var rows []row

	if err := h.db.Model(&models.Task{}).
		Select("feature_id, count(*) as total, "+
			"sum(case when exists ("+
			"  select 1 from pull_requests pr"+
			"  where pr.task_id = tasks.id and pr.tested = 1"+
			"    and lower(pr.status) = 'approved' and pr.deleted_at is null"+
			") then 1 else 0 end) as completed").
		Where("feature_id IN ? AND deleted_at IS NULL", ids).
		Group("feature_id").
		Scan(&rows).Error; err != nil {
		log.WithError(err).Warn("could not load feature task counts")
		return result
	}

	for _, r := range rows {
		result[r.FeatureID] = &FeatureTaskCounts{Total: r.Total, Completed: r.Completed}
	}
	return result
}

// featureFilters is the parsed query string for a feature list.
type featureFilters struct {
	statuses   map[string]bool
	priorities map[string]bool
	tag        string
	query      string
	rootOnly   bool
}

func filterFeatures(features []models.Feature, tags map[uint][]string, f featureFilters) []models.Feature {
	out := make([]models.Feature, 0, len(features))

	for _, feature := range features {
		if len(f.statuses) > 0 && !f.statuses[strings.ToLower(string(feature.Status))] {
			continue
		}
		if len(f.priorities) > 0 && !f.priorities[strings.ToLower(string(feature.Priority))] {
			continue
		}
		if f.rootOnly && feature.ParentFeatureID != nil {
			continue
		}
		if f.tag != "" && !hasTag(tags[feature.ID], f.tag) {
			continue
		}
		if f.query != "" &&
			!strings.Contains(strings.ToLower(feature.Title), f.query) &&
			!strings.Contains(strings.ToLower(feature.Description), f.query) {
			continue
		}
		out = append(out, feature)
	}

	return out
}

func hasTag(tags []string, want string) bool {
	for _, tag := range tags {
		if strings.ToLower(tag) == want {
			return true
		}
	}
	return false
}

// priorityRank orders priorities highest first. An unrecognised value sorts
// after the known ones rather than being dropped.
func priorityRank(p models.FeaturePriority) int {
	switch p {
	case models.PriorityHigh:
		return 0
	case models.PriorityMedium:
		return 1
	case models.PriorityLow:
		return 2
	default:
		return 3
	}
}

// normaliseTags trims, lowercases and de-duplicates a tag list, so "UI", "ui "
// and "ui" cannot become three separate tags on one feature.
func normaliseTags(tags []string) []string {
	seen := map[string]bool{}
	out := make([]string, 0, len(tags))

	for _, tag := range tags {
		tag = strings.ToLower(strings.TrimSpace(tag))
		if tag == "" || seen[tag] {
			continue
		}
		if len(tag) > 50 { // The column is varchar(50).
			tag = tag[:50]
		}
		seen[tag] = true
		out = append(out, tag)
	}

	sort.Strings(out)
	return out
}

func featureIDs(features []models.Feature) []uint {
	ids := make([]uint, 0, len(features))
	for _, f := range features {
		ids = append(ids, f.ID)
	}
	return ids
}

func lowerSet(values []string) map[string]bool {
	if len(values) == 0 {
		return nil
	}

	set := map[string]bool{}
	for _, value := range values {
		// A single parameter may still carry a comma-separated list.
		for _, part := range strings.Split(value, ",") {
			if part = strings.ToLower(strings.TrimSpace(part)); part != "" {
				set[part] = true
			}
		}
	}
	return set
}

func orDefault(value, fallback string) string {
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	return value
}

// plural renders a count with its noun, pluralised, for error messages.
func plural(n int, noun string) string {
	if n == 1 {
		return "1 " + noun
	}
	return strconv.Itoa(n) + " " + noun + "s"
}
