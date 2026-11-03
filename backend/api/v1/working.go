package v1

import (
	"errors"
	"strconv"
	"strings"
	"time"

	"github.com/FeaturePlus/backend/api"
	"github.com/FeaturePlus/backend/models"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// The working version: the project's Feature List, as it stands against the
// saved version it is based on.
//
// It is based on the version it was last saved as, or the one last opened as
// the working version from the Versions page. Changes are counted against
// that version, which is also the one the Versions page marks Live.

// WorkingDTO is where the working version stands.
type WorkingDTO struct {
	// Base is the version the working version is based on; nil before any save.
	Base *VersionDTO `json:"base"`
	// Unsaved counts the features that differ from Base; nil when there is no Base.
	Unsaved *ChangeCounts `json:"unsaved"`
	Note    string        `json:"note"`
	NoteBy  string        `json:"note_by"`
	// NextSave and NextPublish are the numbers a save or a publish would get now.
	NextSave    string `json:"next_save"`
	NextPublish string `json:"next_publish"`
}

// WorkingNoteRequest sets the working version's note; empty clears it.
type WorkingNoteRequest struct {
	Note string `json:"note" binding:"max=2000"`
}

// VersionNoteRequest changes a saved version's note.
type VersionNoteRequest struct {
	Notes string `json:"notes" binding:"max=2000"`
}

// basedOnNow is the version a project's working version is based on: the one
// recorded, or else the newest. found is false when nothing is saved yet.
func basedOnNow(db *gorm.DB, projectID int) (models.FeatureVersion, bool, error) {
	var state models.WorkingState
	err := db.Where("project_id = ?", projectID).Limit(1).Find(&state).Error
	if err != nil {
		return models.FeatureVersion{}, false, err
	}
	var version models.FeatureVersion
	if state.BaseVersionID != nil {
		err := db.Where("id = ? AND project_id = ?", *state.BaseVersionID, projectID).First(&version).Error
		if err == nil {
			return version, true, nil
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return version, false, err
		}
	}
	err = db.Where("project_id = ?", projectID).Order("number DESC").First(&version).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return version, false, nil
	}
	return version, err == nil, err
}

// setWorkingBase records the version the working version is now based on.
func setWorkingBase(db *gorm.DB, projectID int, versionID uint) error {
	return db.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "project_id"}},
		DoUpdates: clause.AssignmentColumns([]string{"base_version_id", "updated_at"}),
	}).Create(&models.WorkingState{ProjectID: projectID, BaseVersionID: &versionID, UpdatedAt: time.Now()}).Error
}

// Working says where the working version stands.
//
// GET /api/v1/projects/:id/working
func (h *VersionsHandler) Working(c *gin.Context) {
	projectID, err := api.IDParam(c, "id")
	if err != nil {
		api.Fail(c, err)
		return
	}
	project, err := requireProject(c, h.db, projectID, canView)
	if err != nil {
		api.Fail(c, err)
		return
	}

	out := WorkingDTO{}
	base, found, err := basedOnNow(h.db, projectID)
	if err != nil {
		api.Fail(c, api.Internal(err))
		return
	}
	if found {
		names, err := h.saverNames([]models.FeatureVersion{base})
		if err != nil {
			api.Fail(c, api.Internal(err))
			return
		}
		dto := h.withBase(newVersionDTO(base, names), base)
		out.Base = &dto
		snap, err := readSnapshot(base.Snapshot)
		if err != nil {
			api.Fail(c, api.Internal(err))
			return
		}
		now, err := openProject(h.db, project, true)
		if err != nil {
			api.Fail(c, api.Internal(err))
			return
		}
		d := compareLists(snap.OpenedProject, now)
		out.Unsaved = &ChangeCounts{Added: d.Added, Removed: d.Removed, Changed: d.Changed}
	}

	_, major, minor, err := nextNumbers(h.db, projectID)
	if err != nil {
		api.Fail(c, api.Internal(err))
		return
	}
	out.NextSave = "v" + strconv.Itoa(major) + "." + strconv.Itoa(minor+1)
	out.NextPublish = "v" + strconv.Itoa(major+1)

	var state models.WorkingState
	if err := h.db.Where("project_id = ?", projectID).Limit(1).Find(&state).Error; err != nil {
		api.Fail(c, api.Internal(err))
		return
	}
	out.Note = state.Note
	if state.Note != "" && state.NoteByID != 0 {
		names, err := h.saverNames([]models.FeatureVersion{{SavedByID: state.NoteByID}})
		if err == nil {
			out.NoteBy = names[state.NoteByID]
		}
	}
	api.OK(c, out)
}

// SetWorkingNote sets the working version's note.
//
// PATCH /api/v1/projects/:id/working
func (h *VersionsHandler) SetWorkingNote(c *gin.Context) {
	projectID, err := api.IDParam(c, "id")
	if err != nil {
		api.Fail(c, err)
		return
	}
	if _, err := requireProject(c, h.db, projectID, canEdit); err != nil {
		api.Fail(c, err)
		return
	}
	userID, err := api.UserID(c)
	if err != nil {
		api.Fail(c, err)
		return
	}
	var req WorkingNoteRequest
	if err := api.Bind(c, &req); err != nil {
		api.Fail(c, err)
		return
	}
	if err := setWorkingNote(h.db, projectID, strings.TrimSpace(req.Note), userID); err != nil {
		api.Fail(c, api.Internal(err))
		return
	}
	api.NoContent(c)
}

func setWorkingNote(db *gorm.DB, projectID int, note string, userID int) error {
	now := time.Now()
	return db.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "project_id"}},
		DoUpdates: clause.AssignmentColumns([]string{"note", "note_by_id", "note_updated", "updated_at"}),
	}).Create(&models.WorkingState{ProjectID: projectID, Note: note, NoteByID: userID, NoteUpdated: &now, UpdatedAt: now}).Error
}

// SetVersionNote changes a saved version's note. Only the note: what a
// version holds never changes.
//
// PATCH /api/v1/projects/:id/versions/:versionId
func (h *VersionsHandler) SetVersionNote(c *gin.Context) {
	project, versionID, _, ok := h.versionTarget(c, canEdit)
	if !ok {
		return
	}
	var req VersionNoteRequest
	if err := api.Bind(c, &req); err != nil {
		api.Fail(c, err)
		return
	}
	var version models.FeatureVersion
	if dbErr := h.db.Where("id = ? AND project_id = ?", versionID, project.ID).First(&version).Error; dbErr != nil {
		api.Fail(c, api.FromDB(dbErr, "Version"))
		return
	}
	notes := strings.TrimSpace(req.Notes)
	// The note now names the version, so an old tag no longer stands in for it.
	if err := h.db.Model(&version).Updates(map[string]any{"notes": notes, "tag": ""}).Error; err != nil {
		api.Fail(c, api.Internal(err))
		return
	}
	version.Notes, version.Tag = notes, ""
	names, err := h.saverNames([]models.FeatureVersion{version})
	if err != nil {
		api.Fail(c, api.Internal(err))
		return
	}
	api.OK(c, h.withBase(newVersionDTO(version, names), version))
}
