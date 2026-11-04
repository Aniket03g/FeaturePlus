package models

import "time"

// InviteCode lets one person create an account. An admin makes it and hands
// the code over outside FeaturePlus (in person, by phone, in a chat); signing
// up needs it.
//
// Only a hash of the code is stored, so a code cannot be read back, not even
// by an admin: it is shown once, when made. A lost code is cancelled and a new
// one made.
type InviteCode struct {
	ID       uint   `gorm:"primaryKey"`
	CodeHash string `gorm:"type:varchar(64);not null;uniqueIndex"`
	// Hint is the code's last four characters, so a list of codes can be told
	// apart without showing any of them whole.
	Hint string `gorm:"type:varchar(8);not null"`
	// Email, when set, is the only address that may sign up with the code.
	Email       string `gorm:"type:varchar(254)"`
	Note        string `gorm:"type:varchar(200)"`
	CreatedByID int    `gorm:"not null"`
	ExpiresAt   time.Time
	UsedAt      *time.Time
	UsedByID    *int
	CancelledAt *time.Time
	CreatedAt   time.Time
}
