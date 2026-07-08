package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"html/template"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/FeaturePlus/backend/database"
	"github.com/FeaturePlus/backend/handlers"
	"github.com/FeaturePlus/backend/internal/log"
	internalModels "github.com/FeaturePlus/backend/internal/models"
	"github.com/FeaturePlus/backend/middleware"
	"github.com/FeaturePlus/backend/migrations"
	"github.com/FeaturePlus/backend/models"
	"github.com/FeaturePlus/backend/repositories"
	"github.com/FeaturePlus/backend/routes"
	"github.com/FeaturePlus/backend/services"
	"github.com/gin-gonic/gin"
	"github.com/jilio/sqlitefs"
	"github.com/joho/godotenv"
	"github.com/sirupsen/logrus"
)

// Debug helper function
func debug(msg string, args ...interface{}) {
	if os.Getenv("DEBUG") != "" {
		log.Debugf("[DEBUG] "+msg, args...)
	}
}

// Simple logging middleware to print requests
func LoggingMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		path := c.Request.URL.Path
		raw := c.Request.URL.RawQuery

		c.Next()

		latency := time.Since(start)
		clientIP := c.ClientIP()
		method := c.Request.Method
		statusCode := c.Writer.Status()

		// Structured logging with fields
		logFields := logrus.Fields{
			"method":      method,
			"path":        path,
			"status":      statusCode,
			"duration_ms": latency.Milliseconds(),
			"ip":          clientIP,
		}
		if raw != "" {
			logFields["query"] = raw
		}

		log.WithFields(logFields).Info("HTTP request")
	}
}

// AppHandler handles app shell rendering and common functionality
type AppHandler struct {
	db          *database.Database
	projectRepo *repositories.ProjectRepository
}

// NewAppHandler creates a new app handler with database access
func NewAppHandler(db *database.Database) *AppHandler {
	return &AppHandler{
		db:          db,
		projectRepo: repositories.NewProjectRepository(db.DB),
	}
}

// RenderAppShell renders the dashboard.html shell and passes the correct initial fragment URL
func (h *AppHandler) RenderAppShell(c *gin.Context) {
	path := c.Request.URL.Path
	fragment := ""

	// Remove "/web" prefix
	if strings.HasPrefix(path, "/web") {
		path = path[len("/web"):]
	}

	// Build fragment URL for new /web/fragments group
	switch {
	case path == "/dashboard":
		fragment = "/web/fragments/dashboard-status"
	case path == "/projects":
		fragment = "/web/fragments/projects"
	case strings.HasPrefix(path, "/projects/") && strings.HasSuffix(path, "/features"):
		// e.g. /projects/8/features -> /web/projects/8/features/content
		parts := strings.Split(path, "/")
		if len(parts) >= 4 {
			fragment = "/web/projects/" + parts[2] + "/features/content"
		}
	case strings.HasPrefix(path, "/projects/") && strings.Contains(path, "/features/"):
		// e.g. /projects/8/features/33 -> /web/fragments/features/33
		parts := strings.Split(path, "/")
		if len(parts) >= 5 {
			fragment = "/web/fragments/features/" + parts[4]
		}
	case strings.HasPrefix(path, "/projects/"):
		// e.g. /projects/8 -> /web/fragments/projects/8
		parts := strings.Split(path, "/")
		if len(parts) >= 3 {
			fragment = "/web/fragments/projects/" + parts[2]
		}
	default:
		fragment = "/web/fragments/projects"
	}

	// Get user ID and role from context (set by AuthMiddleware and RoleMiddleware)
	userID, _ := c.Get("user_id")
	userRole, _ := c.Get("user_role")

	// Create CurrentUser object for template
	currentUser := map[string]interface{}{
		"ID":   userID,
		"Role": userRole,
	}

	// Get projects for sidebar
	var projects []models.Project
	h.db.DB.Find(&projects)

	c.HTML(http.StatusOK, "dashboard.html", gin.H{
		"InitialURL":  fragment,
		"CurrentUser": currentUser,
		"Projects":    projects,
	})
}

