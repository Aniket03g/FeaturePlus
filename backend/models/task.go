package models

import "gorm.io/gorm"

type Task struct {
	gorm.Model
	TaskType      string           `json:"task_type" binding:"required"`
	TaskName      string           `json:"task_name" binding:"required"`
	Description   string           `json:"description"`
	FeatureID     uint             `json:"feature_id"`
	SubFeatureID  uint             `json:"sub_feature_id"`
	CreatedByUser uint             `json:"created_by_user"`
	Attachments   []TaskAttachment `json:"attachments" gorm:"foreignKey:TaskID"`
}
