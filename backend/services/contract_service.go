package services

import (
	"github.com/FeaturePlus/backend/models"
	"gorm.io/gorm"
)

// ContractService connects the extractor to FeaturePlus's existing
// feature<->file linkage (feature_files, the same data behind GetLinkedCode)
// and the dependency graph. It answers "which files does this collaborator see
// as contracts?" — namely the files owned by the features that a feature they
// own depends on.
type ContractService struct {
	db     *gorm.DB
	access *AccessService
}

// NewContractService constructs a ContractService.
func NewContractService(db *gorm.DB) *ContractService {
	return &ContractService{db: db, access: NewAccessService(db)}
}

// ContractTarget is one file that should be served as a contract rather than as
// real source, along with the dependency feature that owns it.
type ContractTarget struct {
	FilePath     string `json:"file_path"`
	FeatureID    uint   `json:"feature_id"`
	FeatureTitle string `json:"feature_title"`
	ProjectID    int    `json:"project_id"`
}

// dependencyFeatures returns the features that featureID depends on (its
// parents: "Child depends on Parent").
func (s *ContractService) dependencyFeatures(featureID uint) ([]models.Feature, error) {
	var deps []models.Dependency
	if err := s.db.Where("child_type = ? AND child_id = ?", models.EntityTypeFeature, featureID).
		Find(&deps).Error; err != nil {
		return nil, err
	}
	parentIDs := make([]uint, 0, len(deps))
	for _, d := range deps {
		if d.ParentType == models.EntityTypeFeature {
			parentIDs = append(parentIDs, d.ParentID)
		}
	}
	if len(parentIDs) == 0 {
		return nil, nil
	}
	var features []models.Feature
	if err := s.db.Where("id IN ?", parentIDs).Find(&features).Error; err != nil {
		return nil, err
	}
	return features, nil
}

// filesForFeature returns the file paths mapped to a feature (via feature_files,
// the GetLinkedCode linkage).
func (s *ContractService) filesForFeature(featureID uint) ([]string, error) {
	var paths []string
	err := s.db.Model(&models.FeatureFile{}).
		Where("feature_id = ?", featureID).
		Pluck("file_path", &paths).Error
	return paths, err
}

// TargetsForOwnedFeature returns the contract targets implied by owning one
// feature: every file belonging to a feature that this feature depends on. A
// collaborator who owns featureID may call these files but must see only their
// stripped contracts.
func (s *ContractService) TargetsForOwnedFeature(featureID uint) ([]ContractTarget, error) {
	depFeatures, err := s.dependencyFeatures(featureID)
	if err != nil {
		return nil, err
	}
	var targets []ContractTarget
	for _, dep := range depFeatures {
		paths, err := s.filesForFeature(dep.ID)
		if err != nil {
			return nil, err
		}
		for _, p := range paths {
			targets = append(targets, ContractTarget{
				FilePath:     p,
				FeatureID:    dep.ID,
				FeatureTitle: dep.Title,
				ProjectID:    dep.ProjectID,
			})
		}
	}
	return targets, nil
}

// TargetsForUser returns every contract target a collaborator should see across
// a project: the de-duplicated union of dependency files over all features the
// user owns. Files the user already owns outright are excluded — those are
// served as real source, not contracts.
func (s *ContractService) TargetsForUser(userID, projectID int) ([]ContractTarget, error) {
	ownedIDs, err := s.access.ownedFeatureIDs(userID, projectID)
	if err != nil {
		return nil, err
	}
	if len(ownedIDs) == 0 {
		return nil, nil
	}

	// Collect files the user owns outright so we never downgrade them to contracts.
	ownedFiles := map[string]bool{}
	for _, fid := range ownedIDs {
		paths, err := s.filesForFeature(fid)
		if err != nil {
			return nil, err
		}
		for _, p := range paths {
			ownedFiles[p] = true
		}
	}

	seen := map[string]bool{}
	var targets []ContractTarget
	for _, fid := range ownedIDs {
		ts, err := s.TargetsForOwnedFeature(fid)
		if err != nil {
			return nil, err
		}
		for _, t := range ts {
			if ownedFiles[t.FilePath] || seen[t.FilePath] {
				continue
			}
			seen[t.FilePath] = true
			targets = append(targets, t)
		}
	}
	return targets, nil
}
