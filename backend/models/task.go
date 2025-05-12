package models

import "gorm.io/gorm"

type Task struct {
	gorm.Model
	TaskType      string `json:"task_type" binding:"required"`
	TaskName      string `json:"task_name" binding:"required"`
	Description   string `json:"description"`
	FeatureID     uint   `json:"feature_id" binding:"required`
	CreatedByUser uint   `json:"created_by_user" binding:"required"`
}
