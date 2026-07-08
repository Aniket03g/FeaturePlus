package services

import (
	"github.com/FeaturePlus/backend/models"
	"gorm.io/gorm"
)

// AccessService resolves a collaborator's effective access to features and
// files under the Scoped Contracts three-tier model:
//
//	owner    -> the user holds an owner grant on the feature (full source)
//	contract -> the feature is a dependency of a feature the user owns
//	            (stripped contract only, never the real implementation)
//	none      -> everything else (invisible)
//
// The project owner always has full (owner) access to their own project.
type AccessService struct {
	db *gorm.DB
}

// NewAccessService constructs an AccessService over the given DB handle.
func NewAccessService(db *gorm.DB) *AccessService {
	return &AccessService{db: db}
}

// isProjectOwner reports whether the user owns the project outright. Project
// owners bypass scoping — the model only constrains invited collaborators.
func (s *AccessService) isProjectOwner(userID, projectID int) (bool, error) {
	var project models.Project
	if err := s.db.Select("owner_id").First(&project, projectID).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return false, nil
		}
		return false, err
	}
	return project.OwnerID == userID, nil
}

// ownedFeatureIDs returns the IDs of features in a project on which the user
// holds an explicit owner grant.
func (s *AccessService) ownedFeatureIDs(userID, projectID int) ([]uint, error) {
	var ids []uint
	err := s.db.Model(&models.FeatureScope{}).
		Where("project_id = ? AND user_id = ? AND access_level = ?", projectID, userID, models.AccessOwner).
		Pluck("feature_id", &ids).Error
	return ids, err
}

// explicitGrant returns the access level explicitly granted to the user for a
// single feature, or AccessNone if there is no grant.
func (s *AccessService) explicitGrant(userID int, featureID uint) (models.FeatureAccessLevel, error) {
	var scope models.FeatureScope
	err := s.db.Where("user_id = ? AND feature_id = ?", userID, featureID).First(&scope).Error
	if err == gorm.ErrRecordNotFound {
		return models.AccessNone, nil
	}
	if err != nil {
		return models.AccessNone, err
	}
	return scope.AccessLevel, nil
}

// dependencyFeatureIDs returns the features that the given feature depends on
// (its parents in the dependency graph — "Child depends on Parent").
func (s *AccessService) dependencyFeatureIDs(featureID uint) ([]uint, error) {
	var deps []models.Dependency
	err := s.db.Where("child_type = ? AND child_id = ?", models.EntityTypeFeature, featureID).
		Find(&deps).Error
	if err != nil {
		return nil, err
	}
	ids := make([]uint, 0, len(deps))
	for _, d := range deps {
		if d.ParentType == models.EntityTypeFeature {
			ids = append(ids, d.ParentID)
		}
	}
	return ids, nil
}

// EffectiveFeatureAccess resolves how a user may access a specific feature.
// The result is the most permissive of: their explicit grant, an owner bypass
// for the project owner, or contract access derived from the dependency graph
// when the feature is a dependency of some feature the user owns.
func (s *AccessService) EffectiveFeatureAccess(userID, projectID int, featureID uint) (models.FeatureAccessLevel, error) {
	// Project owners see everything.
	owner, err := s.isProjectOwner(userID, projectID)
	if err != nil {
		return models.AccessNone, err
	}
	if owner {
		return models.AccessOwner, nil
	}

	best := models.AccessNone

	// Explicit grant on this exact feature.
	grant, err := s.explicitGrant(userID, featureID)
	if err != nil {
		return models.AccessNone, err
	}
	if grant.Rank() > best.Rank() {
		best = grant
	}
	// An owner grant is already the maximum; short-circuit.
	if best == models.AccessOwner {
		return best, nil
	}

	// Derived contract access: is this feature a dependency of any feature the
	// user owns?
	ownedIDs, err := s.ownedFeatureIDs(userID, projectID)
	if err != nil {
		return models.AccessNone, err
	}
	for _, ownedID := range ownedIDs {
		depIDs, err := s.dependencyFeatureIDs(ownedID)
		if err != nil {
			return models.AccessNone, err
		}
		for _, depID := range depIDs {
			if depID == featureID {
				if models.AccessContract.Rank() > best.Rank() {
					best = models.AccessContract
				}
			}
		}
	}

	return best, nil
}

// FileAccess is the outcome of resolving a file path for a user.
type FileAccess struct {
	Level     models.FeatureAccessLevel
	FeatureID uint // the feature that owns the file, 0 if none
}

// owningFeatureID returns the feature that owns a file path within a project,
// or 0 if the file is not mapped to any feature. When a file is linked to more
// than one feature, the caller's most permissive access is what matters, so the
// resolver considers all owning features.
func (s *AccessService) owningFeatureIDs(projectID int, filePath string) ([]uint, error) {
	var ids []uint
	err := s.db.Model(&models.FeatureFile{}).
		Joins("JOIN features ON features.id = feature_files.feature_id").
		Where("features.project_id = ? AND feature_files.file_path = ?", projectID, filePath).
		Pluck("feature_files.feature_id", &ids).Error
	return ids, err
}

// ResolveFileAccess maps a file path to its owning feature(s) and returns the
// user's effective access. Files not owned by any feature resolve to None:
// unrelated code is invisible, never merely contract-visible.
func (s *AccessService) ResolveFileAccess(userID, projectID int, filePath string) (FileAccess, error) {
	featureIDs, err := s.owningFeatureIDs(projectID, filePath)
	if err != nil {
		return FileAccess{Level: models.AccessNone}, err
	}
	if len(featureIDs) == 0 {
		return FileAccess{Level: models.AccessNone}, nil
	}

	best := FileAccess{Level: models.AccessNone}
	for _, fid := range featureIDs {
		level, err := s.EffectiveFeatureAccess(userID, projectID, fid)
		if err != nil {
			return FileAccess{Level: models.AccessNone}, err
		}
		if level.Rank() > best.Level.Rank() {
			best = FileAccess{Level: level, FeatureID: fid}
		}
	}
	return best, nil
}