// Middleware to redirect non-HTMX requests for fragments to the app shell route
func FragmentHTMXGuard() gin.HandlerFunc {
	return func(c *gin.Context) {
		hx := c.GetHeader("HX-Request")
		if hx == "true" {
			c.Next()
			return
		}

		// Not an HTMX request: redirect to the corresponding app shell route
		path := c.Request.URL.Path
		if strings.HasPrefix(path, "/web/fragments/projects/") && strings.HasSuffix(path, "/features") {
			// /web/fragments/projects/:id/features -> /web/projects/:id/features
			parts := strings.Split(path, "/")
			if len(parts) >= 6 {
				redirect := "/web/projects/" + parts[4] + "/features"
				c.Redirect(http.StatusFound, redirect)
				c.Abort()
				return
			}
		} else if strings.HasPrefix(path, "/web/fragments/features/") {
			// /web/fragments/features/:id -> /web/projects/:pid/features/:id (try to guess parent, fallback)
			parts := strings.Split(path, "/")
			if len(parts) >= 5 {
				// You may want to look up the parent project, but fallback to /web/features/:id
				redirect := "/web/features/" + parts[4]
				c.Redirect(http.StatusFound, redirect)
				c.Abort()
				return
			}
		} else if strings.HasPrefix(path, "/web/fragments/projects/") {
			// /web/fragments/projects/:id -> /web/projects/:id
			parts := strings.Split(path, "/")
			if len(parts) >= 5 {
				redirect := "/web/projects/" + parts[4]
				c.Redirect(http.StatusFound, redirect)
				c.Abort()
				return
			}
		} else if path == "/web/fragments/projects" {
			c.Redirect(http.StatusFound, "/web/projects")
			c.Abort()
			return
		}
		// Default fallback: redirect to dashboard
		c.Redirect(http.StatusFound, "/web/dashboard")
		c.Abort()
	}
}

// Handler for dashboard status fragment
func DashboardStatusFragment(c *gin.Context) {
	// Check if user is logged in
	userID, loggedIn := c.Get("user_id")

	// Get user role from context (set by RoleMiddleware)
	userRole, hasRole := c.Get("user_role")

	// Create CurrentUser object for template
	currentUser := map[string]interface{}{
		"ID":        userID,
		"Role":      userRole,
		"IsManager": userRole == "manager",
	}

	// Get username for display
	var username string = "test1" // Default for testing
	if loggedIn {
		// Try to get the actual username from the database
		db, err := database.InitDB()
		if err == nil {
			var user models.User
			if err := db.DB.First(&user, userID).Error; err == nil {
				username = user.Username
			}
		}
	}

	c.HTML(http.StatusOK, "dashboard-status.html", gin.H{
		"LoggedIn":    loggedIn,
		"CurrentUser": currentUser,
		"HasRole":     hasRole,
		"Username":    username,
	})
}

// Handler for login page
func LoginPageHandler(c *gin.Context) {
	c.HTML(http.StatusOK, "login.html", nil)
}

// Handler for features by tag (HTML fragment)
func FeaturesByTagFragment(featureHandler *handlers.FeatureHandler) gin.HandlerFunc {
	return func(c *gin.Context) {
		tag := c.Query("tag")
		if tag == "" {
			c.HTML(http.StatusOK, "feature-list.html", gin.H{"Features": []interface{}{}, "TagFilter": tag})
			return
		}
		features, err := featureHandler.GetFeaturesByTagName(tag)
		if err != nil || len(features) == 0 {
			c.HTML(http.StatusOK, "feature-list.html", gin.H{"Features": []interface{}{}, "TagFilter": tag})
			return
		}
		c.HTML(http.StatusOK, "feature-list.html", gin.H{"Features": features, "TagFilter": tag})
	}
}

