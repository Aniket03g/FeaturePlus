package models

import "time"

// ProjectRole is what someone may do in a project they have been added to.
type ProjectRole string

const (
	// RoleOwner can do everything, including sharing and deleting the project.
	// It is never stored on a ProjectMember row: the owner is Project.OwnerID,
	// so there is one place that says who owns a project, not two that can
	// disagree.
	RoleOwner ProjectRole = "owner"
	// RoleEditor can change the project's contents but not who it is shared with.
	RoleEditor ProjectRole = "editor"
	// RoleViewer can look at everything and change nothing.
	RoleViewer ProjectRole = "viewer"
	// RoleAdmin is what someone running the server has in a project that is
	// not theirs: everything the owner can do. It is never stored; it comes
	// from the account's role.
	RoleAdmin ProjectRole = "admin"
)

// IsShareable reports whether a role can be given to someone added to a
// project. Owner cannot: there is exactly one, and it is the project's own.
func (r ProjectRole) IsShareable() bool {
	return r == RoleEditor || r == RoleViewer
}

// Rank orders roles from least to most able, so a check can ask for "at least
// editor".
func (r ProjectRole) Rank() int {
	switch r {
	case RoleAdmin:
		return 4
	case RoleOwner:
		return 3
	case RoleEditor:
		return 2
	case RoleViewer:
		return 1
	default:
		return 0
	}
}

// ProjectMember is one person a project is shared with, and in what role.
// A project with no rows here is private to its owner.
type ProjectMember struct {
	ID        uint        `gorm:"primaryKey" json:"id"`
	ProjectID int         `gorm:"not null;uniqueIndex:idx_project_member" json:"project_id"`
	UserID    int         `gorm:"not null;uniqueIndex:idx_project_member;index" json:"user_id"`
	Role      ProjectRole `gorm:"type:varchar(20);not null" json:"role"`
	// AddedBy is who shared the project with them.
	AddedBy   int       `json:"added_by"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}
