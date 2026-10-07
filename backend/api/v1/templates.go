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

// TemplatesHandler serves project templates: the starting points a new project
// can be filled in from.
//
// A template is a file on disk, not a database row, so these routes are
// read-only apart from applying one. Editing the catalogue is a deployment
// action rather than something a signed-in user does through the UI.
type TemplatesHandler struct {
	templates   *repositories.TemplateRepository
	projectRepo *repositories.ProjectRepository
	featureRepo *repositories.FeatureRepository
	taskRepo    repositories.TaskRepository
	db          *gorm.DB
}

// NewTemplatesHandler builds the handler. A nil template repository leaves the
// routes answering "no templates" rather than failing — the catalogue is
// optional, and a missing data directory should not take the API down.
func NewTemplatesHandler(db *gorm.DB, templates *repositories.TemplateRepository) *TemplatesHandler {
	return &TemplatesHandler{
		templates:   templates,
		projectRepo: repositories.NewProjectRepository(db),
		featureRepo: repositories.NewFeatureRepository(db),
		taskRepo:    repositories.NewTaskRepository(db),
		db:          db,
	}
}

// Register mounts the template routes onto an authenticated group.
func (h *TemplatesHandler) Register(g *gin.RouterGroup) {
	g.GET("/templates", h.List)
	g.GET("/templates/:templateId", h.Get)
	g.GET("/template-stacks", h.Stacks)
	g.POST("/projects/:id/template", h.Apply)
}

// List returns the template catalogue.
//
// GET /api/v1/templates?stack=&q=
func (h *TemplatesHandler) List(c *gin.Context) {
	if h.templates == nil {
		api.List(c, []TemplateSummaryDTO{}, api.ParsePage(c).Meta(0))
		return
	}

	all := h.templates.GetAllTemplates()

	stacks := lowerSet(c.QueryArray("stack"))
	query := strings.ToLower(c.Query("q"))

	filtered := make([]repositories.Template, 0, len(all))
	for _, t := range all {
		if len(stacks) > 0 && !stacks[strings.ToLower(t.Stack)] && !stacks[strings.ToLower(t.TechStack)] {
			continue
		}
		if query != "" &&
			!contains(lower(t.Name), query) &&
			!contains(lower(t.Description), query) &&
			!contains(lower(t.TechStack), query) {
			continue
		}
		filtered = append(filtered, t)
	}

	sort.SliceStable(filtered, func(i, j int) bool {
		return lower(filtered[i].Name) < lower(filtered[j].Name)
	})

	page := api.ParsePage(c)
	total := int64(len(filtered))
	api.List(c, NewTemplateSummaryDTOs(api.Slice(filtered, page)), page.Meta(total))
}

// Get returns one template in full, including everything applying it would
// create.
//
// GET /api/v1/templates/:templateId
func (h *TemplatesHandler) Get(c *gin.Context) {
	if h.templates == nil {
		api.Fail(c, api.NotFound("Template"))
		return
	}

	template, err := h.find(c.Param("templateId"))
	if err != nil {
		api.Fail(c, err)
		return
	}

	api.OK(c, NewTemplateDTO(*template))
}

// Stacks returns the tech stacks the catalogue covers, for a filter control.
//
// GET /api/v1/template-stacks
func (h *TemplatesHandler) Stacks(c *gin.Context) {
	if h.templates == nil {
		api.List(c, []string{}, api.Meta{Page: 1, PerPage: 0, TotalPages: 0})
		return
	}

	stacks := h.templates.GetAvailableStacks()
	sort.Strings(stacks)

	api.List(c, api.EmptyIfNil(stacks), api.Meta{
		Total: int64(len(stacks)), Page: 1, PerPage: len(stacks), TotalPages: 1,
	})
}

// Apply writes a template's features and tasks into a project.
//
// POST /api/v1/projects/:id/template
//
// It adds rather than replaces: a template is a starting point, and wiping a
// project's existing work because someone picked a template is not a thing a
// person can undo. The response says exactly what was created.
func (h *TemplatesHandler) Apply(c *gin.Context) {
	if h.templates == nil {
		api.Fail(c, api.NotFound("Template"))
		return
	}

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

	var req ApplyTemplateRequest
	if bindErr := api.Bind(c, &req); bindErr != nil {
		api.Fail(c, bindErr)
		return
	}

	if err := h.authoriseWrite(c, project); err != nil {
		api.Fail(c, err)
		return
	}

	template, err := h.find(req.TemplateID)
	if err != nil {
		api.Fail(c, err)
		return
	}

	result := h.apply(project, template)
	api.OK(c, result)
}

