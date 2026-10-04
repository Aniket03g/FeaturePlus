package handlers

import (
	"fmt"
	"log"
	"path/filepath"
	"strings"

	"github.com/FeaturePlus/backend/models"
	"github.com/FeaturePlus/backend/repositories"
	"github.com/FeaturePlus/backend/services"
)

// ApplyTemplate applies a template to a project
func (h *ProjectHandler) ApplyTemplate(project *models.Project, templateID string) error {
	// Enhanced debugging for template application
	log.Printf("DEBUG: ApplyTemplate called with templateID=%s for project ID=%d", templateID, project.ID)
	
	// Check if template ID is empty
	if templateID == "" {
		log.Printf("ERROR: Empty template ID provided")
		return fmt.Errorf("invalid template ID: empty ID provided")
	}
	
	// Check if template repository is initialized
	if h.templateRepo == nil {
		log.Printf("ERROR: Template repository is nil in ProjectHandler")
		return fmt.Errorf("template repository not initialized")
	}
	
	// Log available templates for debugging
	templates := h.templateRepo.GetAllTemplates()
	log.Printf("DEBUG: Found %d templates in repository", len(templates))
	for i, t := range templates {
		log.Printf("DEBUG: Available template %d: ID=%s, Name=%s", i+1, t.ID, t.Name)
	}

	log.Printf("INFO: Applying template %s to project %d", templateID, project.ID)

	// Get the template - first try exact match
	log.Printf("DEBUG: Looking for template with exact ID match: %s", templateID)
	template, err := h.templateRepo.GetTemplateByID(templateID)
	if err != nil {
		log.Printf("ERROR: Failed to get template by exact ID: %v", err)
		
		// Try case-insensitive match
		log.Printf("DEBUG: Trying case-insensitive match for template ID: %s", templateID)
		templates := h.templateRepo.GetAllTemplates()
		for _, t := range templates {
			if strings.EqualFold(t.ID, templateID) {
				log.Printf("DEBUG: Found case-insensitive match: %s", t.ID)
				template = &t
				break
			}
		}
		
		if template == nil {
			// Try matching by name
			log.Printf("DEBUG: Trying to match template by name: %s", templateID)
			for _, t := range templates {
				if strings.Contains(strings.ToLower(t.Name), strings.ToLower(templateID)) {
					log.Printf("DEBUG: Found template by name match: %s", t.Name)
					template = &t
					break
				}
			}
		}
		
		if template == nil {
			return fmt.Errorf("template not found with ID or name: %s", templateID)
		}
	} else {
		log.Printf("DEBUG: Found template with exact ID match: %s", template.ID)
	}
	
	if template == nil {
		return fmt.Errorf("template not found")
	}
	
	log.Printf("INFO: Using template: %s (ID: %s) with %d features and %d tasks", 
		template.Name, template.ID, len(template.Features), len(template.Tasks))

	// Update project config with template's feature categories and task types if available
	if project.Config == nil {
		project.Config = models.JSONB{}
	}

	// Update feature categories if provided in the template
	if len(template.FeatureCategories) > 0 {
		log.Printf("INFO: Setting feature categories from template: %v", template.FeatureCategories)
		project.Config["feature_category"] = template.FeatureCategories
		
		// Update the project in the database
		if err := h.repo.UpdateProject(project); err != nil {
			log.Printf("WARNING: Failed to update project with template feature categories: %v", err)
		}
	}

	// Update task types if provided in the template
	if len(template.TaskTypes) > 0 {
		log.Printf("INFO: Setting task types from template: %v", template.TaskTypes)
		project.Config["task_types"] = template.TaskTypes
		
		// Update the project in the database
		if err := h.repo.UpdateProject(project); err != nil {
			log.Printf("WARNING: Failed to update project with template task types: %v", err)
		}
	}

	// Log template details for debugging
	// STAGE 2b: Get project context for filtering
	projectContext := "Development" // Default context
	if project.Config != nil {
		if ctx, ok := project.Config["context"].(string); ok && ctx != "" {
			projectContext = ctx
		}
	}
	log.Printf("INFO: Project context: %s", projectContext)

	// STAGE 2b: Filter features by context
	var filteredFeatures []repositories.TemplateFeature
	for _, feature := range template.Features {
		// Default to "Development" if context not specified
		featureContext := feature.Context
		if featureContext == "" {
			featureContext = "Development"
		}
		
		// Include feature if it matches project context
		if featureContext == projectContext {
			filteredFeatures = append(filteredFeatures, feature)
		}
	}
	
	// Fallback: If no features match, use Development context features
	if len(filteredFeatures) == 0 && projectContext != "Development" {
		log.Printf("INFO: No features found for context '%s', falling back to Development", projectContext)
		for _, feature := range template.Features {
			featureContext := feature.Context
			if featureContext == "" || featureContext == "Development" {
				filteredFeatures = append(filteredFeatures, feature)
			}
		}
	}
	
	// If still no features, use all features
	if len(filteredFeatures) == 0 {
		log.Printf("WARNING: No context-specific features found, using all features")
		filteredFeatures = template.Features
	}

	log.Printf("INFO: Applying template '%s' -> inserting %d/%d features (context: %s)", 
		template.Name, len(filteredFeatures), len(template.Features), projectContext)

	// Create features from template
	createdFeatures := []models.Feature{}
	featureMap := make(map[string]uint) // Map feature names to IDs for dependency creation

	for i, templateFeature := range filteredFeatures {
		log.Printf("DEBUG: Creating feature %d/%d: %s (context: %s)", i+1, len(filteredFeatures), templateFeature.Name, templateFeature.Context)
		feature := models.Feature{
			Title:       templateFeature.Name,
			Description: templateFeature.Description,
			Category:    templateFeature.Category,
			ProjectID:   int(project.ID),
			Status:      models.StatusTodo,
			Priority:    models.PriorityMedium,
		}

		if err := h.featureRepo.CreateFeature(&feature); err != nil {
			log.Printf("ERROR: Failed to create feature %s: %v", templateFeature.Name, err)
			continue
		}
		
		log.Printf("DEBUG: Successfully created feature with ID: %d", feature.ID)
		createdFeatures = append(createdFeatures, feature)
		
		// Store feature ID by name for dependency creation
		featureMap[templateFeature.Name] = feature.ID
	}
	
	log.Printf("INFO: Created %d/%d features successfully", len(createdFeatures), len(filteredFeatures))

	// STAGE 2b: Filter tasks by context
	var filteredTasks []repositories.TemplateTask
	for _, task := range template.Tasks {
		// Default to "Development" if context not specified
		taskContext := task.Context
		if taskContext == "" {
			taskContext = "Development"
		}
		
		// Include task if it matches project context
		if taskContext == projectContext {
			filteredTasks = append(filteredTasks, task)
		}
	}
	
	// Fallback: If no tasks match, use Development context tasks
	if len(filteredTasks) == 0 && projectContext != "Development" {
		log.Printf("INFO: No tasks found for context '%s', falling back to Development", projectContext)
		for _, task := range template.Tasks {
			taskContext := task.Context
			if taskContext == "" || taskContext == "Development" {
				filteredTasks = append(filteredTasks, task)
			}
		}
	}
	
	// If still no tasks, use all tasks
	if len(filteredTasks) == 0 {
		log.Printf("WARNING: No context-specific tasks found, using all tasks")
		filteredTasks = template.Tasks
	}

	log.Printf("INFO: Creating %d/%d tasks (context: %s)", len(filteredTasks), len(template.Tasks), projectContext)

	// Create tasks from template with feature assignment
	createdTasks := []models.Task{}
	taskMap := make(map[string]uint) // Map task names to IDs for dependency creation

	// Create a map of feature categories for quick lookup
	featureCategories := make(map[string][]models.Feature)
	for _, feature := range createdFeatures {
		featureCategories[feature.Category] = append(featureCategories[feature.Category], feature)
	}

	for i, templateTask := range filteredTasks {
		log.Printf("DEBUG: Creating task %d/%d: %s (Type: %s, Context: %s)", i+1, len(filteredTasks), templateTask.Name, templateTask.Type, templateTask.Context)
		
		// Find the appropriate feature for this task based on type matching
		var featureID uint
		if len(createdFeatures) > 0 {
			// Try exact match first
			if features, exists := featureCategories[templateTask.Type]; exists && len(features) > 0 {
				featureID = features[0].ID
				log.Printf("DEBUG: Exact match - Task type '%s' with feature category '%s' (ID: %d)", 
					templateTask.Type, features[0].Category, features[0].ID)
			} else {
				// Try case-insensitive match
				for _, feature := range createdFeatures {
					if strings.EqualFold(feature.Category, templateTask.Type) {
						featureID = feature.ID
						log.Printf("DEBUG: Case-insensitive match - Task type '%s' with feature category '%s' (ID: %d)", 
							templateTask.Type, feature.Category, feature.ID)
						break
					}
				}
				
				// If still no match, use the first feature
				if featureID == 0 {
					featureID = createdFeatures[0].ID
					log.Printf("DEBUG: No match found, assigning task to first feature (ID: %d)", featureID)
				}
			}
		} else {
			log.Printf("WARNING: No features available to assign task to")
		}

		task := models.Task{
			TaskName:    templateTask.Name,
			Description: templateTask.Description,
			TaskType:    templateTask.Type,
			FeatureID:   featureID,
		}

		if err := h.taskRepo.Create(&task); err != nil {
			log.Printf("ERROR: Failed to create task %s: %v", templateTask.Name, err)
			continue
		}
		
		log.Printf("DEBUG: Successfully created task with ID: %d", task.ID)
		createdTasks = append(createdTasks, task)
		
		// Store task ID by name for dependency creation
		taskMap[templateTask.Name] = task.ID
	}
	
	log.Printf("INFO: Created %d/%d tasks successfully", len(createdTasks), len(filteredTasks))

	// Create dependencies if we have a dependency repository
	createdDependencies := 0
	if len(template.Dependencies) > 0 && h.db != nil {
		dependencyService := services.NewDependencyService(repositories.NewDependencyRepository(h.db))

		for _, dep := range template.Dependencies {
			// Create a simple dependency record
			dependency := models.Dependency{
				Description: fmt.Sprintf("Template dependency: %s", dep),
				ParentType:  models.EntityTypeFeature,
				ChildType:   models.EntityTypeFeature,
			}
			
			// Try to find matching features
			if len(createdFeatures) > 0 {
				dependency.ParentID = createdFeatures[0].ID
				
				if len(createdFeatures) > 1 {
					dependency.ChildID = createdFeatures[1].ID
				} else {
					dependency.ChildID = createdFeatures[0].ID
				}
				
				if err := dependencyService.CreateDependency(&dependency); err != nil {
					log.Printf("ERROR: Failed to create dependency: %v", err)
					continue
				}
				
				createdDependencies++
			}
		}
		
		log.Printf("INFO: Created %d dependencies", createdDependencies)
	}

	log.Printf("INFO: Successfully applied template %s to project %d: %d features, %d tasks",
		template.Name, project.ID, len(createdFeatures), len(createdTasks))

	// Generate per-project markdown file
	projectsDir := filepath.Join(h.dataPath, "projects")
	if err := GenerateProjectMarkdown(project, template, createdFeatures, createdTasks, createdDependencies, projectsDir); err != nil {
		log.Printf("WARNING: Failed to generate project markdown: %v", err)
	}

	return nil
}
