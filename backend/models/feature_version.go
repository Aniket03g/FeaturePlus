package models

import (
	"strconv"
	"time"
)

// FeatureVersion is a saved copy of a project's feature list: the whole tree
// as it stood when someone saved it, under a tag they chose. Versions are
// numbered 1, 2, 3… within their project and are never edited after saving.
//
// Snapshot is the list as JSON, in the same shape the playground opens and
// FEATURES.md is written from, so an old version downloads through the same
// code as the live list.
type FeatureVersion struct {
	ID        uint   `gorm:"primaryKey"`
	ProjectID int    `gorm:"not null;uniqueIndex:idx_feature_version_number,priority:1"`
	Number    int    `gorm:"not null;uniqueIndex:idx_feature_version_number,priority:2"`
	Tag       string `gorm:"type:varchar(50);not null"`
	Notes     string `gorm:"type:text"`
	SavedByID int    `gorm:"not null"`
	// Auto marks a version the server saved by itself, around a merge, rather
	// than one someone chose to save.
	Auto bool `gorm:"not null;default:false"`

	// Major and Minor are the number people see: v2 for the second publish,
	// v2.1, v2.2… for the saves after it, v0.1, v0.2… for saves before the
	// first publish. Number above stays the order versions were made in.
	// Both 0 marks a row from before this numbering; NumberVersions fills it.
	Major int `gorm:"not null;default:0"`
	Minor int `gorm:"not null;default:0"`

	// BasedOnID is the version this one was made from: for a save, the
	// version saved before it; for a publish of an older version, that
	// version; for going back, the version gone back to. Nil for the first.
	BasedOnID *uint `gorm:"index"`

	// PublishNumber is 1, 2, 3… for the versions published from the
	// in-progress list, in the order they were published, and 0 for one only
	// saved. The latest published version is what the published list shows.
	PublishNumber int `gorm:"not null;default:0;index"`
	PublishedAt   *time.Time

	// FeatureCount is how many features the snapshot holds, kept beside it so
	// a list of versions does not have to open every snapshot.
	FeatureCount int    `gorm:"not null"`
	Snapshot     string `gorm:"type:text;not null"`
	// Deleted hides a version from the list without renumbering: the row keeps
	// its (project, number) slot so later saves never reuse it. Published
	// versions and the working version's base cannot be deleted.
	Deleted bool `gorm:"not null;default:false;index"`

	CreatedAt time.Time
}

// Label is how a version is named on screen: "v2" or "v2.3".
func (v FeatureVersion) Label() string {
	if v.Minor == 0 {
		return "v" + strconv.Itoa(v.Major)
	}
	return "v" + strconv.Itoa(v.Major) + "." + strconv.Itoa(v.Minor)
}
