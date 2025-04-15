package models

import (
	"time"
)

type Project struct {
	ID          int       `gorm:"primaryKey" json:"id"`
	Name        string    `gorm:"size:255;not null" json:"name"`
	Description string    `gorm:"type:text" json:"description"`
	OwnerID     int       `gorm:"not null;index" json:"owner_id"` // Foreign key
	CreatedAt   time.Time `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt   time.Time `gorm:"autoUpdateTime" json:"updated_at"`

	// Association to User model (already in your models package)
	Owner User `gorm:"foreignKey:OwnerID" json:"owner"`

	Features []Feature `gorm:"foreignKey:ProjectID" json:"features,omitempty"`
}
