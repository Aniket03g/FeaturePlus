package handlers

import (
	"FeaturePlus/models"
	"FeaturePlus/utils"
	"fmt"
	"net/http"
	"strings"

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
	var user models.User
	if err := c.ShouldBindJSON(&user); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Debug log
	fmt.Printf("Signup request: email=%s, username=%s, password_length=%d\n",
		user.Email, user.Username, len(user.Password))

	// Make sure password is not empty
	if user.Password == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Password cannot be empty"})
		return
	}

	// Store the password temporarily
	plainPassword := user.Password

	// Hash the password
	if err := user.HashPassword(plainPassword); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Error hashing password: %v", err)})
		return
	}

	// Debug - show hashed password
	fmt.Printf("Hashed password: %s\n", user.Password)

	// Create the user with hashed password
	if err := h.DB.Create(&user).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("User already exists or database error: %v", err)})
		return
	}

	// Return created user ID for confirmation
	c.JSON(http.StatusCreated, gin.H{
		"message": "Signup successful",
		"auth_info": gin.H{
			"user_id":   user.ID,
			"user_name": user.Username,
			"projects":  "P-1,P-2",
		},
	})
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

	// Logging to debug
	fmt.Printf("Login attempt: email=%s, password_length=%d\n", input.Email, len(input.Password))

	var user models.User
	if err := h.DB.Where("email = ?", input.Email).First(&user).Error; err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid email or password"})
		return
	}

	// Log stored password hash for debugging
	fmt.Printf("User found: ID=%d, stored password hash=%s\n", user.ID, user.Password)

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
	if err := h.DB.Select("id, username, email, role").Where("id = ?", userIDInt).First(&user).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "User not found"})
		return
	}

	c.JSON(http.StatusOK, user)
}
