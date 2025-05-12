package handlers

import (
	"FeaturePlus/models"
	"FeaturePlus/repositories"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
)

type TaskHandler struct {
	taskRepo repositories.TaskRepository
}

func NewTaskHandler(taskRepo repositories.TaskRepository) *TaskHandler {
	return &TaskHandler{taskRepo}
}

// CreateTask creates a standalone task not tied to a specific feature
func (h *TaskHandler) CreateTask(c *gin.Context) {
	var task models.Task
	if err := c.ShouldBindJSON(&task); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if userID, exists := c.Get("user_id"); exists {
		task.CreatedByUser = userID.(uint)
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

	var task models.Task
	if err := c.ShouldBindJSON(&task); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	task.FeatureID = uint(featureID)

	if userID, exists := c.Get("user_id"); exists {
		task.CreatedByUser = userID.(uint)
	}

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
