package v1

import (
	"net/http"
	"strings"

	"github.com/FeaturePlus/backend/api"
	"github.com/FeaturePlus/backend/internal/log"
	"github.com/FeaturePlus/backend/models"
	"github.com/FeaturePlus/backend/repositories"
	"github.com/FeaturePlus/backend/services"
	"github.com/gin-gonic/gin"
	"github.com/jilio/sqlitefs"
	"gorm.io/gorm"
)

// Deps carries what the API needs beyond the database.
//
// Every field is optional. A nil Files disables attachment upload and
// download, and an empty directory leaves the corresponding list empty — in
// each case the routes still answer, saying there is nothing there. The
// alternative, failing at startup because an optional directory is missing,
// would take the whole API down over a feature nobody was using.
type Deps struct {
	// Files is where task attachments are stored — inside the database file
	// itself, which is what lets a project be one file you can copy.
	Files *sqlitefs.SQLiteFS

	// TemplateDir holds templates.json. It ships with the application and is
	// only read, which is why it is separate from ImportDir: on the desktop
	// build the install directory may not be writable.
	TemplateDir string

	// ImportDir is where saved repository analyses are written and read.
	ImportDir string

	// Contracts is the application's configured contract service. It has to be
	// passed in rather than built here: only the application knows the
	// repository roots, and without them the service can serve stored
	// contracts but cannot open a single real source file.
	Contracts *services.ContractService
}

// Register mounts /api/v1 onto the router.
//
// Everything but the health check runs behind requireAuth, which accepts a JWT
// from either the Authorization header or the token cookie and resolves the
// caller's role. Only the health route is public.
func Register(router *gin.Engine, db *gorm.DB, deps Deps) {
	v1 := router.Group("/api/v1")

	// Public: lets a client check the API is reachable before authenticating,
	// which the desktop window needs while waiting for its server to come up.
	v1.GET("/health", func(c *gin.Context) {
		api.OK(c, gin.H{"status": "ok", "version": "v1"})
	})

	// Public: signing in cannot require being signed in.
	registerSessionRoutes(v1, db)

	authed := v1.Group("", requireAuth(db))

	authed.GET("/me", meHandler(db))
	authed.POST("/me/password", changePasswordHandler(db))
	authed.POST("/users/:userId/password", resetPasswordHandler(db))

	NewProjectsHandler(repositories.NewProjectRepository(db), db).Register(authed)
	NewMembersHandler(db).Register(authed)
	NewFeaturesHandler(db).Register(authed)
	NewTasksHandler(db).Register(authed)
	NewDependenciesHandler(db).Register(authed)
	NewPlaygroundHandler(db).Register(authed)
	NewReleasesHandler(db).Register(authed)
	NewVersionsHandler(db).Register(authed)
	NewGitHubHandler(db).Register(authed)
	NewPullRequestsHandler(db).Register(authed)

	NewUsersHandler(db).Register(authed)
	NewCodeHandler(db).Register(authed)
	NewScopesHandler(db).Register(authed)
	NewContractsHandler(db, deps.Contracts).Register(authed)
	NewAttachmentsHandler(db, deps.Files).Register(authed)

	templates := NewTemplatesHandler(db, loadTemplates(deps.TemplateDir))
	templates.Register(authed)
	NewImportsHandler(db, loadImports(deps.ImportDir), templates).Register(authed)

	registerNotFound(router)
}

// loadTemplates opens the template catalogue, or returns nil when there is
// none to open. A missing catalogue is a project without templates, not a
// server that will not start.
func loadTemplates(dataDir string) *repositories.TemplateRepository {
	if dataDir == "" {
		return nil
	}

	repo, err := repositories.NewTemplateRepository(dataDir)
	if err != nil {
		log.WithError(err).WithField("dir", dataDir).Warn("no template catalogue loaded")
		return nil
	}
	return repo
}

// loadImports opens the directory saved repository analyses live in.
func loadImports(dataDir string) *repositories.ImportRepository {
	if dataDir == "" {
		return nil
	}
	return repositories.NewImportRepository(dataDir)
}

// meHandler returns the authenticated user, which is how the frontend learns
// who it is after a page reload — the JWT lives in an HttpOnly cookie that
// JavaScript cannot read.
func meHandler(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID, err := api.UserID(c)
		if err != nil {
			api.Fail(c, err)
			return
		}

		var user models.User
		if dbErr := db.First(&user, userID).Error; dbErr != nil {
			api.Fail(c, api.FromDB(dbErr, "User"))
			return
		}

		api.OK(c, NewUserDTO(user))
	}
}

// registerNotFound makes unmatched /api/v1 paths answer with the API's own
// error envelope. Gin's default 404 is plain text, which gives a JSON client a
// parse error instead of a readable failure.
//
// This has to hang off the engine's NoRoute rather than a catch-all inside the
// group: Gin's router rejects a wildcard that sits beside a static segment, so
// registering "/*any" alongside "/projects" panics at startup.
func registerNotFound(router *gin.Engine) {
	router.NoRoute(func(c *gin.Context) {
		if !strings.HasPrefix(c.Request.URL.Path, "/api/v1") {
			// Leave every other path to the existing behaviour.
			c.Status(http.StatusNotFound)
			return
		}

		api.Fail(c, api.NotFound("Endpoint "+c.Request.Method+" "+c.Request.URL.Path))
	})
}

// lower and contains are tiny wrappers so the search helpers in this package
// read the same way regardless of which string package they came from.
func lower(s string) string { return strings.ToLower(s) }

func contains(haystack, needle string) bool { return strings.Contains(haystack, needle) }
