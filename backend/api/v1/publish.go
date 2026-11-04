package v1

import (
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/FeaturePlus/backend/api"
	"github.com/FeaturePlus/backend/internal/log"
	"github.com/FeaturePlus/backend/models"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// Publishing, and going back to an old version.
//
// The Feature List is saved as minor versions, v2.1, v2.2… on top of the last
// publish. Publishing takes a saved version and makes it the next whole
// number: publishing v2.2 turns it into v3. Any saved version can be
// published, an older one too; that one stays where it is in the history and
// a new row, v4, is made from it, so the history keeps the order things
// happened in. The Published list shows the newest publish.
//
// Going back puts a saved version in place of the Feature List. It is only
// allowed when every change to the list is saved as a version, so nothing
// can be lost, and it is saved as a version itself afterwards.
//
// Publishing needs the owner or a publisher; opening a version as the
// working version, an editor.

// PublishRequest is the accepted body for publishing. The note is optional.
type PublishRequest struct {
	Notes string `json:"notes" binding:"max=2000"`
}

// Publish publishes one saved version.
//
// POST /api/v1/projects/:id/versions/:versionId/publish
func (h *VersionsHandler) Publish(c *gin.Context) {
	project, versionID, userID, ok := h.versionTarget(c, canPublish)
	if !ok {
		return
	}
	var req PublishRequest
	if err := api.Bind(c, &req); err != nil {
		api.Fail(c, err)
		return
	}
	note := strings.TrimSpace(req.Notes)

	var published models.FeatureVersion
	txErr := h.db.Transaction(func(tx *gorm.DB) error {
		var version models.FeatureVersion
		if dbErr := tx.Where("id = ? AND project_id = ?", versionID, project.ID).First(&version).Error; dbErr != nil {
			return api.FromDB(dbErr, "Version")
		}
		live, found, err := latestPublished(tx, project.ID)
		if err != nil {
			return api.Internal(err)
		}
		if found && live.ID == version.ID {
			return api.Conflict(version.Label() + " is already the published version")
		}
		if found {
			same, err := sameLists(live.Snapshot, version.Snapshot)
			if err != nil {
				return api.Internal(err)
			}
			if same {
				return api.Conflict(version.Label() + " is the same as the published " + live.Label())
			}
		}

		last, major, _, err := nextNumbers(tx, project.ID)
		if err != nil {
			return api.Internal(err)
		}
		publishNumber := 1
		if found {
			publishNumber = live.PublishNumber + 1
		}
		now := time.Now()

		if version.Number == last && version.PublishNumber == 0 {
			// The newest save becomes the next whole number in place.
			updates := map[string]any{
				"major": major + 1, "minor": 0, "publish_number": publishNumber, "published_at": now,
			}
			if note != "" {
				updates["notes"] = note
			}
			if err := tx.Model(&version).Updates(updates).Error; err != nil {
				return api.Internal(err)
			}
			published = version
			return tx.First(&published, version.ID).Error
		}

		// An older version: published as a new row, so the history stays in order.
		if note == "" {
			note = "Published again from " + version.Label()
		}
		published = models.FeatureVersion{
			ProjectID: project.ID, Number: last + 1, Major: major + 1, Minor: 0,
			BasedOnID: &version.ID,
			Tag:       "", Notes: note, SavedByID: userID,
			PublishNumber: publishNumber, PublishedAt: &now,
			FeatureCount: version.FeatureCount, Snapshot: version.Snapshot,
		}
		if err := tx.Create(&published).Error; err != nil {
			return api.Internal(err)
		}
		// A working version opened from that version holds the same list as
		// the publish, so it is based on the publish now.
		base, found, err := basedOnNow(tx, project.ID)
		if err != nil {
			return api.Internal(err)
		}
		if found && base.ID == version.ID {
			if err := setWorkingBase(tx, project.ID, published.ID); err != nil {
				return api.Internal(err)
			}
		}
		return nil
	})
	if txErr != nil {
		api.Fail(c, txErr)
		return
	}

	log.WithField("project", project.ID).WithField("version", published.Label()).Info("version published")

	names, err := h.saverNames([]models.FeatureVersion{published})
	if err != nil {
		api.Fail(c, api.Internal(err))
		return
	}
	api.Created(c, h.withBase(newVersionDTO(published, names), published))
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
		VersionDTO: h.withBase(newVersionDTO(version, names), version),
		Snapshot:   []byte(version.Snapshot),
	})
}

