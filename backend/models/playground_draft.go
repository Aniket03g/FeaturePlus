package models

import "time"

// PlaygroundDraft is one person's playground: the list they are shaping, its
// releases, and the conversation with the AI. One per user, so it follows them
// from browser to browser and nobody sees anyone else's.
//
// The draft is stored as the page sends it. The server never reads inside it;
// an import is what turns a draft into features, and that request carries the
// rows itself.
type PlaygroundDraft struct {
	ID     uint `gorm:"primaryKey" json:"-"`
	UserID uint `gorm:"uniqueIndex;not null" json:"-"`

	// Data is the page's own JSON: list, releases, chat, source project.
	Data string `gorm:"type:text;not null" json:"-"`

	UpdatedAt time.Time `json:"updated_at"`
	CreatedAt time.Time `json:"-"`
}
