package handlers

import (
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"

	"github.com/FeaturePlus/backend/models"
	"github.com/FeaturePlus/backend/repositories"
	"github.com/FeaturePlus/backend/services"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// MARKER:FEATURE_HANDLER Feature handler definition
type FeatureHandler struct {
	repo     *repositories.FeatureRepository
	tagRepo  *repositories.TagRepository
	taskRepo repositories.TaskRepository
	DB       *gorm.DB
}

func NewFeatureHandler(repo *repositories.FeatureRepository, tagRepo *repositories.TagRepository, taskRepo repositories.TaskRepository, db *gorm.DB) *FeatureHandler {
	return &FeatureHandler{repo: repo, tagRepo: tagRepo, taskRepo: taskRepo, DB: db}
}

type FeatureWithTags struct {
	models.Feature
	TagsInput string `json:"tags_input,omitempty"`
}

// viewerID reads the authenticated user's id out of the gin context, or 0 when
// the request is unauthenticated.
func viewerID(c *gin.Context) int {
	v, ok := c.Get("user_id")
	if !ok {
		return 0
	}
	if u, ok := v.(uint); ok {
		return int(u)
	}
	return 0
}

// visibleFeatures lists a project's features narrowed to those the current
// viewer is scoped to see. Handlers that render feature lists should use this
// rather than the repository directly, so a scoped collaborator's project view
// matches the access they actually hold.
func (h *FeatureHandler) visibleFeatures(c *gin.Context, projectID int) ([]models.Feature, error) {
	features, err := h.repo.GetFeaturesByProject(projectID)
	if err != nil {
		return nil, err
	}
	return services.NewAccessService(h.DB).FilterVisibleFeatures(viewerID(c), projectID, features)
}

type FeatureFormInput struct {
	Title       string `form:"title" binding:"required"`
	Description string `form:"description"`
	Category    string `form:"category" binding:"required"`
}

func (h *FeatureHandler) CreateFeature(c *gin.Context) {
	var input FeatureFormInput
	if err := c.ShouldBind(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	projectIDStr := c.Param("id")
	projectID, err := strconv.Atoi(projectIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid project ID in URL"})
		return
	}

	feature := models.Feature{
		ProjectID:   projectID,
		Title:       input.Title,
		Description: input.Description,
		Category:    input.Category,
		Status:      models.StatusTodo,
		Priority:    models.PriorityMedium,
	}

	// Strict validation for category against project config
	projectRepo := repositories.NewProjectRepository(h.DB)
	project, err := projectRepo.GetProjectByID(projectID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid project ID for category validation"})
		return
	}

	// Ensure project config is properly initialized
	ensureProjectConfig(project)

	// Get categories using the helper function
	categoryStrings := getFeatureCategories(project)

	// Convert to interface array for compatibility with existing code
	categories := make([]interface{}, len(categoryStrings))
	for i, s := range categoryStrings {
		categories[i] = s
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

	// Return the updated feature list (full block, not just inner fragment)
	// Use helper function to safely get categories
	categories2 := getFeatureCategories(project)
	features, _ := h.repo.GetFeaturesByProject(projectID)
	c.HTML(http.StatusOK, "feature-list.html", gin.H{"Features": features, "ProjectID": projectID, "FeatureCategories": categories2, "FilterCategory": "All"})
}

func (h *FeatureHandler) GetFeature(c *gin.Context) {
	// Debug log to print the user_role received from context
	userRole, exists := c.Get("user_role")
	log.Printf("[GetFeature] user_role from context: '%v' (exists: %v)", userRole, exists)

	featureIDStr := c.Param("featureid")
	if featureIDStr == "" {
		featureIDStr = c.Param("id")
	}
	featureID, err := strconv.Atoi(featureIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid feature ID"})
		return
	}

	feature, err := h.repo.GetFeatureByID(featureID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "feature not found"})
		return
	}

	// Get user ID and role from context (set by AuthMiddleware and RoleMiddleware)
	userID, _ := c.Get("user_id")
	userRole, _ = c.Get("user_role") // Using = instead of := since userRole is already declared above

	// Create CurrentUser object for template
	currentUser := map[string]interface{}{
		"ID":   userID,
		"Role": userRole,
	}

	if c.GetHeader("HX-Request") == "true" {
		c.HTML(http.StatusOK, "feature-detail.html", gin.H{
			"Feature":     feature,
			"CurrentUser": currentUser,
		})
		return
	}
	// Non-HTMX: render dashboard shell with InitialURL for this feature
	c.HTML(http.StatusOK, "dashboard.html", gin.H{
		"InitialURL":  "/web/fragments/features/" + featureIDStr,
		"CurrentUser": currentUser,
	})
}

// GetFeatureAPI returns feature data as JSON for API clients
func (h *FeatureHandler) GetFeatureAPI(c *gin.Context) {
	featureIDStr := c.Param("id")
	featureID, err := strconv.Atoi(featureIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid feature ID"})
		return
	}

	feature, err := h.repo.GetFeatureByID(featureID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "feature not found"})
		return
	}

	// Return JSON response
	c.JSON(http.StatusOK, feature)
}

