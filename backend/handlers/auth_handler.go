package handlers

import (
	"net/http"
	"strings"

	"github.com/FeaturePlus/backend/models"
	"github.com/FeaturePlus/backend/utils"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type AuthHandler struct {
	DB *gorm.DB
}

func NewAuthHandler(db *gorm.DB) *AuthHandler {
	return &AuthHandler{DB: db}
}

func (h *AuthHandler) Signup(c *gin.Context) {
	// Accounts are made at /api/v1/auth/signup, which needs an invite code
	// from an admin. This older route had no such check, so it is closed.
	c.JSON(http.StatusGone, gin.H{"error": "Sign up in the app with an invite code from your admin"})
}

func (h *AuthHandler) Login(c *gin.Context) {
	var input struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var user models.User
	if err := h.DB.Where("LOWER(email) = ?", strings.ToLower(strings.TrimSpace(input.Email))).First(&user).Error; err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid email or password"})
		return
	}

	// Check if password is empty in database
	if user.Password == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Account has no password set"})
		return
	}

	if !user.CheckPassword(input.Password) {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid email or password"})
		return
	}

	token, err := utils.GenerateJWT(user.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate token"})
		return
	}

	// Set secure HTTP-only cookie with the JWT token
	c.SetCookie(
		"token",      // Name
		token,        // Value
		3600,         // MaxAge (1 hour in seconds)
		"/",          // Path
		"",  // Domain
		false,        // Secure (false for http)
		true,         // HttpOnly
	)

	c.JSON(http.StatusOK, gin.H{
		"token": token,
		"auth_info": map[string]interface{}{
			"id":       user.ID,
			"username": user.Username,
			"email":    user.Email,
			"role":     user.Role,
		},
		"projects_roles": map[string]interface{}{
			"FeaturePlus": "admin,devel,pm",
			"*":           "view",
		},
	})
}

func (h *AuthHandler) GetCurrentUser(c *gin.Context) {
	// Get the Authorization header
	authHeader := c.GetHeader("Authorization")
	if authHeader == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Authorization header is required"})
		return
	}

	// Check if it's a Bearer token
	parts := strings.Split(authHeader, " ")
	if len(parts) != 2 || parts[0] != "Bearer" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid authorization format"})
		return
	}

	// Extract the token
	tokenString := parts[1]

	// Verify and parse the token
	claims, err := utils.ValidateToken(tokenString)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid or expired token"})
		return
	}

	// Extract user ID from claims
	userID, ok := claims["user_id"].(float64)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid token payload"})
		return
	}

	// Convert float64 to int
	userIDInt := int(userID)

	// Get user from database
	var user models.User
	if err := h.DB.Select("id, username, email, role, name").Where("id = ?", userIDInt).First(&user).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "User not found"})
		return
	}

	c.JSON(http.StatusOK, user)
}
