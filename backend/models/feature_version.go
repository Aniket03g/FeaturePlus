package models

import "time"

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

	// PublishNumber is 1, 2, 3… for the versions published from the
	// in-progress list, in the order they were published, and 0 for one only
	// saved. The latest published version is what the published list shows.
	PublishNumber int `gorm:"not null;default:0;index"`
	PublishedAt   *time.Time

	// FeatureCount is how many features the snapshot holds, kept beside it so
	// a list of versions does not have to open every snapshot.
	FeatureCount int    `gorm:"not null"`
	Snapshot     string `gorm:"type:text;not null"`

	CreatedAt time.Time
}
