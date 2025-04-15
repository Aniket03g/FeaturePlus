package repositories

import (
	"FeaturePlus/models"

	"gorm.io/gorm"
)

type ProjectRepository struct {
	db *gorm.DB
}

func NewProjectRepository(db *gorm.DB) *ProjectRepository {
	return &ProjectRepository{db: db}
}

// CreateProject creates a new project in database
func (r *ProjectRepository) CreateProject(project *models.Project) error {
	return r.db.Create(project).Error
}

// GetProjectByID gets a single project by ID with owner details
func (r *ProjectRepository) GetProjectByID(id int) (*models.Project, error) {
	var project models.Project
	if err := r.db.Preload("Owner").First(&project, id).Error; err != nil {
		return nil, err
	}
	return &project, nil
}

// GetAllProjects gets all projects with owner details
func (r *ProjectRepository) GetAllProjects() ([]models.Project, error) {
	var projects []models.Project
	if err := r.db.Preload("Owner").Find(&projects).Error; err != nil {
		return nil, err
	}
	return projects, nil
}

// UpdateProject updates an existing project
func (r *ProjectRepository) UpdateProject(project *models.Project) error {
	return r.db.Save(project).Error
}

// DeleteProject deletes a project by ID
func (r *ProjectRepository) DeleteProject(id int) error {
	return r.db.Delete(&models.Project{}, id).Error
}

// GetProjectsByUser gets all projects for a specific user
func (r *ProjectRepository) GetProjectsByUser(userID int) ([]models.Project, error) {
	var projects []models.Project
	if err := r.db.Where("owner_id = ?", userID).Preload("Owner").Find(&projects).Error; err != nil {
		return nil, err
	}
	return projects, nil
}
