package app

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"os"
	"time"

	"github.com/FeaturePlus/backend/database"
	"github.com/FeaturePlus/backend/handlers"
	"github.com/FeaturePlus/backend/internal/log"
	internalModels "github.com/FeaturePlus/backend/internal/models"
	"github.com/FeaturePlus/backend/middleware"
	"github.com/FeaturePlus/backend/migrations"
	"github.com/FeaturePlus/backend/models"
	"github.com/FeaturePlus/backend/repositories"
	"github.com/FeaturePlus/backend/services"
	"github.com/gin-gonic/gin"
	"github.com/jilio/sqlitefs"
	"github.com/sirupsen/logrus"
)

// App is a fully wired FeaturePlus instance: database, repositories, handlers
// and routes, but not yet listening. Both the web server and the desktop build
// construct one of these; they differ only in the Config passed to New and in
// how they call Serve.
type App struct {
	Config Config
	DB     *database.Database
	Router *gin.Engine

	sqliteFS *sqlitefs.SQLiteFS
	server   *http.Server
	listener net.Listener
}

// New builds the application from a configuration. It opens and migrates the
// database, constructs every handler, and registers all routes. It does not
// bind a port — call Listen or Serve for that.
func New(cfg Config) (*App, error) {
	if err := cfg.Validate(); err != nil {
		return nil, err
	}

	if os.Getenv("DEBUG") == "1" {
		log.SetLevel(logrus.DebugLevel)
		log.Info("DEBUG mode enabled - detailed logging will be shown")
	}

	log.WithFields(cfg.LogFields()).Info("Starting FeaturePlus")

	db, err := openDatabase(cfg)
	if err != nil {
		return nil, err
	}

	sqlDB, err := db.DB.DB()
	if err != nil {
		return nil, fmt.Errorf("failed to get database connection: %w", err)
	}

	sqliteFS, err := sqlitefs.NewSQLiteFS(sqlDB)
	if err != nil {
		return nil, fmt.Errorf("failed to initialize SQLiteFS: %w", err)
	}

	a := &App{Config: cfg, DB: db, sqliteFS: sqliteFS}

	if err := a.buildRouter(); err != nil {
		_ = sqliteFS.Close()
		return nil, err
	}

	a.dumpRoutes()

	return a, nil
}

// openDatabase connects to SQLite and brings the schema up to date.
func openDatabase(cfg Config) (*database.Database, error) {
	log.Info("Initializing database...")

	db, err := database.InitDBAt(cfg.DBPath)
	if err != nil {
		return nil, fmt.Errorf("failed to connect database: %w", err)
	}
	log.Info("Database initialized successfully")

	migrations.RegisterMigrations(db.DB)

	// This must run before AutoMigrate: it rebuilds the releases table to swap a
	// global UNIQUE(tag) for UNIQUE(project_id, tag).
	if err := db.MigrateReleasesToProjectScoped(); err != nil {
		return nil, fmt.Errorf("failed to migrate releases to project-scoped tags: %w", err)
	}

	if err := db.Migrate(
		&models.User{}, &models.Project{}, &models.Feature{}, &models.SubFeature{},
		&models.Task{}, &models.FeatureTag{}, &models.TaskAttachment{}, &models.Comment{},
		&models.PullRequest{}, &models.Dependency{},
		&models.Release{}, // also creates release_prs, which the release migration above reads
		&models.ApprovedPR{},
		&models.FeatureFile{}, &models.FeatureCommit{}, // File and commit mappings
		&models.FeatureScope{},     // Scoped Contracts: per-feature access grants
		&models.ContractArtifact{}, // Scoped Contracts: versioned contract artifacts
		&models.IntegrationCheck{}, // Scoped Contracts: trusted integration check results
		&models.ProjectGitHub{}, &models.ReleaseGitHub{}, &models.UserGitHub{}, // GitHub connection
		&models.PlaygroundDraft{}, // Each person's playground draft
		&models.ProjectMember{},   // Who each project is shared with
		&models.FeatureVersion{},  // Saved copies of a project's feature list
		&models.FeatureCopy{},     // Each person's own edited copy of a version
		&internalModels.ProjectConnection{},
	); err != nil {
		return nil, fmt.Errorf("failed to migrate database: %w", err)
	}

	return db, nil
}

// dependencies bundles everything the route registration needs, so that
// registerRoutes reads as a list of routes rather than a list of arguments.
type dependencies struct {
	db       *database.Database
	sqliteFS *sqlitefs.SQLiteFS

	// contracts is shared with the v1 API, so both halves of the application
	// read source through the same configured repository roots.
	contracts *services.ContractService

	prRepo repositories.PullRequestRepository

	shell      *ShellHandler
	user       *handlers.UserHandler
	project    *handlers.ProjectHandler
	feature    *handlers.FeatureHandler
	task       *handlers.TaskHandler
	attachment *handlers.TaskAttachmentHandler
	comment    *handlers.CommentHandler
	pr         *handlers.PullRequestHandler
	webPR      *handlers.WebPRHandler
	webRelease *handlers.WebReleaseHandler
	llmSuggest *handlers.LLMSuggestHandler
	scope      *handlers.ScopeHandler
	contract   *handlers.ContractHandler
	briefing   *handlers.BriefingHandler

	// role builds a role-checking middleware. Called with no arguments it only
	// loads the user's role into the context; with names it also enforces them.
	role func(...string) gin.HandlerFunc
}

