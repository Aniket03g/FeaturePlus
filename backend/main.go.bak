package main

import (
	"FeaturePlus/database"
	"FeaturePlus/handlers"
	"FeaturePlus/models"
	"FeaturePlus/repositories"
	"net/http"

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
		c.Writer.Header().Set("Access-Control-Allow-Origin", "http://localhost:3000")
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
	userRoutes := router.Group("/users")
	{
		userRoutes.GET("", userHandler.GetAllUsers)
		userRoutes.GET("/:id", userHandler.GetUser)
		userRoutes.POST("", userHandler.CreateUser)
		userRoutes.PUT("/:id", userHandler.UpdateUser)
		userRoutes.DELETE("/:id", userHandler.DeleteUser)
	}

	// Project routes
	projectRoutes := router.Group("/projects")
	{
		projectRoutes.POST("", projectHandler.CreateProject)
		projectRoutes.GET("", projectHandler.GetAllProjects)
		projectRoutes.GET("/:id", projectHandler.GetProject)
		projectRoutes.PUT("/:id", projectHandler.UpdateProject)
		projectRoutes.DELETE("/:id", projectHandler.DeleteProject)
		projectRoutes.GET("/user/:user_id", projectHandler.GetProjectsByUser)
	}

	// Feature routes
	featureRoutes := router.Group("/features")
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
	router.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"status":  "ok",
			"version": "1.0.0",
		})
	})

	// Start server
	if err := router.Run(":8080"); err != nil {
		panic("failed to start server: " + err.Error())
	}
}
