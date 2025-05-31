package main

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/FeaturePlus/backend/database"
	"github.com/FeaturePlus/backend/handlers"
	"github.com/FeaturePlus/backend/middleware"
	"github.com/FeaturePlus/backend/models"
	"github.com/FeaturePlus/backend/repositories"
	"github.com/FeaturePlus/backend/routes"

	"github.com/gin-gonic/gin"
)

func main() {
	// Initialize DBcd b
	db, err := database.InitDB()
	if err != nil {
		panic("failed to connect database")
	}

	// Migrate all schemas
	if err := db.Migrate(&models.User{}, &models.Project{}, &models.Feature{}, &models.SubFeature{}, &models.Task{}, &models.FeatureTag{}); err != nil {
		panic("failed to migrate database: " + err.Error())
	}

	// Create repositories
	userRepo := repositories.NewUserRepository(db.DB)
	projectRepo := repositories.NewProjectRepository(db.DB)
	featureRepo := repositories.NewFeatureRepository(db.DB)
	taskRepo := repositories.NewTaskRepository(db.DB)
	tagRepo := repositories.NewTagRepository(db.DB)

	// Create handlers
	userHandler := handlers.NewUserHandler(userRepo)
	projectHandler := handlers.NewProjectHandler(projectRepo)
	featureHandler := handlers.NewFeatureHandler(featureRepo, tagRepo, db.DB)
	taskHandler := handlers.NewTaskHandler(taskRepo)
	tagHandler := handlers.NewTagHandler(tagRepo, featureRepo)

	router := gin.Default()

	// CORS middleware
	router.Use(func(c *gin.Context) {
		c.Writer.Header().Set("Access-Control-Allow-Origin", "*")
		c.Writer.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		c.Writer.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		c.Writer.Header().Set("Access-Control-Allow-Credentials", "true")

		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(http.StatusOK)
			return
		}
		c.Next()
	})

	// Register auth routes
	routes.RegisterAuthRoutes(router, db.DB)

	// User routes - not protected, admin only functions should be protected elsewhere
	userRoutes := router.Group("/api/users")
	{
		userRoutes.GET("", userHandler.GetAllUsers)
		userRoutes.GET("/:id", userHandler.GetUser)
		userRoutes.POST("", userHandler.CreateUser)
		userRoutes.PUT("/:id", userHandler.UpdateUser)
		userRoutes.DELETE("/:id", userHandler.DeleteUser)
	}

	// Protected routes - requires authentication
	// Project routes
	projectRoutes := router.Group("/api/projects", middleware.AuthMiddleware())
	{
		projectRoutes.POST("", projectHandler.CreateProject)
		projectRoutes.GET("", projectHandler.GetAllProjects)
		projectRoutes.GET("/:id", projectHandler.GetProject)
		projectRoutes.PUT("/:id", projectHandler.UpdateProject)
		projectRoutes.DELETE("/:id", projectHandler.DeleteProject)
		projectRoutes.GET("/user/:user_id", projectHandler.GetProjectsByUser)
	}

	// Feature routes
	featureRoutes := router.Group("/api/features", middleware.AuthMiddleware())
	{
		featureRoutes.POST("", featureHandler.CreateFeature)
		featureRoutes.GET("", featureHandler.GetAllFeatures)
		featureRoutes.GET("/:id", featureHandler.GetFeature)
		featureRoutes.PUT("/:id", featureHandler.UpdateFeature)
		featureRoutes.DELETE("/:id", featureHandler.DeleteFeature)
		featureRoutes.GET("/:id/subfeatures", featureHandler.GetSubfeatures)

		// Feature-specific Task routes
		featureRoutes.POST("/:id/tasks", taskHandler.CreateTaskForFeature)
		featureRoutes.GET("/:id/tasks", taskHandler.GetTasksByFeature)
		featureRoutes.PUT("/:id/task/:task_id", taskHandler.UpdateTaskForFeature)
		featureRoutes.DELETE("/:id/task/:task_id", taskHandler.DeleteTaskForFeature)

		// Feature tags routes
		featureRoutes.GET("/:id/tags", tagHandler.GetFeatureTags)
		featureRoutes.PUT("/:id/tags", tagHandler.UpdateFeatureTags)
	}

	// Public route for project features (for frontend access)
	router.GET("/api/features/project/:project_id", featureHandler.GetProjectFeatures)

	// General task routes
	taskRoutes := router.Group("/api/tasks")
	{
		taskRoutes.GET("", taskHandler.GetAllTasks)
		taskRoutes.POST("", taskHandler.CreateTask)
		taskRoutes.GET("/:id", taskHandler.GetTask)
		taskRoutes.PUT("/:id", taskHandler.UpdateTask)
		taskRoutes.DELETE("/:id", taskHandler.DeleteTask)

		// New route to get tasks by project ID
		taskRoutes.GET("/project/:project_id", taskHandler.GetTasksByProject)
	}

	// Sub-feature routes
	subFeatureRoutes := router.Group("/api/sub-features", middleware.AuthMiddleware())
	{
		subFeatureRoutes.POST("", handlers.CreateSubFeature(db.DB))
		subFeatureRoutes.PUT("/:id", handlers.UpdateSubFeature(db.DB))
		subFeatureRoutes.GET("", handlers.GetSubFeaturesByFeature(db.DB))
		subFeatureRoutes.GET("/project", handlers.GetSubFeaturesByProject(db.DB))
		subFeatureRoutes.GET("/:id", handlers.GetSubFeatureDetail(db.DB))

		// Sub-feature task routes
		subFeatureRoutes.POST("/:id/tasks", taskHandler.CreateTaskForSubFeature)
		subFeatureRoutes.GET("/:id/tasks", taskHandler.GetTasksBySubFeature)
		subFeatureRoutes.PUT("/:id/task/:task_id", taskHandler.UpdateTaskForSubFeature)
		subFeatureRoutes.DELETE("/:id/task/:task_id", taskHandler.DeleteTaskForSubFeature)
	}

	// Tag routes
	tagRoutes := router.Group("/api/tags", middleware.AuthMiddleware())
	{
		tagRoutes.GET("", tagHandler.GetAllTags)
		tagRoutes.GET("/:tag_name/features", tagHandler.GetFeaturesByTag)
	}

	// Health check
	router.GET("/api/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"status":  "ok",
			"version": "1.0.0",
		})
	})

	// Static frontend files
	staticDir := "../frontend/.next"
	router.Static("/static", filepath.Join(staticDir, "static"))
	router.Static("/_next", filepath.Join(staticDir, "static"))

	// Handle unmatched routes (e.g., for client-side routing)
	router.NoRoute(func(c *gin.Context) {
		if strings.HasPrefix(c.Request.URL.Path, "/api/") {
			c.JSON(http.StatusNotFound, gin.H{"error": "API endpoint not found"})
			return
		}

		path := filepath.Join(staticDir, c.Request.URL.Path)
		if _, err := os.Stat(path); err == nil {
			c.File(path)
			return
		}

		indexPath := filepath.Join(staticDir, "server", "app", "index.html")
		if _, err := os.Stat(indexPath); os.IsNotExist(err) {
			c.JSON(http.StatusNotFound, gin.H{"error": "Frontend build not found"})
			return
		}
		c.File(indexPath)
	})

	// Start server
	if err := router.Run(":8080"); err != nil {
		panic("failed to start server: " + err.Error())
	}
}
