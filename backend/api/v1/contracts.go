package v1

import (
	"net/http"
	"strings"

	"github.com/FeaturePlus/backend/api"
	"github.com/FeaturePlus/backend/models"
	"github.com/FeaturePlus/backend/repositories"
	"github.com/FeaturePlus/backend/services"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// ContractsHandler serves the scoped-access half of the API: file content, the
// generated mocks that stand in for what a collaborator cannot see, and the
// briefing that gathers all of it into one place.
//
// This is an enforcement boundary, not a convenience layer. "Owner sees the
// source, contract scope sees a stripped contract, everyone else sees nothing"
// only means anything at the point where it becomes an HTTP response, and this
// is that point.
//
// Note what "nothing" means here: a file outside your scope answers 404, not
// 403. A 403 confirms the file exists, and the existence of a file is itself
// something a collaborator is not entitled to know.
type ContractsHandler struct {
	access      *services.AccessService
	contract    *services.ContractService
	briefing    *services.BriefingService
	projectRepo *repositories.ProjectRepository
	db          *gorm.DB
}

// NewContractsHandler builds the handler over an existing contract service.
//
// The service must be the one the application configured, not a fresh one: a
// ContractService only knows how to read real source after SetSourceReader has
// been called with the repository roots. Building its own would leave every
// owner reading their own files through a service that cannot open any.
//
// A nil service is allowed, and builds an unconfigured one — enough for the
// contract and briefing routes, which read from the database.
func NewContractsHandler(db *gorm.DB, contract *services.ContractService) *ContractsHandler {
	if contract == nil {
		contract = services.NewContractService(db)
	}

	return &ContractsHandler{
		access:      services.NewAccessService(db),
		contract:    contract,
		briefing:    services.NewBriefingService(db, contract),
		projectRepo: repositories.NewProjectRepository(db),
		db:          db,
	}
}

// Register mounts the contract routes onto an authenticated group.
func (h *ContractsHandler) Register(g *gin.RouterGroup) {
	g.GET("/projects/:id/source", h.FileContent)
	g.GET("/projects/:id/mock", h.Mock)
	g.GET("/projects/:id/contracts", h.ListContracts)
	g.GET("/projects/:id/briefing", h.Briefing)
}

// FileContent returns a file as the caller is allowed to see it.
//
// GET /api/v1/projects/:id/source?path=&commit=
func (h *ContractsHandler) FileContent(c *gin.Context) {
	projectID, filePath, err := h.target(c)
	if err != nil {
		api.Fail(c, err)
		return
	}

	userID, err := api.UserID(c)
	if err != nil {
		api.Fail(c, err)
		return
	}

	access, accessErr := h.access.ResolveFileAccess(userID, projectID, filePath)
	if accessErr != nil {
		api.Fail(c, api.Internal(accessErr))
		return
	}

	commit := c.Query("commit")

	switch access.Level {
	case models.AccessOwner:
		source, srcErr := h.contract.RealSource(projectID, filePath)
		if srcErr != nil {
			// The file is mapped, and the caller is allowed to read it, but
			// the working copy is not reachable. Almost always that means no
			// repository root is configured for this project, which is a
			// setting on the machine rather than anything wrong with the
			// mapping — so say that instead of "not found" or a bare 500.
			api.Fail(c, api.Unavailable(
				"The repository holding this file could not be read. "+
					"Check the source root configured for this project.").
				WithCause(srcErr))
			return
		}
		api.OK(c, FileContentDTO{
			FilePath: filePath,
			Access:   string(models.AccessOwner),
			IsSource: true,
			Content:  string(source),
			Commit:   commit,
		})

	case models.AccessContract:
		artifact, contractErr := h.contract.ContractFor(projectID, access.FeatureID, filePath, commit)
		if contractErr != nil {
			// No contract has been extracted yet. Never fall through to the
			// real source: that is the whole point of this route.
			api.Fail(c, api.NotFound("Contract for this file"))
			return
		}

		stale := false
		if drift, driftErr := h.contract.CheckDrift(projectID, filePath); driftErr == nil {
			stale = drift.Drifted
		}

		api.OK(c, FileContentDTO{
			FilePath: filePath,
			Access:   string(models.AccessContract),
			IsSource: false,
			Content:  services.ContractWithNote(artifact),
			Note:     artifact.BehaviorNote,
			Commit:   artifact.CommitHash,
			Stale:    stale,
		})

	default:
		api.Fail(c, api.NotFound("File"))
	}
}

// Mock returns a generated stand-in for a dependency, so a collaborator can
// build and test against a fake of what they cannot see.
//
// GET /api/v1/projects/:id/mock?path=&commit=
func (h *ContractsHandler) Mock(c *gin.Context) {
	projectID, filePath, err := h.target(c)
	if err != nil {
		api.Fail(c, err)
		return
	}

	userID, err := api.UserID(c)
	if err != nil {
		api.Fail(c, err)
		return
	}

	access, accessErr := h.access.ResolveFileAccess(userID, projectID, filePath)
	if accessErr != nil {
		api.Fail(c, api.Internal(accessErr))
		return
	}

	switch access.Level {
	case models.AccessNone:
		api.Fail(c, api.NotFound("File"))

	case models.AccessOwner:
		// Not an error in the file's sense — the caller can read the real
		// thing, so a mock of it is the wrong tool rather than a missing one.
		api.Fail(c, api.Conflict("You have source access to this file; a mock is unnecessary"))

	default:
		mock, mockErr := h.contract.MockFor(projectID, access.FeatureID, filePath, c.Query("commit"))
		if mockErr != nil {
			api.Fail(c, api.NotFound("Mock for this file"))
			return
		}
		api.OK(c, MockFileDTO{
			FilePath:     filePath,
			MockFilename: mockFileName(filePath),
			Content:      mock,
		})
	}
}

// ListContracts returns the contracts stored for a project.
//
// GET /api/v1/projects/:id/contracts?path=
//
// Only the latest artifact per file is listed: the table keeps one row per
// commit a file was extracted at, and a list of every version of every file is
// a changelog, not the answer to "what contracts exist here".
func (h *ContractsHandler) ListContracts(c *gin.Context) {
	projectID, err := api.IDParam(c, "id")
	if err != nil {
		api.Fail(c, err)
		return
	}

	if _, dbErr := h.projectRepo.GetProjectByID(projectID); dbErr != nil {
		api.Fail(c, api.FromDB(dbErr, "Project"))
		return
	}

	var artifacts []models.ContractArtifact
	if dbErr := h.db.Where("project_id = ? AND deleted_at IS NULL", projectID).
		Order("file_path, updated_at DESC").Find(&artifacts).Error; dbErr != nil {
		api.Fail(c, api.Internal(dbErr))
		return
	}

	seen := map[string]bool{}
	latest := make([]models.ContractArtifact, 0, len(artifacts))
	for _, artifact := range artifacts {
		if seen[artifact.FilePath] {
			continue
		}
		seen[artifact.FilePath] = true
		latest = append(latest, artifact)
	}

	if query := strings.ToLower(c.Query("path")); query != "" {
		kept := make([]models.ContractArtifact, 0, len(latest))
		for _, artifact := range latest {
			if contains(lower(artifact.FilePath), query) {
				kept = append(kept, artifact)
			}
		}
		latest = kept
	}

	page := api.ParsePage(c)
	total := int64(len(latest))
	api.List(c, NewContractArtifactDTOs(api.Slice(latest, page)), page.Meta(total))
}

// Briefing returns everything the caller needs to build their feature: the
// project brief, their own features and tasks, and the contracts and mocks of
// the features they depend on.
//
// GET /api/v1/projects/:id/briefing?format=md
//
// A caller with no grant on this project gets 404, and so does the project's
// owner — they already have the whole repository, so a briefing assembled from
// grants is not the tool they want.
func (h *ContractsHandler) Briefing(c *gin.Context) {
	projectID, err := api.IDParam(c, "id")
	if err != nil {
		api.Fail(c, err)
		return
	}

	userID, err := api.UserID(c)
	if err != nil {
		api.Fail(c, err)
		return
	}

	brief, buildErr := h.briefing.BuildBriefing(userID, projectID)
	switch {
	case buildErr == services.ErrNoScope:
		api.Fail(c, api.NotFound("Briefing"))
		return
	case buildErr != nil:
		api.Fail(c, api.Internal(buildErr))
		return
	}

	// The Markdown form exists to be pasted whole into an AI assistant, which
	// is the actual workflow this feature was built for. It is returned as
	// text rather than wrapped in the envelope: the point is to copy it.
	if c.Query("format") == "md" {
		c.Data(http.StatusOK, "text/markdown; charset=utf-8", []byte(brief.Markdown()))
		return
	}

	api.OK(c, brief)
}

// target reads the project and file path a request is about.
func (h *ContractsHandler) target(c *gin.Context) (int, string, error) {
	projectID, err := api.IDParam(c, "id")
	if err != nil {
		return 0, "", err
	}

	raw := c.Query("path")
	if strings.TrimSpace(raw) == "" {
		return 0, "", api.BadRequest("A path is required")
	}

	filePath, err := cleanRepoPath(raw)
	if err != nil {
		return 0, "", err
	}

	return projectID, filePath, nil
}

// mockFileName derives the name a generated mock would be saved under, so the
// client can offer it as a filename rather than inventing one.
func mockFileName(filePath string) string {
	base := filePath
	if i := strings.LastIndexAny(base, "/\\"); i >= 0 {
		base = base[i+1:]
	}
	if strings.HasSuffix(base, ".go") {
		return strings.TrimSuffix(base, ".go") + "_mock.go"
	}
	return base + "_mock.go"
}
