package v1

import (
	"encoding/json"
	"errors"
	"regexp"
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
	g.POST("/projects/:id/versions/:versionId/publish", h.Publish)
	g.GET("/projects/:id/versions/:versionId/restore", h.PreviewRestore)
	g.POST("/projects/:id/versions/:versionId/restore", h.Restore)
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
	// Tag is optional: a version is known by its number, v2.3, and the note
	// says what it is.
	Tag   string `json:"tag" binding:"max=50"`
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
	ID        uint `json:"id"`
	ProjectID int  `json:"project_id"`
	Number    int  `json:"number"`
	// Label is the number people see, "v2" or "v2.3", from Major and Minor.
	Label string `json:"label"`
	Major int    `json:"major"`
	Minor int    `json:"minor"`
	// BasedOn is the version this one was made from; nil for the first.
	BasedOn      *VersionRef `json:"based_on"`
	Tag          string      `json:"tag"`
	Notes        string      `json:"notes"`
	FeatureCount int         `json:"feature_count"`
	Auto         bool        `json:"auto"`
	// PublishNumber is 0 for a version that was only saved.
	PublishNumber int          `json:"publish_number"`
	PublishedAt   *time.Time   `json:"published_at"`
	SavedBy       VersionSaver `json:"saved_by"`
	CreatedAt     time.Time    `json:"created_at"`
	// Changes is what changed from the version saved before this one; only
	// in a list asked for with changes=1, and absent for the first version.
	Changes *ChangeCounts `json:"changes,omitempty"`
}

// VersionRef names another version by id and label.
type VersionRef struct {
	ID    uint   `json:"id"`
	Label string `json:"label"`
}

// ChangeCounts counts the features added, removed and changed between two lists.
type ChangeCounts struct {
	Added   int `json:"added"`
	Removed int `json:"removed"`
	Changed int `json:"changed"`
}

// VersionDetailDTO is a version with its contents.
type VersionDetailDTO struct {
	VersionDTO
	Snapshot json.RawMessage `json:"snapshot"`
}

// List returns a project's versions, newest first, without their contents.
//
// GET /api/v1/projects/:id/versions[?changes=1]
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

	withChanges := c.Query("changes") == "1"
	query := h.db.Where("project_id = ?", projectID).Order("number DESC")
	if !withChanges {
		query = query.Omit("snapshot")
	}
	var versions []models.FeatureVersion
	if err := query.Find(&versions).Error; err != nil {
		api.Fail(c, api.Internal(err))
		return
	}

	// With changes=1, each version says what changed from the one saved
	// before it.
	counts := map[uint]*ChangeCounts{}
	if withChanges {
		lists := make([]OpenedProject, len(versions))
		for i, v := range versions {
			snap, err := readSnapshot(v.Snapshot)
			if err != nil {
				api.Fail(c, api.Internal(err))
				return
			}
			lists[i] = snap.OpenedProject
		}
		for i := 0; i+1 < len(versions); i++ {
			d := compareLists(lists[i+1], lists[i])
			counts[versions[i].ID] = &ChangeCounts{Added: d.Added, Removed: d.Removed, Changed: d.Changed}
		}
	}

	names, err := h.saverNames(versions)
	if err != nil {
		api.Fail(c, api.Internal(err))
		return
	}
	out := make([]VersionDTO, 0, len(versions))
	for _, v := range versions {
		dto := newVersionDTO(v, names)
		dto.Changes = counts[v.ID]
		dto.BasedOn = basedOnRef(versions, v)
		out = append(out, dto)
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
		VersionDTO: h.withBase(newVersionDTO(version, names), version),
		Snapshot:   json.RawMessage(version.Snapshot),
	})
}

