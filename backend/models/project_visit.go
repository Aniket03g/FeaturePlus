package models

import "time"

// ProjectVisit is when someone last opened a project's working list, so the
// next visit can point out what changed since.
type ProjectVisit struct {
	UserID    uint      `gorm:"primaryKey;autoIncrement:false"`
	ProjectID int       `gorm:"primaryKey;autoIncrement:false;index"`
	SeenAt    time.Time `gorm:"not null"`
}
