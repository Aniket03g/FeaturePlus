package repositories

import (
	"github.com/FeaturePlus/backend/models"

	"gorm.io/gorm"
)

type TaskRepository interface {
	Create(task *models.Task) error
	Update(task *models.Task) error
	Delete(taskID uint) error
	GetByID(taskID uint) (*models.Task, error)
	GetByFeatureID(featureID uint) ([]models.Task, error)
	GetBySubFeatureID(subFeatureID uint) ([]models.Task, error)
	GetAllWithFeatureTitle() ([]map[string]interface{}, error)
	GetByProjectID(projectID uint) ([]map[string]interface{}, error)
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

func (r *taskRepository) GetAllWithFeatureTitle() ([]map[string]interface{}, error) {
	var results []map[string]interface{}
	err := r.db.Table("tasks").
		Select("tasks.id, tasks.task_type, tasks.task_name, tasks.description, tasks.feature_id, features.title as feature_title").
		Joins("LEFT JOIN features ON tasks.feature_id = features.id").
		Scan(&results).Error
	return results, err
}

func (r *taskRepository) GetByProjectID(projectID uint) ([]map[string]interface{}, error) {
	var results []map[string]interface{}
	err := r.db.Table("tasks").
		Select("tasks.id, tasks.task_type, tasks.task_name, tasks.description, tasks.feature_id, features.title as feature_title").
		Joins("JOIN features ON tasks.feature_id = features.id").
		Where("features.project_id = ?", projectID).
		Scan(&results).Error
	return results, err
}
