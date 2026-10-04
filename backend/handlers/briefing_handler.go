package handlers

import (
	"net/http"
	"strconv"

	"github.com/FeaturePlus/backend/models"
	"github.com/FeaturePlus/backend/services"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// BriefingHandler serves the scoped onboarding bundle: everything a
// collaborator needs to build their feature, assembled from their grants.
type BriefingHandler struct {
	DB       *gorm.DB
	briefing *services.BriefingService
}

// NewBriefingHandler builds a BriefingHandler over the shared contract service.
func NewBriefingHandler(db *gorm.DB, contract *services.ContractService) *BriefingHandler {
	return &BriefingHandler{
		DB:       db,
		briefing: services.NewBriefingService(db, contract),
	}
}

// GetBriefing returns the caller's briefing for a project.
//
// Responses:
//   - 200 JSON (default) or Markdown (?format=md, for pasting into an AI tool)
//   - 404 when the caller holds no owner grant here — consistent with the rest
//     of Scoped Contracts, a project outside your scope is invisible, not
//     forbidden. Project owners get 404 too: they already have the whole repo,
//     so a briefing is not the tool they want.
func (h *BriefingHandler) GetBriefing(c *gin.Context) {
	userIDVal, ok := c.Get("user_id")
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Authentication required"})
		return
	}
	userID := 0
	if u, ok := userIDVal.(uint); ok {
		userID = int(u)
	}

	projectID, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid project id"})
		return
	}

	brief, err := h.briefing.BuildBriefing(userID, projectID)
	if err == services.ErrNoScope {
		c.JSON(http.StatusNotFound, gin.H{"error": "Not found"})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Could not build briefing"})
		return
	}

	if c.Query("format") == "md" {
		c.Data(http.StatusOK, "text/markdown; charset=utf-8", []byte(brief.Markdown()))
		return
	}
	c.JSON(http.StatusOK, brief)
}

// GetBriefingView renders the collaborator-facing briefing page: the project
// brief, their feature's spec, and the contracts and mocks of its dependencies.
// It carries the Markdown rendering alongside the structured view so the
// developer can copy the whole thing into an AI assistant in one click.
//
// Gated identically to GetBriefing — a user with no grant gets 404, not a
// forbidden page.
func (h *BriefingHandler) GetBriefingView(c *gin.Context) {
	userIDVal, ok := c.Get("user_id")
	if !ok {
		c.String(http.StatusUnauthorized, "Authentication required")
		return
	}
	userID := 0
	if u, ok := userIDVal.(uint); ok {
		userID = int(u)
	}

	projectID, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.String(http.StatusBadRequest, "Invalid project id")
		return
	}

	brief, err := h.briefing.BuildBriefing(userID, projectID)
	if err == services.ErrNoScope {
		c.String(http.StatusNotFound, "Not found")
		return
	}
	if err != nil {
		c.String(http.StatusInternalServerError, "Could not build briefing")
		return
	}

	// briefing.html is a fragment meant to be swapped into the app shell. A
	// direct browser navigation carries no HX-Request header, so render the
	// shell and let it pull this same URL back over HTMX — otherwise the page
	// arrives without the stylesheet and layout the rest of the app has.
	if c.GetHeader("HX-Request") != "true" {
		userRole, _ := c.Get("user_role")
		var projects []models.Project
		h.DB.Find(&projects)
		c.HTML(http.StatusOK, "dashboard.html", gin.H{
			"InitialURL": c.Request.URL.Path,
			"CurrentUser": map[string]interface{}{
				"ID":   userIDVal,
				"Role": userRole,
			},
			"Projects": projects,
		})
		return
	}

	c.HTML(http.StatusOK, "briefing.html", gin.H{
		"Briefing":  brief,
		"ProjectID": projectID,
		"Markdown":  brief.Markdown(),
	})
}
