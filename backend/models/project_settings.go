package models

import (
	"encoding/json"
	"strings"
	"time"
)

// SettingsEntry is one titled piece of markdown in a project's settings: a
// prompt (instructions for working on the project) or a convention (how the
// team works). Entries are free-form and there may be any number of them.
type SettingsEntry struct {
	Title string `json:"title"`
	Body  string `json:"body"`
}

// ParseSettingsEntries reads the JSON stored in a settings column. An empty or
// unreadable value yields no entries.
func ParseSettingsEntries(stored string) []SettingsEntry {
	stored = strings.TrimSpace(stored)
	if stored == "" {
		return nil
	}
	var entries []SettingsEntry
	if json.Unmarshal([]byte(stored), &entries) != nil {
		return nil
	}
	return entries
}

// MarshalSettingsEntries writes entries as JSON. An empty list is stored as
// "[]", which is how the API tells "saved as empty" from "never written".
func MarshalSettingsEntries(entries []SettingsEntry) (string, error) {
	if entries == nil {
		entries = []SettingsEntry{}
	}
	raw, err := json.Marshal(entries)
	return string(raw), err
}

// ProjectSettings is how a project's team works and how its code is laid
// out, written down in one place: prompts, conventions, what each feature
// colour means, and the architecture with its modules.
//
// It is a table of its own rather than more Project columns or Config keys:
// a project is saved whole in places, and Config is replaced whole, and
// either would wipe what is written here.
type ProjectSettings struct {
	ProjectID int `gorm:"primaryKey;autoIncrement:false"`
	// Prompts is JSON: a list of models.SettingsEntry, each a titled markdown
	// instruction for the project, e.g. for architecture or UI standards.
	Prompts string `gorm:"type:text"`
	// Conventions is JSON: a list of models.SettingsEntry, the same shape as
	// Prompts, for how the team works.
	Conventions string `gorm:"type:text"`
	// VersionsConvention and PublishConvention are what Conventions replaced.
	// They are kept so old rows and old backups still read; new writes go to
	// Conventions.
	VersionsConvention string `gorm:"type:text"`
	PublishConvention  string `gorm:"type:text"`
	Architecture       string `gorm:"type:text"`
	// ColorMeanings is JSON: colour name → what it means, e.g. {"red":"Blocked"}.
	ColorMeanings string `gorm:"type:text"`
	// Modules is markdown: the parts of the code, their folders and what each
	// does. (Before it was text it was briefly a JSON list; see modulesText.)
	Modules string `gorm:"type:text"`
	// Statuses is JSON: the feature statuses this project offers and the
	// parameters each carries, e.g.
	// [{"name":"in_progress","params":[{"ui_name":"Assignee","key":"assignee","type":"string"}]}].
	// Empty means the project uses models.DefaultStatuses().
	Statuses    string `gorm:"type:text"`
	UpdatedByID int
	UpdatedAt   time.Time
}
