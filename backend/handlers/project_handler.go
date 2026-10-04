package handlers

import (
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/FeaturePlus/backend/models"
	"github.com/FeaturePlus/backend/repositories"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type ProjectHandler struct {
	repo         *repositories.ProjectRepository
	db           *gorm.DB
	templateRepo *repositories.TemplateRepository
	featureRepo  *repositories.FeatureRepository
	taskRepo     repositories.TaskRepository
	dataPath     string
}

func NewProjectHandler(repo *repositories.ProjectRepository, db *gorm.DB) *ProjectHandler {
	// Environment variables are loaded in main.go
	
	// Use environment variable for data path
	dataPath := os.Getenv("DATA_PATH")
	if dataPath == "" {
		log.Printf("INFO: DATA_PATH environment variable not set in ProjectHandler, using default path")
		dataPath = "./data" // fallback for local dev
	}
	
	// Resolve absolute path
	absPath, err := filepath.Abs(dataPath)
	if err != nil {
		log.Printf("ERROR: Failed to resolve absolute path for %s: %v", dataPath, err)
		absPath = dataPath // Fallback to original path
	}
	
	log.Printf("DEBUG: ProjectHandler using data path: %s (absolute: %s)", dataPath, absPath)
	
	// Use the resolved path to create template repository
	templateRepo, err := repositories.NewTemplateRepository(absPath)
	if err != nil {
		log.Printf("Warning: Failed to load template repository: %v. Templates will not be available.", err)
	}

	return &ProjectHandler{
		repo:         repo,
		db:           db,
		templateRepo: templateRepo,
		featureRepo:  repositories.NewFeatureRepository(db),
		taskRepo:     repositories.NewTaskRepository(db),
		dataPath:     absPath,
	}
}

// ShowProjectCreateModal renders the create project modal for HTMX
func (h *ProjectHandler) ShowProjectCreateModal(c *gin.Context) {
	c.HTML(http.StatusOK, "create_project.html", gin.H{})
}

// ShowProjectImportModal renders the import project modal for HTMX
func (h *ProjectHandler) ShowProjectImportModal(c *gin.Context) {
	c.HTML(http.StatusOK, "import_project.html", gin.H{})
}

// ShowGitHubImportModal renders the GitHub MCP import modal for HTMX
func (h *ProjectHandler) ShowGitHubImportModal(c *gin.Context) {
	c.HTML(http.StatusOK, "import_github.html", gin.H{})
}

// CreateProjectFromForm handles the project creation from the HTMX modal form
func (h *ProjectHandler) CreateProjectFromForm(c *gin.Context) {
	var err error
	var projectList []models.Project
	log.Println("DEBUG: Starting project creation from form")

	// Log all form data for debugging
	formData := c.Request.Form
	if formData == nil {
		if err := c.Request.ParseForm(); err != nil {
			log.Printf("ERROR: Failed to parse form data: %v", err)
		} else {
			formData = c.Request.Form
		}
	}
	log.Printf("DEBUG: Form data received: %+v", formData)

	// Get the current user ID from the authenticated session
	userID, exists := c.Get("user_id")
	if !exists {
		c.HTML(http.StatusUnauthorized, "create_project.html", gin.H{
			"error": "You must be logged in to create a project",
		})
		return
	}

	// Parse form data from the modal
	name := c.PostForm("name")
	description := c.PostForm("description")
	taskTypes := c.PostForm("task_types")
	featureCategories := c.PostForm("feature_categories")
	techStack := c.PostForm("tech_stack")
	templateID := c.PostForm("template_id")
	tagsEnabled := c.PostForm("tags_enabled") == "on" // Checkbox returns "on" when checked
	context := c.PostForm("context")
	projectContext := c.PostForm("project_context") // STAGE 3: Custom project context

	// Log template ID specifically for debugging
	log.Printf("IMPORTANT: Received template_id: '%s'", templateID)

	// Log all form values individually for debugging
	log.Printf("DEBUG: Form values - name: %s, description: %s, taskTypes: %s, featureCategories: %s, techStack: %s, templateID: %s, tagsEnabled: %v, context: %s",
		name, description, taskTypes, featureCategories, techStack, templateID, tagsEnabled, context)

	// Basic validation
	if name == "" {
		c.HTML(http.StatusBadRequest, "create_project.html", gin.H{
			"error":       "Project name is required",
			"name":        name,
			"description": description,
		})
		return
	}

	// Create new project model
	// Convert userID from uint to int for the Project model
	userIDUint, ok := userID.(uint)
	if !ok {
		c.HTML(http.StatusInternalServerError, "create_project.html", gin.H{
			"error":       "Invalid user ID type",
			"name":        name,
			"description": description,
		})
		return
	}

	// Process task types and feature categories
	var taskTypesList []string
	var featureCategoriesList []string

	// Parse task types
	if taskTypes != "" {
		// Split by comma and trim spaces
		for _, t := range strings.Split(taskTypes, ",") {
			taskTypesList = append(taskTypesList, strings.TrimSpace(t))
		}
	} else {
		// Default task types
		taskTypesList = []string{"UI", "Dev", "DB", "Backend"}
	}

	// Parse feature categories
	if featureCategories != "" {
		// Split by comma and trim spaces
		for _, c := range strings.Split(featureCategories, ",") {
			trimmed := strings.TrimSpace(c)
			if trimmed != "" {
				featureCategoriesList = append(featureCategoriesList, trimmed)
			}
		}
	}
	// Don't set default feature categories - let it be empty if user doesn't provide any

	// Validate tech stack and default to "Other" if empty
	if techStack == "" {
		techStack = "Other"
	}

	// Validate context and default to "Development" if empty
	if context == "" {
		context = "Development"
	}

	// STAGE 3: Validate and sanitize project context
	projectContext = strings.TrimSpace(projectContext)
	if len(projectContext) > 2000 {
		projectContext = projectContext[:2000] // Truncate to max length
	}

	// Create custom config
	customConfig := models.JSONB{
		"task_types":       taskTypesList,
		"feature_category": featureCategoriesList,
		"tech_stack":       techStack,
		"tags_enabled":     tagsEnabled,
		"context":          context,
	}

	// STAGE 3: Add project context to config if provided
	// TODO: This project_context will be used later for LLM-based feature suggestions
	if projectContext != "" {
		customConfig["project_context"] = projectContext
		log.Printf("INFO: Project context provided: %s", projectContext)
	}

	// Store template ID in config if selected
	if templateID != "" {
		customConfig["template_id"] = templateID
	}

	project := models.Project{
		Name:        name,
		Description: description,
		OwnerID:     int(userIDUint), // Convert uint to int
		Config:      customConfig,
	}

	// Save to database using your existing repository
	if err := h.repo.CreateProject(&project); err != nil {
		c.HTML(http.StatusInternalServerError, "create_project.html", gin.H{
			"error":       "Failed to create project",
			"name":        name,
			"description": description,
		})
		return
	}

	// Apply template if one was selected
	if templateID != "" {
		log.Printf("DEBUG: Attempting to apply template %s to project %d", templateID, project.ID)
		
		// Check if template repository is initialized
		if h.templateRepo == nil {
			log.Printf("ERROR: Template repository is nil. Cannot apply template.")
		} else {
			log.Printf("DEBUG: Template repository is initialized. Checking for template with ID: %s", templateID)
			
			// Try to get the template directly to see if it exists
			tpl, err := h.templateRepo.GetTemplateByID(templateID)
			if err != nil {
				log.Printf("ERROR: Failed to get template by ID: %v", err)
			} else if tpl != nil {
				log.Printf("DEBUG: Found template: %s with %d features and %d tasks", 
					tpl.Name, len(tpl.Features), len(tpl.Tasks))
			}
			
			// Apply the template using our dedicated function
			if err := h.ApplyTemplate(&project, templateID); err != nil {
				log.Printf("ERROR: Failed to apply template: %v", err)
			} else {
				log.Printf("INFO: Successfully applied template %s to project %d", templateID, project.ID)
			}
		}
	}

	// Get all projects to refresh the list
	projectList, err = h.repo.GetAllProjects()
	if err != nil {
		c.HTML(http.StatusInternalServerError, "modals/create_project.html", gin.H{
			"error": "Project created but failed to refresh project list",
		})
		return
	}

	// Return two fragments:
	// 1. Close the modal
	// 2. Update the project list
	c.Header("HX-Trigger", "projectCreated")
	c.HTML(http.StatusOK, "project-list-fragment.html", gin.H{
		"Projects":   projectList,
		"NewProject": project,
	})
}


// DeleteProject handles the deletion of a project by ID
func (h *ProjectHandler) DeleteProject(c *gin.Context) {
	// Get project ID from URL parameter
	projectIDStr := c.Param("id")
	projectID, err := strconv.Atoi(projectIDStr)
	if err != nil {
		log.Printf("ERROR: Invalid project ID format: %s", projectIDStr)
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid project ID format"})
		return
	}
	
	log.Printf("DEBUG: Attempting to delete project with ID: %d", projectID)
	
	// Delete the project using repository
	if err := h.repo.DeleteProject(projectID); err != nil {
		log.Printf("ERROR: Failed to delete project %d: %v", projectID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete project"})
		return
	}
	
	log.Printf("INFO: Successfully deleted project with ID: %d", projectID)
	
	// Get updated project list
	projects, err := h.repo.GetAllProjects()
	if err != nil {
		log.Printf("ERROR: Failed to get updated project list after deletion: %v", err)
		c.JSON(http.StatusOK, gin.H{"success": true, "message": "Project deleted successfully"})
		return
	}
	
	// Return updated project list fragment
	c.HTML(http.StatusOK, "project-list-fragment.html", gin.H{
		"Projects": projects,
	})
}
