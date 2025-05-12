package models

type FeatureTag struct {
	TagName       string `gorm:"primaryKey;type:varchar(50)" json:"tag_name"`
	FeatureID     uint   `gorm:"primaryKey;not null;index" json:"feature_id"`
	CreatedByUser uint   `gorm:"not null" json:"created_by_user"`

	// Associations
	Feature Feature `gorm:"foreignKey:FeatureID" json:"-"`
}
