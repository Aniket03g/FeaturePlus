package main

import (
	"FeaturePlus/database"
	"FeaturePlus/handlers"
	"FeaturePlus/models"
	"FeaturePlus/repositories"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/gin-gonic/gin"
)

func main() {
	// Initialize DB
	db, err := database.InitDB()
	if err != nil {
		panic("failed to connect database")
	}

	// Migrate all schemas
	if err := db.Migrate(&models.User{}, &models.Project{}, &models.Feature{}, &models.SubFeature{}); err != nil {
		panic("failed to migrate database: " + err.Error())
	}

	// Create repositories
	userRepo := repositories.NewUserRepository(db.DB)
	projectRepo := repositories.NewProjectRepository(db.DB)
	featureRepo := repositories.NewFeatureRepository(db.DB)

	// Create handlers
	userHandler := handlers.NewUserHandler(userRepo)
	projectHandler := handlers.NewProjectHandler(projectRepo)
	featureHandler := handlers.NewFeatureHandler(featureRepo)

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

	// User routes
	userRoutes := router.Group("/api/users")
	{
		userRoutes.GET("", userHandler.GetAllUsers)
		userRoutes.GET("/:id", userHandler.GetUser)
		userRoutes.POST("", userHandler.CreateUser)
		userRoutes.PUT("/:id", userHandler.UpdateUser)
		userRoutes.DELETE("/:id", userHandler.DeleteUser)
	}

	// Project routes
	projectRoutes := router.Group("/api/projects")
	{
		projectRoutes.POST("", projectHandler.CreateProject)
		projectRoutes.GET("", projectHandler.GetAllProjects)
		projectRoutes.GET("/:id", projectHandler.GetProject)
		projectRoutes.PUT("/:id", projectHandler.UpdateProject)
		projectRoutes.DELETE("/:id", projectHandler.DeleteProject)
		projectRoutes.GET("/user/:user_id", projectHandler.GetProjectsByUser)
	}

	// Feature routes
	featureRoutes := router.Group("/api/features")
	{
		featureRoutes.POST("", featureHandler.CreateFeature)
		featureRoutes.GET("/:id", featureHandler.GetFeature)
		featureRoutes.GET("/project/:project_id", featureHandler.GetProjectFeatures)
		featureRoutes.PUT("/:id", featureHandler.UpdateFeature)
		featureRoutes.DELETE("/:id", featureHandler.DeleteFeature)
	}

	// Sub-feature routes
	subFeatureRoutes := router.Group("/api/sub-features")
	{
		subFeatureRoutes.POST("", handlers.CreateSubFeature(db.DB))
		subFeatureRoutes.PUT("/:id", handlers.UpdateSubFeature(db.DB))
		subFeatureRoutes.GET("", handlers.GetSubFeaturesByFeature(db.DB))
	}

	// Health check endpoint
	router.GET("/api/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"status":  "ok",
			"version": "1.0.0",
		})
	})

	// Static files
	// Serve static files from the frontend build directory
	staticDir := "../frontend/.next"
	router.Static("/static", filepath.Join(staticDir, "static"))
	router.Static("/_next", filepath.Join(staticDir, "static"))

	// Serve the index.html for any other route
	router.NoRoute(func(c *gin.Context) {
		// If the request is for an API endpoint, return 404
		if strings.HasPrefix(c.Request.URL.Path, "/api/") {
			c.JSON(http.StatusNotFound, gin.H{"error": "API endpoint not found"})
			return
		}

		// Try to serve other static files from the frontend directory
		path := filepath.Join(staticDir, c.Request.URL.Path)
		if _, err := os.Stat(path); err == nil {
			c.File(path)
			return
		}

		// Default to serving index.html for client-side routing
		indexPath := filepath.Join(staticDir, "server", "app", "index.html")
		if _, err := os.Stat(indexPath); os.IsNotExist(err) {
			// If index.html doesn't exist in the expected location, try to find it
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
