package app

import (
	"net/http"

	v1 "github.com/FeaturePlus/backend/api/v1"
	"github.com/FeaturePlus/backend/handlers"
	"github.com/FeaturePlus/backend/middleware"
	"github.com/FeaturePlus/backend/routes"
	"github.com/gin-gonic/gin"
)

// registerRoutes wires every route onto the router. The grouping and order are
// unchanged from main.go — this is a move, not a redesign.
func registerRoutes(router *gin.Engine, d *dependencies, cfg *Config) {
	routes.RegisterAuthRoutes(router, d.db.DB)

	// The versioned JSON API the React frontend and the desktop window use.
	// Registered before the legacy /api group so its own 404 envelope wins
	// for unmatched /api/v1 paths.
	v1.Register(router, d.db.DB)

	registerAPIRoutes(router, d)

	routes.RegisterReleaseRoutes(router, d.db.DB)
	routes.RegisterDependencyRoutes(router, d.db.DB)
	routes.RegisterGuidanceRoutes(router, d.db.DB)
	routes.RegisterTemplateRoutes(router, d.db.DB)
	routes.RegisterImportRoutes(router, d.db.DB)

	registerWebRoutes(router, d)
	registerFragmentRoutes(router, d)
	registerMiscRoutes(router, d, cfg)
}

// registerAPIRoutes registers the JSON API under /api.
func registerAPIRoutes(router *gin.Engine, d *dependencies) {
	api := router.Group("/api")
	{
		api.Use(BodyLoggingMiddleware())

		// Public routes (no auth required)
		userRoutes := api.Group("/users")
		{
			userRoutes.GET("", d.user.GetAllUsers)
		}

		// Public project connection routes (no auth required for CLI)
		publicProjectRoutes := api.Group("/projects")
		{
			publicProjectRoutes.POST("/:id/connect", handlers.ConnectProjectHandler(d.db.DB))
			publicProjectRoutes.GET("/:id/status", handlers.GetProjectConnectionStatus(d.db.DB))
		}

		// Public feature routes (no auth required for CLI)
		api.GET("/features/:id", d.feature.GetFeatureAPI)
		api.POST("/features/sync", d.feature.SyncFeatureData)

		// CLI JSON API routes (auth required)
		cliApi := api.Group("/", middleware.AuthMiddleware())
		{
			cliApi.POST("/features", d.feature.CreateFeatureAPI)
			cliApi.GET("/json/projects/:id/features", d.feature.GetFeaturesByProjectAPI)
			cliApi.POST("/tasks", d.feature.CreateTaskAPI)
			cliApi.GET("/json/features/:id/tasks", d.feature.GetTasksByFeatureAPI)
		}

		// Protected routes (auth required)
		authApi := api.Group("/", middleware.AuthMiddleware())
		authApi.Use(d.role())

		projectRoutes := authApi.Group("/projects")
		{
			projectRoutes.GET("", d.project.GetAllProjects)
			projectRoutes.DELETE("/:id", d.project.DeleteProject)
			projectRoutes.GET("/:id/progress", d.project.GetProjectProgress)
			projectRoutes.GET("/:id/releases", d.project.GetProjectReleases)
			projectRoutes.POST("/:id/settings", d.project.UpdateProjectSettings)
			projectRoutes.POST("/:id/export-markdown", d.project.ExportMarkdown)
			// LLM-based feature suggestions
			projectRoutes.POST("/:id/suggest", d.llmSuggest.SuggestFeatures)
			// Scoped Contracts: access-gated file content (owner=source, contract=stripped, none=404)
			projectRoutes.GET("/:id/files", d.contract.ServeFile)
			// Scoped Contracts: generated mock for a contract-scope dependency file
			projectRoutes.GET("/:id/mocks", d.contract.ServeMock)
			// Scoped Contracts: the collaborator's full onboarding briefing
			// (?format=md renders it as a single document for an AI assistant)
			projectRoutes.GET("/:id/briefing", d.briefing.GetBriefing)
		}

		// Regular authenticated routes
		authApi.GET("/features/project/:project_id", d.feature.GetProjectFeatures)
		authApi.POST("/features/:id/unassign-release", d.feature.UnassignFeatureFromRelease)
		authApi.POST("/tasks/:task_id/attachments", d.attachment.UploadAttachment)
		authApi.GET("/attachments/file/:filename", d.attachment.ServeAttachment)
		authApi.DELETE("/attachments/:id", d.attachment.DeleteAttachment)
		authApi.POST("/tasks/:task_id/comments", d.comment.CreateComment)
		authApi.GET("/tasks/:task_id/comments", d.comment.GetTaskComments)
		authApi.GET("/attachments/:attachment_id/comments", d.comment.GetAttachmentComments)
		authApi.PUT("/comments/:comment_id", d.comment.UpdateComment)
		authApi.DELETE("/comments/:comment_id", d.comment.DeleteComment)
		authApi.POST("/pr", handlers.PRUploadAPIHandler)
		authApi.GET("/pr", handlers.PRListAPIHandler)
		authApi.GET("/prs/:id", handlers.PRGetByIDHandler)

		prReviewHandler := handlers.NewPRReviewHandler(d.prRepo)
		authApi.POST("/pr/:id/review", prReviewHandler.ReviewPR)
	}
}

