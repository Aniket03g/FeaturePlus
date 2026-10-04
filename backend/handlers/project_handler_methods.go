package handlers

import (
	"log"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/FeaturePlus/backend/models"
	"github.com/FeaturePlus/backend/repositories"
	"github.com/gin-gonic/gin"
)

// GetAllProjects handles getting all projects
func (h *ProjectHandler) GetAllProjects(c *gin.Context) {
	log.Println("DEBUG: Getting all projects from repository")
	projects, err := h.repo.GetAllProjects()
	if err != nil {
		log.Printf("ERROR: Failed to get projects: %v\n", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	log.Printf("DEBUG: Retrieved %d projects from repository\n", len(projects))
	for i, p := range projects {
		log.Printf("DEBUG: Project %d: ID=%d, Name=%s, OwnerID=%d\n", i+1, p.ID, p.Name, p.OwnerID)
	}
	c.HTML(http.StatusOK, "project-list.html", gin.H{"Projects": projects})
}

// GetProject handles getting a single project with progress stats and releases
func (h *ProjectHandler) GetProject(c *gin.Context) {
	idStr := c.Param("id")
	projectID, err := strconv.Atoi(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid project ID"})
		return
	}

	project, err := h.repo.GetProjectByID(projectID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "project not found"})
		return
	}

	// Get progress stats
	progressStats := h.getProjectProgressStats(projectID)
	
	// Get releases for this project
	releaseRepo := repositories.NewReleaseRepository(h.db)
	releases, err := releaseRepo.GetByProjectID(projectID)
	if err != nil {
		log.Printf("ERROR: Failed to get releases for project %d: %v\n", projectID, err)
		releases = []models.Release{} // Empty slice on error
	}

	c.HTML(http.StatusOK, "project-detail.html", gin.H{
		"Project":       project,
		"ProgressStats": progressStats,
		"Releases":      releases,
	})
}

