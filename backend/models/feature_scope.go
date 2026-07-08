package models

import (
	"time"

	"gorm.io/gorm"
)

// FeatureAccessLevel is the tier of access a collaborator has to a feature.
//
// This is the central new primitive behind Scoped Onboarding: the project's
// access model is no longer all-or-nothing per project. Instead a collaborator
// is granted one of these levels per feature.
type FeatureAccessLevel string

const (
	// AccessOwner grants full source access to a feature's owned files.
	AccessOwner FeatureAccessLevel = "owner"
	// AccessContract grants contract-only access: stripped signatures/types,
	// never the real implementation. This is what a collaborator gets for the
	// dependencies of a feature they own.
	AccessContract FeatureAccessLevel = "contract"
	// AccessNone denies all access. Everything unrelated to an owned feature
	// resolves to this.
	AccessNone FeatureAccessLevel = "none"
)

// IsValid reports whether the access level is one of the known tiers.
func (a FeatureAccessLevel) IsValid() bool {
	switch a {
	case AccessOwner, AccessContract, AccessNone:
		return true
	default:
		return false
	}
}

// Rank orders access levels from most to least permissive so the effective
// access for a user can be resolved when multiple grants apply (owner wins
// over contract wins over none).
func (a FeatureAccessLevel) Rank() int {
	switch a {
	case AccessOwner:
		return 2
	case AccessContract:
		return 1
	default:
		return 0
	}
}

// FeatureScope is a per-feature access grant for one collaborator.
//
// A grant of AccessOwner on feature X means: this user sees X's owned files in
// full, X's dependencies as contracts only (derived from the dependency graph,
// not stored here), and nothing else. Grants are the signal the ACL middleware
// uses to decide what a collaborator may read.
type FeatureScope struct {
	ID          uint               `gorm:"primaryKey" json:"id"`
	ProjectID   int                `gorm:"not null;index" json:"project_id"`
	FeatureID   uint               `gorm:"not null;index:idx_scope_user_feature,unique" json:"feature_id"`
	UserID      int                `gorm:"not null;index:idx_scope_user_feature,unique" json:"user_id"`
	AccessLevel FeatureAccessLevel `gorm:"type:varchar(20);not null;default:'owner'" json:"access_level"`
	GrantedByID int                `gorm:"not null" json:"granted_by_id"` // project owner who granted this
	CreatedAt   time.Time          `json:"created_at"`
	UpdatedAt   time.Time          `json:"updated_at"`
	DeletedAt   gorm.DeletedAt     `gorm:"index" json:"-"`

	// Associations
	Feature   Feature `gorm:"foreignKey:FeatureID" json:"-"`
	User      User    `gorm:"foreignKey:UserID" json:"user,omitempty"`
	GrantedBy User    `gorm:"foreignKey:GrantedByID" json:"granted_by,omitempty"`
}

// TableName pins the table name so it reads clearly in the schema.
func (FeatureScope) TableName() string {
	return "feature_scopes"
}

// BeforeCreate validates the access level and prevents self-inconsistent grants.
func (s *FeatureScope) BeforeCreate(tx *gorm.DB) error {
	if s.AccessLevel == "" {
		s.AccessLevel = AccessOwner
	}
	if !s.AccessLevel.IsValid() {
		return gorm.ErrInvalidData
	}
	return nil
}
