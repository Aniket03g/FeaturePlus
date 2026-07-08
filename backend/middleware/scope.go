package middleware

import (
	"log"
	"net/http"
	"strconv"

	"github.com/FeaturePlus/backend/models"
	"github.com/FeaturePlus/backend/services"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// FeatureScopeMiddleware enforces the Scoped Contracts access model on routes
// that target a single feature. It reads user_id from context (set by
// AuthMiddleware), resolves the user's effective access to the feature named by
// the given route param, and aborts with 404 when the user has no access at
// all — unrelated features must be invisible, not merely forbidden.
//
// The resolved access level is stored in the context under "feature_access" so
// downstream handlers can decide whether to serve full source or a stripped
// contract.
func FeatureScopeMiddleware(db *gorm.DB, featureParam string, minLevel models.FeatureAccessLevel) gin.HandlerFunc {
	access := services.NewAccessService(db)
	return func(c *gin.Context) {
		userIDVal, exists := c.Get("user_id")
		if !exists {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Authentication required"})
			c.Abort()
			return
		}
		userID, err := toInt(userIDVal)
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid user context"})
			c.Abort()
			return
		}

		featureID, err := strconv.ParseUint(c.Param(featureParam), 10, 64)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid feature id"})
			c.Abort()
			return
		}

		// Look up the project the feature belongs to.
		var feature models.Feature
		if err := db.Select("id", "project_id").First(&feature, uint(featureID)).Error; err != nil {
			// Don't leak whether the feature exists.
			c.JSON(http.StatusNotFound, gin.H{"error": "Not found"})
			c.Abort()
			return
		}

		level, err := access.EffectiveFeatureAccess(userID, feature.ProjectID, uint(featureID))
		if err != nil {
			log.Printf("[FeatureScopeMiddleware] resolve error for user %d feature %d: %v", userID, featureID, err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Access check failed"})
			c.Abort()
			return
		}

		// No access at all -> invisible (404, not 403).
		if level == models.AccessNone {
			c.JSON(http.StatusNotFound, gin.H{"error": "Not found"})
			c.Abort()
			return
		}

		// Below the required tier -> forbidden (the resource exists to them, but
		// this operation needs more than they hold, e.g. owner-only writes).
		if level.Rank() < minLevel.Rank() {
			c.JSON(http.StatusForbidden, gin.H{"error": "Insufficient access for this feature"})
			c.Abort()
			return
		}

		c.Set("feature_access", level)
		c.Set("feature_project_id", feature.ProjectID)
		c.Next()
	}
}

// toInt normalizes the several numeric shapes user_id may take in the gin
// context (int, uint, float64 from JSON, or a string) into an int.
func toInt(v interface{}) (int, error) {
	switch n := v.(type) {
	case int:
		return n, nil
	case int64:
		return int(n), nil
	case uint:
		return int(n), nil
	case float64:
		return int(n), nil
	case string:
		return strconv.Atoi(n)
	default:
		return 0, strconv.ErrSyntax
	}
}
