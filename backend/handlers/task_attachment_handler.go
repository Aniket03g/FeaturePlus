package handlers

import (
	"fmt"
	"io"
	"net/http"
	"strconv"

	"github.com/FeaturePlus/backend/models"
	"github.com/FeaturePlus/backend/repositories"
	"github.com/gin-gonic/gin"
	"github.com/jilio/sqlitefs"
)

type TaskAttachmentHandler struct {
	attachmentRepo repositories.TaskAttachmentRepository
	sqliteFS       *sqlitefs.SQLiteFS
}

func NewTaskAttachmentHandler(repo repositories.TaskAttachmentRepository, sqliteFS *sqlitefs.SQLiteFS) *TaskAttachmentHandler {
	return &TaskAttachmentHandler{
		attachmentRepo: repo,
		sqliteFS:       sqliteFS,
	}
}

func (h *TaskAttachmentHandler) UploadAttachment(c *gin.Context) {
	taskID, err := strconv.ParseUint(c.Param("task_id"), 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("Invalid task ID: %v", err)})
		return
	}

	file, header, err := c.Request.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("Failed to get file: %v", err)})
		return
	}
	defer file.Close()

	// Create a unique filename
	filename := fmt.Sprintf("task_%d_%s", taskID, header.Filename)

	// Create writer in SQLiteFS
	writer := h.sqliteFS.NewWriter(filename)
	defer writer.Close()

	// Copy file to SQLiteFS
	if _, err := io.Copy(writer, file); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Failed to save file: %v", err)})
		return
	}

	// Create attachment record
	attachment := &models.TaskAttachment{
		TaskID:   uint(taskID),
		FileName: filename,
		FileSize: header.Size,
		MimeType: header.Header.Get("Content-Type"),
	}

	if err := h.attachmentRepo.Create(attachment); err != nil {
		// Try to delete the file since we couldn't create the record
		writer := h.sqliteFS.NewWriter(filename)
		writer.Close()
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Failed to save attachment record: %v", err)})
		return
	}

	// Return the created attachment with its ID
	c.JSON(http.StatusCreated, attachment)
}

func (h *TaskAttachmentHandler) GetTaskAttachments(c *gin.Context) {
	taskID, err := strconv.ParseUint(c.Param("task_id"), 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid task ID"})
		return
	}

	attachments, err := h.attachmentRepo.GetByTaskID(uint(taskID))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch attachments"})
		return
	}

	c.JSON(http.StatusOK, attachments)
}

func (h *TaskAttachmentHandler) DownloadAttachment(c *gin.Context) {
	filename := c.Param("filename")

	file, err := h.sqliteFS.Open(filename)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "File not found"})
		return
	}
	defer file.Close()

	// Set appropriate headers
	c.Header("Content-Description", "File Transfer")
	c.Header("Content-Transfer-Encoding", "binary")
	c.Header("Content-Disposition", fmt.Sprintf("attachment; filename=%s", filename))

	// Stream the file to response
	c.DataFromReader(http.StatusOK, -1, "application/octet-stream", file, nil)
}

func (h *TaskAttachmentHandler) DeleteAttachment(c *gin.Context) {
	attachmentID, err := strconv.ParseUint(c.Param("attachmentId"), 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("Invalid attachment ID: %v", err)})
		return
	}

	// Log the request details
	fmt.Printf("Deleting attachment: ID=%d\n", attachmentID)

	// Get the attachment first to get the filename
	attachment, err := h.attachmentRepo.GetByID(uint(attachmentID))
	if err != nil {
		fmt.Printf("Error getting attachment: %v\n", err)
		c.JSON(http.StatusNotFound, gin.H{"error": fmt.Sprintf("Attachment not found: %v", err)})
		return
	}

	fmt.Printf("Found attachment: ID=%d, TaskID=%d, FileName=%s\n", attachment.ID, attachment.TaskID, attachment.FileName)

	// Delete the file from SQLiteFS
	writer := h.sqliteFS.NewWriter(attachment.FileName)
	if err := writer.Close(); err != nil {
		fmt.Printf("Error deleting file: %v\n", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Failed to delete file: %v", err)})
		return
	}

	// Delete the record from database
	if err := h.attachmentRepo.Delete(uint(attachmentID)); err != nil {
		fmt.Printf("Error deleting record: %v\n", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Failed to delete attachment record: %v", err)})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Attachment deleted successfully"})
}
