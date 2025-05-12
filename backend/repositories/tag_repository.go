package repositories

import (
	"FeaturePlus/models"
	"strings"

	"gorm.io/gorm"
)

type TagRepository struct {
	db *gorm.DB
}

func NewTagRepository(db *gorm.DB) *TagRepository {
	return &TagRepository{db: db}
}

func (r *TagRepository) CreateTag(tag *models.FeatureTag) error {
	return r.db.Create(tag).Error
}

func (r *TagRepository) GetTagsByFeatureID(featureID uint) ([]models.FeatureTag, error) {
	var tags []models.FeatureTag
	if err := r.db.Where("feature_id = ?", featureID).Find(&tags).Error; err != nil {
		return nil, err
	}
	return tags, nil
}

func (r *TagRepository) GetAllTags() ([]models.FeatureTag, error) {
	var tags []models.FeatureTag
	if err := r.db.Find(&tags).Error; err != nil {
		return nil, err
	}
	return tags, nil
}

func (r *TagRepository) GetFeaturesByTagName(tagName string) ([]models.Feature, error) {
	var features []models.Feature

	// Find all features that have this tag
	if err := r.db.
		Joins("INNER JOIN feature_tags ON features.id = feature_tags.feature_id").
		Where("feature_tags.tag_name = ?", tagName).
		Preload("Assignee").
		Preload("Tags").
		Find(&features).Error; err != nil {
		return nil, err
	}

	return features, nil
}

func (r *TagRepository) DeleteTagsByFeatureID(featureID uint) error {
	return r.db.Where("feature_id = ?", featureID).Delete(&models.FeatureTag{}).Error
}

func (r *TagRepository) UpdateFeatureTags(featureID uint, userID uint, tagInput string) error {
	// First delete existing tags for this feature
	if err := r.DeleteTagsByFeatureID(featureID); err != nil {
		return err
	}

	// Process the tag string
	tagStrings := processTagString(tagInput)
	if len(tagStrings) == 0 {
		return nil // No tags to add
	}

	// Create tags in batch
	var tags []models.FeatureTag
	for _, tagName := range tagStrings {
		tag := models.FeatureTag{
			TagName:       tagName,
			FeatureID:     featureID,
			CreatedByUser: userID,
		}
		tags = append(tags, tag)
	}

	return r.db.Create(&tags).Error
}

// processTagString converts a comma/space/semicolon-separated string into a slice of tag names
func processTagString(tagInput string) []string {
	if tagInput == "" {
		return []string{}
	}

	// Split by common separators
	parts := strings.FieldsFunc(tagInput, func(r rune) bool {
		return r == ',' || r == ' ' || r == ';'
	})

	// Process each part to clean it
	var tags []string
	for _, part := range parts {
		tag := strings.TrimSpace(part)

		// Skip empty tags
		if tag == "" {
			continue
		}

		// Remove leading # if present
		if strings.HasPrefix(tag, "#") {
			tag = tag[1:]
		}

		// Skip tags that are empty after processing
		if tag != "" {
			tags = append(tags, tag)
		}
	}

	return tags
}
