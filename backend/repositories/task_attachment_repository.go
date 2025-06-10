package repositories

import (
	"github.com/FeaturePlus/backend/models"
	"github.com/jilio/sqlitefs"
	"gorm.io/gorm"
)

type TaskAttachmentRepository interface {
	Create(attachment *models.TaskAttachment) error
	Delete(attachmentID uint) error
	GetByTaskID(taskID uint) ([]models.TaskAttachment, error)
	GetByID(attachmentID uint) (*models.TaskAttachment, error)
}

type taskAttachmentRepository struct {
	db       *gorm.DB
	sqliteFS *sqlitefs.SQLiteFS
}

func NewTaskAttachmentRepository(db *gorm.DB, sqliteFS *sqlitefs.SQLiteFS) TaskAttachmentRepository {
	return &taskAttachmentRepository{db: db, sqliteFS: sqliteFS}
}

func (r *taskAttachmentRepository) Create(attachment *models.TaskAttachment) error {
	return r.db.Create(attachment).Error
}

func (r *taskAttachmentRepository) Delete(attachmentID uint) error {
	attachment, err := r.GetByID(attachmentID)
	if err != nil {
		return err
	}

	// Delete file from SQLiteFS
	writer := r.sqliteFS.NewWriter(attachment.FileName)
	if err := writer.Close(); err != nil {
		return err
	}

	// Delete record from database
	return r.db.Delete(&models.TaskAttachment{}, attachmentID).Error
}

func (r *taskAttachmentRepository) GetByTaskID(taskID uint) ([]models.TaskAttachment, error) {
	var attachments []models.TaskAttachment
	err := r.db.Where("task_id = ?", taskID).Find(&attachments).Error
	return attachments, err
}

func (r *taskAttachmentRepository) GetByID(attachmentID uint) (*models.TaskAttachment, error) {
	var attachment models.TaskAttachment
	err := r.db.Preload("Task").First(&attachment, attachmentID).Error
	if err != nil {
		return nil, err
	}
	return &attachment, nil
}
