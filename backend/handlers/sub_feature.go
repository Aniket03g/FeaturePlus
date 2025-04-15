package handlers

import (
	"net/http"
	"time"

	"FeaturePlus/models"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func CreateSubFeature(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var subFeature models.SubFeature
		if err := c.ShouldBindJSON(&subFeature); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body: " + err.Error()})
			return
		}

		// Validate required fields
		if subFeature.Title == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Title is required"})
			return
		}
		if subFeature.FeatureID == 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Feature ID is required"})
			return
		}

		// Verify feature exists
		var feature models.Feature
		if err := db.First(&feature, subFeature.FeatureID).Error; err != nil {
			if err == gorm.ErrRecordNotFound {
				c.JSON(http.StatusBadRequest, gin.H{"error": "Feature not found"})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to verify feature"})
			return
		}

		// Set default values
		subFeature.CreatedAt = time.Now()
		subFeature.UpdatedAt = time.Now()

		// Insert into database
		if err := db.Create(&subFeature).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create sub-feature: " + err.Error()})
			return
		}

		c.JSON(http.StatusCreated, subFeature)
	}
}

func UpdateSubFeature(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var subFeature models.SubFeature
		if err := c.ShouldBindJSON(&subFeature); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body: " + err.Error()})
			return
		}

		// Validate required fields
		if subFeature.ID == 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Sub-feature ID is required"})
			return
		}
		if subFeature.Title == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Title is required"})
			return
		}

		// Verify sub-feature exists
		var existingSubFeature models.SubFeature
		if err := db.First(&existingSubFeature, subFeature.ID).Error; err != nil {
			if err == gorm.ErrRecordNotFound {
				c.JSON(http.StatusNotFound, gin.H{"error": "Sub-feature not found"})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to verify sub-feature"})
			return
		}

		// Update timestamp
		subFeature.UpdatedAt = time.Now()

		// Update in database
		if err := db.Save(&subFeature).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update sub-feature: " + err.Error()})
			return
		}

		c.JSON(http.StatusOK, subFeature)
	}
}

func GetSubFeaturesByFeature(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		featureID := c.Query("feature_id")
		if featureID == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Feature ID is required"})
			return
		}

		// Verify feature exists
		var feature models.Feature
		if err := db.First(&feature, featureID).Error; err != nil {
			if err == gorm.ErrRecordNotFound {
				c.JSON(http.StatusNotFound, gin.H{"error": "Feature not found"})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to verify feature"})
			return
		}

		var subFeatures []models.SubFeature
		if err := db.Where("feature_id = ?", featureID).Order("created_at DESC").Find(&subFeatures).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch sub-features: " + err.Error()})
			return
		}

		c.JSON(http.StatusOK, subFeatures)
	}
}