// Create saves the project's feature list as it stands now, as the next
// version number.
//
// POST /api/v1/projects/:id/versions
//
// A tag is optional; when given it is unique within the project, ignoring
// case, so a tag names one version when people talk about it. Reading the list and numbering the version happen
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

	var version models.FeatureVersion
	txErr := h.db.Transaction(func(tx *gorm.DB) error {
		if tag == "" {
			var err error
			version, err = saveVersion(tx, project, "", strings.TrimSpace(req.Notes), userID, false)
			return err
		}
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
	api.Created(c, h.withBase(newVersionDTO(version, names), version))
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

	last, major, minor, err := nextNumbers(tx, project.ID)
	if err != nil {
		return models.FeatureVersion{}, api.Internal(err)
	}
	var basedOn *uint
	if last > 0 {
		var previous models.FeatureVersion
		if err := tx.Select("id").Where("project_id = ? AND number = ?", project.ID, last).First(&previous).Error; err != nil {
			return models.FeatureVersion{}, api.Internal(err)
		}
		basedOn = &previous.ID
	}

	version := models.FeatureVersion{
		ProjectID:    project.ID,
		Number:       last + 1,
		Major:        major,
		Minor:        minor + 1,
		BasedOnID:    basedOn,
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

// nextNumbers is what a new version is numbered from: the project's highest
// Number so far, its newest major (the last publish, 0 before any), and the
// highest minor saved under that major.
func nextNumbers(tx *gorm.DB, projectID int) (last, major, minor int, err error) {
	if err = tx.Model(&models.FeatureVersion{}).Where("project_id = ?", projectID).
		Select("COALESCE(MAX(number), 0)").Scan(&last).Error; err != nil {
		return
	}
	if err = tx.Model(&models.FeatureVersion{}).Where("project_id = ?", projectID).
		Select("COALESCE(MAX(major), 0)").Scan(&major).Error; err != nil {
		return
	}
	err = tx.Model(&models.FeatureVersion{}).Where("project_id = ? AND major = ?", projectID, major).
		Select("COALESCE(MAX(minor), 0)").Scan(&minor).Error
	return
}

// NumberVersions gives v-numbers to versions saved before they existed (both
// Major and Minor still 0). Per project, in the order they were saved: each
// publish is the next whole number, and the saves after it count up under
// it; saves before the first publish are v0.1, v0.2… A project with any
// numbered version is left alone.
func NumberVersions(db *gorm.DB) error {
	var projects []int
	if err := db.Model(&models.FeatureVersion{}).Where("major = 0 AND minor = 0").
		Distinct().Pluck("project_id", &projects).Error; err != nil {
		return err
	}
	for _, projectID := range projects {
		var numbered int64
		if err := db.Model(&models.FeatureVersion{}).
			Where("project_id = ? AND (major > 0 OR minor > 0)", projectID).Count(&numbered).Error; err != nil {
			return err
		}
		if numbered > 0 {
			continue
		}
		var versions []models.FeatureVersion
		if err := db.Omit("snapshot").Where("project_id = ?", projectID).Order("number").Find(&versions).Error; err != nil {
			return err
		}
		major, minor := 0, 0
		for _, v := range versions {
			if v.PublishNumber > 0 {
				major, minor = major+1, 0
			} else {
				minor++
			}
			if err := db.Model(&models.FeatureVersion{}).Where("id = ?", v.ID).
				Updates(map[string]any{"major": major, "minor": minor}).Error; err != nil {
				return err
			}
		}
	}
	return nil
}

// madeFromNote is the note going back, or publishing an older version, leaves.
var madeFromNote = regexp.MustCompile(`^(?:Went back to|Published again from) v(\d+)(?:\.(\d+))?$`)

// FillBasedOn gives versions saved before "based on" existed the version
// saved just before them as their base. The first version of a project has
// none. Versions that already have a base are left alone, so this is safe to
// run on every start.
func FillBasedOn(db *gorm.DB) error {
	var missing []models.FeatureVersion
	if err := db.Select("id", "project_id", "number", "notes").
		Where("based_on_id IS NULL AND number > 1").Find(&missing).Error; err != nil {
		return err
	}
	for _, v := range missing {
		// Going back and publishing an older version say in their note which
		// version they were made from.
		if m := madeFromNote.FindStringSubmatch(v.Notes); m != nil {
			major, _ := strconv.Atoi(m[1])
			minor := 0
			if m[2] != "" {
				minor, _ = strconv.Atoi(m[2])
			}
			var source models.FeatureVersion
			err := db.Select("id").Where("project_id = ? AND major = ? AND minor = ? AND number < ?",
				v.ProjectID, major, minor, v.Number).Order("number DESC").First(&source).Error
			if err == nil {
				if err := db.Model(&models.FeatureVersion{}).Where("id = ?", v.ID).Update("based_on_id", source.ID).Error; err != nil {
					return err
				}
				continue
			}
			if !errors.Is(err, gorm.ErrRecordNotFound) {
				return err
			}
		}
		var previous models.FeatureVersion
		err := db.Select("id").Where("project_id = ? AND number < ?", v.ProjectID, v.Number).
			Order("number DESC").First(&previous).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			continue
		}
		if err != nil {
			return err
		}
		if err := db.Model(&models.FeatureVersion{}).Where("id = ?", v.ID).Update("based_on_id", previous.ID).Error; err != nil {
			return err
		}
	}
	return nil
}

// basedOnRef names v's base from versions, which hold the whole project.
func basedOnRef(versions []models.FeatureVersion, v models.FeatureVersion) *VersionRef {
	if v.BasedOnID == nil {
		return nil
	}
	for _, other := range versions {
		if other.ID == *v.BasedOnID {
			return &VersionRef{ID: other.ID, Label: other.Label()}
		}
	}
	return nil
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

// withBase fills in what a single version is based on, looking its base up.
func (h *VersionsHandler) withBase(dto VersionDTO, v models.FeatureVersion) VersionDTO {
	if v.BasedOnID == nil {
		return dto
	}
	var base models.FeatureVersion
	if err := h.db.Select("id", "major", "minor").First(&base, *v.BasedOnID).Error; err == nil {
		dto.BasedOn = &VersionRef{ID: base.ID, Label: base.Label()}
	}
	return dto
}

func newVersionDTO(v models.FeatureVersion, names map[int]string) VersionDTO {
	return VersionDTO{
		ID:            v.ID,
		ProjectID:     v.ProjectID,
		Number:        v.Number,
		Label:         v.Label(),
		Major:         v.Major,
		Minor:         v.Minor,
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