// RestorePreview is what putting a version back as the Feature List would do.
// Unsaved counts the list's changes not saved as a version yet; while there
// are any, going back is refused. Described names the features whose
// description or notes would change.
type RestorePreview struct {
	Version VersionDTO `json:"version"`
	Unsaved int        `json:"unsaved"`
	// Latest is the label of the version the working version is based on now.
	Latest    string        `json:"latest"`
	Changes   []MergeChange `json:"changes"`
	Described []string      `json:"described"`
	Notes     []MergeNote   `json:"notes"`
	Problems  []string      `json:"problems"`
	Ready     bool          `json:"ready"`
}

// RestoreResult is a version opened as the working version: what changed, and
// the version the working version is now based on.
type RestoreResult struct {
	Changes   []MergeChange `json:"changes"`
	Described []string      `json:"described"`
	Notes     []MergeNote   `json:"notes"`
	Base      VersionDTO    `json:"base"`
}

// RestoreRequest opens a version as the working version. Discard says the
// working version's unsaved changes may be thrown away; without it, going
// ahead with unsaved changes is refused.
type RestoreRequest struct {
	Discard bool `json:"discard"`
}

// restoreInputs is everything going back is worked out from.
type restoreInputs struct {
	version    models.FeatureVersion
	target     OpenedProject
	live       OpenedProject
	taskCounts map[uint]int
	unsaved    int
	latest     string
	plan       mergePlan
	described  []string
}

// planRestore works out putting a version back as the list. It is a merge of
// the version into the list with the list itself as the base: everything the
// version has differently is taken, nothing clashes, and the merge's rules
// hold — a feature with tasks is never deleted, nor one with something inside.
func planRestore(db *gorm.DB, project *models.Project, versionID uint) (restoreInputs, error) {
	var in restoreInputs
	if dbErr := db.Where("id = ? AND project_id = ?", versionID, project.ID).First(&in.version).Error; dbErr != nil {
		return in, api.FromDB(dbErr, "Version")
	}
	snap, err := readSnapshot(in.version.Snapshot)
	if err != nil {
		return in, api.Internal(err)
	}
	in.target = snap.OpenedProject
	if in.live, err = openProject(db, project, true); err != nil {
		return in, api.Internal(err)
	}

	latest, found, err := basedOnNow(db, project.ID)
	if err != nil {
		return in, api.Internal(err)
	}
	if !found {
		return in, api.Conflict("Nothing is saved yet")
	}
	in.latest = latest.Label()
	latestSnap, err := readSnapshot(latest.Snapshot)
	if err != nil {
		return in, api.Internal(err)
	}
	diff := compareLists(latestSnap.OpenedProject, in.live)
	in.unsaved = diff.Added + diff.Removed + diff.Changed

	if in.taskCounts, err = taskCountsOf(db, in.live); err != nil {
		return in, api.Internal(err)
	}
	in.plan = planMerge(in.live, in.target, in.live, in.taskCounts, nil)
	// The merge's notes speak of a copy; going back has a version instead.
	for i, note := range in.plan.notes {
		in.plan.notes[i].Message = strings.ReplaceAll(strings.ReplaceAll(note.Message,
			"The copy adds it, but the list already has a feature by that name, so that one is used",
			in.version.Label()+" has it, and the list has a feature by that name now, so that one is kept"),
			"The copy", in.version.Label())
	}

	liveRows := indexRows(in.live.Features)
	for _, row := range in.target.Features {
		now, ok := liveRows[row.Key]
		if ok && (now.Description != row.Description || now.Notes != row.Notes) {
			in.described = append(in.described, row.Title)
		}
	}
	if in.described == nil {
		in.described = []string{}
	}
	return in, nil
}

func (in restoreInputs) ready() bool {
	return in.unsaved == 0 && len(in.plan.problems) == 0
}

// PreviewRestore says what putting a version back as the Feature List would do.
//
// GET /api/v1/projects/:id/versions/:versionId/restore
func (h *VersionsHandler) PreviewRestore(c *gin.Context) {
	project, versionID, _, ok := h.versionTarget(c, canEdit)
	if !ok {
		return
	}
	in, err := planRestore(h.db, project, versionID)
	if err != nil {
		api.Fail(c, err)
		return
	}
	names, err := h.saverNames([]models.FeatureVersion{in.version})
	if err != nil {
		api.Fail(c, api.Internal(err))
		return
	}
	api.OK(c, RestorePreview{
		Version: h.withBase(newVersionDTO(in.version, names), in.version), Unsaved: in.unsaved, Latest: in.latest,
		Changes: in.plan.changes, Described: in.described, Notes: in.plan.notes, Problems: in.plan.problems,
		Ready: in.ready(),
	})
}

