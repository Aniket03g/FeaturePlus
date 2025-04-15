package models

import (
	"time"
)

type User struct {
	ID        int       `gorm:"primaryKey" json:"id"` // ✅ Changed to int
	Email     string    `gorm:"unique;not null" json:"email"`
	Username  string    `gorm:"unique;not null" json:"username"`
	Password  string    `gorm:"not null" json:"-"`
	Role      string    `gorm:"not null" json:"role"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
	// Add project association
	Projects []Project `gorm:"foreignKey:OwnerID" json:"projects,omitempty"`
}
