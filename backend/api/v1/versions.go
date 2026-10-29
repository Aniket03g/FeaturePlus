package v1

import (
	"encoding/json"
	"strconv"
	"strings"
	"time"

	"github.com/FeaturePlus/backend/api"
	"github.com/FeaturePlus/backend/internal/log"
	"github.com/FeaturePlus/backend/models"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// VersionsHandler serves saved versions of a project's feature list.
//
// This is the first step of versioning: save the list under a tag, see the
// saved versions, and fetch one back. Nothing here edits or merges a version;
// once saved it stays as it was.
//
// Anyone who can see a project can see and download its versions. Saving one
// needs the right to edit the project, the same as changing its features.
type VersionsHandler struct {
	db *gorm.DB
}

// NewVersionsHandler builds the handler.
func NewVersionsHandler(db *gorm.DB) *VersionsHandler {
	return &VersionsHandler{db: db}
}

// Register mounts the version routes onto an authenticated group.
func (h *VersionsHandler) Register(g *gin.RouterGroup) {
	g.GET("/projects/:id/versions", h.List)
	g.POST("/projects/:id/versions", h.Create)
	// Registered before /:versionId reads it; gin matches the static segment first.
	g.GET("/projects/:id/versions/compare", h.Compare)
	g.GET("/projects/:id/versions/:versionId", h.Get)
	g.POST("/projects/:id/publish", h.Publish)
	g.GET("/projects/:id/published", h.Published)

	g.GET("/projects/:id/copies", h.ListCopies)
	g.POST("/projects/:id/copies", h.SaveCopy)
	// Registered before /:copyId reads it; gin matches the static segment first.
	g.POST("/projects/:id/copies/start", h.StartCopy)
	g.PUT("/projects/:id/copies/:copyId/list", h.SaveCopyList)
	g.DELETE("/projects/:id/copies/:copyId", h.DeleteCopy)
	g.GET("/me/copies", h.ListMyCopies)
	g.GET("/me/space", h.Space)
	g.POST("/me/space/seen", h.SpaceSeen)
	g.GET("/projects/:id/copies/:copyId", h.GetCopy)
	g.POST("/projects/:id/copies/:copyId/publish", h.PublishCopy)
	g.POST("/projects/:id/copies/:copyId/unpublish", h.UnpublishCopy)
	g.GET("/projects/:id/copies/:copyId/merge", h.PreviewMerge)
	g.POST("/projects/:id/copies/:copyId/merge", h.Merge)
}

// snapshotFormat is written into every snapshot, so a later change to its
// shape can still read the versions saved before it.
const snapshotFormat = 1

// versionSnapshot is what a version stores: the project as a list, with each
// feature's details, and the format it was written in.
type versionSnapshot struct {
	Format int `json:"format"`
	OpenedProject
}

// SaveVersionRequest is the accepted body for saving a version.
type SaveVersionRequest struct {
	Tag   string `json:"tag" binding:"required,max=50"`
	Notes string `json:"notes" binding:"max=2000"`
}

// VersionSaver is who saved a version. Name is empty when that account has
// since been removed.
type VersionSaver struct {
	ID   int    `json:"id"`
	Name string `json:"name"`
}

// VersionDTO describes a version without its contents.
type VersionDTO struct {
	ID           uint   `json:"id"`
	ProjectID    int    `json:"project_id"`
	Number       int    `json:"number"`
	Tag          string `json:"tag"`
	Notes        string `json:"notes"`
	FeatureCount int    `json:"feature_count"`
	Auto         bool   `json:"auto"`
	// PublishNumber is 0 for a version that was only saved.
	PublishNumber int          `json:"publish_number"`
	PublishedAt   *time.Time   `json:"published_at"`
	SavedBy       VersionSaver `json:"saved_by"`
	CreatedAt     time.Time    `json:"created_at"`
}

// VersionDetailDTO is a version with its contents.
type VersionDetailDTO struct {
	VersionDTO
	Snapshot json.RawMessage `json:"snapshot"`
}

// List returns a project's versions, newest first, without their contents.
//
// GET /api/v1/projects/:id/versions
func (h *VersionsHandler) List(c *gin.Context) {
	projectID, err := api.IDParam(c, "id")
	if err != nil {
		api.Fail(c, err)
		return
	}
	if _, err := requireProject(c, h.db, projectID, canView); err != nil {
		api.Fail(c, err)
		return
	}

	var versions []models.FeatureVersion
	if err := h.db.Omit("snapshot").Where("project_id = ?", projectID).
		Order("number DESC").Find(&versions).Error; err != nil {
		api.Fail(c, api.Internal(err))
		return
	}

	names, err := h.saverNames(versions)
	if err != nil {
		api.Fail(c, api.Internal(err))
		return
	}
	out := make([]VersionDTO, 0, len(versions))
	for _, v := range versions {
		out = append(out, newVersionDTO(v, names))
	}
	api.OK(c, out)
}

// Get returns one version with its contents.
//
// GET /api/v1/projects/:id/versions/:versionId
func (h *VersionsHandler) Get(c *gin.Context) {
	projectID, err := api.IDParam(c, "id")
	if err != nil {
		api.Fail(c, err)
		return
	}
	versionID, err := api.IDParam(c, "versionId")
	if err != nil {
		api.Fail(c, err)
		return
	}
	if _, err := requireProject(c, h.db, projectID, canView); err != nil {
		api.Fail(c, err)
		return
	}

	// Looked up within the project, so a version id from another project
	// reads as not found rather than leaking that project's list.
	var version models.FeatureVersion
	if dbErr := h.db.Where("id = ? AND project_id = ?", versionID, projectID).
		First(&version).Error; dbErr != nil {
		api.Fail(c, api.FromDB(dbErr, "Version"))
		return
	}

	names, err := h.saverNames([]models.FeatureVersion{version})
	if err != nil {
		api.Fail(c, api.Internal(err))
		return
	}
	api.OK(c, VersionDetailDTO{
		VersionDTO: newVersionDTO(version, names),
		Snapshot:   json.RawMessage(version.Snapshot),
	})
}

// Create saves the project's feature list as it stands now, as the next
// version number.
//
// POST /api/v1/projects/:id/versions
//
// Tags are unique within a project, ignoring case, so a tag names one version
// when people talk about it. Reading the list and numbering the version happen
// in one transaction, and the unique (project, number) index refuses a second
// save that raced this one to the same number.
func (h *VersionsHandler) Create(c *gin.Context) {
	projectID, err := api.IDParam(c, "id")
	if err != nil {
		api.Fail(c, err)
		return
	}
	project, err := requireProject(c, h.db, projectID, canEdit)
	if err != nil {
		api.Fail(c, err)
		return
	}
	userID, err := api.UserID(c)
	if err != nil {
		api.Fail(c, err)
		return
	}

	var req SaveVersionRequest
	if err := api.Bind(c, &req); err != nil {
		api.Fail(c, err)
		return
	}
	tag := strings.TrimSpace(req.Tag)
	if tag == "" {
		api.Fail(c, api.Validation("Check the highlighted fields").
			WithField("tag", "Give the version a tag"))
		return
	}

	var version models.FeatureVersion
	txErr := h.db.Transaction(func(tx *gorm.DB) error {
		var taken int64
		if err := tx.Model(&models.FeatureVersion{}).
			Where("project_id = ? AND LOWER(tag) = LOWER(?)", projectID, tag).
			Count(&taken).Error; err != nil {
			return api.Internal(err)
		}
		if taken > 0 {
			return api.Conflict("This project already has a version with that tag").
				WithField("tag", "Already used in this project")
		}

		var err error
		version, err = saveVersion(tx, project, tag, strings.TrimSpace(req.Notes), userID, false)
		return err
	})
	if txErr != nil {
		api.Fail(c, txErr)
		return
	}

	log.WithField("project", projectID).WithField("version", version.Number).Info("version saved")

	names, err := h.saverNames([]models.FeatureVersion{version})
	if err != nil {
		api.Fail(c, api.Internal(err))
		return
	}
	api.Created(c, newVersionDTO(version, names))
}

// saveVersion saves the project's list as it stands in tx as the next
// version number. The caller has checked the tag is free. auto marks one the
// server saved by itself.
func saveVersion(tx *gorm.DB, project *models.Project, tag, notes string, userID int, auto bool) (models.FeatureVersion, error) {
	opened, err := openProject(tx, project, true)
	if err != nil {
		return models.FeatureVersion{}, api.Internal(err)
	}
	snapshot, err := json.Marshal(versionSnapshot{Format: snapshotFormat, OpenedProject: opened})
	if err != nil {
		return models.FeatureVersion{}, api.Internal(err)
	}

	var last int
	if err := tx.Model(&models.FeatureVersion{}).Where("project_id = ?", project.ID).
		Select("COALESCE(MAX(number), 0)").Scan(&last).Error; err != nil {
		return models.FeatureVersion{}, api.Internal(err)
	}

	version := models.FeatureVersion{
		ProjectID:    project.ID,
		Number:       last + 1,
		Tag:          tag,
		Notes:        notes,
		SavedByID:    userID,
		Auto:         auto,
		FeatureCount: len(opened.Features),
		Snapshot:     string(snapshot),
	}
	if err := tx.Create(&version).Error; err != nil {
		return models.FeatureVersion{}, api.Internal(err)
	}
	return version, nil
}

// freeTag is tag, or tag with " (2)", " (3)"… after it when the project
// already has a version by that name, for tags the server makes up itself.
func freeTag(tx *gorm.DB, projectID int, tag string) (string, error) {
	candidate := tag
	for n := 2; ; n++ {
		var taken int64
		if err := tx.Model(&models.FeatureVersion{}).
			Where("project_id = ? AND LOWER(tag) = LOWER(?)", projectID, candidate).
			Count(&taken).Error; err != nil {
			return "", err
		}
		if taken == 0 {
			return candidate, nil
		}
		candidate = tag + " (" + strconv.Itoa(n) + ")"
	}
}

// saverNames looks up the display name of everyone who saved these versions.
func (h *VersionsHandler) saverNames(versions []models.FeatureVersion) (map[int]string, error) {
	ids := make([]int, 0, len(versions))
	for _, v := range versions {
		ids = append(ids, v.SavedByID)
	}
	names := map[int]string{}
	if len(ids) == 0 {
		return names, nil
	}
	var users []models.User
	if err := h.db.Select("id", "name", "username").Where("id IN ?", ids).Find(&users).Error; err != nil {
		return nil, err
	}
	for _, u := range users {
		names[u.ID] = u.Name
		if names[u.ID] == "" {
			names[u.ID] = u.Username
		}
	}
	return names, nil
}

func newVersionDTO(v models.FeatureVersion, names map[int]string) VersionDTO {
	return VersionDTO{
		ID:            v.ID,
		ProjectID:     v.ProjectID,
		Number:        v.Number,
		Tag:           v.Tag,
		Notes:         v.Notes,
		FeatureCount:  v.FeatureCount,
		Auto:          v.Auto,
		PublishNumber: v.PublishNumber,
		PublishedAt:   v.PublishedAt,
		SavedBy:       VersionSaver{ID: v.SavedByID, Name: names[v.SavedByID]},
		CreatedAt:     v.CreatedAt,
	}
}
