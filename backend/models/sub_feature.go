package models

import (
	"time"
)

type SubFeature struct {
	ID          int       `json:"id" gorm:"primaryKey"`
	FeatureID   int       `json:"feature_id"`
	Title       string    `json:"title"`
	Description string    `json:"description"`
	Status      string    `json:"status"`
	Priority    string    `json:"priority"`
	AssigneeID  int       `json:"assignee_id"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}