// apply does the writing, and reports what happened.
//
// A template carries features and tasks tagged with the context they belong to
// — Development, Staging, and so on. Only the ones matching the project's own
// context are created, falling back to Development, and then to everything, so
// that a template with no context tags still does something useful.
func (h *TemplatesHandler) apply(project *models.Project, template *repositories.Template) ApplyTemplateResultDTO {
	result := ApplyTemplateResultDTO{
		TemplateID:   template.ID,
		TemplateName: template.Name,
		ProjectID:    project.ID,
	}

	context := projectContext(project)

	features := selectByContext(template.Features, context, func(f repositories.TemplateFeature) string {
		return f.Context
	})
	tasks := selectByContext(template.Tasks, context, func(t repositories.TemplateTask) string {
		return t.Context
	})

	// The project's own vocabulary comes from the template: its feature
	// categories and task types drive the dropdowns on every later screen.
	config := models.JSONB{}
	for key, value := range project.Config {
		config[key] = value
	}
	config["tech_stack"] = template.TechStack
	config["template_id"] = template.ID
	if len(template.FeatureCategories) > 0 {
		config["feature_category"] = template.FeatureCategories
	}
	if len(template.TaskTypes) > 0 {
		config["task_types"] = template.TaskTypes
	}
	project.Config = config

	if err := h.projectRepo.UpdateProject(project); err != nil {
		log.WithError(err).Warn("could not update project config from template")
	} else {
		result.ConfigUpdated = true
	}

	created := make([]models.Feature, 0, len(features))
	for _, tf := range features {
		feature := models.Feature{
			ProjectID:   project.ID,
			Title:       tf.Name,
			Description: tf.Description,
			Category:    orDefault(tf.Category, "general"),
			Status:      models.StatusTodo,
			Priority:    models.PriorityMedium,
		}
		if err := h.featureRepo.CreateFeature(&feature); err != nil {
			log.WithError(err).WithField("feature", tf.Name).Warn("template feature not created")
			result.FeaturesSkipped++
			continue
		}
		created = append(created, feature)
	}
	result.FeaturesCreated = len(created)

	// A task is filed against the feature whose category matches its type,
	// which is how a template expresses "this backend task belongs to the
	// backend feature". Without a match it lands on the first feature, which
	// is at least somewhere a person will find it.
	byCategory := map[string]models.Feature{}
	for _, feature := range created {
		key := strings.ToLower(feature.Category)
		if _, seen := byCategory[key]; !seen {
			byCategory[key] = feature
		}
	}

	for _, tt := range tasks {
		if len(created) == 0 {
			// Nowhere to put it: a task with no feature is unreachable in
			// every screen, so it is not created at all.
			result.SkippedBecause = "The template created no features, so its tasks had nowhere to go."
			break
		}

		target := created[0]
		if match, ok := byCategory[strings.ToLower(tt.Type)]; ok {
			target = match
		}

		task := models.Task{
			FeatureID:   target.ID,
			TaskName:    tt.Name,
			TaskType:    orDefault(tt.Type, "Dev"),
			Description: tt.Description,
		}
		if err := h.taskRepo.Create(&task); err != nil {
			log.WithError(err).WithField("task", tt.Name).Warn("template task not created")
			continue
		}
		result.TasksCreated++
	}

	// The template's Dependencies field is a list of package names — "react",
	// "express" — not feature relationships. The old code turned each one into
	// a dependency edge between the first two features it had just created,
	// which produced rows that mean nothing and show up on the dependency
	// canvas as real constraints. Nothing is created from it here.

	return result
}

// find looks a template up by id, then case-insensitively, then by name.
//
// Ids in the catalogue are hand-written, so "React-Node" and "react-node" both
// occur in the wild, and people refer to templates by name.
//
// The search is done here over the whole catalogue rather than through
// repositories.GetTemplateByID, which answers an unknown id with the *default*
// template and a nil error. Through that path, asking for a template that does
// not exist writes some other template's features into your project and
// reports success. The old htmx routes still go through it.
func (h *TemplatesHandler) find(id string) (*repositories.Template, error) {
	id = strings.TrimSpace(id)
	if id == "" {
		return nil, api.BadRequest("A template id is required")
	}

	all := h.templates.GetAllTemplates()

	for i := range all {
		if all[i].ID == id {
			return &all[i], nil
		}
	}
	for i := range all {
		if strings.EqualFold(all[i].ID, id) {
			return &all[i], nil
		}
	}
	for i := range all {
		if strings.EqualFold(all[i].Name, id) {
			return &all[i], nil
		}
	}

	return nil, api.NotFound("Template")
}

// authoriseWrite permits applying a template by anyone who can edit the
// project.
func (h *TemplatesHandler) authoriseWrite(c *gin.Context, project *models.Project) error {
	_, err := requireProject(c, h.db, project.ID, canEdit)
	return err
}

// projectContext reads the context a project is being planned in, defaulting
// to Development.
func projectContext(project *models.Project) string {
	if project.Config != nil {
		if value, ok := project.Config["context"].(string); ok && strings.TrimSpace(value) != "" {
			return value
		}
	}
	return "Development"
}

// selectByContext picks the entries belonging to a context, falling back to
// Development and then to everything.
//
// The fallbacks matter because most templates carry no context tags at all: a
// strict match would apply them as empty.
func selectByContext[T any](items []T, context string, contextOf func(T) string) []T {
	matching := make([]T, 0, len(items))
	for _, item := range items {
		itemContext := orDefault(contextOf(item), "Development")
		if strings.EqualFold(itemContext, context) {
			matching = append(matching, item)
		}
	}
	if len(matching) > 0 {
		return matching
	}

	if !strings.EqualFold(context, "Development") {
		for _, item := range items {
			itemContext := contextOf(item)
			if itemContext == "" || strings.EqualFold(itemContext, "Development") {
				matching = append(matching, item)
			}
		}
		if len(matching) > 0 {
			return matching
		}
	}

	return items
}