// buildDependencies constructs the repositories, services and handlers.
func (a *App) buildDependencies() *dependencies {
	db := a.DB

	userRepo := repositories.NewUserRepository(db.DB)
	projectRepo := repositories.NewProjectRepository(db.DB)
	featureRepo := repositories.NewFeatureRepository(db.DB)
	taskRepo := repositories.NewTaskRepository(db.DB)
	tagRepo := repositories.NewTagRepository(db.DB)
	attachmentRepo := repositories.NewTaskAttachmentRepository(db.DB, a.sqliteFS)
	commentRepo := repositories.NewCommentRepository(db.DB)
	prRepo := repositories.NewPullRequestRepository(db.DB)
	releaseRepo := repositories.NewReleaseRepository(db.DB)

	// Scoped Contracts: the contract service serves stripped contracts in place
	// of real source. The repository root is the default source root; projects
	// whose code lives elsewhere are mapped through FEATUREPLUS_SOURCE_ROOTS, so
	// one instance can serve contracts across multiple repositories.
	contractService := services.NewContractService(db.DB)
	if root := a.Config.SourceRoot; root != "" {
		contractService.SetSourceReader(services.ProjectSourceReader{
			Roots:   a.Config.SourceRoots,
			Default: root,
		})
		contractService.SetCommitResolver(services.GitCommitResolver{RepoDir: root})
	}

	return &dependencies{
		db:        db,
		sqliteFS:  a.sqliteFS,
		prRepo:    prRepo,
		contracts: contractService,
		role:      middleware.CreateRoleMiddleware(db.DB),

		shell:      NewShellHandler(db),
		user:       handlers.NewUserHandler(userRepo),
		project:    handlers.NewProjectHandler(projectRepo, db.DB),
		feature:    handlers.NewFeatureHandler(featureRepo, tagRepo, taskRepo, db.DB),
		task:       handlers.NewTaskHandler(taskRepo, db.DB),
		attachment: handlers.NewTaskAttachmentHandler(attachmentRepo, a.sqliteFS),
		comment:    handlers.NewCommentHandler(commentRepo, attachmentRepo),
		pr:         handlers.NewPullRequestHandler(prRepo),
		webPR:      handlers.NewWebPRHandler(prRepo),
		webRelease: handlers.NewWebReleaseHandler(releaseRepo, prRepo, projectRepo),
		llmSuggest: handlers.NewLLMSuggestHandler(db.DB),
		scope:      handlers.NewScopeHandler(db.DB),
		contract:   handlers.NewContractHandler(db.DB, contractService),
		briefing:   handlers.NewBriefingHandler(db.DB, contractService),
	}
}

// buildRouter creates the Gin engine, loads templates, installs middleware and
// registers every route.
func (a *App) buildRouter() error {
	router := gin.Default()

	loadTemplates(router, &a.Config)

	router.Static("/static", a.Config.StaticDir())
	router.MaxMultipartMemory = a.Config.MaxMultipartMemory

	router.Use(LoggingMiddleware())
	router.Use(CORSMiddleware())

	registerRoutes(router, a.buildDependencies(), &a.Config)

	a.Router = router
	return nil
}

// dumpRoutes writes the registered route table to disk as a development aid.
// Failure is logged and ignored — it must never stop the application starting.
func (a *App) dumpRoutes() {
	if a.Config.RouteDumpPath == "" {
		return
	}

	f, err := os.Create(a.Config.RouteDumpPath)
	if err != nil {
		log.WithError(err).Warn("Error creating routes file")
		return
	}
	defer f.Close()

	fmt.Fprintln(f, "Registered Routes:")
	for _, route := range a.Router.Routes() {
		fmt.Fprintf(f, "Method: %s, Path: %s\n", route.Method, route.Path)
	}
}

// Listen binds the configured address without serving, and returns the address
// actually bound. This matters in desktop mode, where the port is 0 and the
// operating system picks one: the window needs the real port to load a URL.
func (a *App) Listen() (string, error) {
	ln, err := net.Listen("tcp", a.Config.Addr)
	if err != nil {
		return "", fmt.Errorf("failed to bind %s: %w", a.Config.Addr, err)
	}

	a.listener = ln
	a.server = &http.Server{Handler: a.Router}

	return ln.Addr().String(), nil
}

// URL returns the base URL of the bound listener, or an empty string if the
// application is not listening yet.
func (a *App) URL() string {
	if a.listener == nil {
		return ""
	}
	addr := a.listener.Addr().String()
	if tcp, ok := a.listener.Addr().(*net.TCPAddr); ok && tcp.IP.IsUnspecified() {
		addr = fmt.Sprintf("127.0.0.1:%d", tcp.Port)
	}
	return "http://" + addr
}

// Serve blocks, handling requests until the server is shut down. It calls
// Listen first if the application is not already bound.
func (a *App) Serve() error {
	if a.listener == nil {
		if _, err := a.Listen(); err != nil {
			return err
		}
	}

	log.WithField("url", a.URL()).Info("Server starting...")

	if err := a.server.Serve(a.listener); err != nil && err != http.ErrServerClosed {
		return err
	}
	return nil
}

// Shutdown stops accepting requests and waits briefly for those in flight.
func (a *App) Shutdown(ctx context.Context) error {
	if a.server == nil {
		return nil
	}
	return a.server.Shutdown(ctx)
}

// Close releases the application's resources. It is safe to call more than once.
func (a *App) Close() error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := a.Shutdown(ctx); err != nil {
		log.WithError(err).Warn("Error shutting down HTTP server")
	}

	if a.sqliteFS != nil {
		if err := a.sqliteFS.Close(); err != nil {
			log.WithError(err).Warn("Error closing SQLiteFS")
		}
		a.sqliteFS = nil
	}

	// Close the database itself. Without this the SQLite file stays open for
	// the life of the process, which leaves the desktop build holding a lock on
	// the user's database after the window closes.
	if a.DB != nil {
		if sqlDB, err := a.DB.DB.DB(); err == nil {
			if err := sqlDB.Close(); err != nil {
				return err
			}
		}
		a.DB = nil
	}

	return nil
}
