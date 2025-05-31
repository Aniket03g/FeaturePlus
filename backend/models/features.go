package models

import (
	"time"

	"gorm.io/gorm"
)

type FeatureStatus string
type FeaturePriority string

const (
	StatusTodo       FeatureStatus = "todo"
	StatusInProgress FeatureStatus = "in_progress"
	StatusDone       FeatureStatus = "done"

	PriorityLow    FeaturePriority = "low"
	PriorityMedium FeaturePriority = "medium"
	PriorityHigh   FeaturePriority = "high"
)

type Feature struct {
	ID              uint            `gorm:"primaryKey" json:"id"`
	ProjectID       int             `gorm:"not null;index" json:"project_id"`
	ParentFeatureID *uint           `gorm:"index" json:"parent_feature_id"`
	Title           string          `gorm:"type:varchar(255);not null" json:"title"`
	Description     string          `gorm:"type:text" json:"description"`
	Status          FeatureStatus   `gorm:"type:varchar(50);not null;default:'todo'" json:"status"`
	Priority        FeaturePriority `gorm:"type:varchar(50);not null;default:'medium'" json:"priority"`
	AssigneeID      uint            `gorm:"default:0" json:"assignee_id"`
	CreatedAt       time.Time       `json:"created_at"`
	UpdatedAt       time.Time       `json:"updated_at"`
	DeletedAt       gorm.DeletedAt  `gorm:"index" json:"-"`
	Category        string          `gorm:"type:varchar(100)" json:"category"`

	// Associations
	Project       Project      `gorm:"foreignKey:ProjectID" json:"-"`
	ParentFeature *Feature     `gorm:"foreignKey:ParentFeatureID" json:"parent_feature,omitempty"`
	Assignee      User         `gorm:"foreignKey:AssigneeID" json:"assignee"`
	Tags          []FeatureTag `json:"tags"`
}
