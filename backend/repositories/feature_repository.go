package repositories

import (
	"FeaturePlus/models"

	"gorm.io/gorm"
)

type FeatureRepository struct {
	db *gorm.DB
}

func NewFeatureRepository(db *gorm.DB) *FeatureRepository {
	return &FeatureRepository{db: db}
}

func (r *FeatureRepository) CreateFeature(feature *models.Feature) error {
	return r.db.Create(feature).Error
}

func (r *FeatureRepository) GetFeatureByID(id int) (*models.Feature, error) {
	var feature models.Feature
	if err := r.db.Preload("Project").Preload("Assignee").First(&feature, id).Error; err != nil {
		return nil, err
	}
	return &feature, nil
}

func (r *FeatureRepository) GetFeaturesByProject(projectID int) ([]models.Feature, error) {
	var features []models.Feature
	if err := r.db.Where("project_id = ?", projectID).Preload("Assignee").Find(&features).Error; err != nil {
		return nil, err
	}
	return features, nil
}

func (r *FeatureRepository) UpdateFeature(feature *models.Feature) error {
	return r.db.Save(feature).Error
}

func (r *FeatureRepository) DeleteFeature(id int) error {
	return r.db.Delete(&models.Feature{}, id).Error
}
