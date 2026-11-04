package models

import "time"

// ProjectSettings is how a project's team works and how its code is laid
// out, written down in one place: conventions for versions and publishing,
// what each feature colour means, and the architecture with its modules.
//
// It is a table of its own rather than more Project columns or Config keys:
// a project is saved whole in places, and Config is replaced whole, and
// either would wipe what is written here.
type ProjectSettings struct {
	ProjectID int `gorm:"primaryKey;autoIncrement:false"`
	// Markdown. Empty means never written; the API then offers starting text.
	VersionsConvention string `gorm:"type:text"`
	PublishConvention  string `gorm:"type:text"`
	Architecture       string `gorm:"type:text"`
	// ColorMeanings is JSON: colour name → what it means, e.g. {"red":"Blocked"}.
	ColorMeanings string `gorm:"type:text"`
	// Modules is markdown: the parts of the code, their folders and what each
	// does. (Before it was text it was briefly a JSON list; see modulesText.)
	Modules     string `gorm:"type:text"`
	UpdatedByID int
	UpdatedAt   time.Time
}
