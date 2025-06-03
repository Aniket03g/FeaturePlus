package handlers

import (
	"fmt"
	"net/http"
	"strconv"

	"github.com/FeaturePlus/backend/models"
	"github.com/FeaturePlus/backend/repositories"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type FeatureHandler struct {
	repo    *repositories.FeatureRepository
	tagRepo *repositories.TagRepository
	DB      *gorm.DB
}

func NewFeatureHandler(repo *repositories.FeatureRepository, tagRepo *repositories.TagRepository, db *gorm.DB) *FeatureHandler {
	return &FeatureHandler{repo: repo, tagRepo: tagRepo, DB: db}
}

type FeatureWithTags struct {
	models.Feature
	TagsInput string `json:"tags_input,omitempty"`
}

func (h *FeatureHandler) CreateFeature(c *gin.Context) {
	var featureWithTags FeatureWithTags
	if err := c.ShouldBindJSON(&featureWithTags); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Extract feature from the combined structure
	feature := featureWithTags.Feature

	// Convert string values to proper types
	feature.Status = models.FeatureStatus(feature.Status)
	feature.Priority = models.FeaturePriority(feature.Priority)

	if !isValidStatus(feature.Status) || !isValidPriority(feature.Priority) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid status or priority"})
		return
	}

	if feature.Category == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "category is required"})
		return
	}

	// Strict validation for category against project config
	projectRepo := repositories.NewProjectRepository(h.DB)
	project, err := projectRepo.GetProjectByID(feature.ProjectID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid project ID for category validation"})
		return
	}
	categories, ok := project.Config["feature_category"].([]interface{})
	if !ok {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "project config missing feature_category"})
		return
	}
	validCategory := false
	for _, cat := range categories {
		if catStr, ok := cat.(string); ok && catStr == feature.Category {
			validCategory = true
			break
		}
	}
	if !validCategory {
		c.JSON(http.StatusBadRequest, gin.H{"error": "category must be one of the allowed feature_category values in project config"})
		return
	}

	if err := h.repo.CreateFeature(&feature); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// Handle tags if provided
	if featureWithTags.TagsInput != "" {
		var createdByUser uint = 1 // Default to admin if not available
		if userID, exists := c.Get("user_id"); exists {
			createdByUser = userID.(uint)
		}

		err := h.tagRepo.UpdateFeatureTags(feature.ID, createdByUser, featureWithTags.TagsInput)
		if err != nil {
			// Log the error but don't fail the whole request
			// We already created the feature successfully
			c.JSON(http.StatusCreated, gin.H{
				"feature": feature,
				"warning": "Feature created but failed to save tags",
			})
			return
		}

		// Fetch the feature again with its tags
		updatedFeature, err := h.repo.GetFeatureByID(int(feature.ID))
		if err == nil {
			c.JSON(http.StatusCreated, updatedFeature)
			return
		}
	}

	c.JSON(http.StatusCreated, feature)
}

func (h *FeatureHandler) GetFeature(c *gin.Context) {
	idStr := c.Param("id")
	featureID, err := strconv.Atoi(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid feature ID"})
		return
	}

	feature, err := h.repo.GetFeatureByID(featureID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "feature not found"})
		return
	}

	// Log the feature object with preloaded tags
	fmt.Printf("Fetched feature with tags in backend: %+v\n", feature)

	c.JSON(http.StatusOK, feature)
}

func (h *FeatureHandler) GetProjectFeatures(c *gin.Context) {
	projectIDStr := c.Param("project_id")
	projectID, err := strconv.Atoi(projectIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid project ID"})
		return
	}

	// Check if we should return only root features
	rootOnly := c.Query("root_only")
	if rootOnly == "true" {
		features, err := h.repo.GetRootFeaturesByProject(projectID)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, features)
		return
	}

	// Return all features for the project
	features, err := h.repo.GetFeaturesByProject(projectID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, features)
}

// GetSubfeatures returns all subfeatures for a given parent feature
func (h *FeatureHandler) GetSubfeatures(c *gin.Context) {
	parentIDStr := c.Param("id")
	parentID, err := strconv.ParseUint(parentIDStr, 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid parent feature ID"})
		return
	}

	features, err := h.repo.GetSubfeaturesByParentID(uint(parentID))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, features)
}

func (h *FeatureHandler) UpdateFeature(c *gin.Context) {
	idStr := c.Param("id")
	featureID, err := strconv.Atoi(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid feature ID"})
		return
	}

	var featureWithTags FeatureWithTags
	if err := c.ShouldBindJSON(&featureWithTags); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Extract feature from the combined structure
	feature := featureWithTags.Feature

	// Convert string values to proper types
	feature.Status = models.FeatureStatus(feature.Status)
	feature.Priority = models.FeaturePriority(feature.Priority)

	if !isValidStatus(feature.Status) || !isValidPriority(feature.Priority) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid status or priority"})
		return
	}

	existingFeature, err := h.repo.GetFeatureByID(featureID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "feature not found"})
		return
	}

	// Update fields
	existingFeature.Title = feature.Title
	existingFeature.Description = feature.Description
	existingFeature.Status = feature.Status
	existingFeature.Priority = feature.Priority
	existingFeature.AssigneeID = feature.AssigneeID
	existingFeature.Category = feature.Category

	// Update parent feature ID if provided
	if feature.ParentFeatureID != nil {
		existingFeature.ParentFeatureID = feature.ParentFeatureID
	}

	if err := h.repo.UpdateFeature(existingFeature); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// Handle tags if provided
	if featureWithTags.TagsInput != "" {
		var createdByUser uint = 1 // Default to admin if not available
		if userID, exists := c.Get("user_id"); exists {
			createdByUser = userID.(uint)
		}

		err := h.tagRepo.UpdateFeatureTags(existingFeature.ID, createdByUser, featureWithTags.TagsInput)
		if err != nil {
			// Log the error but don't fail the whole request
			// We already updated the feature successfully
			c.JSON(http.StatusOK, gin.H{
				"feature": existingFeature,
				"warning": "Feature updated but failed to save tags",
			})
			return
		}

		// Fetch the feature again with its updated tags
		updatedFeature, err := h.repo.GetFeatureByID(featureID)
		if err == nil {
			c.JSON(http.StatusOK, updatedFeature)
			return
		}
	}

	c.JSON(http.StatusOK, existingFeature)
}