// registerWebRoutes registers the htmx page routes under /web.
func registerWebRoutes(router *gin.Engine, d *dependencies) {
	web := router.Group("/web")
	{
		// Public web routes
		web.GET("/dashboard", d.shell.RenderAppShell)
		web.GET("/login", LoginPageHandler)

		// Protected web routes
		authWeb := web.Group("/", middleware.AuthMiddleware())
		authWeb.Use(d.role())
		{
			authWeb.GET("/projects", d.shell.RenderAppShell)
			authWeb.GET("/projects/:id", d.shell.RenderAppShell)
			authWeb.GET("/projects/:id/features", d.shell.RenderAppShell)
			authWeb.GET("/projects/create-modal", d.project.ShowProjectCreateModal)
			authWeb.GET("/projects/import-modal", d.project.ShowProjectImportModal)
			authWeb.GET("/projects/import-github-modal", d.project.ShowGitHubImportModal)
			authWeb.POST("/projects/create", d.project.CreateProjectFromForm)
			authWeb.GET("/projects/:id/features/:featureid", d.feature.GetFeature)
			authWeb.GET("/projects/:id/features/content", d.feature.FeaturesContentHandler)
			authWeb.GET("/projects/:id/features/new", d.feature.NewFeatureForm)
			authWeb.POST("/projects/:id/features", d.feature.CreateFeatureForProject)
			// AI Suggestions web route
			authWeb.POST("/projects/:id/suggest", d.llmSuggest.SuggestFeaturesWeb)
			authWeb.GET("/features/:id/edit-inline", d.feature.EditFeatureInline)
			authWeb.DELETE("/features/:id", d.feature.DeleteFeature)
			authWeb.GET("/features/:id/tasks", d.task.GetTasksByFeature)
			authWeb.GET("/features/:id/linked-code", d.feature.GetLinkedCode)
			// Scoped Contracts: collaborator contract view (with drift banner)
			authWeb.GET("/projects/:id/contract-view", d.contract.GetContractView)
			// Scoped Contracts: the collaborator's onboarding briefing page
			authWeb.GET("/projects/:id/briefing", d.briefing.GetBriefingView)
			// Scoped Contracts: per-feature access management
			authWeb.GET("/features/:id/scopes", d.scope.GetFeatureScopes)
			authWeb.POST("/features/:id/scopes", d.scope.CreateFeatureScope)
			authWeb.DELETE("/features/:id/scopes/:scope_id", d.scope.DeleteFeatureScope)
			authWeb.GET("/features/:id/tasks/new", d.task.NewTaskForm)
			authWeb.POST("/features/:id/tasks", d.task.CreateTaskForFeature)
			authWeb.GET("/tasks/cancel", d.task.CancelTaskForm)
			authWeb.GET("/features/cancel", emptyFragment)

			// Release web routes
			authWeb.GET("/releases", d.webRelease.RenderReleasesList)
			authWeb.GET("/releases/:id", d.webRelease.RenderReleaseDetail)
			authWeb.GET("/releases/:id/row", d.webRelease.RenderReleaseRow)
			authWeb.GET("/releases/:id/notes/edit", d.webRelease.EditNotesFragment)
		}
	}
}