func (h *FeatureHandler) GetProjectFeatures(c *gin.Context) {
	projectIDStr := c.Param("id")
	projectID, err := strconv.Atoi(projectIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid project ID"})
		return
	}

	// Fetch project to get categories
	projectRepo := repositories.NewProjectRepository(h.DB)
	project, err := projectRepo.GetProjectByID(projectID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid project ID"})
		return
	}

	// Use helper function to safely get categories
	categories := getFeatureCategories(project)

	// Get filter from query param
	filterCategory := c.Query("category")
	if c.GetHeader("HX-Request") == "true" {
		// HTMX request: only render the inner list
		if filterCategory == "" || filterCategory == "All" {
			features, err := h.visibleFeatures(c, projectID)
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
			fmt.Printf("[GetProjectFeatures] ProjectID: %d, Filter: '%s', Features: %d\n", projectID, filterCategory, len(features))
			for _, f := range features {
				fmt.Printf("  - %s\n", f.Title)
			}
			c.HTML(http.StatusOK, "feature-list-inner.html", gin.H{"Features": features, "ProjectID": projectID, "FeatureCategories": categories, "FilterCategory": "All"})
			return
		}
		features, err := h.visibleFeatures(c, projectID)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		filtered := []models.Feature{}
		for _, f := range features {
			if f.Category == filterCategory {
				filtered = append(filtered, f)
			}
		}
		fmt.Printf("[GetProjectFeatures] ProjectID: %d, Filter: '%s', Features: %d\n", projectID, filterCategory, len(filtered))
		for _, f := range filtered {
			fmt.Printf("  - %s\n", f.Title)
		}
		c.HTML(http.StatusOK, "feature-list-inner.html", gin.H{"Features": filtered, "ProjectID": projectID, "FeatureCategories": categories, "FilterCategory": filterCategory})
		return
	}

	// Non-HTMX request: render the full feature list
	if filterCategory == "" || filterCategory == "All" {
		features, err := h.visibleFeatures(c, projectID)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		fmt.Printf("[GetProjectFeatures] ProjectID: %d, Filter: '%s', Features: %d\n", projectID, filterCategory, len(features))
		for _, f := range features {
			fmt.Printf("  - %s\n", f.Title)
		}
		c.HTML(http.StatusOK, "feature-list.html", gin.H{"Features": features, "ProjectID": projectID, "FeatureCategories": categories, "FilterCategory": "All"})
		return
	}

	features, err := h.visibleFeatures(c, projectID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	filtered := []models.Feature{}
	for _, f := range features {
		if f.Category == filterCategory {
			filtered = append(filtered, f)
		}
	}
	fmt.Printf("[GetProjectFeatures] ProjectID: %d, Filter: '%s', Features: %d\n", projectID, filterCategory, len(filtered))
	for _, f := range filtered {
		fmt.Printf("  - %s\n", f.Title)
	}
	c.HTML(http.StatusOK, "feature-list.html", gin.H{"Features": filtered, "ProjectID": projectID, "FeatureCategories": categories, "FilterCategory": filterCategory})
}

// FeaturesContentHandler serves /web/projects/:id/features/content for main content swaps
func (h *FeatureHandler) FeaturesContentHandler(c *gin.Context) {
	projectIDStr := c.Param("id")
	projectID, err := strconv.Atoi(projectIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid project ID"})
		return
	}

	projectRepo := repositories.NewProjectRepository(h.DB)
	project, err := projectRepo.GetProjectByID(projectID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid project ID"})
		return
	}
	// Use helper function to safely get categories
	categories := getFeatureCategories(project)

	filterCategory := c.Query("category")
	features, err := h.visibleFeatures(c, projectID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if filterCategory != "" && filterCategory != "All" {
		filtered := []models.Feature{}
		for _, f := range features {
			if f.Category == filterCategory {
				filtered = append(filtered, f)
			}
		}
		features = filtered
	}
	fmt.Printf("[FeaturesContentHandler] ProjectID: %d, Filter: '%s', Features: %d\n", projectID, filterCategory, len(features))
	for _, f := range features {
		fmt.Printf("  - %s\n", f.Title)
	}
	c.HTML(http.StatusOK, "feature-list.html", gin.H{
		"Features":          features,
		"ProjectID":         projectID,
		"FeatureCategories": categories,
		"FilterCategory":    filterCategory,
	})
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

	// MARKER:UPDATE_FEATURE_SWITCH Switch for updating feature fields
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

			// Use helper function to safely get categories
			categoryStrings := getFeatureCategories(project)

			// Check if the category is valid
			validCategory := false
			for _, catStr := range categoryStrings {
				if catStr == category {
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
			userID, exists := c.Get("user_id")
			if !exists {
				c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
				return
			}
			if err := h.tagRepo.UpdateFeatureTags(existingFeature.ID, userID.(uint), tags); err != nil {
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

// NewFeatureForm renders the inline form for creating a new feature
func (h *FeatureHandler) NewFeatureForm(c *gin.Context) {
	projectIDStr := c.Param("id")
	projectID, err := strconv.Atoi(projectIDStr)
	if err != nil {
		c.String(http.StatusBadRequest, "Invalid project ID")
		return
	}

	projectRepo := repositories.NewProjectRepository(h.DB)
	project, err := projectRepo.GetProjectByID(projectID)
	if err != nil {
		c.String(http.StatusNotFound, "Project not found")
		return
	}

	// Use helper function to safely obtain categories
	categories := getFeatureCategories(project)

	c.HTML(http.StatusOK, "feature-form.html", gin.H{
		"ProjectID":         projectID,
		"FeatureCategories": categories,
	})
}

// CreateFeatureForProject handles POST /web/projects/:id/features
func (h *FeatureHandler) CreateFeatureForProject(c *gin.Context) {
	projectIDStr := c.Param("id")
	projectID, err := strconv.Atoi(projectIDStr)
	if err != nil {
		c.String(http.StatusBadRequest, "Invalid project ID")
		return
	}

	var input FeatureFormInput
	if err := c.ShouldBind(&input); err != nil {
		c.String(http.StatusBadRequest, "Invalid form data")
		return
	}

	feature := models.Feature{
		Title:       input.Title,
		Description: input.Description,
		Category:    input.Category,
		ProjectID:   projectID, // fix: use int, not uint
	}
	if err := h.repo.CreateFeature(&feature); err != nil {
		c.String(http.StatusInternalServerError, "Failed to create feature")
		return
	}

	// Handle tags if present
	tagsInput := c.PostForm("tags_input")
	if tagsInput != "" && h.tagRepo != nil {
		var createdByUser uint = 1 // Default to admin if not available
		if userID, exists := c.Get("user_id"); exists {
			createdByUser = userID.(uint)
		}
		// Save tags (handles single/multiple, any separator)
		_ = h.tagRepo.UpdateFeatureTags(feature.ID, createdByUser, tagsInput)
	}

	// Fetch categories for filter bar (use helper)
	projectRepo := repositories.NewProjectRepository(h.DB)
	project, err := projectRepo.GetProjectByID(projectID)
	var categories []string
	if err == nil {
		categories = getFeatureCategories(project)
	} else {
		categories = []string{}
	}

	features, _ := h.repo.GetFeaturesByProject(projectID)

	if c.GetHeader("HX-Request") == "true" {
		// Render feature cards and OOB clear form
		c.Header("HX-Trigger", "feature-added")
		c.HTML(http.StatusOK, "feature-list-oob.html", gin.H{
			"Features":          features,
			"ProjectID":         projectID,
			"FeatureCategories": categories,
			"FilterCategory":    "All",
		})
		return
	}
	// Non-HTMX: redirect to full page
	c.Redirect(http.StatusSeeOther, "/web/projects/"+projectIDStr+"/features")
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

// Add these methods to FeatureHandler
func (h *FeatureHandler) GetFeaturesByProjectID(projectID int) ([]models.Feature, error) {
	return h.repo.GetFeaturesByProject(projectID)
}

// Add this method to FeatureHandler
// New: Render only the feature-edit-form.html partial for inline editing (like tasks)
func (h *FeatureHandler) EditFeatureInline(c *gin.Context) {
	idStr := c.Param("id")
	projectIDStr := c.Query("project_id")
	var projectID int
	fmt.Sscanf(projectIDStr, "%d", &projectID)
	featureID := 0
	fmt.Sscanf(idStr, "%d", &featureID)
	feature, err := h.repo.GetFeatureByID(featureID)
	if err != nil {
		c.String(http.StatusNotFound, "Feature not found")
		return
	}
	c.HTML(http.StatusOK, "feature-edit-form.html", gin.H{
		"Feature":   feature,
		"ProjectID": projectID,
	})
}

// UpdateFeatureInline handles inline feature updates (title, description only)
func (h *FeatureHandler) UpdateFeatureInline(c *gin.Context) {
	idStr := c.Param("id")
	featureID, err := strconv.Atoi(idStr)
	if err != nil {
		c.String(http.StatusBadRequest, "Invalid feature ID")
		return
	}
	var input struct {
		Title       string `form:"title" binding:"required"`
		Description string `form:"description"`
	}
	if err := c.ShouldBind(&input); err != nil {
		c.String(http.StatusBadRequest, "Invalid form data")
		return
	}
	feature, err := h.repo.GetFeatureByID(featureID)
	if err != nil {
		c.String(http.StatusNotFound, "Feature not found")
		return
	}
	feature.Title = input.Title
	feature.Description = input.Description
	if err := h.repo.UpdateFeature(feature); err != nil {
		c.String(http.StatusInternalServerError, "Failed to update feature")
		return
	}
	// Handle tags
	tagsInput := c.PostForm("tags_input")
	if tagsInput != "" && h.tagRepo != nil {
		var createdByUser uint = 1 // Default to admin if not available
		if userID, exists := c.Get("user_id"); exists {
			createdByUser = userID.(uint)
		}
		_ = h.tagRepo.UpdateFeatureTags(feature.ID, createdByUser, tagsInput)
	} else if h.tagRepo != nil {
		_ = h.tagRepo.DeleteTagsByFeatureID(feature.ID)
	}
	// Reload feature with tags
	updatedFeature, err := h.repo.GetFeatureByID(featureID)
	if err != nil {
		c.String(http.StatusInternalServerError, "Failed to reload feature")
		return
	}
	projectID := c.DefaultQuery("project_id", "0")
	pid, _ := strconv.Atoi(projectID)
	c.HTML(http.StatusOK, "feature-card.html", gin.H{
		"Feature":   updatedFeature,
		"ProjectID": pid,
	})
}

// ViewFeatureCard serves the card partial for a single feature (for cancel)
func (h *FeatureHandler) ViewFeatureCard(c *gin.Context) {
	idStr := c.Param("id")
	projectIDStr := c.DefaultQuery("project_id", "0")
	featureID, _ := strconv.Atoi(idStr)
	projectID, _ := strconv.Atoi(projectIDStr)
	feature, err := h.repo.GetFeatureByID(featureID)
	if err != nil {
		c.String(http.StatusNotFound, "Feature not found")
		return
	}
	c.HTML(http.StatusOK, "feature-card.html", gin.H{
		"Feature":   feature,
		"ProjectID": projectID,
	})
}

// TagAutocomplete returns a JSON array of tag names matching the query
func (h *FeatureHandler) TagAutocomplete(c *gin.Context) {
	query := c.Query("query")
	fmt.Println("[TagAutocomplete] query:", query) // DEBUG
	if len(query) < 2 {
		fmt.Println("[TagAutocomplete] Query too short, returning empty array") // DEBUG
		c.JSON(200, []string{})
		return
	}
	var tagNames []string
	if h.tagRepo != nil {
		tagNames, _ = h.tagRepo.AutocompleteTagNames(query)
		fmt.Println("[TagAutocomplete] tagNames:", tagNames) // DEBUG
	}
	c.JSON(200, tagNames)
}

func (h *FeatureHandler) GetFeaturesByTagName(tag string) ([]models.Feature, error) {
	return h.tagRepo.GetFeaturesByTagName(tag)
}

// ensureProjectConfig ensures that project.Config exists and has required fields
func ensureProjectConfig(project *models.Project) {
	// Initialize Config if nil
	if project.Config == nil {
		project.Config = models.JSONB{}
	}

	// Ensure required fields exist with defaults
	if _, exists := project.Config["task_types"]; !exists {
		project.Config["task_types"] = []string{"UI", "Dev", "DB", "Backend"}
	}
	if _, exists := project.Config["feature_category"]; !exists {
		project.Config["feature_category"] = []string{"Auth", "Payment", "Tags", "Tasks", "Features"}
	}
	if _, exists := project.Config["tech_stack"]; !exists {
		project.Config["tech_stack"] = "Other"
	}
	if _, exists := project.Config["tags_enabled"]; !exists {
		project.Config["tags_enabled"] = true
	}
}

// getFeatureCategories safely extracts feature categories from project config
func getFeatureCategories(project *models.Project) []string {
	ensureProjectConfig(project)

	categories := []string{}

	// Try to extract categories as interface array
	if cats, ok := project.Config["feature_category"].([]interface{}); ok {
		for _, cat := range cats {
			if catStr, ok := cat.(string); ok {
				categories = append(categories, catStr)
			}
		}
	} else if strArr, ok := project.Config["feature_category"].([]string); ok {
		// Try to extract as string array
		categories = strArr
	} else if raw, ok := project.Config["feature_category"].(string); ok {
		// support comma separated string as fallback
		for _, s := range strings.Split(raw, ",") {
			categories = append(categories, strings.TrimSpace(s))
		}
	}

	// Don't force defaults - allow empty categories
	// If user hasn't set any, return empty slice
	return categories
}

// UnassignFeatureFromRelease removes a feature from its assigned release
func (h *FeatureHandler) UnassignFeatureFromRelease(c *gin.Context) {
	logPrefix := "[UnassignFeatureFromRelease]"
	log.Printf("%s Start unassigning feature from release", logPrefix)
	
	// Parse feature ID from URL
	featureIDStr := c.Param("id")
	featureID, err := strconv.ParseUint(featureIDStr, 10, 32)
	if err != nil {
		log.Printf("%s Invalid feature ID: %v", logPrefix, err)
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid feature ID"})
		return
	}
	
	log.Printf("%s Unassigning feature %d from release", logPrefix, featureID)
	
	// Update the feature to set release_id to NULL
	if err := h.DB.Model(&models.Feature{}).Where("id = ?", featureID).Update("release_id", nil).Error; err != nil {
		log.Printf("%s Failed to unassign feature: %v", logPrefix, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to unassign feature from release"})
		return
	}
	
	log.Printf("%s Successfully unassigned feature %d from release", logPrefix, featureID)
	
	// For HTMX requests, return empty content to remove the element
	if c.GetHeader("HX-Request") == "true" {
		c.Status(http.StatusOK)
		return
	}
	
	// For non-HTMX requests, return JSON
	c.JSON(http.StatusOK, gin.H{
		"status":  "success",
		"message": "Feature unassigned from release",
	})
}

// SyncFeatureData handles syncing file and commit data from CLI
func (h *FeatureHandler) SyncFeatureData(c *gin.Context) {
	var payload struct {
		FeatureID string   `json:"feature_id" binding:"required"`
		Files     []string `json:"files"`
		Commits   []string `json:"commits"`
		Status    string   `json:"status"`
	}

	if err := c.ShouldBindJSON(&payload); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request payload"})
		return
	}

	// Extract numeric ID from FTR-XXX format
	var featureID int
	if _, err := fmt.Sscanf(payload.FeatureID, "FTR-%d", &featureID); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid feature ID format"})
		return
	}

	// Check if feature exists
	feature, err := h.repo.GetFeatureByID(featureID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Feature not found"})
		return
	}

	// Store files in database
	for _, filePath := range payload.Files {
		featureFile := models.FeatureFile{
			FeatureID: feature.ID,
			FilePath:  filePath,
		}
		// Use FirstOrCreate to avoid duplicates
		h.DB.Where("feature_id = ? AND file_path = ?", feature.ID, filePath).FirstOrCreate(&featureFile)
	}

	// Store commits in database
	for _, commitHash := range payload.Commits {
		featureCommit := models.FeatureCommit{
			FeatureID:  feature.ID,
			CommitHash: commitHash,
		}
		// Use FirstOrCreate to avoid duplicates
		h.DB.Where("feature_id = ? AND commit_hash = ?", feature.ID, commitHash).FirstOrCreate(&featureCommit)
	}

	log.Printf("Synced feature %d: %d files, %d commits stored in database", 
		featureID, len(payload.Files), len(payload.Commits))

	// Update feature status if provided
	if payload.Status != "" {
		feature.Status = models.FeatureStatus(payload.Status)
		if err := h.DB.Save(feature).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update feature"})
			return
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "Feature synced successfully",
		"feature_id": payload.FeatureID,
		"files_count": len(payload.Files),
		"commits_count": len(payload.Commits),
	})
}

// GetLinkedCode renders the linked code section for a feature
func (h *FeatureHandler) GetLinkedCode(c *gin.Context) {
	featureIDStr := c.Param("id")
	log.Printf("[GetLinkedCode] Called for feature ID: %s", featureIDStr)
	
	featureID, err := strconv.Atoi(featureIDStr)
	if err != nil {
		log.Printf("[GetLinkedCode] Error parsing feature ID: %v", err)
		c.HTML(http.StatusBadRequest, "linked-code.html", gin.H{
			"Feature": gin.H{"ID": featureIDStr},
			"Files": []interface{}{},
			"Commits": []interface{}{},
		})
		return
	}
	
	log.Printf("[GetLinkedCode] Fetching data for feature ID: %d", featureID)

	// Resolve the owning project so we can build contract-view links and check
	// the current viewer's per-file access under Scoped Contracts.
	var feature models.Feature
	projectID := 0
	if err := h.DB.Select("project_id").First(&feature, featureID).Error; err == nil {
		projectID = int(feature.ProjectID)
	}
	viewerID := 0
	if v, ok := c.Get("user_id"); ok {
		if u, ok := v.(uint); ok {
			viewerID = int(u)
		}
	}
	access := services.NewAccessService(h.DB)

	// Fetch files from database
	var files []models.FeatureFile
	h.DB.Where("feature_id = ?", featureID).Find(&files)

	// Fetch commits from database
	var commits []models.FeatureCommit
	h.DB.Where("feature_id = ?", featureID).Order("created_at DESC").Find(&commits)

	// Format files for template
	type FileDisplay struct {
		FilePath       string
		LastSeenCommit string
		AccessLevel    string // owner | contract | none â€” governs the contract-view link
	}
	fileDisplays := make([]FileDisplay, 0, len(files))
	for _, file := range files {
		// Get the last commit that touched this file (if any)
		lastCommit := ""
		if len(commits) > 0 {
			lastCommit = commits[0].CommitHash
		}
		level := string(models.AccessNone)
		if projectID != 0 {
			if fa, err := access.ResolveFileAccess(viewerID, projectID, file.FilePath); err == nil {
				level = string(fa.Level)
			}
		}
		fileDisplays = append(fileDisplays, FileDisplay{
			FilePath:       file.FilePath,
			LastSeenCommit: lastCommit,
			AccessLevel:    level,
		})
	}

	// Format commits for template
	type CommitDisplay struct {
		CommitHash string
		Message    string
		Author     string
	}
	commitDisplays := make([]CommitDisplay, 0, len(commits))
	for _, commit := range commits {
		// Extract message from commit hash (in real scenario, you'd fetch from git)
		// For now, just show the hash
		commitDisplays = append(commitDisplays, CommitDisplay{
			CommitHash: commit.CommitHash,
			Message:    "Commit " + commit.CommitHash,
			Author:     "",
		})
	}

	// Get last synced time from the most recent file or commit
	var lastSynced string
	if len(files) > 0 {
		lastSynced = files[0].UpdatedAt.Format("Jan 02, 2006 at 3:04 PM")
	} else if len(commits) > 0 {
		lastSynced = commits[0].UpdatedAt.Format("Jan 02, 2006 at 3:04 PM")
	}

	log.Printf("[GetLinkedCode] Rendering template with %d files, %d commits", len(fileDisplays), len(commitDisplays))

	// TODO: Get RepoURL from project settings or feature metadata
	// For now, you can configure this per project in the database
	repoURL := "" // e.g., "https://github.com/username/repo"

	c.HTML(http.StatusOK, "linked-code.html", gin.H{
		"Feature":    gin.H{"ID": featureIDStr},
		"ProjectID":  projectID,
		"Files":      fileDisplays,
		"Commits":    commitDisplays,
		"LastSynced": lastSynced,
		"RepoURL":    repoURL,
	})
}

// CreateFeatureAPI creates a feature via JSON (used by CLI).
// POST /api/features
func (h *FeatureHandler) CreateFeatureAPI(c *gin.Context) {
	var input struct {
		ProjectID   uint   `json:"project_id" binding:"required"`
		Title       string `json:"title" binding:"required"`
		Description string `json:"description"`
		Status      string `json:"status"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	status := models.StatusTodo
	if input.Status != "" {
		status = models.FeatureStatus(input.Status)
	}

	feature := models.Feature{
		ProjectID:   int(input.ProjectID),
		Title:       input.Title,
		Description: input.Description,
		Status:      status,
		Priority:    models.PriorityMedium,
	}

	if err := h.repo.CreateFeature(&feature); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create feature"})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"id":          feature.ID,
		"project_id":  feature.ProjectID,
		"title":       feature.Title,
		"description": feature.Description,
		"status":      feature.Status,
	})
}

// GetFeaturesByProjectAPI lists features for a project as JSON (used by CLI).
// GET /api/json/projects/:id/features
func (h *FeatureHandler) GetFeaturesByProjectAPI(c *gin.Context) {
	projectIDStr := c.Param("id")
	projectID, err := strconv.Atoi(projectIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid project ID"})
		return
	}

	features, err := h.visibleFeatures(c, projectID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to fetch features"})
		return
	}

	type featureJSON struct {
		ID          uint   `json:"id"`
		ProjectID   int    `json:"project_id"`
		Title       string `json:"title"`
		Description string `json:"description"`
		Status      string `json:"status"`
	}

	result := make([]featureJSON, len(features))
	for i, f := range features {
		result[i] = featureJSON{
			ID:          f.ID,
			ProjectID:   f.ProjectID,
			Title:       f.Title,
			Description: f.Description,
			Status:      string(f.Status),
		}
	}

	c.JSON(http.StatusOK, result)
}

// CreateTaskAPI creates a task via JSON (used by CLI).
// POST /api/tasks
func (h *FeatureHandler) CreateTaskAPI(c *gin.Context) {
	var input struct {
		FeatureID   uint   `json:"feature_id" binding:"required"`
		TaskName    string `json:"task_name" binding:"required"`
		TaskType    string `json:"task_type" binding:"required"`
		Description string `json:"description"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	task := models.Task{
		FeatureID: input.FeatureID,
		TaskName:  input.TaskName,
		TaskType:  input.TaskType,
	}

	if err := h.taskRepo.Create(&task); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create task"})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"id":         task.ID,
		"feature_id": task.FeatureID,
		"task_name":  task.TaskName,
		"task_type":  task.TaskType,
	})
}

// GetTasksByFeatureAPI lists tasks for a feature as JSON (used by CLI).
// GET /api/json/features/:id/tasks
func (h *FeatureHandler) GetTasksByFeatureAPI(c *gin.Context) {
	featureIDStr := c.Param("id")
	featureID, err := strconv.Atoi(featureIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid feature ID"})
		return
	}

	tasks, err := h.taskRepo.GetByFeatureID(uint(featureID))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to fetch tasks"})
		return
	}

	type taskJSON struct {
		ID        uint   `json:"id"`
		FeatureID uint   `json:"feature_id"`
		TaskName  string `json:"task_name"`
		TaskType  string `json:"task_type"`
	}

	result := make([]taskJSON, len(tasks))
	for i, t := range tasks {
		result[i] = taskJSON{
			ID:        t.ID,
			FeatureID: t.FeatureID,
			TaskName:  t.TaskName,
			TaskType:  t.TaskType,
		}
	}

	c.JSON(http.StatusOK, result)
	
	log.Printf("[GetLinkedCode] Template rendered successfully")
}
