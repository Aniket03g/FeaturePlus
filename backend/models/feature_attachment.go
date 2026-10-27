package models

import "time"

// FeatureAttachment is a file attached to a feature, usually an image shown in
// its description or notes. The bytes live in the same SQLiteFS store as task
// attachments, under FileName.
//
// Name is what the description links to ("attachment:screenshot.png"), so it
// is unique within its feature: a second upload of the same name is given
// another one. Linking by name rather than by id is what keeps the links
// working when a backup is restored and every id changes.
type FeatureAttachment struct {
	ID        uint   `gorm:"primaryKey"`
	FeatureID uint   `gorm:"not null;index"`
	Name      string `gorm:"type:varchar(255);not null"`
	FileName  string `gorm:"type:varchar(512);not null"`
	FileSize  int64  `gorm:"not null"`
	MimeType  string `gorm:"type:varchar(255);not null"`
	CreatedAt time.Time
	UpdatedAt time.Time
}
