package routes

import (
	"github.com/FeaturePlus/backend/handlers"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func RegisterAuthRoutes(r *gin.Engine, db *gorm.DB) {
	authHandler := handlers.NewAuthHandler(db)

	auth := r.Group("/api/auth")
	{
		auth.POST("/signup", authHandler.Signup)
		auth.POST("/login", authHandler.Login)
		auth.GET("/me", authHandler.GetCurrentUser)
	}
}
