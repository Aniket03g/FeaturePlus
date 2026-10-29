package v1

import (
	"errors"
	"strconv"
	"strings"
	"time"

	"github.com/FeaturePlus/backend/api"
	"github.com/FeaturePlus/backend/internal/log"
	"github.com/FeaturePlus/backend/models"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// Publishing turns the in-progress list into the published one.
//
// A publish is a saved version with a publish number: the in-progress list as
// it stands is saved as the next version and numbered Published #1, #2, #3…
// The published list shows the latest of these. Nothing about the in-progress
// list changes, and published versions are never edited, like any other.

// PublishRequest is the accepted body for publishing. The note is optional.
type PublishRequest struct {
	Notes string `json:"notes" binding:"max=2000"`
}

// Publish saves the project's list as the next published version.
//
// POST /api/v1/projects/:id/publish
//
// Owners and editors may publish. A publish with nothing changed since the
// last one is refused, so the history only holds real changes.
func (h *VersionsHandler) Publish(c *gin.Context) {
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

	var req PublishRequest
	if err := api.Bind(c, &req); err != nil {
		api.Fail(c, err)
		return
	}

	var version models.FeatureVersion
	txErr := h.db.Transaction(func(tx *gorm.DB) error {
		last, found, err := latestPublished(tx, projectID)
		if err != nil {
			return api.Internal(err)
		}
		number := 1
		if found {
			number = last.PublishNumber + 1
		}

		tag, err := freeTag(tx, projectID, "Published #"+strconv.Itoa(number))
		if err != nil {
			return api.Internal(err)
		}
		version, err = saveVersion(tx, project, tag, strings.TrimSpace(req.Notes), userID, false)
		if err != nil {
			return err
		}
		// Returning an error rolls the save back.
		if found && version.Snapshot == last.Snapshot {
			return api.Conflict("Nothing has changed since Published #" + strconv.Itoa(last.PublishNumber))
		}

		now := time.Now()
		version.PublishNumber = number
		version.PublishedAt = &now
		if err := tx.Model(&version).Updates(map[string]any{
			"publish_number": number,
			"published_at":   now,
		}).Error; err != nil {
			return api.Internal(err)
		}
		return nil
	})
	if txErr != nil {
		api.Fail(c, txErr)
		return
	}

	log.WithField("project", projectID).WithField("publish", version.PublishNumber).Info("list published")

	names, err := h.saverNames([]models.FeatureVersion{version})
	if err != nil {
		api.Fail(c, api.Internal(err))
		return
	}
	api.Created(c, newVersionDTO(version, names))
}

// Published returns the latest published version with its contents, or null
// when nothing has been published yet.
//
// GET /api/v1/projects/:id/published
func (h *VersionsHandler) Published(c *gin.Context) {
	projectID, err := api.IDParam(c, "id")
	if err != nil {
		api.Fail(c, err)
		return
	}
	if _, err := requireProject(c, h.db, projectID, canView); err != nil {
		api.Fail(c, err)
		return
	}

	version, found, err := latestPublished(h.db, projectID)
	if err != nil {
		api.Fail(c, api.Internal(err))
		return
	}
	if !found {
		api.OK(c, nil)
		return
	}

	names, err := h.saverNames([]models.FeatureVersion{version})
	if err != nil {
		api.Fail(c, api.Internal(err))
		return
	}
	api.OK(c, VersionDetailDTO{
		VersionDTO: newVersionDTO(version, names),
		Snapshot:   []byte(version.Snapshot),
	})
}

// latestPublished is the project's most recent published version, if any.
func latestPublished(db *gorm.DB, projectID int) (models.FeatureVersion, bool, error) {
	var version models.FeatureVersion
	err := db.Where("project_id = ? AND publish_number > 0", projectID).
		Order("publish_number DESC").First(&version).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return version, false, nil
	}
	if err != nil {
		return version, false, err
	}
	return version, true, nil
}