func main() {
	// --- Load environment variables from .env file at startup ---
	// Try multiple possible locations for .env file
	envLoaded := false
	possibleEnvFiles := []string{
		".env",
		"../.env",
		"../../.env",
	}

	for _, envFile := range possibleEnvFiles {
		if err := godotenv.Load(envFile); err == nil {
			log.WithField("file", envFile).Info("Loaded environment variables")
			envLoaded = true
			break
		}
	}

	if !envLoaded {
		log.Warn("No .env file found in any checked location (this is OK in production if env vars are set)")
	}

	// Check if debug mode is enabled
	if os.Getenv("DEBUG") == "1" {
		log.SetLevel(logrus.DebugLevel)
		log.Info("DEBUG mode enabled - detailed logging will be shown")
	}

	// --- Set required environment variables if not already set ---
	// Check for DATA_PATH
	dataPath := os.Getenv("DATA_PATH")
	if dataPath == "" {
		dataPath = "./data"
		os.Setenv("DATA_PATH", dataPath)
		log.WithField("path", dataPath).Info("Set DATA_PATH")
	}

	// Check for GITHUB_TOKEN
	githubToken := os.Getenv("GITHUB_TOKEN")
	if githubToken == "" {
		log.Error("GITHUB_TOKEN environment variable is not set")
		log.Error("Please set it in your .env file or directly in your environment")
		log.Error("Example: GITHUB_TOKEN=your_token_here")
		os.Exit(1)
	}

	// Initialize DB
	log.Info("Initializing database...")
	db, err := database.InitDB()
	if err != nil {
		log.WithError(err).Fatal("Failed to connect database")
	}
	log.Info("Database initialized successfully")

	// Run project config migrations to ensure tech_stack field exists
	migrations.RegisterMigrations(db.DB)

	// Get the underlying *sql.DB from GORM
	sqlDB, err := db.DB.DB()
	if err != nil {
		panic("failed to get database connection: " + err.Error())
	}

	// Initialize SQLiteFS with the *sql.DB
	sqliteFS, err := sqlitefs.NewSQLiteFS(sqlDB)
	if err != nil {
		panic("failed to initialize SQLiteFS: " + err.Error())
	}
	defer sqliteFS.Close()

	// Run upgrade to ensure releases have project-scoped unique tags BEFORE AutoMigrate
	if err := db.MigrateReleasesToProjectScoped(); err != nil {
		panic("failed to migrate releases to project-scoped tags: " + err.Error())
	}

	// Migrate all schemas
	if err := db.Migrate(
		&models.User{}, &models.Project{}, &models.Feature{}, &models.SubFeature{},
		&models.Task{}, &models.FeatureTag{}, &models.TaskAttachment{}, &models.Comment{},
		&models.PullRequest{}, &models.Dependency{},
		&models.ApprovedPR{},
		&models.FeatureFile{}, &models.FeatureCommit{}, // New: File and commit mappings
		&models.FeatureScope{},      // Scoped Contracts: per-feature access grants
		&models.ContractArtifact{}, // Scoped Contracts: versioned contract artifacts
		&internalModels.ProjectConnection{},
	); err != nil {
		panic("failed to migrate database: " + err.Error())
	}

	// Create repositories
	userRepo := repositories.NewUserRepository(db.DB)
	projectRepo := repositories.NewProjectRepository(db.DB)
	featureRepo := repositories.NewFeatureRepository(db.DB)
	taskRepo := repositories.NewTaskRepository(db.DB)
	tagRepo := repositories.NewTagRepository(db.DB)
	attachmentRepo := repositories.NewTaskAttachmentRepository(db.DB, sqliteFS)
	commentRepo := repositories.NewCommentRepository(db.DB)
	prRepo := repositories.NewPullRequestRepository(db.DB)
	releaseRepo := repositories.NewReleaseRepository(db.DB)

	// Create handlers
	userHandler := handlers.NewUserHandler(userRepo)
	projectHandler := handlers.NewProjectHandler(projectRepo, db.DB)
	featureHandler := handlers.NewFeatureHandler(featureRepo, tagRepo, taskRepo, db.DB)
	taskHandler := handlers.NewTaskHandler(taskRepo, db.DB)
	attachmentHandler := handlers.NewTaskAttachmentHandler(attachmentRepo, sqliteFS)
	commentHandler := handlers.NewCommentHandler(commentRepo, attachmentRepo)
	prHandler := handlers.NewPullRequestHandler(prRepo)
	webPRHandler := handlers.NewWebPRHandler(prRepo)
	webReleaseHandler := handlers.NewWebReleaseHandler(releaseRepo, prRepo, projectRepo)
	llmSuggestHandler := handlers.NewLLMSuggestHandler(db.DB) // STAGE 4a: LLM feature suggestions
	scopeHandler := handlers.NewScopeHandler(db.DB)           // Scoped Contracts: per-feature access grants
	// Scoped Contracts: contract service serves stripped contracts vs real source.
	// Source is read from the repo root (parent of the backend working dir).
	contractService := services.NewContractService(db.DB)
	if repoRoot, err := filepath.Abs(".."); err == nil {
		contractService.SetSourceReader(services.FSSourceReader{BaseDir: repoRoot})
	}
	contractHandler := handlers.NewContractHandler(db.DB, contractService)

	// MARKER:ROUTER_INIT Initialize the main router
	router := gin.Default()

	// Add dict function to the template FuncMap BEFORE LoadHTMLGlob
	router.SetFuncMap(template.FuncMap{
		"dict": func(values ...interface{}) map[string]interface{} {
			dict := make(map[string]interface{}, len(values)/2)
			for i := 0; i < len(values); i += 2 {
				key, _ := values[i].(string)
				dict[key] = values[i+1]
			}
			return dict
		},
		"toJson": func(v interface{}) template.JS {
			a, _ := json.Marshal(v)
			return template.JS(a)
		},
		"div": func(a, b float64) float64 {
			if b == 0 {
				return 0
			}
			return a / b
		},
		"float64": func(i interface{}) float64 {
			switch v := i.(type) {
			case int:
				return float64(v)
			case int64:
				return float64(v)
			case float64:
				return v
			default:
				return 0
			}
		},
		"hasPrefix": strings.HasPrefix,
		"add": func(a, b int) int {
			return a + b
		},
		"shortHash": func(hash string) string {
			if len(hash) > 7 {
				return hash[:7]
			}
			return hash
		},
		"truncate": func(s string, max int) string {
			if len(s) > max {
				return s[:max] + "…"
			}
			return s
		},
	})

	// First load the main templates
	router.LoadHTMLFiles(
		"templates/dashboard.html",
		"templates/login.html",
		"templates/feature-detail.html",
		"templates/pr-detail.html",
		"templates/task-card.html",
		"templates/dependency_panels.html",
		"templates/dependency_modal.html",
		"templates/pr_dependencies.html",
		"templates/project-list.html",
		"templates/project-list-fragment.html",
		"templates/create_project.html",
		"templates/import_project.html",
		"templates/import_github.html",
		"templates/template-details-fragment.html",
		"templates/_project_create_success.html",
		"templates/_pr_row.html",
		"templates/pr-modal.html",
		"templates/release-modal.html",
		"templates/_pr_table.html",
		"templates/task-comments-section.html",
		"templates/task-comments-list.html",
		"templates/attachment-comments-section.html",
		"templates/attachment-comments-list.html",
		"templates/comment-form.html",
		"templates/all-tasks-list.html",
		"templates/all-prs-list.html",
		"templates/dashboard-status.html",
		"templates/release-list.html",
		"templates/release-detail.html",
		"templates/release-edit-notes.html",
		"templates/release-feature-form.html",
		"templates/release-assign-features.html",
		"templates/release-planned-features-oob.html",
		"templates/feature-list.html",
		"templates/feature-list-inner.html",
		"templates/feature-list-oob.html",
		"templates/feature-card.html",
		"templates/feature-edit-form.html",
		"templates/task-list.html",
		"templates/task-edit-form.html",
		"templates/task-guidance-fragment.html",
		"templates/linked-code.html",
		"templates/feature-scopes.html",
		"templates/feature-progress.html",
		"templates/dependencies/dependencies-list.html",
		"templates/dependencies/dependency_panels.html",
		"templates/suggestions-error.html",
		"templates/feature-form.html",
		"templates/task-form.html",
		"templates/project-detail.html",
		"templates/project-list.html",
		"templates/project-settings-modal.html",
		"templates/success-message.html",
		"templates/dependencies/dependency_type_selector.html",
	)

	// Serve static files
	router.Static("/static", "./static")

	// Configure multipart form handling
	router.MaxMultipartMemory = 8 << 20 // 8 MiB

	// Add logging middleware
	router.Use(LoggingMiddleware())

	// MARKER:CORS_CONFIG CORS middleware configuration
	router.Use(func(c *gin.Context) {
		origin := c.Request.Header.Get("Origin")

		// Define allowed origins
		allowedOrigins := []string{
			"http://localhost:3000",
			"http://127.0.0.1:3000",
			"http://localhost:8080",
			"http://127.0.0.1:8080",
		}

		// Check if the origin is in allowed list
		isAllowed := false
		for _, o := range allowedOrigins {
			if origin == o {
				isAllowed = true
				break
			}
		}

		// If not matched, you can still allow Tailscale/IP based origins dynamically
		if strings.HasPrefix(origin, "http://100.") {
			isAllowed = true
		}

		if isAllowed && origin != "" {
			c.Writer.Header().Set("Access-Control-Allow-Origin", origin)
			c.Writer.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, PATCH, OPTIONS")
			c.Writer.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
			c.Writer.Header().Set("Access-Control-Allow-Credentials", "true")
			c.Writer.Header().Set("Vary", "Origin")
		}

		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(http.StatusOK)
			return
		}

		c.Next()
	})

	// Register auth routes
	routes.RegisterAuthRoutes(router, db.DB)

	// Create role middleware with database instance
	roleMiddleware := middleware.CreateRoleMiddleware(db.DB)

	// MARKER:API_ROUTES Define API endpoints
	// --- EXISTING API ROUTES ---
	api := router.Group("/api")
	{
		api.Use(BodyLoggingMiddleware())

		// Public routes (no auth required)
		userRoutes := api.Group("/users")
		{
			userRoutes.GET("", userHandler.GetAllUsers)
		}

		// Public project connection routes (no auth required for CLI)
		publicProjectRoutes := api.Group("/projects")
		{
			publicProjectRoutes.POST("/:id/connect", handlers.ConnectProjectHandler(db.DB))
			publicProjectRoutes.GET("/:id/status", handlers.GetProjectConnectionStatus(db.DB))
		}

		// Public feature routes (no auth required for CLI)
		api.GET("/features/:id", featureHandler.GetFeatureAPI)
		api.POST("/features/sync", featureHandler.SyncFeatureData)

		// CLI JSON API routes (auth required)
		cliApi := api.Group("/", middleware.AuthMiddleware())
		{
			cliApi.POST("/features", featureHandler.CreateFeatureAPI)
			cliApi.GET("/json/projects/:id/features", featureHandler.GetFeaturesByProjectAPI)
			cliApi.POST("/tasks", featureHandler.CreateTaskAPI)
			cliApi.GET("/json/features/:id/tasks", featureHandler.GetTasksByFeatureAPI)
		}

		// Protected routes (auth required)
		authApi := api.Group("/", middleware.AuthMiddleware())
		authApi.Use(roleMiddleware()) // Apply role middleware to all authenticated routes

		projectRoutes := authApi.Group("/projects")
		{
			projectRoutes.GET("", projectHandler.GetAllProjects)
			projectRoutes.DELETE("/:id", projectHandler.DeleteProject)
			projectRoutes.GET("/:id/progress", projectHandler.GetProjectProgress)
			projectRoutes.GET("/:id/releases", projectHandler.GetProjectReleases)
			projectRoutes.POST("/:id/settings", projectHandler.UpdateProjectSettings)
			projectRoutes.POST("/:id/export-markdown", projectHandler.ExportMarkdown)
			// STAGE 4a: LLM-based feature suggestions
			projectRoutes.POST("/:id/suggest", llmSuggestHandler.SuggestFeatures)
			// Scoped Contracts: access-gated file content (owner=source, contract=stripped, none=404)
			projectRoutes.GET("/:id/files", contractHandler.ServeFile)
		}

		// Regular authenticated routes
		authApi.GET("/features/project/:project_id", featureHandler.GetProjectFeatures)
		authApi.POST("/features/:id/unassign-release", featureHandler.UnassignFeatureFromRelease)
		authApi.POST("/tasks/:task_id/attachments", attachmentHandler.UploadAttachment)
		authApi.GET("/attachments/file/:filename", attachmentHandler.ServeAttachment)
		authApi.DELETE("/attachments/:id", attachmentHandler.DeleteAttachment)
		authApi.POST("/tasks/:task_id/comments", commentHandler.CreateComment)
		authApi.GET("/tasks/:task_id/comments", commentHandler.GetTaskComments)
		authApi.GET("/attachments/:attachment_id/comments", commentHandler.GetAttachmentComments)
		authApi.PUT("/comments/:comment_id", commentHandler.UpdateComment)
		authApi.DELETE("/comments/:comment_id", commentHandler.DeleteComment)
		authApi.POST("/pr", handlers.PRUploadAPIHandler)
		authApi.GET("/pr", handlers.PRListAPIHandler)
		authApi.GET("/prs/:id", handlers.PRGetByIDHandler)

		prReviewHandler := handlers.NewPRReviewHandler(prRepo)
		authApi.POST("/pr/:id/review", prReviewHandler.ReviewPR)
	}

	// Register release routes
	routes.RegisterReleaseRoutes(router, db.DB)

	// Register dependency routes
	routes.RegisterDependencyRoutes(router, db.DB)

	// Register guidance routes
	routes.RegisterGuidanceRoutes(router, db.DB)

	// Register template routes
	routes.RegisterTemplateRoutes(router, db.DB)

	// Register import routes (dynamic loading, not preloaded)
	routes.RegisterImportRoutes(router, db.DB)

	// MARKER:WEB_ROUTES Define web routes for HTMX
	// --- NEW WEB ROUTES FOR HTMX ---
	// Create app handler for web routes
	appHandler := NewAppHandler(db)

	web := router.Group("/web")
	{
		// Public web routes
		web.GET("/dashboard", appHandler.RenderAppShell)
		web.GET("/login", LoginPageHandler)

		// Protected web routes
		authWeb := web.Group("/", middleware.AuthMiddleware())
		authWeb.Use(roleMiddleware()) // Apply role middleware to all authenticated web routes
		{
			authWeb.GET("/projects", appHandler.RenderAppShell)
			authWeb.GET("/projects/:id", appHandler.RenderAppShell)
			authWeb.GET("/projects/:id/features", appHandler.RenderAppShell)
			authWeb.GET("/projects/create-modal", projectHandler.ShowProjectCreateModal)
			authWeb.GET("/projects/import-modal", projectHandler.ShowProjectImportModal)
			authWeb.GET("/projects/import-github-modal", projectHandler.ShowGitHubImportModal)
			authWeb.POST("/projects/create", projectHandler.CreateProjectFromForm)
			authWeb.GET("/projects/:id/features/:featureid", featureHandler.GetFeature)
			authWeb.GET("/projects/:id/features/content", featureHandler.FeaturesContentHandler)
			authWeb.GET("/projects/:id/features/new", featureHandler.NewFeatureForm)
			authWeb.POST("/projects/:id/features", featureHandler.CreateFeatureForProject)
			// STAGE 4b: AI Suggestions web route
			authWeb.POST("/projects/:id/suggest", llmSuggestHandler.SuggestFeaturesWeb)
			authWeb.GET("/features/:id/edit-inline", featureHandler.EditFeatureInline)
			authWeb.DELETE("/features/:id", featureHandler.DeleteFeature)
			authWeb.GET("/features/:id/tasks", taskHandler.GetTasksByFeature)
			authWeb.GET("/features/:id/linked-code", featureHandler.GetLinkedCode)
			// Scoped Contracts: per-feature access management
			authWeb.GET("/features/:id/scopes", scopeHandler.GetFeatureScopes)
			authWeb.POST("/features/:id/scopes", scopeHandler.CreateFeatureScope)
			authWeb.DELETE("/features/:id/scopes/:scope_id", scopeHandler.DeleteFeatureScope)
			authWeb.GET("/features/:id/tasks/new", taskHandler.NewTaskForm)
			authWeb.POST("/features/:id/tasks", taskHandler.CreateTaskForFeature)
			authWeb.GET("/tasks/cancel", taskHandler.CancelTaskForm)
			authWeb.GET("/features/cancel", func(c *gin.Context) { c.String(200, "") })

			// Release web routes
			authWeb.GET("/releases", webReleaseHandler.RenderReleasesList)
			authWeb.GET("/releases/:id", webReleaseHandler.RenderReleaseDetail)
			authWeb.GET("/releases/:id/row", webReleaseHandler.RenderReleaseRow)
			authWeb.GET("/releases/:id/notes/edit", webReleaseHandler.EditNotesFragment)
		}
	}

	// Fragments routes - most require authentication
	fragments := web.Group("/fragments")
	fragments.Use(FragmentHTMXGuard())
	{
		// Public fragment routes
		fragments.GET("/dashboard-status", DashboardStatusFragment)

		// Protected fragment routes
		authFragments := fragments.Group("/", middleware.AuthMiddleware())
		authFragments.Use(roleMiddleware()) // Apply role middleware to all authenticated fragment routes
		{
			// THIS IS THE NEWLY ADDED ROUTE
			authFragments.GET("/projects", projectHandler.GetAllProjectsFragment)
			authFragments.GET("/projects/:id", projectHandler.GetProject)
			authFragments.GET("/projects/:id/settings", projectHandler.GetProjectSettingsModal)

			authFragments.GET("/projects/:id/features", featureHandler.GetProjectFeatures)
			authFragments.GET("/projects/:id/features/new", featureHandler.NewFeatureForm)
			authFragments.GET("/features/:id", featureHandler.GetFeature)
			authFragments.GET("/features/:id/tasks/:task_id/edit", taskHandler.EditTaskForm)
			authFragments.POST("/features/:id/tasks/:task_id/edit", taskHandler.UpdateTaskInline)
			authFragments.GET("/features/:id/tasks/:task_id/view", taskHandler.ViewTaskCard)
			authFragments.GET("/features/:id/view", featureHandler.ViewFeatureCard)
			authFragments.GET("/features/cancel", func(c *gin.Context) { c.String(200, "") })
			authFragments.POST("/features/:id/edit-inline", featureHandler.UpdateFeatureInline)
			authFragments.GET("/tags/autocomplete", featureHandler.TagAutocomplete)
			authFragments.GET("/features", FeaturesByTagFragment(featureHandler))
			authFragments.GET("/features/progress", featureHandler.GetFeaturesProgressFragment)
			authFragments.GET("/tasks", taskHandler.GetAllTasksFragment)
			authFragments.GET("/tasks/assigned", taskHandler.GetAssignedTasksFragment)
			authFragments.GET("/prs", webPRHandler.GetAllPRsFragment)
			authFragments.GET("/prs/my-prs", webPRHandler.GetMyPRsFragment)
			authFragments.GET("/releases", webReleaseHandler.RenderReleasesListFragment)
			authFragments.GET("/releases/:id", webReleaseHandler.RenderReleaseDetailFragment)
			authFragments.GET("/release-modal", webReleaseHandler.NewReleaseModal)
			authFragments.GET("/releases/:id/features/new", webReleaseHandler.NewFeatureFragment)
			authFragments.GET("/releases/:id/features/assign", webReleaseHandler.AssignFeaturesFragment)
			authFragments.POST("/api/releases", webReleaseHandler.CreateRelease)
		}
	}

	// Health check
	router.GET("/api/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"status":  "ok",
			"version": "1.0.0",
		})
	})

	// Serve the minimal test upload page for debugging
	router.StaticFile("/test-upload", "./templates/task-attachments-test.html")

	// Register PR routes
	prGroup := router.Group("/prs", middleware.AuthMiddleware())
	prGroup.Use(roleMiddleware()) // Apply role middleware to all PR routes
	{
		prGroup.POST("/:id/test", prHandler.MarkAsTested)
		// Restrict approve action to managers only
		prGroup.POST("/:id/approve", roleMiddleware("manager"), prHandler.ApprovePR)
	}

	// Register Task PR routes
	taskPRGroup := router.Group("/tasks", middleware.AuthMiddleware())
	taskPRGroup.Use(roleMiddleware()) // Apply role middleware to all task PR routes
	{
		taskPRGroup.GET("/:id/pr-form", webPRHandler.GetPRForm)
		taskPRGroup.POST("/:id/prs", webPRHandler.AddTaskPR)
	}

	// Debug: List all registered routes
	log.Debug("Listing all registered routes")
	routesFile, err := os.Create("routes.txt")
	if err != nil {
		log.WithError(err).Warn("Error creating routes file")
	} else {
		defer routesFile.Close()
		fmt.Fprintln(routesFile, "Registered Routes:")
		for _, route := range router.Routes() {
			fmt.Fprintf(routesFile, "Method: %s, Path: %s\n", route.Method, route.Path)
		}
	}

	// Start server
	log.WithFields(logrus.Fields{
		"port": 8080,
		"host": "0.0.0.0",
	}).Info("Server starting...")
	if err := router.Run("0.0.0.0:8080"); err != nil {
		log.WithError(err).Fatal("Failed to start server")
	}
}

// BodyLoggingMiddleware logs the request body
func BodyLoggingMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		if c.Request.Method == "POST" || c.Request.Method == "PUT" || c.Request.Method == "PATCH" {
			bodyBytes, err := io.ReadAll(c.Request.Body)
			if err != nil {
				log.WithError(err).Error("Error reading request body")
			} else {
				log.WithField("body", string(bodyBytes)).Debug("Request Body")
			}
			// Restore the body for subsequent handlers
			c.Request.Body = io.NopCloser(bytes.NewBuffer(bodyBytes))
		}
		c.Next()
	}
}