// GetAllProjectsFragment handles getting all projects for HTMX fragment requests
func (h *ProjectHandler) GetAllProjectsFragment(c *gin.Context) {
	log.Println("DEBUG: Getting all projects for fragment")

	// Get the user's role from the context (set by the AuthMiddleware)
	userRole, _ := c.Get("user_role")
	isManager := userRole == "manager"

	projects, err := h.repo.GetAllProjects()
	if err != nil {
		log.Printf("ERROR: Failed to get projects for fragment: %v\n", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	log.Printf("DEBUG: Retrieved %d projects for fragment\n", len(projects))

	// Pass both the Projects and the CurrentUser's role to the template
	c.HTML(http.StatusOK, "project-list.html", gin.H{
		"Projects": projects,
		"CurrentUser": gin.H{
			"IsManager": isManager,
		},
	})
}

// getProjectProgressStats calculates progress statistics for a project
func (h *ProjectHandler) getProjectProgressStats(projectID int) gin.H {
	// Get all features for the project
	features, err := h.featureRepo.GetFeaturesByProject(projectID)
	if err != nil {
		log.Printf("ERROR: Failed to get features for project %d: %v\n", projectID, err)
		return gin.H{
			"TotalFeatures":     0,
			"CompletedFeatures": 0,
			"TotalTasks":        0,
			"CompletedTasks":    0,
			"FeatureProgress":   0,
			"TaskProgress":      0,
		}
	}

	totalFeatures := len(features)
	completedFeatures := 0
	totalTasks := 0
	completedTasks := 0

	// Count completed features and tasks
	for _, feature := range features {
		if feature.Status == "completed" || feature.Status == "done" {
			completedFeatures++
		}

		// Get tasks for this feature
		tasks, err := h.taskRepo.GetByFeatureID(feature.ID)
		if err == nil {
			totalTasks += len(tasks)
			// Count tasks with approved PRs as completed
			for _, task := range tasks {
				var prCount int64
				h.db.Model(&models.PullRequest{}).Where("task_id = ? AND tested = ? AND approved = ?", task.ID, true, true).Count(&prCount)
				if prCount > 0 {
					completedTasks++
				}
			}
		}
	}

	// Calculate progress percentages
	featureProgress := 0
	if totalFeatures > 0 {
		featureProgress = (completedFeatures * 100) / totalFeatures
	}

	taskProgress := 0
	if totalTasks > 0 {
		taskProgress = (completedTasks * 100) / totalTasks
	}

	return gin.H{
		"TotalFeatures":     totalFeatures,
		"CompletedFeatures": completedFeatures,
		"TotalTasks":        totalTasks,
		"CompletedTasks":    completedTasks,
		"FeatureProgress":   featureProgress,
		"TaskProgress":      taskProgress,
	}
}

// GetProjectProgress returns progress stats as JSON (API endpoint)
func (h *ProjectHandler) GetProjectProgress(c *gin.Context) {
	idStr := c.Param("id")
	projectID, err := strconv.Atoi(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid project ID"})
		return
	}

	progressStats := h.getProjectProgressStats(projectID)
	c.JSON(http.StatusOK, progressStats)
}

// GetProjectReleases returns releases for a project as JSON (API endpoint)
func (h *ProjectHandler) GetProjectReleases(c *gin.Context) {
	idStr := c.Param("id")
	projectID, err := strconv.Atoi(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid project ID"})
		return
	}

	releaseRepo := repositories.NewReleaseRepository(h.db)
	releases, err := releaseRepo.GetByProjectID(projectID)
	if err != nil {
		log.Printf("ERROR: Failed to get releases for project %d: %v\n", projectID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to get releases"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"releases": releases})
}

// GetProjectSettingsModal renders the project settings modal
func (h *ProjectHandler) GetProjectSettingsModal(c *gin.Context) {
	idStr := c.Param("id")
	projectID, err := strconv.Atoi(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid project ID"})
		return
	}

	project, err := h.repo.GetProjectByID(projectID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "project not found"})
		return
	}

	// Extract feature categories
	var featureCategories []string
	if categories, ok := project.Config["feature_category"].([]interface{}); ok {
		for _, cat := range categories {
			if catStr, ok := cat.(string); ok {
				featureCategories = append(featureCategories, catStr)
			}
		}
	} else if categories, ok := project.Config["feature_category"].([]string); ok {
		featureCategories = categories
	}

	// Extract task types
	var taskTypes []string
	if types, ok := project.Config["task_types"].([]interface{}); ok {
		for _, t := range types {
			if tStr, ok := t.(string); ok {
				taskTypes = append(taskTypes, tStr)
			}
		}
	} else if types, ok := project.Config["task_types"].([]string); ok {
		taskTypes = types
	}

	c.HTML(http.StatusOK, "project-settings-modal.html", gin.H{
		"Project":           project,
		"FeatureCategories": featureCategories,
		"TaskTypes":         taskTypes,
	})
}

// ExportMarkdown regenerates the markdown file for a project on demand.
func (h *ProjectHandler) ExportMarkdown(c *gin.Context) {
	idStr := c.Param("id")
	projectID, err := strconv.Atoi(idStr)
	if err != nil {
		c.Data(http.StatusBadRequest, "text/html", []byte(`<span class="text-red-600 text-sm font-medium">Invalid project ID.</span>`))
		return
	}

	project, err := h.repo.GetProjectByID(projectID)
	if err != nil {
		c.Data(http.StatusNotFound, "text/html", []byte(`<span class="text-red-600 text-sm font-medium">Project not found.</span>`))
		return
	}

	features, err := h.featureRepo.GetFeaturesByProject(projectID)
	if err != nil {
		log.Printf("ERROR: ExportMarkdown - failed to get features for project %d: %v", projectID, err)
		features = []models.Feature{}
	}

	var allTasks []models.Task
	for _, f := range features {
		tasks, err := h.taskRepo.GetByFeatureID(f.ID)
		if err == nil {
			allTasks = append(allTasks, tasks...)
		}
	}

	var tmpl *repositories.Template
	if project.Config != nil {
		if tid, ok := project.Config["template_id"].(string); ok && tid != "" && h.templateRepo != nil {
			if t, err := h.templateRepo.GetTemplateByID(tid); err == nil {
				tmpl = t
			}
		}
	}

	projectsDir := filepath.Join(h.dataPath, "projects")
	if err := GenerateProjectMarkdown(project, tmpl, features, allTasks, 0, projectsDir); err != nil {
		log.Printf("ERROR: ExportMarkdown - failed to generate markdown for project %d: %v", projectID, err)
		c.Data(http.StatusInternalServerError, "text/html", []byte(`<span class="text-red-600 text-sm font-medium">Failed to export markdown.</span>`))
		return
	}

	c.Data(http.StatusOK, "text/html", []byte(`<span class="text-green-600 text-sm font-medium">Markdown exported successfully.</span>`))
}

// UpdateProjectSettings updates project settings from the settings modal
func (h *ProjectHandler) UpdateProjectSettings(c *gin.Context) {
	idStr := c.Param("id")
	projectID, err := strconv.Atoi(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid project ID"})
		return
	}

	project, err := h.repo.GetProjectByID(projectID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "project not found"})
		return
	}

	// Parse form data
	if err := c.Request.ParseForm(); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid form data"})
		return
	}

	// Get feature categories from form
	featureCategoriesForm := c.Request.Form["feature_categories[]"]
	var featureCategories []string
	for _, cat := range featureCategoriesForm {
		trimmed := strings.TrimSpace(cat)
		if trimmed != "" {
			featureCategories = append(featureCategories, trimmed)
		}
	}

	// Get task types from form
	taskTypesForm := c.Request.Form["task_types[]"]
	var taskTypes []string
	for _, t := range taskTypesForm {
		trimmed := strings.TrimSpace(t)
		if trimmed != "" {
			taskTypes = append(taskTypes, trimmed)
		}
	}

	// Initialize Config if nil
	if project.Config == nil {
		project.Config = models.JSONB{}
	}

	// Update config
	if len(featureCategories) > 0 {
		project.Config["feature_category"] = featureCategories
	} else {
		// Allow empty categories
		project.Config["feature_category"] = []string{}
	}

	if len(taskTypes) > 0 {
		project.Config["task_types"] = taskTypes
	} else {
		// Set default task types if empty
		project.Config["task_types"] = []string{"UI", "Dev", "DB", "Backend"}
	}

	// Save project
	if err := h.db.Save(&project).Error; err != nil {
		log.Printf("ERROR: Failed to update project settings: %v\n", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update settings"})
		return
	}

	// Return success and close modal
	c.HTML(http.StatusOK, "success-message.html", gin.H{
		"message": "Project settings updated successfully",
	})
}
