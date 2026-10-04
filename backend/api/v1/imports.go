package v1

import (
	"encoding/json"
	"fmt"
	"net/url"
	"sort"
	"strings"
	"time"

	"github.com/FeaturePlus/backend/api"
	"github.com/FeaturePlus/backend/internal/log"
	"github.com/FeaturePlus/backend/internal/mcpbridge"
	"github.com/FeaturePlus/backend/models"
	"github.com/FeaturePlus/backend/repositories"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// ImportsHandler creates projects from somewhere other than an empty form:
// a saved analysis on disk, or a GitHub repository read live.
//
// Both paths end in the same place. An import is a template, so once one has
// been produced the project is filled in by the template machinery rather than
// by a second copy of the same loop.
type ImportsHandler struct {
	imports     *repositories.ImportRepository
	templates   *TemplatesHandler
	projectRepo *repositories.ProjectRepository
	db          *gorm.DB
}

// NewImportsHandler builds the handler. A nil import repository leaves the
// list empty rather than failing, the same way the template catalogue does.
func NewImportsHandler(db *gorm.DB, imports *repositories.ImportRepository, templates *TemplatesHandler) *ImportsHandler {
	return &ImportsHandler{
		imports:     imports,
		templates:   templates,
		projectRepo: repositories.NewProjectRepository(db),
		db:          db,
	}
}

// Register mounts the import routes onto an authenticated group.
func (h *ImportsHandler) Register(g *gin.RouterGroup) {
	imports := g.Group("/imports")
	{
		imports.GET("", h.List)
		imports.POST("/project", h.CreateFromSaved)
		imports.POST("/github", h.CreateFromGitHub)
		imports.DELETE("/:importId", h.Delete)
	}
}

// List returns the analyses saved on disk and ready to become projects.
//
// GET /api/v1/imports
func (h *ImportsHandler) List(c *gin.Context) {
	if h.imports == nil {
		api.List(c, []ImportSummaryDTO{}, api.ParsePage(c).Meta(0))
		return
	}

	ids, err := h.imports.ListAvailableImports()
	if err != nil {
		api.Fail(c, api.Internal(err))
		return
	}

	summaries := make([]ImportSummaryDTO, 0, len(ids))
	for _, id := range ids {
		summary := ImportSummaryDTO{ID: id, Name: id}

		// A saved import that will not parse is listed by its id rather than
		// hidden: a file the user can see in the directory but not in the app
		// is worse than one shown with nothing behind it.
		if template, loadErr := h.imports.LoadImportTemplate(id); loadErr == nil && template != nil {
			if template.Name != "" {
				summary.Name = template.Name
			}
			summary.TechStack = template.TechStack
			summary.FeatureCount = len(template.Features)
			summary.TaskCount = len(template.Tasks)
		} else if loadErr != nil {
			log.WithError(loadErr).WithField("import", id).Warn("saved import could not be read")
		}

		summaries = append(summaries, summary)
	}

	sort.SliceStable(summaries, func(i, j int) bool {
		return lower(summaries[i].Name) < lower(summaries[j].Name)
	})

	page := api.ParsePage(c)
	total := int64(len(summaries))
	api.List(c, api.Slice(summaries, page), page.Meta(total))
}

// CreateFromSaved turns a saved analysis into a project.
//
// POST /api/v1/imports/project
func (h *ImportsHandler) CreateFromSaved(c *gin.Context) {
	if h.imports == nil {
		api.Fail(c, api.NotFound("Import"))
		return
	}

	var req ImportProjectRequest
	if bindErr := api.Bind(c, &req); bindErr != nil {
		api.Fail(c, bindErr)
		return
	}

	template, loadErr := h.imports.LoadImportTemplate(req.ImportID)
	if loadErr != nil || template == nil {
		api.Fail(c, api.NotFound("Import"))
		return
	}

	name := strings.TrimSpace(req.Name)
	if name == "" {
		name = template.Name
	}
	if name == "" {
		name = req.ImportID
	}

	result, err := h.createProject(c, template, name, req.Description, "import:"+req.ImportID)
	if err != nil {
		api.Fail(c, err)
		return
	}

	api.Created(c, result)
}

// CreateFromGitHub analyses a repository and turns it into a project.
//
// POST /api/v1/imports/github
//
// The analysis runs in a separate MCP bridge process. That is worth saying out
// loud in the failure messages: an unreachable bridge is a setup problem on
// the machine, not a bad repository URL, and the two need telling apart or
// people retype the URL forever.
func (h *ImportsHandler) CreateFromGitHub(c *gin.Context) {
	var req ImportGitHubRequest
	if bindErr := api.Bind(c, &req); bindErr != nil {
		api.Fail(c, bindErr)
		return
	}

	repoURL := strings.TrimSpace(req.RepoURL)
	if err := validateGitHubURL(repoURL); err != nil {
		api.Fail(c, err)
		return
	}

	raw, bridgeErr := mcpbridge.CallLocalMCPBridge(repoURL)
	if bridgeErr != nil {
		api.Fail(c, bridgeFailure(bridgeErr))
		return
	}

	var template repositories.Template
	if err := json.Unmarshal(raw, &template); err != nil {
		api.Fail(c, api.Internal(fmt.Errorf("the analysis result was not readable: %w", err)))
		return
	}

	if len(template.Features) == 0 && len(template.Tasks) == 0 {
		api.Fail(c, api.Conflict(
			"The analysis found no features or tasks in that repository"))
		return
	}

	// Keep the analysis. It took a round trip through another process to
	// produce, and being able to re-import it without repeating that is the
	// difference between a retry and a rerun.
	savedID := savedImportID(template.ID, repoURL)
	if h.imports != nil {
		if saveErr := h.imports.SaveImportTemplate(savedID, &template); saveErr != nil {
			log.WithError(saveErr).Warn("could not save the imported analysis")
		}
	}

	name := strings.TrimSpace(req.Name)
	if name == "" {
		name = template.Name
	}
	if name == "" {
		name = repoName(repoURL)
	}

	result, err := h.createProject(c, &template, name, "Imported from "+repoURL, repoURL)
	if err != nil {
		api.Fail(c, err)
		return
	}

	api.Created(c, result)
}

// Delete removes a saved analysis. The projects made from it are untouched.
//
// DELETE /api/v1/imports/:importId
func (h *ImportsHandler) Delete(c *gin.Context) {
	if h.imports == nil {
		api.Fail(c, api.NotFound("Import"))
		return
	}

	if !api.IsManager(c) {
		api.Fail(c, api.Forbidden("Only a manager can remove a saved import"))
		return
	}

	id := c.Param("importId")
	if _, loadErr := h.imports.LoadImportTemplate(id); loadErr != nil {
		api.Fail(c, api.NotFound("Import"))
		return
	}

	if err := h.imports.DeleteImportTemplate(id); err != nil {
		api.Fail(c, api.Internal(err))
		return
	}

	api.NoContent(c)
}

// createProject makes the project and fills it in from the template.
//
// The caller becomes the owner. That is taken from the session rather than the
// request, so an import cannot quietly create a project belonging to somebody
// else.
func (h *ImportsHandler) createProject(
	c *gin.Context,
	template *repositories.Template,
	name, description, source string,
) (ImportResultDTO, error) {
	userID, err := api.UserID(c)
	if err != nil {
		return ImportResultDTO{}, err
	}

	if strings.TrimSpace(name) == "" {
		return ImportResultDTO{}, api.Validation("The project needs a name").
			WithField("name", "This field is required")
	}

	project := models.Project{
		Name:        name,
		Description: description,
		OwnerID:     userID,
		Config: models.JSONB{
			"tech_stack":    template.TechStack,
			"template_id":   template.ID,
			"import_source": source,
		},
	}

	if dbErr := h.projectRepo.CreateProject(&project); dbErr != nil {
		return ImportResultDTO{}, api.FromDB(dbErr, "Project")
	}

	applied := h.templates.apply(&project, template)

	return ImportResultDTO{
		ProjectID:       project.ID,
		Name:            project.Name,
		FeaturesCreated: applied.FeaturesCreated,
		TasksCreated:    applied.TasksCreated,
		Source:          source,
	}, nil
}

// validateGitHubURL checks the URL is a GitHub repository before anything is
// spawned to go and read it.
func validateGitHubURL(raw string) error {
	invalid := api.Validation("That is not a GitHub repository URL").
		WithField("repo_url", "Expected something like https://github.com/owner/repo")

	parsed, err := url.Parse(raw)
	if err != nil || parsed.Scheme != "https" {
		return invalid
	}

	host := strings.ToLower(parsed.Hostname())
	if host != "github.com" && host != "www.github.com" {
		return invalid
	}

	parts := strings.Split(strings.Trim(parsed.Path, "/"), "/")
	if len(parts) < 2 || parts[0] == "" || parts[1] == "" {
		return invalid
	}

	return nil
}

// bridgeFailure turns an analysis failure into something that says what to do.
func bridgeFailure(err error) *api.Error {
	message := err.Error()

	switch {
	case strings.Contains(message, "unavailable"):
		return api.Conflict(
			"The repository analyser is not running. Start the MCP bridge and try again.").
			WithCause(err)
	case strings.Contains(message, "rate limited"):
		return api.Conflict("An analysis is already running. Try again shortly.").WithCause(err)
	case strings.Contains(message, "timeout"):
		return api.Conflict(
			"The analysis took too long and was stopped. A smaller repository may work.").
			WithCause(err)
	default:
		return api.Internal(err)
	}
}

// savedImportID names the file an analysis is kept under. The timestamp keeps
// re-importing the same repository from overwriting the previous analysis.
func savedImportID(templateID, repoURL string) string {
	base := strings.TrimSpace(templateID)
	if base == "" {
		base = repoName(repoURL)
	}
	if base == "" {
		base = "import"
	}
	return fmt.Sprintf("%s_%d", base, time.Now().Unix())
}

// repoName is the last path segment of a repository URL.
func repoName(repoURL string) string {
	trimmed := strings.TrimSuffix(strings.TrimSpace(repoURL), "/")
	trimmed = strings.TrimSuffix(trimmed, ".git")
	if i := strings.LastIndex(trimmed, "/"); i >= 0 {
		return trimmed[i+1:]
	}
	return trimmed
}
