package models

import (
	"time"
)

type TaskAttachment struct {
	ID        uint      `json:"ID" gorm:"primarykey"`
	CreatedAt time.Time `json:"CreatedAt"`
	UpdatedAt time.Time `json:"UpdatedAt"`
	TaskID    uint      `json:"task_id"`
	FileName  string    `json:"file_name"`
	FileSize  int64     `json:"file_size"`
	MimeType  string    `json:"mime_type"`
	Task      Task      `json:"Task" gorm:"foreignKey:TaskID"`
}
