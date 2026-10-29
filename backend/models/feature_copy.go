package models

import "time"

// FeatureCopy is one person's own copy of a saved version of a project's
// feature list. They download the version as markdown, edit it wherever they
// like, and upload it back; the upload is saved here, against the version it
// was made from. The project's real list does not change.
//
// Copies are numbered 1, 2, 3… within their project. Revision goes up by one
// each time the copy is uploaded again, so a file downloaded before the last
// upload can be told apart and refused instead of quietly undoing it.
//
// Snapshot is in the same shape a FeatureVersion stores, so a copy reads,
// downloads and compares through the same code as a version.
//
// A copy is private to its owner until they publish it. PublishedAt is set
// while it is published: everyone on the project can then see it, and it is
// frozen, so what people looked at is what would be merged. Unpublishing
// clears it and the copy can be uploaded again.
type FeatureCopy struct {
	ID            uint `gorm:"primaryKey"`
	ProjectID     int  `gorm:"not null;uniqueIndex:idx_feature_copy_number,priority:1"`
	Number        int  `gorm:"not null;uniqueIndex:idx_feature_copy_number,priority:2"`
	BaseVersionID uint `gorm:"not null;index"`
	OwnerID       int  `gorm:"not null;index"`
	Revision      int  `gorm:"not null"`
	// Name is what its owner calls it, e.g. "Checkout rework". Empty shows as
	// "Copy" and its number.
	Name string `gorm:"type:varchar(80)"`
	// Source is where the copy was started from in My Space: "published" or
	// "working". Empty for one made by uploading a downloaded file.
	Source string `gorm:"type:varchar(20)"`

	FeatureCount int    `gorm:"not null"`
	Snapshot     string `gorm:"type:text;not null"`

	PublishedAt *time.Time `gorm:"index"`

	// Set once the copy has been merged into the project's list. A merged
	// copy stays published and never changes again. MergedVersionID is the
	// version the list was saved as straight after the merge.
	MergedAt        *time.Time
	MergedByID      *int
	MergedVersionID *uint

	CreatedAt time.Time
	UpdatedAt time.Time
}
