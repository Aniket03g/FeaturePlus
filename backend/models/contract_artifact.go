package models

import (
	"time"

	"gorm.io/gorm"
)

// ContractArtifact is a persisted, versioned contract for one source file.
//
// Each artifact is tagged with the commit hash it was generated from so drift
// against the real source can be detected (a contract must be regenerated when
// its source moves ahead, or it silently goes stale). The same file may have
// many artifacts over time, one per commit it was extracted at.
type ContractArtifact struct {
	ID        uint   `gorm:"primaryKey" json:"id"`
	ProjectID int    `gorm:"not null;index" json:"project_id"`
	// FeatureID is the dependency feature that owns the source file — the key a
	// collaborator's dependency resolves through.
	FeatureID uint `gorm:"not null;uniqueIndex:idx_artifact_file,priority:1" json:"feature_id"`
	// FilePath is the real source file this contract was extracted from.
	FilePath string `gorm:"type:varchar(500);not null;uniqueIndex:idx_artifact_file,priority:2" json:"file_path"`
	// CommitHash is the git ref the source was at when extracted. Part of the
	// uniqueness key so re-extracting at the same commit updates in place.
	CommitHash string `gorm:"type:varchar(64);not null;uniqueIndex:idx_artifact_file,priority:3" json:"commit_hash"`
	Language   string `gorm:"type:varchar(20);not null;default:'go'" json:"language"`
	// Contract is the stripped public-shape text served to contract-scope users.
	Contract string `gorm:"type:text" json:"contract"`
	// BehaviorNote is an optional AI-written note appended by the behavior-notes
	// step; empty until generated.
	BehaviorNote string `gorm:"type:text" json:"behavior_note"`

	CreatedAt time.Time      `json:"created_at"`
	UpdatedAt time.Time      `json:"updated_at"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`
}

// TableName pins the table name.
func (ContractArtifact) TableName() string {
	return "contract_artifacts"
}
