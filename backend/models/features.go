package models

import (
	"time"
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
	ID          int             `gorm:"primaryKey" json:"id"`
	ProjectID   int             `gorm:"not null;index" json:"project_id"`
	Title       string          `gorm:"size:255;not null" json:"title"`
	Description string          `gorm:"type:text" json:"description"`
	Status      FeatureStatus   `gorm:"type:varchar(20);not null" json:"status"`
	Priority    FeaturePriority `gorm:"type:varchar(20);not null" json:"priority"`
	AssigneeID  int             `gorm:"not null" json:"assignee_id"`
	CreatedAt   time.Time       `json:"created_at"`
	UpdatedAt   time.Time       `json:"updated_at"`

	// Associations
	Project  Project `gorm:"foreignKey:ProjectID" json:"-"`
	Assignee User    `gorm:"foreignKey:AssigneeID" json:"assignee"`
}
