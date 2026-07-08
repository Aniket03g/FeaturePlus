package services

import (
	"errors"
	"os"
	"path/filepath"
	"strings"

	"github.com/FeaturePlus/backend/contracts"
	"github.com/FeaturePlus/backend/models"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// ErrSourceUnavailable is returned when real source is requested but no source
// reader is configured (or the file cannot be located).
var ErrSourceUnavailable = errors.New("source unavailable")

// ContractService connects the extractor to FeaturePlus's existing
// feature<->file linkage (feature_files, the same data behind GetLinkedCode)
// and the dependency graph. It answers "which files does this collaborator see
// as contracts?" — namely the files owned by the features that a feature they
// own depends on.
type ContractService struct {
	db      *gorm.DB
	access  *AccessService
	source  SourceReader
	commits CommitResolver
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

// SaveArtifact persists (or updates in place) a contract artifact for a source
// file at a given commit. Re-extracting the same file at the same commit updates
// the existing row rather than piling up duplicates; a new commit creates a new
// versioned row so history is retained.
func (s *ContractService) SaveArtifact(a *models.ContractArtifact) error {
	return s.db.Clauses(clause.OnConflict{
		Columns: []clause.Column{
			{Name: "feature_id"}, {Name: "file_path"}, {Name: "commit_hash"},
		},
		DoUpdates: clause.AssignmentColumns([]string{
			"contract", "behavior_note", "language", "updated_at",
		}),
	}).Create(a).Error
}

// LatestArtifact returns the most recently generated contract for a file within
// a project, or gorm.ErrRecordNotFound if none exists yet.
func (s *ContractService) LatestArtifact(projectID int, filePath string) (*models.ContractArtifact, error) {
	var a models.ContractArtifact
	err := s.db.Where("project_id = ? AND file_path = ?", projectID, filePath).
		Order("created_at desc").First(&a).Error
	if err != nil {
		return nil, err
	}
	return &a, nil
}

// ArtifactAtCommit returns the contract for a file generated at a specific
// commit, or gorm.ErrRecordNotFound if that version was never extracted.
func (s *ContractService) ArtifactAtCommit(projectID int, filePath, commitHash string) (*models.ContractArtifact, error) {
	var a models.ContractArtifact
	err := s.db.Where("project_id = ? AND file_path = ? AND commit_hash = ?",
		projectID, filePath, commitHash).First(&a).Error
	if err != nil {
		return nil, err
	}
	return &a, nil
}

// SourceReader fetches the real source of a project file. Injecting it keeps the
// serving logic testable and lets deployments decide where source lives (a git
// worktree, an object store, etc.). When no reader is configured, real source is
// simply unavailable and only persisted contracts can be served.
type SourceReader interface {
	ReadSource(projectID int, filePath string) ([]byte, error)
}

// SetSourceReader attaches a source reader used to serve real source (to owners)
// and to generate contracts on demand.
func (s *ContractService) SetSourceReader(r SourceReader) {
	s.source = r
}

// RealSource returns the real file contents. It is the caller's responsibility
// to have already verified the requester holds owner access — this method does
// no access checks.
func (s *ContractService) RealSource(projectID int, filePath string) ([]byte, error) {
	if s.source == nil {
		return nil, ErrSourceUnavailable
	}
	return s.source.ReadSource(projectID, filePath)
}

// ContractFor returns the stripped contract text for a file. It prefers a
// persisted artifact; if none exists and a source reader is available, it
// extracts, persists (tagged with commit), and returns a fresh contract. The
// returned text never contains implementation bodies.
func (s *ContractService) ContractFor(projectID int, featureID uint, filePath, commit string) (*models.ContractArtifact, error) {
	// Prefer an existing artifact for this commit, else the latest.
	if commit != "" {
		if a, err := s.ArtifactAtCommit(projectID, filePath, commit); err == nil {
			return a, nil
		}
	}
	if a, err := s.LatestArtifact(projectID, filePath); err == nil {
		return a, nil
	}

	// None persisted yet — generate from source if we can.
	if s.source == nil {
		return nil, ErrSourceUnavailable
	}
	src, err := s.source.ReadSource(projectID, filePath)
	if err != nil {
		return nil, err
	}
	contract, err := contracts.ExtractGoContract(filePath, src)
	if err != nil {
		return nil, err
	}
	a := &models.ContractArtifact{
		ProjectID:  projectID,
		FeatureID:  featureID,
		FilePath:   filePath,
		CommitHash: commit,
		Language:   "go",
		Contract:   contract,
	}
	if err := s.SaveArtifact(a); err != nil {
		return nil, err
	}
	return a, nil
}

// FSSourceReader reads source from a filesystem rooted at BaseDir. Paths are
// cleaned and confined to BaseDir so a crafted file_path cannot escape the
// project tree.
type FSSourceReader struct {
	BaseDir string
}

// ReadSource returns the file contents for a project-relative path, rejecting
// any path that would resolve outside BaseDir.
func (r FSSourceReader) ReadSource(_ int, filePath string) ([]byte, error) {
	clean := filepath.Clean("/" + strings.ReplaceAll(filePath, "\\", "/"))
	full := filepath.Join(r.BaseDir, clean)
	rel, err := filepath.Rel(r.BaseDir, full)
	if err != nil || strings.HasPrefix(rel, "..") {
		return nil, ErrSourceUnavailable
	}
	data, err := os.ReadFile(full)
	if err != nil {
		return nil, ErrSourceUnavailable
	}
	return data, nil
}

// MockFor returns a generated mock package for a dependency file: the stripped
// contract turned into a compilable fake (synthetic returns + sentinel-error
// dispatch). A contract-scope collaborator drops this into their build in place
// of the real dependency, so they can compile and test without the real code.
func (s *ContractService) MockFor(projectID int, featureID uint, filePath, commit string) (string, error) {
	artifact, err := s.ContractFor(projectID, featureID, filePath, commit)
	if err != nil {
		return "", err
	}
	return contracts.GenerateMock(filePath, []byte(artifact.Contract))
}
