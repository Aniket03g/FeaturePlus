package repositories

import (
	"FeaturePlus/models"

	"gorm.io/gorm"
)

type TaskRepository interface {
	Create(task *models.Task) error
	Update(task *models.Task) error
	Delete(taskID uint) error
	GetByID(taskID uint) (*models.Task, error)
	GetByFeatureID(featureID uint) ([]models.Task, error)
	GetBySubFeatureID(subFeatureID uint) ([]models.Task, error)
}

type taskRepository struct {
	db *gorm.DB
}

func NewTaskRepository(db *gorm.DB) TaskRepository {
	return &taskRepository{db}
}

func (r *taskRepository) Create(task *models.Task) error {
	return r.db.Create(task).Error
}

func (r *taskRepository) Update(task *models.Task) error {
	return r.db.Save(task).Error
}

func (r *taskRepository) Delete(taskID uint) error {
	return r.db.Unscoped().Delete(&models.Task{}, taskID).Error
}

func (r *taskRepository) GetByID(taskID uint) (*models.Task, error) {
	var task models.Task
	err := r.db.Unscoped().First(&task, taskID).Error
	return &task, err
}

func (r *taskRepository) GetByFeatureID(featureID uint) ([]models.Task, error) {
	var tasks []models.Task
	err := r.db.Unscoped().Where("feature_id = ?", featureID).Find(&tasks).Error
	return tasks, err
}

func (r *taskRepository) GetBySubFeatureID(subFeatureID uint) ([]models.Task, error) {
	var tasks []models.Task
	err := r.db.Unscoped().Where("sub_feature_id = ?", subFeatureID).Find(&tasks).Error
	return tasks, err
}
