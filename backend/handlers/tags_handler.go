package handlers

import (
	"net/http"
	"strconv"

	"github.com/FeaturePlus/backend/repositories"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type TagHandler struct {
	tagRepo     *repositories.TagRepository
	featureRepo *repositories.FeatureRepository
	DB          *gorm.DB
}

func NewTagHandler(
	tagRepo *repositories.TagRepository,
	featureRepo *repositories.FeatureRepository,
	db *gorm.DB,
) *TagHandler {
	return &TagHandler{
		tagRepo:     tagRepo,
		featureRepo: featureRepo,
		DB:          db,
	}
}

// GetFeatureTags godoc
// @Summary Get tags for a feature
// @Description Get all tags associated with a feature
// @Tags tags
// @Accept json
// @Produce json
// @Param id path int true "Feature ID"
// @Success 200 {array} models.FeatureTag
// @Failure 400 {object} ErrorResponse
// @Failure 404 {object} ErrorResponse
// @Router /features/{id}/tags [get]
func (h *TagHandler) GetFeatureTags(c *gin.Context) {
	featureIDStr := c.Param("id")
	featureID, err := strconv.ParseUint(featureIDStr, 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid feature ID"})
		return
	}

	tags, err := h.tagRepo.GetTagsByFeatureID(uint(featureID))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get tags"})
		return
	}

	c.JSON(http.StatusOK, tags)
}

// GetAllTags godoc
// @Summary Get all tags
// @Description Get all tags in the system
// @Tags tags
// @Accept json
// @Produce json
// @Success 200 {array} models.FeatureTag
// @Failure 500 {object} ErrorResponse
// @Router /tags [get]
func (h *TagHandler) GetAllTags(c *gin.Context) {
	tags, err := h.tagRepo.GetAllTags()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get tags"})
		return
	}

	c.JSON(http.StatusOK, tags)
}

// GetFeaturesByTag godoc
// @Summary Get features by tag
// @Description Get all features associated with a tag
// @Tags tags
// @Accept json
// @Produce json
// @Param tag_name path string true "Tag name"
// @Success 200 {array} models.Feature
// @Failure 400 {object} ErrorResponse
// @Failure 500 {object} ErrorResponse
// @Router /tags/{tag_name}/features [get]
func (h *TagHandler) GetFeaturesByTag(c *gin.Context) {
	tagName := c.Param("tag_name")
	if tagName == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Tag name is required"})
		return
	}

	features, err := h.tagRepo.GetFeaturesByTagName(tagName)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get features by tag"})
		return
	}

	c.JSON(http.StatusOK, features)
}

// UpdateFeatureTags godoc
// @Summary Update tags for a feature
// @Description Delete existing tags and add new tags to a feature
// @Tags tags
// @Accept json
// @Produce json
// @Param id path int true "Feature ID"
// @Param tags body string true "Tags string (comma/space/semicolon separated)"
// @Success 200 {object} SuccessResponse
// @Failure 400 {object} ErrorResponse
// @Failure 500 {object} ErrorResponse
// @Router /features/{id}/tags [put]
func (h *TagHandler) UpdateFeatureTags(c *gin.Context) {
	featureIDStr := c.Param("id")
	featureID, err := strconv.ParseUint(featureIDStr, 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid feature ID"})
		return
	}

	var requestBody struct {
		Tags string `json:"tags"`
	}

	if err := c.ShouldBindJSON(&requestBody); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Get the current user ID from the context
	userID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	currentUserID := userID.(uint)

	if err := h.tagRepo.UpdateFeatureTags(uint(featureID), currentUserID, requestBody.Tags); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update tags"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Tags updated successfully"})
}
