package v1

import (
	"encoding/json"
	"errors"
	"strings"

	"github.com/FeaturePlus/backend/api"
	"github.com/FeaturePlus/backend/internal/log"
	"github.com/FeaturePlus/backend/models"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// My Space › Working: copies made and edited online.
//
// Someone pulls a project's published list, or its working list, into a copy
// of their own and edits it in the page. It is the same kind of copy a file
// upload makes, so it can still be downloaded, edited offline and uploaded
// again. Only its owner sees it; nothing here changes the project's lists.
// Bringing a copy's changes back is merging, which is parked for now.

// StartCopyRequest says which list to start a copy from.
type StartCopyRequest struct {
	From string `json:"from" binding:"required,oneof=published working"`
	Name string `json:"name" binding:"max=80"`
}

// SaveCopyListRequest is a copy's list as edited online, at the revision the
// page last loaded.
type SaveCopyListRequest struct {
	Revision int       `json:"revision" binding:"required"`
	Name     *string   `json:"name" binding:"omitempty,max=80"`
	Features []CopyRow `json:"features" binding:"max=1000,dive"`
}

// MyCopyDTO is one of the signed-in person's copies, with the project it is of.
type MyCopyDTO struct {
	CopyDTO
	Project OpenedProjectName `json:"project"`
}

// StartCopy makes the signed-in person a new copy of a project's published
// list, or of its working list as it is now.
//
// POST /api/v1/projects/:id/copies/start
//
// A copy is always based on a saved version, which is what a later merge
// compares against. From the published list that is the latest publish. From
// the working list it is the newest version when nothing has changed since,
// and otherwise the list is saved as an automatic version first.
func (h *VersionsHandler) StartCopy(c *gin.Context) {
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
	userID, err := api.UserID(c)
	if err != nil {
		api.Fail(c, err)
		return
	}

	var req StartCopyRequest
	if err := api.Bind(c, &req); err != nil {
		api.Fail(c, err)
		return
	}

	var saved models.FeatureCopy
	txErr := h.db.Transaction(func(tx *gorm.DB) error {
		var base models.FeatureVersion
		if req.From == "published" {
			latest, found, err := latestPublished(tx, projectID)
			if err != nil {
				return api.Internal(err)
			}
			if !found {
				return api.Validation("Nothing has been published in this project yet").
					WithField("from", "Nothing published yet")
			}
			base = latest
		} else {
			var err error
			if base, err = workingBase(tx, project, userID); err != nil {
				return err
			}
		}

		var last int
		if err := tx.Model(&models.FeatureCopy{}).Where("project_id = ?", projectID).
			Select("COALESCE(MAX(number), 0)").Scan(&last).Error; err != nil {
			return api.Internal(err)
		}
		saved = models.FeatureCopy{
			ProjectID:     projectID,
			Number:        last + 1,
			BaseVersionID: base.ID,
			OwnerID:       userID,
			Name:          strings.TrimSpace(req.Name),
			Source:        req.From,
			Revision:      1,
			FeatureCount:  base.FeatureCount,
			Snapshot:      base.Snapshot,
		}
		if err := tx.Create(&saved).Error; err != nil {
			return api.Internal(err)
		}
		return nil
	})
	if txErr != nil {
		api.Fail(c, txErr)
		return
	}

	log.WithField("project", projectID).WithField("copy", saved.Number).WithField("from", req.From).Info("copy started")

	out, err := h.copyDTOs([]models.FeatureCopy{saved}, userID)
	if err != nil {
		api.Fail(c, api.Internal(err))
		return
	}
	api.Created(c, CopyDetailDTO{CopyDTO: out[0], Snapshot: json.RawMessage(saved.Snapshot)})
}

// workingBase is a saved version holding the project's list as it is now: the
// newest version if it already does, or else a new automatic one.
func workingBase(tx *gorm.DB, project *models.Project, userID int) (models.FeatureVersion, error) {
	opened, err := openProject(tx, project, true)
	if err != nil {
		return models.FeatureVersion{}, api.Internal(err)
	}
	now, err := json.Marshal(versionSnapshot{Format: snapshotFormat, OpenedProject: opened})
	if err != nil {
		return models.FeatureVersion{}, api.Internal(err)
	}

	var newest models.FeatureVersion
	err = tx.Where("project_id = ?", project.ID).Order("number DESC").First(&newest).Error
	switch {
	case err == nil && newest.Snapshot == string(now):
		return newest, nil
	case err != nil && !errors.Is(err, gorm.ErrRecordNotFound):
		return models.FeatureVersion{}, api.Internal(err)
	}

	tag, err := freeTag(tx, project.ID, "Starting point for a copy")
	if err != nil {
		return models.FeatureVersion{}, api.Internal(err)
	}
	return saveVersion(tx, project, tag, "Saved automatically when a copy was started from the Working list", userID, true)
}

// SaveCopyList saves a copy's list as edited online.
//
// PUT /api/v1/projects/:id/copies/:copyId/list
//
// Only the copy's owner can save it, and only while it is neither published
// nor merged. The revision must be the one the page loaded, so a second tab
// cannot quietly undo the first.
func (h *VersionsHandler) SaveCopyList(c *gin.Context) {
	projectID, err := api.IDParam(c, "id")
	if err != nil {
		api.Fail(c, err)
		return
	}
	copyID, err := api.IDParam(c, "copyId")
	if err != nil {
		api.Fail(c, err)
		return
	}
	if _, err := requireProject(c, h.db, projectID, canView); err != nil {
		api.Fail(c, err)
		return
	}
	userID, err := api.UserID(c)
	if err != nil {
		api.Fail(c, err)
		return
	}

	var req SaveCopyListRequest
	if err := api.Bind(c, &req); err != nil {
		api.Fail(c, err)
		return
	}

	var fc models.FeatureCopy
	txErr := h.db.Transaction(func(tx *gorm.DB) error {
		if dbErr := tx.Where("id = ? AND project_id = ? AND owner_id = ?", copyID, projectID, userID).
			First(&fc).Error; dbErr != nil {
			return api.FromDB(dbErr, "Copy")
		}
		if fc.MergedAt != nil {
			return api.Conflict("This copy has been merged, so it stays as it was")
		}
		if fc.PublishedAt != nil {
			return api.Conflict("This copy is published, so it stays as people saw it")
		}
		if req.Revision != fc.Revision {
			return api.Conflict("This copy was changed somewhere else, perhaps in another tab. Reload it to carry on from the latest")
		}

		var base models.FeatureVersion
		if dbErr := tx.First(&base, fc.BaseVersionID).Error; dbErr != nil {
			return api.Internal(dbErr)
		}
		baseSnap, err := readSnapshot(base.Snapshot)
		if err != nil {
			return api.Internal(err)
		}
		current, err := readSnapshot(fc.Snapshot)
		if err != nil {
			return api.Internal(err)
		}

		features, err := buildCopyRows(req.Features, current.Features, baseSnap.Features)
		if err != nil {
			return err
		}
		snapshot, err := json.Marshal(versionSnapshot{
			Format: snapshotFormat,
			OpenedProject: OpenedProject{
				Project:  current.Project,
				Features: features,
				Releases: current.Releases,
			},
		})
		if err != nil {
			return api.Internal(err)
		}

		if req.Name != nil {
			fc.Name = strings.TrimSpace(*req.Name)
		}
		fc.Revision++
		fc.FeatureCount = len(features)
		fc.Snapshot = string(snapshot)
		if err := tx.Save(&fc).Error; err != nil {
			return api.Internal(err)
		}
		return nil
	})
	if txErr != nil {
		api.Fail(c, txErr)
		return
	}

	out, err := h.copyDTOs([]models.FeatureCopy{fc}, userID)
	if err != nil {
		api.Fail(c, api.Internal(err))
		return
	}
	api.OK(c, CopyDetailDTO{CopyDTO: out[0], Snapshot: json.RawMessage(fc.Snapshot)})
}

// DeleteCopy removes one of the signed-in person's own copies. A merged copy
// is part of the project's history and stays.
//
// DELETE /api/v1/projects/:id/copies/:copyId
func (h *VersionsHandler) DeleteCopy(c *gin.Context) {
	projectID, err := api.IDParam(c, "id")
	if err != nil {
		api.Fail(c, err)
		return
	}
	copyID, err := api.IDParam(c, "copyId")
	if err != nil {
		api.Fail(c, err)
		return
	}
	if _, err := requireProject(c, h.db, projectID, canView); err != nil {
		api.Fail(c, err)
		return
	}
	userID, err := api.UserID(c)
	if err != nil {
		api.Fail(c, err)
		return
	}

	var fc models.FeatureCopy
	if dbErr := h.db.Where("id = ? AND project_id = ? AND owner_id = ?", copyID, projectID, userID).
		First(&fc).Error; dbErr != nil {
		api.Fail(c, api.FromDB(dbErr, "Copy"))
		return
	}
	if fc.MergedAt != nil {
		api.Fail(c, api.Conflict("This copy has been merged into the list, so it is kept"))
		return
	}
	if err := h.db.Delete(&fc).Error; err != nil {
		api.Fail(c, api.Internal(err))
		return
	}
	log.WithField("project", projectID).WithField("copy", fc.Number).Info("copy deleted")
	api.NoContent(c)
}

// ListMyCopies returns the signed-in person's own copies in every project they
// can still see, the most recently changed first.
//
// GET /api/v1/me/copies
func (h *VersionsHandler) ListMyCopies(c *gin.Context) {
	userID, err := api.UserID(c)
	if err != nil {
		api.Fail(c, err)
		return
	}

	var copies []models.FeatureCopy
	if err := h.db.Omit("snapshot").Where("owner_id = ?", userID).
		Order("updated_at DESC, id DESC").Find(&copies).Error; err != nil {
		api.Fail(c, api.Internal(err))
		return
	}

	// Only projects that still exist and the person can still see.
	projects := map[int]*models.Project{}
	visible := make([]models.FeatureCopy, 0, len(copies))
	for _, fc := range copies {
		project, seen := projects[fc.ProjectID]
		if !seen {
			var p models.Project
			if dbErr := h.db.First(&p, fc.ProjectID).Error; dbErr == nil {
				role, roleErr := projectRole(h.db, &p, userID)
				if roleErr != nil {
					api.Fail(c, api.Internal(roleErr))
					return
				}
				if role != "" || api.IsAdmin(c) {
					project = &p
				}
			} else if !errors.Is(dbErr, gorm.ErrRecordNotFound) {
				api.Fail(c, api.Internal(dbErr))
				return
			}
			projects[fc.ProjectID] = project
		}
		if project != nil {
			visible = append(visible, fc)
		}
	}

	dtos, err := h.copyDTOs(visible, userID)
	if err != nil {
		api.Fail(c, api.Internal(err))
		return
	}
	out := make([]MyCopyDTO, 0, len(dtos))
	for i, d := range dtos {
		p := projects[visible[i].ProjectID]
		out = append(out, MyCopyDTO{CopyDTO: d, Project: OpenedProjectName{ID: p.ID, Name: p.Name}})
	}
	api.OK(c, out)
}