// registerFragmentRoutes registers the htmx partial routes under /web/fragments.
func registerFragmentRoutes(router *gin.Engine, d *dependencies) {
	fragments := router.Group("/web/fragments")
	fragments.Use(FragmentHTMXGuard())
	{
		// Public fragment routes
		fragments.GET("/dashboard-status", d.shell.DashboardStatusFragment)

		// Protected fragment routes
		authFragments := fragments.Group("/", middleware.AuthMiddleware())
		authFragments.Use(d.role())
		{
			authFragments.GET("/projects", d.project.GetAllProjectsFragment)
			authFragments.GET("/projects/:id", d.project.GetProject)
			authFragments.GET("/projects/:id/settings", d.project.GetProjectSettingsModal)
			authFragments.GET("/projects/:id/features", d.feature.GetProjectFeatures)
			authFragments.GET("/projects/:id/features/new", d.feature.NewFeatureForm)
			authFragments.GET("/features/:id", d.feature.GetFeature)
			authFragments.GET("/features/:id/tasks/:task_id/edit", d.task.EditTaskForm)
			authFragments.POST("/features/:id/tasks/:task_id/edit", d.task.UpdateTaskInline)
			authFragments.GET("/features/:id/tasks/:task_id/view", d.task.ViewTaskCard)
			authFragments.GET("/features/:id/view", d.feature.ViewFeatureCard)
			authFragments.GET("/features/cancel", emptyFragment)
			authFragments.POST("/features/:id/edit-inline", d.feature.UpdateFeatureInline)
			authFragments.GET("/tags/autocomplete", d.feature.TagAutocomplete)
			authFragments.GET("/features", FeaturesByTagFragment(d.feature))
			authFragments.GET("/features/progress", d.feature.GetFeaturesProgressFragment)
			authFragments.GET("/tasks", d.task.GetAllTasksFragment)
			authFragments.GET("/tasks/assigned", d.task.GetAssignedTasksFragment)
			authFragments.GET("/prs", d.webPR.GetAllPRsFragment)
			authFragments.GET("/prs/my-prs", d.webPR.GetMyPRsFragment)
			authFragments.GET("/releases", d.webRelease.RenderReleasesListFragment)
			authFragments.GET("/releases/:id", d.webRelease.RenderReleaseDetailFragment)
			authFragments.GET("/release-modal", d.webRelease.NewReleaseModal)
			authFragments.GET("/releases/:id/features/new", d.webRelease.NewFeatureFragment)
			authFragments.GET("/releases/:id/features/assign", d.webRelease.AssignFeaturesFragment)
			authFragments.POST("/api/releases", d.webRelease.CreateRelease)
		}
	}
}

// registerMiscRoutes covers the health check, the upload debug page, and the
// PR routes that sit outside the /api and /web groups.
func registerMiscRoutes(router *gin.Engine, d *dependencies, cfg *Config) {
	router.GET("/api/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"status":  "ok",
			"version": "1.0.0",
			"mode":    string(cfg.Mode),
		})
	})

	// Minimal test upload page, for debugging attachments
	router.StaticFile("/test-upload", cfg.TemplatePath("task-attachments-test.html"))

	prGroup := router.Group("/prs", middleware.AuthMiddleware())
	prGroup.Use(d.role())
	{
		prGroup.POST("/:id/test", d.pr.MarkAsTested)
		// Approving a PR is restricted to managers
		prGroup.POST("/:id/approve", d.role("manager"), d.pr.ApprovePR)
	}

	taskPRGroup := router.Group("/tasks", middleware.AuthMiddleware())
	taskPRGroup.Use(d.role())
	{
		taskPRGroup.GET("/:id/pr-form", d.webPR.GetPRForm)
		taskPRGroup.POST("/:id/prs", d.webPR.AddTaskPR)
	}
}

// emptyFragment answers an htmx request with nothing, which is how the inline
// edit forms cancel themselves.
func emptyFragment(c *gin.Context) {
	c.String(http.StatusOK, "")
}
