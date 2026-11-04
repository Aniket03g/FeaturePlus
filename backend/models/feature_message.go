package models

import "time"

// FeatureMessage is a message left on a feature: a question, a remark, a
// heads-up. Anyone on the project may write one; only its author changes or
// removes it.
//
// It is its own table rather than a task comment without a task: comments
// point at their task, and a feature's messages point at the feature.
// ProjectID is kept beside FeatureID so the project's messages can be listed
// without going through its features.
type FeatureMessage struct {
	ID        uint   `gorm:"primaryKey"`
	ProjectID int    `gorm:"not null;index"`
	FeatureID uint   `gorm:"not null;index"`
	UserID    int    `gorm:"not null"`
	Content   string `gorm:"type:text;not null"`
	CreatedAt time.Time
	UpdatedAt time.Time
}