// Restore opens a saved version as the working version: the Feature List
// takes its names, nesting, dependencies, descriptions and notes. Status,
// priority and tasks are left as they are. Nothing new is saved: the working
// version is now based on that version.
//
// Opening the version it is already based on, with discard, throws away the
// working version's unsaved changes.
//
// POST /api/v1/projects/:id/versions/:versionId/restore
func (h *VersionsHandler) Restore(c *gin.Context) {
	project, versionID, userID, ok := h.versionTarget(c, canEdit)
	if !ok {
		return
	}
	var req RestoreRequest
	if c.Request.ContentLength > 0 {
		if err := api.Bind(c, &req); err != nil {
			api.Fail(c, err)
			return
		}
	}

	var result RestoreResult
	var opened models.FeatureVersion
	txErr := h.db.Transaction(func(tx *gorm.DB) error {
		in, err := planRestore(tx, project, versionID)
		if err != nil {
			return err
		}
		if in.unsaved > 0 && !req.Discard {
			return api.Conflict("The working version has " + plural(in.unsaved, "change") +
				" not saved as a version yet. Save them first, or discard them")
		}
		if len(in.plan.problems) > 0 {
			return api.Conflict("Going back to " + in.version.Label() + " is blocked: " + strings.Join(in.plan.problems, "; "))
		}

		ids, err := applyMerge(tx, project.ID, in.live, in.plan, uint(userID), "From going back to "+in.version.Label(), true)
		if err != nil {
			return err
		}
		// Discarding changes puts back everything the version holds, status and
		// priority too; opening another version leaves progress as it is.
		discarding := req.Discard && in.version.Label() == in.latest
		liveRows := indexRows(in.live.Features)
		for _, row := range in.target.Features {
			id := ids[row.Key]
			if id == 0 {
				continue
			}
			now, existed := liveRows[row.Key]
			updates := map[string]any{}
			if !existed || now.Description != row.Description || now.Notes != row.Notes {
				updates["description"], updates["notes"] = row.Description, row.Notes
			}
			if discarding {
				if row.Status != "" && (!existed || now.Status != row.Status) {
					updates["status"] = row.Status
				}
				if row.Priority != "" && (!existed || now.Priority != row.Priority) {
					updates["priority"] = row.Priority
				}
				if row.Category != "" && (!existed || now.Category != row.Category) {
					updates["category"] = row.Category
				}
			}
			if len(updates) == 0 {
				continue
			}
			if err := tx.Model(&models.Feature{}).Where("id = ?", id).Updates(updates).Error; err != nil {
				return err
			}
		}

		if err := setWorkingBase(tx, project.ID, in.version.ID); err != nil {
			return err
		}
		opened = in.version
		result = RestoreResult{Changes: in.plan.changes, Described: in.described, Notes: in.plan.notes}
		return nil
	})
	if txErr != nil {
		var refused *api.Error
		if errors.As(txErr, &refused) {
			api.Fail(c, refused)
		} else {
			api.Fail(c, api.FromDB(txErr, "Feature"))
		}
		return
	}

	names, err := h.saverNames([]models.FeatureVersion{opened})
	if err != nil {
		api.Fail(c, api.Internal(err))
		return
	}
	result.Base = h.withBase(newVersionDTO(opened, names), opened)
	log.WithField("project", project.ID).WithField("version", opened.Label()).Info("version opened as the working version")
	api.OK(c, result)
}

// versionTarget reads :id and :versionId and checks the caller has need.
func (h *VersionsHandler) versionTarget(c *gin.Context, need models.ProjectRole) (*models.Project, uint, int, bool) {
	projectID, err := api.IDParam(c, "id")
	if err != nil {
		api.Fail(c, err)
		return nil, 0, 0, false
	}
	versionID, err := api.IDParam(c, "versionId")
	if err != nil {
		api.Fail(c, err)
		return nil, 0, 0, false
	}
	project, err := requireProject(c, h.db, projectID, need)
	if err != nil {
		api.Fail(c, err)
		return nil, 0, 0, false
	}
	userID, err := api.UserID(c)
	if err != nil {
		api.Fail(c, err)
		return nil, 0, 0, false
	}
	return project, uint(versionID), userID, true
}

// sameLists reports whether two snapshots hold the same list, feature by
// feature, whatever order their JSON is in.
func sameLists(a, b string) (bool, error) {
	if a == b {
		return true, nil
	}
	var x, y versionSnapshot
	if err := json.Unmarshal([]byte(a), &x); err != nil {
		return false, err
	}
	if err := json.Unmarshal([]byte(b), &y); err != nil {
		return false, err
	}
	diff := compareLists(x.OpenedProject, y.OpenedProject)
	return diff.Added+diff.Removed+diff.Changed == 0, nil
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
