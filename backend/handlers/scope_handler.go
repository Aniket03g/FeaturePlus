package handlers

import (
	"log"
	"net/http"
	"strconv"

	"github.com/FeaturePlus/backend/models"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// ScopeHandler manages per-feature access grants (the Scoped Contracts ACL
// primitive) from the feature detail page. Only a project owner may grant or
// revoke access.
type ScopeHandler struct {
	DB *gorm.DB
}

// NewScopeHandler constructs a ScopeHandler.
func NewScopeHandler(db *gorm.DB) *ScopeHandler {
	return &ScopeHandler{DB: db}
}

// scopeRow is the view model for one grant in the list.
type scopeRow struct {
	ID          uint
	UserID      int
	UserLabel   string
	AccessLevel models.FeatureAccessLevel
}

// loadFeature fetches the feature and reports whether the current request user
// is the owner of its project (only project owners manage scopes).
func (h *ScopeHandler) loadFeature(c *gin.Context) (*models.Feature, bool, bool) {
	featureID, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		return nil, false, false
	}
	var feature models.Feature
	if err := h.DB.First(&feature, uint(featureID)).Error; err != nil {
		return nil, false, false
	}
	var project models.Project
	if err := h.DB.Select("id", "owner_id").First(&project, feature.ProjectID).Error; err != nil {
		return &feature, false, true
	}
	userIDVal, _ := c.Get("user_id")
	isOwner := false
	if uid, ok := userIDVal.(uint); ok {
		isOwner = int(uid) == project.OwnerID
	}
	return &feature, isOwner, true
}

// renderScopes renders the feature-scopes fragment for a feature.
func (h *ScopeHandler) renderScopes(c *gin.Context, feature *models.Feature, isOwner bool, status int, flash string) {
	var scopes []models.FeatureScope
	h.DB.Preload("User").Where("feature_id = ?", feature.ID).Order("created_at asc").Find(&scopes)

	rows := make([]scopeRow, 0, len(scopes))
	for _, s := range scopes {
		label := s.User.Username
		if label == "" {
			label = s.User.Email
		}
		if label == "" {
			label = "user #" + strconv.Itoa(s.UserID)
		}
		rows = append(rows, scopeRow{
			ID:          s.ID,
			UserID:      s.UserID,
			UserLabel:   label,
			AccessLevel: s.AccessLevel,
		})
	}

	// Candidate users to grant access to: everyone except those already scoped.
	granted := map[int]bool{}
	for _, r := range rows {
		granted[r.UserID] = true
	}
	var users []models.User
	h.DB.Order("username asc").Find(&users)
	candidates := make([]models.User, 0, len(users))
	for _, u := range users {
		if !granted[u.ID] {
			candidates = append(candidates, u)
		}
	}

	c.HTML(status, "feature-scopes.html", gin.H{
		"Feature":    feature,
		"IsOwner":    isOwner,
		"Scopes":     rows,
		"Candidates": candidates,
		"Levels":     []models.FeatureAccessLevel{models.AccessOwner, models.AccessContract},
		"Flash":      flash,
	})
}

// GetFeatureScopes renders the access-management fragment for a feature.
func (h *ScopeHandler) GetFeatureScopes(c *gin.Context) {
	feature, isOwner, ok := h.loadFeature(c)
	if !ok {
		c.String(http.StatusNotFound, "Feature not found")
		return
	}
	h.renderScopes(c, feature, isOwner, http.StatusOK, "")
}

// CreateFeatureScope grants a collaborator access to a feature. Owner-only.
func (h *ScopeHandler) CreateFeatureScope(c *gin.Context) {
	feature, isOwner, ok := h.loadFeature(c)
	if !ok {
		c.String(http.StatusNotFound, "Feature not found")
		return
	}
	if !isOwner {
		c.String(http.StatusForbidden, "Only the project owner can grant access")
		return
	}

	userID, err := strconv.Atoi(c.PostForm("user_id"))
	if err != nil {
		h.renderScopes(c, feature, isOwner, http.StatusBadRequest, "Select a user to grant access to.")
		return
	}
	level := models.FeatureAccessLevel(c.PostForm("access_level"))
	if !level.IsValid() || level == models.AccessNone {
		h.renderScopes(c, feature, isOwner, http.StatusBadRequest, "Choose owner or contract access.")
		return
	}

	granterID := 0
	if uid, ok := c.Get("user_id"); ok {
		if u, ok := uid.(uint); ok {
			granterID = int(u)
		}
	}

	scope := models.FeatureScope{
		ProjectID:   feature.ProjectID,
		FeatureID:   feature.ID,
		UserID:      userID,
		AccessLevel: level,
		GrantedByID: granterID,
	}
	// Upsert: if a grant already exists for this (user, feature), update its level.
	var existing models.FeatureScope
	err = h.DB.Where("user_id = ? AND feature_id = ?", userID, feature.ID).First(&existing).Error
	if err == nil {
		existing.AccessLevel = level
		existing.GrantedByID = granterID
		if err := h.DB.Save(&existing).Error; err != nil {
			log.Printf("[CreateFeatureScope] update failed: %v", err)
			h.renderScopes(c, feature, isOwner, http.StatusInternalServerError, "Could not update access.")
			return
		}
	} else {
		if err := h.DB.Create(&scope).Error; err != nil {
			log.Printf("[CreateFeatureScope] create failed: %v", err)
			h.renderScopes(c, feature, isOwner, http.StatusInternalServerError, "Could not grant access.")
			return
		}
	}

	h.renderScopes(c, feature, isOwner, http.StatusOK, "Access updated.")
}

// DeleteFeatureScope revokes a grant. Owner-only.
func (h *ScopeHandler) DeleteFeatureScope(c *gin.Context) {
	feature, isOwner, ok := h.loadFeature(c)
	if !ok {
		c.String(http.StatusNotFound, "Feature not found")
		return
	}
	if !isOwner {
		c.String(http.StatusForbidden, "Only the project owner can revoke access")
		return
	}
	scopeID, err := strconv.ParseUint(c.Param("scope_id"), 10, 64)
	if err != nil {
		h.renderScopes(c, feature, isOwner, http.StatusBadRequest, "Invalid grant.")
		return
	}
	// Scope the delete to this feature so a grant can't be revoked cross-feature.
	if err := h.DB.Where("id = ? AND feature_id = ?", uint(scopeID), feature.ID).
		Delete(&models.FeatureScope{}).Error; err != nil {
		log.Printf("[DeleteFeatureScope] delete failed: %v", err)
		h.renderScopes(c, feature, isOwner, http.StatusInternalServerError, "Could not revoke access.")
		return
	}
	h.renderScopes(c, feature, isOwner, http.StatusOK, "Access revoked.")
}
