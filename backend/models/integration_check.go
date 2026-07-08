package models

import (
	"time"

	"gorm.io/gorm"
)

// IntegrationCheck records the outcome of a trusted integration run for a pull
// request — the privileged job that built/tested the collaborator's branch
// against the real dependency. Only the redacted summary is stored; raw output
// and internals never reach this record.
type IntegrationCheck struct {
	ID            uint           `gorm:"primaryKey" json:"id"`
	PullRequestID uint           `gorm:"not null;index" json:"pull_request_id"`
	Passed        bool           `gorm:"not null" json:"passed"`
	Summary       string         `gorm:"type:text" json:"summary"` // redacted
	CommitHash    string         `gorm:"type:varchar(64)" json:"commit_hash"`
	CreatedAt     time.Time      `json:"created_at"`
	UpdatedAt     time.Time      `json:"updated_at"`
	DeletedAt     gorm.DeletedAt `gorm:"index" json:"-"`
}

// TableName pins the table name.
func (IntegrationCheck) TableName() string {
	return "integration_checks"
}
