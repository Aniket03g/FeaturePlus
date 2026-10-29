package models

import (
	"time"

	"gorm.io/gorm"
)

type FeatureStatus string
type FeaturePriority string

// MARKER:FEATURE_STATUS Feature status and priority constants
const (
	StatusTodo       FeatureStatus = "todo"
	StatusInProgress FeatureStatus = "in_progress"
	StatusDone       FeatureStatus = "done"

	PriorityLow    FeaturePriority = "low"
	PriorityMedium FeaturePriority = "medium"
	PriorityHigh   FeaturePriority = "high"
)

// MARKER:FEATURE_MODEL Feature model definition
type Feature struct {
	ID              uint   `gorm:"primaryKey" json:"id"`
	ProjectID       int    `gorm:"not null;index" json:"project_id"`
	ParentFeatureID *uint  `gorm:"index" json:"parent_feature_id"`
	ReleaseID       *uint  `gorm:"index" json:"release_id"` // Optional: feature can be planned for a release
	Title           string `gorm:"type:varchar(255);not null" json:"title"`
	Description     string `gorm:"type:text" json:"description"`
	// Notes is a second markdown box, for working notes beside the description.
	Notes      string          `gorm:"type:text;not null;default:''" json:"notes"`
	Category   string          `gorm:"type:varchar(50);not null;default:'general'" json:"category"`
	Status     FeatureStatus   `gorm:"type:varchar(50);not null;default:'todo'" json:"status"`
	Priority   FeaturePriority `gorm:"type:varchar(50);not null;default:'medium'" json:"priority"`
	AssigneeID uint            `gorm:"default:0" json:"assignee_id"`
	// Color marks a feature for the team in the working list: one of the
	// palette's names (red, orange, …) or empty for none. It is a working aid,
	// so it is left out of published versions and copies.
	Color string `gorm:"type:varchar(20);not null;default:''" json:"color"`
	// Position orders a feature among the others with the same parent, 1 first.
	// Features saved before it existed share 0 and fall back to their id.
	Position  int            `gorm:"not null;default:0;index" json:"position"`
	CreatedAt time.Time      `json:"created_at"`
	UpdatedAt time.Time      `json:"updated_at"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`

	// Associations
	Project       Project      `gorm:"foreignKey:ProjectID" json:"-"`
	ParentFeature *Feature     `gorm:"foreignKey:ParentFeatureID" json:"parent_feature,omitempty"`
	Release       *Release     `gorm:"foreignKey:ReleaseID" json:"release,omitempty"`
	Assignee      User         `gorm:"foreignKey:AssigneeID" json:"assignee"`
	Tags          []FeatureTag `json:"tags"`
}

// MaxFeatureDepth is the deepest level a feature can sit at: L0 to L3.
const MaxFeatureDepth = 3

// BeforeCreate puts a new feature at the bottom of its parent's list, unless
// it was given a place. Every way of adding features goes through here, so
// they all keep the order the same way.
func (f *Feature) BeforeCreate(tx *gorm.DB) error {
	if f.Position != 0 {
		return nil
	}
	f.Position = NextFeaturePosition(tx, f.ProjectID, f.ParentFeatureID)
	return nil
}

// NextFeaturePosition is the position after the last feature with this
// parent, nil being the top level.
func NextFeaturePosition(tx *gorm.DB, projectID int, parentID *uint) int {
	q := tx.Session(&gorm.Session{NewDB: true}).Model(&Feature{}).Where("project_id = ?", projectID)
	if parentID == nil {
		q = q.Where("parent_feature_id IS NULL")
	} else {
		q = q.Where("parent_feature_id = ?", *parentID)
	}
	var last int
	if err := q.Select("COALESCE(MAX(position), 0)").Scan(&last).Error; err != nil {
		return 0
	}
	return last + 1
}
