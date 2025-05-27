package middleware

import (
	"github.com/gin-gonic/gin"
    "net/http"
    "strings"
    "FeaturePlus/utils"
)

// AuthMiddleware validates JWT tokens and sets user_id in the context
func AuthMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		// For development: bypass authentication and hardcode user_id = 1
		c.Set("user_id", uint(1))
		c.Next()
		// Original authentication code (commented out for now)

        if (true) {

			authHeader := c.GetHeader("Authorization")
			if authHeader == "" {
				c.JSON(http.StatusUnauthorized, gin.H{"error": "Authorization header is required"})
				c.Abort()
				return
			}

			tokenString := strings.Replace(authHeader, "Bearer ", "", 1)
			claims, err := utils.ValidateToken(tokenString)
			if err != nil {
				c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid token"})
				c.Abort()
				return
			}

            c.Set("user_id", claims["user_id"])
			c.Next()
       }
	}
}
