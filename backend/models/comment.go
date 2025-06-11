package models

import (
	"time"
)

type Comment struct {
	ID           uint      `json:"id" gorm:"primarykey"`
	TaskID       uint      `json:"task_id"`
	AttachmentID *uint     `json:"attachment_id,omitempty"` // Optional reference to an attachment
	UserID       uint      `json:"user_id"`
	Content      string    `json:"content" gorm:"type:text"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`

	// Relationships
	Task       Task            `json:"task" gorm:"foreignKey:TaskID"`
	Attachment *TaskAttachment `json:"attachment,omitempty" gorm:"foreignKey:AttachmentID"`
	User       User            `json:"user" gorm:"foreignKey:UserID"`
}
