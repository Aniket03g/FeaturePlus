package handlers

import (
	"net/http"
	"strconv"

	"github.com/FeaturePlus/backend/models"
	"github.com/FeaturePlus/backend/repositories"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type TaskHandler struct {
	taskRepo repositories.TaskRepository
	DB       *gorm.DB
}

func NewTaskHandler(taskRepo repositories.TaskRepository, db *gorm.DB) *TaskHandler {
	return &TaskHandler{taskRepo: taskRepo, DB: db}
}

// CreateTask creates a standalone task not tied to a specific feature
func (h *TaskHandler) CreateTask(c *gin.Context) {
	var task models.Task
	if err := c.ShouldBindJSON(&task); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if task.TaskType == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "task_type is required"})
		return
	}

	userID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}
	task.CreatedByUser = userID.(uint)

	// Strict validation for task_type against project config
	var projectID int
	if task.FeatureID != 0 {
		// Fetch the feature to get the project ID
		featureRepo := repositories.NewFeatureRepository(h.DB)
		feature, err := featureRepo.GetFeatureByID(int(task.FeatureID))
		if err == nil {
			projectID = feature.ProjectID
		}
	}
	if projectID != 0 {
		projectRepo := repositories.NewProjectRepository(h.DB)
		project, err := projectRepo.GetProjectByID(projectID)
		if err == nil {
			types, ok := project.Config["task_types"].([]interface{})
			if ok {
				validType := false
				for _, t := range types {
					if tStr, ok := t.(string); ok && tStr == task.TaskType {
						validType = true
						break
					}
				}
				if !validType {
					c.JSON(http.StatusBadRequest, gin.H{"error": "task_type must be one of the allowed task_types values in project config"})
					return
				}
			}
		}
	}

	if err := h.taskRepo.Create(&task); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Could not create task"})
		return
	}

	c.JSON(http.StatusCreated, task)
}

// UpdateTask updates a standalone task by JSON input
func (h *TaskHandler) UpdateTask(c *gin.Context) {
	var task models.Task
	if err := c.ShouldBindJSON(&task); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := h.taskRepo.Update(&task); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Could not update task"})
		return
	}

	c.JSON(http.StatusOK, task)
}

// DeleteTask deletes a standalone task by ID
func (h *TaskHandler) DeleteTask(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	if err := h.taskRepo.Delete(uint(id)); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Could not delete task"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "Task deleted"})
}

// GetTask retrieves a task by its ID
func (h *TaskHandler) GetTask(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	task, err := h.taskRepo.GetByID(uint(id))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Task not found"})
		return
	}
	c.JSON(http.StatusOK, task)
}

// GetTasksByFeature lists all tasks under a specific feature
func (h *TaskHandler) GetTasksByFeature(c *gin.Context) {
	featureID, _ := strconv.Atoi(c.Param("id"))
	tasks, err := h.taskRepo.GetByFeatureID(uint(featureID))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Could not fetch tasks"})
		return
	}
	c.JSON(http.StatusOK, tasks)
}

// CreateTaskForFeature creates a task and links it to a feature
func (h *TaskHandler) CreateTaskForFeature(c *gin.Context) {
	featureID, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid feature ID"})
		return
	}

	// Get user ID from context first
	userID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	var task models.Task
	if err := c.ShouldBindJSON(&task); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	task.FeatureID = uint(featureID)
	task.CreatedByUser = userID.(uint)

	if err := h.taskRepo.Create(&task); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Could not create task"})
		return
	}

	c.JSON(http.StatusCreated, task)
}

// UpdateTaskForFeature updates a task that belongs to a feature
func (h *TaskHandler) UpdateTaskForFeature(c *gin.Context) {
	taskID, err := strconv.Atoi(c.Param("task_id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid task ID"})
		return
	}

	// Get feature ID
	featureID, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid feature ID"})
		return
	}

	var task models.Task
	if err := c.ShouldBindJSON(&task); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	task.ID = uint(taskID)
	task.FeatureID = uint(featureID)

	if err := h.taskRepo.Update(&task); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Could not update task"})
		return
	}

	c.JSON(http.StatusOK, task)
}

// DeleteTaskForFeature deletes a task under a feature by ID
func (h *TaskHandler) DeleteTaskForFeature(c *gin.Context) {
	taskID, err := strconv.Atoi(c.Param("task_id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid task ID"})
		return
	}

	if err := h.taskRepo.Delete(uint(taskID)); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Could not delete task"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Task deleted"})
}

// GetTasksBySubFeature lists all tasks under a specific sub-feature
func (h *TaskHandler) GetTasksBySubFeature(c *gin.Context) {
	subFeatureID, _ := strconv.Atoi(c.Param("id"))
	tasks, err := h.taskRepo.GetBySubFeatureID(uint(subFeatureID))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Could not fetch tasks"})
		return
	}
	c.JSON(http.StatusOK, tasks)
}

// CreateTaskForSubFeature creates a task and links it to a sub-feature
func (h *TaskHandler) CreateTaskForSubFeature(c *gin.Context) {
	subFeatureID, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid sub-feature ID"})
		return
	}

	// Get user ID from context first
	userID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	var task models.Task
	if err := c.ShouldBindJSON(&task); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	task.SubFeatureID = uint(subFeatureID)
	task.CreatedByUser = userID.(uint)

	if err := h.taskRepo.Create(&task); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Could not create task"})
		return
	}

	c.JSON(http.StatusCreated, task)
}

// UpdateTaskForSubFeature updates a task that belongs to a sub-feature
func (h *TaskHandler) UpdateTaskForSubFeature(c *gin.Context) {
	taskID, err := strconv.Atoi(c.Param("task_id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid task ID"})
		return
	}

	// Get sub-feature ID
	subFeatureID, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid sub-feature ID"})
		return
	}

	var task models.Task
	if err := c.ShouldBindJSON(&task); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	task.ID = uint(taskID)
	task.SubFeatureID = uint(subFeatureID)

	if err := h.taskRepo.Update(&task); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Could not update task"})
		return
	}

	c.JSON(http.StatusOK, task)
}

// DeleteTaskForSubFeature deletes a task under a sub-feature by ID
func (h *TaskHandler) DeleteTaskForSubFeature(c *gin.Context) {
	taskID, err := strconv.Atoi(c.Param("task_id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid task ID"})
		return
	}

	if err := h.taskRepo.Delete(uint(taskID)); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Could not delete task"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Task deleted"})
}

// GetAllTasks retrieves all tasks with their feature title
func (h *TaskHandler) GetAllTasks(c *gin.Context) {
	tasks, err := h.taskRepo.GetAllWithFeatureTitle()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Could not fetch tasks"})
		return
	}
	c.JSON(http.StatusOK, tasks)
}

// GetTasksByProject retrieves all tasks for a given project ID
func (h *TaskHandler) GetTasksByProject(c *gin.Context) {
	projectID, err := strconv.Atoi(c.Param("project_id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid project ID"})
		return
	}

	tasks, err := h.taskRepo.GetByProjectID(uint(projectID))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Could not fetch tasks for project"})
		return
	}

	c.JSON(http.StatusOK, tasks)
}