func (h *FeatureHandler) DeleteFeature(c *gin.Context) {
	idStr := c.Param("id")
	featureID, err := strconv.Atoi(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid feature ID"})
		return
	}

	// Delete associated tags first
	h.tagRepo.DeleteTagsByFeatureID(uint(featureID))

	if err := h.repo.DeleteFeature(featureID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.Status(http.StatusNoContent)
}

// GET /api/features?tag=p0
func (h *FeatureHandler) GetAllFeatures(c *gin.Context) {
	var features []models.Feature
	var err error

	features, err = h.repo.GetAllFeatures()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, features)
}

// UpdateFeatureField updates a single field of a feature
func (h *FeatureHandler) UpdateFeatureField(c *gin.Context) {
	fmt.Printf("Received PATCH request to update feature field\n")
	fmt.Printf("Headers: %+v\n", c.Request.Header)
	fmt.Printf("Method: %s\n", c.Request.Method)

	idStr := c.Param("id")
	fmt.Printf("Feature ID: %s\n", idStr)

	featureID, err := strconv.Atoi(idStr)
	if err != nil {
		fmt.Printf("Error converting ID: %v\n", err)
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid feature ID"})
		return
	}

	var updateData struct {
		Field string      `json:"field" binding:"required"`
		Value interface{} `json:"value"`
	}
	if err := c.ShouldBindJSON(&updateData); err != nil {
		fmt.Printf("Error binding JSON: %v\n", err)
		fmt.Printf("Request body: %+v\n", c.Request.Body)
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	fmt.Printf("Update data: %+v\n", updateData)

	existingFeature, err := h.repo.GetFeatureByID(featureID)
	if err != nil {
		fmt.Printf("Error getting feature: %v\n", err)
		c.JSON(http.StatusNotFound, gin.H{"error": "feature not found"})
		return
	}

	fmt.Printf("Existing feature: %+v\n", existingFeature)

	// Validate and update the specific field
	switch updateData.Field {
	case "title":
		if title, ok := updateData.Value.(string); ok {
			existingFeature.Title = title
		} else {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid title value"})
			return
		}
	case "description":
		if desc, ok := updateData.Value.(string); ok {
			existingFeature.Description = desc
		} else {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid description value"})
			return
		}
	case "status":
		if status, ok := updateData.Value.(string); ok {
			newStatus := models.FeatureStatus(status)
			if !isValidStatus(newStatus) {
				c.JSON(http.StatusBadRequest, gin.H{"error": "invalid status value"})
				return
			}
			existingFeature.Status = newStatus
		} else {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid status value"})
			return
		}
	case "priority":
		if priority, ok := updateData.Value.(string); ok {
			newPriority := models.FeaturePriority(priority)
			if !isValidPriority(newPriority) {
				c.JSON(http.StatusBadRequest, gin.H{"error": "invalid priority value"})
				return
			}
			existingFeature.Priority = newPriority
		} else {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid priority value"})
			return
		}
	case "category":
		if category, ok := updateData.Value.(string); ok {
			// Validate category against project config
			projectRepo := repositories.NewProjectRepository(h.DB)
			project, err := projectRepo.GetProjectByID(existingFeature.ProjectID)
			if err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": "invalid project ID for category validation"})
				return
			}
			categories, ok := project.Config["feature_category"].([]interface{})
			if !ok {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "project config missing feature_category"})
				return
			}
			validCategory := false
			for _, cat := range categories {
				if catStr, ok := cat.(string); ok && catStr == category {
					validCategory = true
					break
				}
			}
			if !validCategory {
				c.JSON(http.StatusBadRequest, gin.H{"error": "category must be one of the allowed feature_category values in project config"})
				return
			}
			existingFeature.Category = category
		} else {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid category value"})
			return
		}
	case "tags":
		if tags, ok := updateData.Value.(string); ok {
			var createdByUser uint = 1 // Default to admin if not available
			if userID, exists := c.Get("user_id"); exists {
				createdByUser = userID.(uint)
			}
			if err := h.tagRepo.UpdateFeatureTags(existingFeature.ID, createdByUser, tags); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update tags"})
				return
			}
		} else {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid tags value"})
			return
		}
	default:
		c.JSON(http.StatusBadRequest, gin.H{"error": "unsupported field"})
		return
	}

	if err := h.repo.UpdateFeature(existingFeature); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// If we updated tags, fetch the feature again to include updated tags
	if updateData.Field == "tags" {
		existingFeature, err = h.repo.GetFeatureByID(featureID)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to fetch updated feature"})
			return
		}
	}

	c.JSON(http.StatusOK, existingFeature)
}

// Helper functions
func isValidStatus(status models.FeatureStatus) bool {
	switch status {
	case models.StatusTodo, models.StatusInProgress, models.StatusDone:
		return true
	}
	return false
}

func isValidPriority(priority models.FeaturePriority) bool {
	switch priority {
	case models.PriorityLow, models.PriorityMedium, models.PriorityHigh:
		return true
	}
	return false
}
