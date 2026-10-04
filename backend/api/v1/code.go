package v1

import (
	"path"
	"regexp"
	"strings"

	"github.com/FeaturePlus/backend/api"
	"github.com/FeaturePlus/backend/models"
	"github.com/FeaturePlus/backend/repositories"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// CodeHandler serves the linked-code routes: which source files and which git
// commits a feature is made of.
//
// These two mappings are what makes the rest of the system work. A feature's
// files are what a contract is extracted from, and what an access grant is
// resolved against — a feature with no files mapped grants nothing, however
// many collaborators are scoped to it.
type CodeHandler struct {
	featureRepo *repositories.FeatureRepository
	projectRepo *repositories.ProjectRepository
	db          *gorm.DB
}

// NewCodeHandler builds the handler.
func NewCodeHandler(db *gorm.DB) *CodeHandler {
	return &CodeHandler{
		featureRepo: repositories.NewFeatureRepository(db),
		projectRepo: repositories.NewProjectRepository(db),
		db:          db,
	}
}

// Register mounts the linked-code routes onto an authenticated group.
func (h *CodeHandler) Register(g *gin.RouterGroup) {
	g.GET("/features/:featureId/files", h.ListFiles)
	g.POST("/features/:featureId/files", h.LinkFile)
	g.DELETE("/features/:featureId/files/:fileId", h.UnlinkFile)

	g.GET("/features/:featureId/commits", h.ListCommits)
	g.POST("/features/:featureId/commits", h.LinkCommit)
	g.DELETE("/features/:featureId/commits/:commitId", h.UnlinkCommit)

	g.GET("/projects/:id/files", h.ListProjectFiles)
}

// ListFiles returns the source files mapped to a feature.
//
// GET /api/v1/features/:featureId/files
func (h *CodeHandler) ListFiles(c *gin.Context) {
	feature, err := h.load(c)
	if err != nil {
		api.Fail(c, err)
		return
	}

	var files []models.FeatureFile
	if dbErr := h.db.Where("feature_id = ?", feature.ID).
		Order("file_path").Find(&files).Error; dbErr != nil {
		api.Fail(c, api.Internal(dbErr))
		return
	}

	dtos := NewFeatureFileDTOs(files)
	api.List(c, dtos, api.Meta{
		Total: int64(len(dtos)), Page: 1, PerPage: len(dtos), TotalPages: 1,
	})
}

// LinkFile maps a source file to a feature.
//
// POST /api/v1/features/:featureId/files
func (h *CodeHandler) LinkFile(c *gin.Context) {
	feature, err := h.loadForWrite(c)
	if err != nil {
		api.Fail(c, err)
		return
	}

	var req LinkFileRequest
	if bindErr := api.Bind(c, &req); bindErr != nil {
		api.Fail(c, bindErr)
		return
	}

	filePath, err := cleanRepoPath(req.FilePath)
	if err != nil {
		api.Fail(c, err)
		return
	}

	var existing int64
	if dbErr := h.db.Model(&models.FeatureFile{}).
		Where("feature_id = ? AND file_path = ? AND deleted_at IS NULL", feature.ID, filePath).
		Count(&existing).Error; dbErr != nil {
		api.Fail(c, api.Internal(dbErr))
		return
	}
	if existing > 0 {
		api.Fail(c, api.Conflict("That file is already mapped to this feature"))
		return
	}

	// One file belongs to one feature. Two features owning the same file makes
	// "who may see this" ambiguous, and the access rules have no tiebreak.
	var clash models.FeatureFile
	clashErr := h.db.Joins("JOIN features ON features.id = feature_files.feature_id").
		Where("feature_files.file_path = ? AND features.project_id = ? AND feature_files.deleted_at IS NULL",
			filePath, feature.ProjectID).
		First(&clash).Error
	if clashErr == nil {
		api.Fail(c, api.Conflict(
			"That file is already mapped to another feature in this project"))
		return
	}
	if clashErr != gorm.ErrRecordNotFound {
		api.Fail(c, api.Internal(clashErr))
		return
	}

	link := models.FeatureFile{FeatureID: feature.ID, FilePath: filePath}
	if dbErr := h.db.Omit("Feature").Create(&link).Error; dbErr != nil {
		api.Fail(c, api.FromDB(dbErr, "File mapping"))
		return
	}

	api.Created(c, NewFeatureFileDTO(link))
}

// UnlinkFile removes a file mapping.
//
// DELETE /api/v1/features/:featureId/files/:fileId
func (h *CodeHandler) UnlinkFile(c *gin.Context) {
	feature, err := h.loadForWrite(c)
	if err != nil {
		api.Fail(c, err)
		return
	}

	fileID, err := api.IDParam(c, "fileId")
	if err != nil {
		api.Fail(c, err)
		return
	}

	result := h.db.Where("id = ? AND feature_id = ?", fileID, feature.ID).
		Delete(&models.FeatureFile{})
	if result.Error != nil {
		api.Fail(c, api.Internal(result.Error))
		return
	}
	if result.RowsAffected == 0 {
		api.Fail(c, api.NotFound("File mapping"))
		return
	}

	api.NoContent(c)
}

// ListCommits returns the git commits mapped to a feature.
//
// GET /api/v1/features/:featureId/commits
func (h *CodeHandler) ListCommits(c *gin.Context) {
	feature, err := h.load(c)
	if err != nil {
		api.Fail(c, err)
		return
	}

	var commits []models.FeatureCommit
	if dbErr := h.db.Where("feature_id = ?", feature.ID).
		Order("created_at DESC").Find(&commits).Error; dbErr != nil {
		api.Fail(c, api.Internal(dbErr))
		return
	}

	dtos := NewFeatureCommitDTOs(commits)
	api.List(c, dtos, api.Meta{
		Total: int64(len(dtos)), Page: 1, PerPage: len(dtos), TotalPages: 1,
	})
}

// LinkCommit maps a git commit to a feature.
//
// POST /api/v1/features/:featureId/commits
func (h *CodeHandler) LinkCommit(c *gin.Context) {
	feature, err := h.loadForWrite(c)
	if err != nil {
		api.Fail(c, err)
		return
	}

	var req LinkCommitRequest
	if bindErr := api.Bind(c, &req); bindErr != nil {
		api.Fail(c, bindErr)
		return
	}

	hash := strings.ToLower(strings.TrimSpace(req.CommitHash))
	if !commitHashPattern.MatchString(hash) {
		api.Fail(c, api.Validation("That is not a commit hash").
			WithField("commit_hash", "Expected 7 to 40 hexadecimal characters"))
		return
	}

	var existing int64
	if dbErr := h.db.Model(&models.FeatureCommit{}).
		Where("feature_id = ? AND commit_hash = ? AND deleted_at IS NULL", feature.ID, hash).
		Count(&existing).Error; dbErr != nil {
		api.Fail(c, api.Internal(dbErr))
		return
	}
	if existing > 0 {
		api.Fail(c, api.Conflict("That commit is already mapped to this feature"))
		return
	}

	link := models.FeatureCommit{FeatureID: feature.ID, CommitHash: hash}
	if dbErr := h.db.Omit("Feature").Create(&link).Error; dbErr != nil {
		api.Fail(c, api.FromDB(dbErr, "Commit mapping"))
		return
	}

	api.Created(c, NewFeatureCommitDTO(link))
}

// UnlinkCommit removes a commit mapping.
//
// DELETE /api/v1/features/:featureId/commits/:commitId
func (h *CodeHandler) UnlinkCommit(c *gin.Context) {
	feature, err := h.loadForWrite(c)
	if err != nil {
		api.Fail(c, err)
		return
	}

	commitID, err := api.IDParam(c, "commitId")
	if err != nil {
		api.Fail(c, err)
		return
	}

	result := h.db.Where("id = ? AND feature_id = ?", commitID, feature.ID).
		Delete(&models.FeatureCommit{})
	if result.Error != nil {
		api.Fail(c, api.Internal(result.Error))
		return
	}
	if result.RowsAffected == 0 {
		api.Fail(c, api.NotFound("Commit mapping"))
		return
	}

	api.NoContent(c)
}

// ListProjectFiles returns every file mapped anywhere in a project, so a
// browser can show the whole map rather than one feature at a time.
//
// GET /api/v1/projects/:id/files?q=
func (h *CodeHandler) ListProjectFiles(c *gin.Context) {
	projectID, err := api.IDParam(c, "id")
	if err != nil {
		api.Fail(c, err)
		return
	}

	if _, dbErr := h.projectRepo.GetProjectByID(projectID); dbErr != nil {
		api.Fail(c, api.FromDB(dbErr, "Project"))
		return
	}

	var files []models.FeatureFile
	if dbErr := h.db.
		Joins("JOIN features ON features.id = feature_files.feature_id").
		Where("features.project_id = ? AND feature_files.deleted_at IS NULL", projectID).
		Order("feature_files.file_path").
		Find(&files).Error; dbErr != nil {
		api.Fail(c, api.Internal(dbErr))
		return
	}

	if query := strings.ToLower(c.Query("q")); query != "" {
		kept := make([]models.FeatureFile, 0, len(files))
		for _, f := range files {
			if contains(lower(f.FilePath), query) {
				kept = append(kept, f)
			}
		}
		files = kept
	}

	page := api.ParsePage(c)
	total := int64(len(files))
	api.List(c, NewFeatureFileDTOs(api.Slice(files, page)), page.Meta(total))
}

// load fetches the feature named in the path.
func (h *CodeHandler) load(c *gin.Context) (*models.Feature, error) {
	id, err := api.IDParam(c, "featureId")
	if err != nil {
		return nil, err
	}

	feature, dbErr := h.featureRepo.GetFeatureByID(id)
	if dbErr != nil {
		return nil, api.FromDB(dbErr, "Feature")
	}

	return feature, nil
}

// loadForWrite fetches the feature and checks the caller may change its map.
func (h *CodeHandler) loadForWrite(c *gin.Context) (*models.Feature, error) {
	feature, err := h.load(c)
	if err != nil {
		return nil, err
	}

	userID, err := api.UserID(c)
	if err != nil {
		return nil, err
	}

	if api.IsManager(c) {
		return feature, nil
	}

	project, dbErr := h.projectRepo.GetProjectByID(feature.ProjectID)
	if dbErr != nil {
		return nil, api.FromDB(dbErr, "Project")
	}
	if project.OwnerID == userID {
		return feature, nil
	}

	return nil, api.Forbidden("Only the project owner or a manager can map code to a feature")
}

var commitHashPattern = regexp.MustCompile(`^[0-9a-f]{7,40}$`)

// cleanRepoPath normalises a repository-relative path and rejects one that
// tries to leave the repository.
//
// These paths are handed to a source reader that opens real files, so "../"
// and an absolute path are not style problems — they are how a contract-scope
// collaborator would read something outside the project entirely.
func cleanRepoPath(raw string) (string, error) {
	cleaned := strings.ReplaceAll(strings.TrimSpace(raw), "\\", "/")
	cleaned = strings.TrimPrefix(cleaned, "./")

	if cleaned == "" {
		return "", api.Validation("The file path is empty").
			WithField("file_path", "This field is required")
	}

	invalid := api.Validation("That file path is not allowed").
		WithField("file_path", "Use a path inside the repository, without .. or a leading /")

	if strings.HasPrefix(cleaned, "/") || strings.Contains(cleaned, ":") {
		return "", invalid
	}

	cleaned = path.Clean(cleaned)
	if cleaned == "." || cleaned == ".." || strings.HasPrefix(cleaned, "../") {
		return "", invalid
	}

	return cleaned, nil
}
