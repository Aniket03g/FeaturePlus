package repositories

import (
	"github.com/FeaturePlus/backend/models"
	"gorm.io/gorm"
)

type CommentRepository struct {
	db *gorm.DB
}

func NewCommentRepository(db *gorm.DB) *CommentRepository {
	return &CommentRepository{db: db}
}

func (r *CommentRepository) Create(comment *models.Comment) error {
	return r.db.Create(comment).Error
}

func (r *CommentRepository) GetByID(id uint) (*models.Comment, error) {
	var comment models.Comment
	err := r.db.Preload("User").Preload("Task").Preload("Attachment").First(&comment, id).Error
	return &comment, err
}

func (r *CommentRepository) GetByTaskID(taskID uint) ([]models.Comment, error) {
	var comments []models.Comment
	err := r.db.Where("task_id = ?", taskID).
		Preload("User").
		Preload("Task").
		Preload("Attachment").
		Order("created_at DESC").
		Find(&comments).Error
	return comments, err
}

func (r *CommentRepository) GetByAttachmentID(attachmentID uint) ([]models.Comment, error) {
	var comments []models.Comment
	err := r.db.Where("attachment_id = ?", attachmentID).
		Preload("User").
		Preload("Task").
		Order("created_at DESC").
		Find(&comments).Error
	return comments, err
}

func (r *CommentRepository) Update(comment *models.Comment) error {
	return r.db.Save(comment).Error
}

func (r *CommentRepository) Delete(id uint) error {
	return r.db.Delete(&models.Comment{}, id).Error
}
