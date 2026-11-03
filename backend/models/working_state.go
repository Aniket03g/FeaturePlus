package models

import "time"

// WorkingState is where a project's working version (its Feature List)
// stands against its saved versions: which version it was opened from or
// last saved as, and a note on what is being worked on.
//
// BaseVersionID moves when the list is saved (to the new version) and when a
// saved version is opened as the working version (to that version). Nil means
// none recorded yet, which reads as the newest version.
type WorkingState struct {
	ProjectID     int   `gorm:"primaryKey;autoIncrement:false"`
	BaseVersionID *uint `gorm:"index"`
	// Note says what is being worked on, for everyone on the project. Saving
	// offers it as the new version's note, then clears it.
	Note        string `gorm:"type:text"`
	NoteByID    int
	NoteUpdated *time.Time
	UpdatedAt   time.Time
}
