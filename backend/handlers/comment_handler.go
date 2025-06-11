package handlers

import (
	"net/http"
	"strconv"

	"github.com/FeaturePlus/backend/models"
	"github.com/FeaturePlus/backend/repositories"
	"github.com/gin-gonic/gin"
)

type CommentHandler struct {
	commentRepo    *repositories.CommentRepository
	attachmentRepo repositories.TaskAttachmentRepository
}

func NewCommentHandler(commentRepo *repositories.CommentRepository, attachmentRepo repositories.TaskAttachmentRepository) *CommentHandler {
	return &CommentHandler{
		commentRepo:    commentRepo,
		attachmentRepo: attachmentRepo,
	}
}

// CreateComment creates a new comment for a task
func (h *CommentHandler) CreateComment(c *gin.Context) {
	var comment models.Comment
	if err := c.ShouldBindJSON(&comment); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Get user ID from context
	userID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}
	comment.UserID = userID.(uint)

	// Validate task ID from URL
	taskID, err := strconv.ParseUint(c.Param("task_id"), 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid task ID"})
		return
	}
	comment.TaskID = uint(taskID)

	// If attachment_id is provided, validate it belongs to the task
	if comment.AttachmentID != nil {
		attachment, err := h.attachmentRepo.GetByID(*comment.AttachmentID)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid attachment ID"})
			return
		}
		if attachment.TaskID != comment.TaskID {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Attachment does not belong to this task"})
			return
		}
	}

	// Create the comment
	if err := h.commentRepo.Create(&comment); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Could not create comment"})
		return
	}

	// Fetch the complete comment with relationships
	createdComment, err := h.commentRepo.GetByID(comment.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Could not fetch created comment"})
		return
	}

	c.JSON(http.StatusCreated, createdComment)
}

// GetTaskComments retrieves all comments for a task
func (h *CommentHandler) GetTaskComments(c *gin.Context) {
	taskID, err := strconv.ParseUint(c.Param("task_id"), 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid task ID"})
		return
	}

	comments, err := h.commentRepo.GetByTaskID(uint(taskID))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Could not fetch comments"})
		return
	}

	c.JSON(http.StatusOK, comments)
}

// GetAttachmentComments retrieves all comments for an attachment
func (h *CommentHandler) GetAttachmentComments(c *gin.Context) {
	attachmentID, err := strconv.ParseUint(c.Param("attachment_id"), 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid attachment ID"})
		return
	}

	comments, err := h.commentRepo.GetByAttachmentID(uint(attachmentID))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Could not fetch comments"})
		return
	}

	c.JSON(http.StatusOK, comments)
}

// UpdateComment updates an existing comment
func (h *CommentHandler) UpdateComment(c *gin.Context) {
	commentID, err := strconv.ParseUint(c.Param("comment_id"), 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid comment ID"})
		return
	}

	// Get the existing comment
	existingComment, err := h.commentRepo.GetByID(uint(commentID))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Comment not found"})
		return
	}

	// Get user ID from context
	userID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	// Verify ownership
	if existingComment.UserID != userID.(uint) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Not authorized to update this comment"})
		return
	}

	// Bind the update data
	var updateData struct {
		Content string `json:"content"`
	}
	if err := c.ShouldBindJSON(&updateData); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Update only the content
	existingComment.Content = updateData.Content

	if err := h.commentRepo.Update(existingComment); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Could not update comment"})
		return
	}

	c.JSON(http.StatusOK, existingComment)
}

// DeleteComment deletes an existing comment
func (h *CommentHandler) DeleteComment(c *gin.Context) {
	commentID, err := strconv.ParseUint(c.Param("comment_id"), 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid comment ID"})
		return
	}

	// Get the existing comment
	existingComment, err := h.commentRepo.GetByID(uint(commentID))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Comment not found"})
		return
	}

	// Get user ID from context
	userID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	// Verify ownership
	if existingComment.UserID != userID.(uint) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Not authorized to delete this comment"})
		return
	}

	if err := h.commentRepo.Delete(uint(commentID)); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Could not delete comment"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Comment deleted successfully"})
}
