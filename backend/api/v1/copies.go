package v1

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
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

// Your own copy of a version.
//
// Someone downloads a saved version as markdown, edits it in whatever they
// like, and uploads it back. The upload is kept as their copy, saved against
// the version the file was made from. The project's real list is not touched;
// bringing a copy's changes into it is a later step.
//
// The file carries a stamp naming its project, its version and, once it has
// been uploaded, its copy and revision, plus a hidden key on every feature.
// The page reads those and sends the list as rows. The server only ever saves
// a copy against the version it came from: a file whose stamp disagrees with
// the copy it names, or that was downloaded before the copy's last upload, is
// refused.
//
// A copy is seen only by the person who made it until they publish it. Then
// everyone on the project sees it, and it is frozen until it is unpublished.
// Anyone who can see a project can make copies of its versions and publish
// them, since neither changes the project's list.

// CopyRow is one feature of an uploaded list. Key is the hidden key the file
// carried, or a new one the page made up for a feature added in the file.
type CopyRow struct {
	Key       string   `json:"key" binding:"required,max=64"`
	Title     string   `json:"title" binding:"required,max=255"`
	ParentKey string   `json:"parent_key" binding:"max=64"`
	Needs     []string `json:"needs" binding:"max=100,dive,max=64"`

	// Set when the copy is edited online in My Space, which carries the text
	// and progress too; a file upload leaves them nil and they are kept.
	Description *string `json:"description,omitempty" binding:"omitempty,max=200000"`
	Notes       *string `json:"notes,omitempty" binding:"omitempty,max=200000"`
	Status      *string `json:"status,omitempty" binding:"omitempty,oneof=todo in_progress done"`
	Priority    *string `json:"priority,omitempty" binding:"omitempty,oneof=low medium high"`
}

// SaveCopyRequest is an uploaded list and what its stamp said.
type SaveCopyRequest struct {
	BaseVersionID uint `json:"base_version_id" binding:"required"`
	// Name names a new copy, or renames the copy being replaced; empty keeps
	// the name it has.
	Name string `json:"name" binding:"max=80"`
	// CopyID and Revision are set when the file was downloaded from a copy:
	// that copy is updated, as long as it is still at that revision.
	CopyID   uint      `json:"copy_id"`
	Revision int       `json:"revision"`
	Features []CopyRow `json:"features" binding:"max=1000,dive"`
	// DryRun checks the file and says what it changes, without saving.
	DryRun bool `json:"dry_run"`
}

// CopyCheck is what a dry-run upload answers: the version the file was made
// from, the copy it would replace (none for a new copy), and what the file
// changes compared with that version, both lists included.
type CopyCheck struct {
	Base       CopyBase          `json:"base"`
	Replaces   *CopyDTO          `json:"replaces"`
	Comparison VersionComparison `json:"comparison"`
}

// CopyBase names the version a copy was made from.
type CopyBase struct {
	ID     uint   `json:"id"`
	Number int    `json:"number"`
	Tag    string `json:"tag"`
	// PublishNumber is set when the version was a publish.
	PublishNumber int `json:"publish_number"`
}

// CopyDTO describes a copy without its contents.
type CopyDTO struct {
	ID        uint   `json:"id"`
	ProjectID int    `json:"project_id"`
	Number    int    `json:"number"`
	Name      string `json:"name"`
	// Source is "published" or "working" for a copy started in My Space,
	// empty for one made by uploading a file.
	Source       string       `json:"source"`
	Base         CopyBase     `json:"base"`
	Owner        VersionSaver `json:"owner"`
	Revision     int          `json:"revision"`
	FeatureCount int          `json:"feature_count"`
	// Mine is whether the signed-in person made it; only they can upload it
	// again, publish it or unpublish it.
	Mine        bool       `json:"mine"`
	PublishedAt *time.Time `json:"published_at"`
	// Set once merged: when, and the version the list was saved as after it.
	MergedAt      *time.Time `json:"merged_at"`
	MergedVersion *CopyBase  `json:"merged_version"`
	CreatedAt     time.Time  `json:"created_at"`
	UpdatedAt     time.Time  `json:"updated_at"`
}

// CopyDetailDTO is a copy with its contents.
type CopyDetailDTO struct {
	CopyDTO
	Snapshot json.RawMessage `json:"snapshot"`
}

// ListCopies returns the copies in a project the signed-in person can see:
// their own, and everyone's published ones. The most recently changed come
// first.
//
// GET /api/v1/projects/:id/copies
func (h *VersionsHandler) ListCopies(c *gin.Context) {
	projectID, err := api.IDParam(c, "id")
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

	var copies []models.FeatureCopy
	if err := h.db.Omit("snapshot").
		Where("project_id = ? AND (owner_id = ? OR published_at IS NOT NULL)", projectID, userID).
		Order("updated_at DESC, id DESC").Find(&copies).Error; err != nil {
		api.Fail(c, api.Internal(err))
		return
	}
	out, err := h.copyDTOs(copies, userID)
	if err != nil {
		api.Fail(c, api.Internal(err))
		return
	}
	api.OK(c, out)
}

// GetCopy returns a copy with its contents: one of the signed-in person's own,
// or anyone's published one.
//
// GET /api/v1/projects/:id/copies/:copyId
func (h *VersionsHandler) GetCopy(c *gin.Context) {
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

	fc, err := findVisibleCopy(h.db, projectID, uint(copyID), userID)
	if err != nil {
		api.Fail(c, err)
		return
	}
	out, err := h.copyDTOs([]models.FeatureCopy{fc}, userID)
	if err != nil {
		api.Fail(c, api.Internal(err))
		return
	}
	api.OK(c, CopyDetailDTO{CopyDTO: out[0], Snapshot: json.RawMessage(fc.Snapshot)})
}

// SaveCopy saves an uploaded list as the signed-in person's copy.
//
// POST /api/v1/projects/:id/copies
//
// Without a copy id, or with the id of someone else's copy, the upload becomes
// a new copy of the person's own. With the id of one of their copies, that
// copy is replaced, as long as it is not published, its base is the file's
// base, and nobody has uploaded it since the file was downloaded.
//
// Features keep what the file cannot carry — description, status, priority,
// category, release, and which real feature they are — from the copy being
// replaced, or else from the base version, matched by key. A key neither of
// those knows is a feature added in the file and is given a fresh key, so it
// can never be mistaken for a real feature.
//
// With dry_run the file goes through every one of those checks and the answer
// is a CopyCheck instead; nothing is saved.
func (h *VersionsHandler) SaveCopy(c *gin.Context) {
	projectID, err := api.IDParam(c, "id")
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

	var req SaveCopyRequest
	if err := api.Bind(c, &req); err != nil {
		api.Fail(c, err)
		return
	}

	var saved models.FeatureCopy
	var check *CopyCheck
	var replaces *models.FeatureCopy
	txErr := h.db.Transaction(func(tx *gorm.DB) error {
		var base models.FeatureVersion
		if dbErr := tx.Where("id = ? AND project_id = ?", req.BaseVersionID, projectID).
			First(&base).Error; dbErr != nil {
			if errors.Is(dbErr, gorm.ErrRecordNotFound) {
				return api.Validation("This file was made from a version this project does not have").
					WithField("base_version_id", "Not a version of this project")
			}
			return api.Internal(dbErr)
		}
		baseSnap, err := readSnapshot(base.Snapshot)
		if err != nil {
			return api.Internal(err)
		}

		// The copy being replaced, if the file came from one of this person's.
		var existing *models.FeatureCopy
		var existingSnap versionSnapshot
		if req.CopyID != 0 {
			var fc models.FeatureCopy
			dbErr := tx.Where("id = ? AND project_id = ?", req.CopyID, projectID).First(&fc).Error
			switch {
			case errors.Is(dbErr, gorm.ErrRecordNotFound):
				// Removed since, or never here: keep the work as a new copy.
			case dbErr != nil:
				return api.Internal(dbErr)
			case fc.OwnerID == userID:
				if fc.PublishedAt != nil {
					return api.Conflict("This copy is published, so it stays as people saw it. Unpublish it first, then upload your changes")
				}
				if fc.BaseVersionID != base.ID {
					return api.Conflict("This file says it was made from a different version than your copy is based on. Download your copy again and make the changes there")
				}
				if req.Revision != fc.Revision {
					// Which copy, and when, so the page can offer to download
					// the newer one.
					name := fc.Name
					if name == "" {
						name = "Copy " + strconv.Itoa(fc.Number)
					}
					return api.Conflict("This file is older than your copy. You uploaded \""+name+"\" again after you downloaded this file; uploading it now would undo that. Download the latest and make your edits there").
						WithField("stale_copy_id", strconv.Itoa(int(fc.ID))).
						WithField("stale_copy_name", name).
						WithField("stale_uploaded_at", fc.UpdatedAt.UTC().Format(time.RFC3339))
				}
				existing = &fc
				if existingSnap, err = readSnapshot(fc.Snapshot); err != nil {
					return api.Internal(err)
				}
			}
		}

		features, err := buildCopyRows(req.Features, existingSnap.Features, baseSnap.Features)
		if err != nil {
			return err
		}

		if req.DryRun {
			after := OpenedProject{Project: baseSnap.Project, Features: features, Releases: baseSnap.Releases}
			comparison := compareLists(baseSnap.OpenedProject, after)
			comparison.From = VersionSide{ID: base.ID, Number: base.Number, Tag: base.Tag}
			comparison.FromList, comparison.ToList = &baseSnap.OpenedProject, &after
			check = &CopyCheck{Base: CopyBase{ID: base.ID, Number: base.Number, Tag: base.Tag}, Comparison: comparison}
			replaces = existing
			return nil
		}
		snapshot, err := json.Marshal(versionSnapshot{
			Format: snapshotFormat,
			OpenedProject: OpenedProject{
				Project:  baseSnap.Project,
				Features: features,
				Releases: baseSnap.Releases,
			},
		})
		if err != nil {
			return api.Internal(err)
		}

		name := strings.TrimSpace(req.Name)
		if existing != nil {
			if name != "" {
				existing.Name = name
			}
			existing.Revision++
			existing.FeatureCount = len(features)
			existing.Snapshot = string(snapshot)
			if err := tx.Save(existing).Error; err != nil {
				return api.Internal(err)
			}
			saved = *existing
			return nil
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
			Name:          name,
			Revision:      1,
			FeatureCount:  len(features),
			Snapshot:      string(snapshot),
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

	if check != nil {
		if replaces != nil {
			out, err := h.copyDTOs([]models.FeatureCopy{*replaces}, userID)
			if err != nil {
				api.Fail(c, api.Internal(err))
				return
			}
			check.Replaces = &out[0]
		}
		api.OK(c, check)
		return
	}

	log.WithField("project", projectID).WithField("copy", saved.Number).
		WithField("revision", saved.Revision).Info("copy saved")

	out, err := h.copyDTOs([]models.FeatureCopy{saved}, userID)
	if err != nil {
		api.Fail(c, api.Internal(err))
		return
	}
	if saved.Revision == 1 {
		api.Created(c, out[0])
		return
	}
	api.OK(c, out[0])
}

// PublishCopy shares one of the signed-in person's copies with everyone on
// the project, and freezes it.
//
// POST /api/v1/projects/:id/copies/:copyId/publish
func (h *VersionsHandler) PublishCopy(c *gin.Context) {
	h.setPublished(c, true)
}

// UnpublishCopy takes a published copy back to a private draft, which its
// owner can upload again.
//
// POST /api/v1/projects/:id/copies/:copyId/unpublish
//
// A merged copy stays published: it is part of the project's history.
func (h *VersionsHandler) UnpublishCopy(c *gin.Context) {
	h.setPublished(c, false)
}

func (h *VersionsHandler) setPublished(c *gin.Context, publish bool) {
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

	fc, err := findVisibleCopy(h.db, projectID, uint(copyID), userID)
	if err != nil {
		api.Fail(c, err)
		return
	}
	if fc.OwnerID != userID {
		api.Fail(c, api.Forbidden("Only the person who made a copy can publish or unpublish it"))
		return
	}
	if !publish && fc.MergedAt != nil {
		api.Fail(c, api.Conflict("This copy has been merged, so it stays published"))
		return
	}
	if publish == (fc.PublishedAt != nil) {
		if publish {
			api.Fail(c, api.Conflict("This copy is already published"))
		} else {
			api.Fail(c, api.Conflict("This copy is not published"))
		}
		return
	}

	// Only the column changes, so the copy's own UpdatedAt still says when
	// its contents were last uploaded.
	var when *time.Time
	if publish {
		now := time.Now()
		when = &now
	}
	if err := h.db.Model(&fc).UpdateColumn("published_at", when).Error; err != nil {
		api.Fail(c, api.Internal(err))
		return
	}
	fc.PublishedAt = when

	log.WithField("project", projectID).WithField("copy", fc.Number).
		WithField("published", publish).Info("copy publishing changed")

	out, err := h.copyDTOs([]models.FeatureCopy{fc}, userID)
	if err != nil {
		api.Fail(c, api.Internal(err))
		return
	}
	api.OK(c, out[0])
}

// buildCopyRows checks an uploaded list and fills in what the file cannot
// carry, from the copy being replaced first and the base version second.
//
// Rows must come parents first, as a tree read top to bottom does, and a
// dependency may not point at the row itself or at anything it sits inside or
// that sits inside it.
func buildCopyRows(rows []CopyRow, previous, base []OpenedFeature) ([]OpenedFeature, error) {
	invalid := func(message string) error {
		return api.Validation(message).WithField("features", message)
	}

	known := indexRows(base)
	for _, row := range previous {
		known[row.Key] = row
	}

	// The file's keys, mapped to the keys the copy keeps.
	keys := make(map[string]string, len(rows))
	parent := make(map[string]string, len(rows))
	out := make([]OpenedFeature, 0, len(rows))
	for _, row := range rows {
		title := strings.TrimSpace(row.Title)
		if title == "" {
			return nil, invalid("Every feature needs a name")
		}
		if _, dup := keys[row.Key]; dup {
			return nil, invalid("Two features in the list have the same key")
		}
		key := row.Key
		if _, ok := known[key]; !ok && !isCopyKey(key) {
			key = freshCopyKey()
		}
		keys[row.Key] = key

		parentKey := ""
		if row.ParentKey != "" {
			var ok bool
			if parentKey, ok = keys[row.ParentKey]; !ok {
				return nil, invalid(`"` + title + `" sits inside a feature that does not come before it in the list`)
			}
		}
		parent[key] = parentKey

		feature := OpenedFeature{Key: key, Title: title, ParentKey: parentKey, Needs: []string{}}
		if was, ok := known[key]; ok {
			feature.FeatureID = was.FeatureID
			feature.ReleaseKey = was.ReleaseKey
			feature.Description = was.Description
			feature.Notes = was.Notes
			feature.Status = was.Status
			feature.Priority = was.Priority
			feature.Category = was.Category
		}
		if row.Description != nil {
			feature.Description = *row.Description
		}
		if row.Notes != nil {
			feature.Notes = *row.Notes
		}
		if row.Status != nil {
			feature.Status = *row.Status
		}
		if row.Priority != nil {
			feature.Priority = *row.Priority
		}
		out = append(out, feature)
	}

	within := func(key, ancestor string) bool {
		for current := parent[key]; current != ""; current = parent[current] {
			if current == ancestor {
				return true
			}
		}
		return false
	}
	for i, row := range rows {
		self := out[i].Key
		seen := map[string]bool{}
		for _, need := range row.Needs {
			needed, ok := keys[need]
			if !ok {
				return nil, invalid(`"` + out[i].Title + `" depends on a feature that is not in the list`)
			}
			if needed == self || within(self, needed) || within(needed, self) {
				return nil, invalid(`"` + out[i].Title + `" cannot depend on itself or on a feature it sits inside or that sits inside it`)
			}
			if !seen[needed] {
				seen[needed] = true
				out[i].Needs = append(out[i].Needs, needed)
			}
		}
	}
	return out, nil
}

// freshCopyKey names a feature that was added in a copy. "n" keeps it apart
// from the "f"-and-id keys of real features.
func freshCopyKey() string {
	var b [6]byte
	_, _ = rand.Read(b[:])
	return "n" + hex.EncodeToString(b[:])
}

// isCopyKey is whether key is one freshCopyKey could have made. The online
// editor makes its own for the features added in it, so they keep their key
// from one save to the next; it can never be taken for a real feature's.
func isCopyKey(key string) bool {
	if len(key) != 13 || key[0] != 'n' {
		return false
	}
	_, err := hex.DecodeString(key[1:])
	return err == nil
}

func readSnapshot(raw string) (versionSnapshot, error) {
	var snap versionSnapshot
	err := json.Unmarshal([]byte(raw), &snap)
	return snap, err
}

// findVisibleCopy looks a copy up within a project, if the signed-in person
// may see it: their own, or a published one. Anyone else's draft reads as not
// found, the same as one that does not exist.
func findVisibleCopy(db *gorm.DB, projectID int, copyID uint, userID int) (models.FeatureCopy, error) {
	var fc models.FeatureCopy
	if dbErr := db.Where("id = ? AND project_id = ? AND (owner_id = ? OR published_at IS NOT NULL)",
		copyID, projectID, userID).First(&fc).Error; dbErr != nil {
		return fc, api.FromDB(dbErr, "Copy")
	}
	return fc, nil
}

// copyDTOs describes copies with their owners' names and their bases, as the
// signed-in person sees them.
func (h *VersionsHandler) copyDTOs(copies []models.FeatureCopy, userID int) ([]CopyDTO, error) {
	baseIDs := make([]uint, 0, len(copies))
	owners := make([]models.FeatureVersion, 0, len(copies))
	for _, fc := range copies {
		baseIDs = append(baseIDs, fc.BaseVersionID)
		if fc.MergedVersionID != nil {
			baseIDs = append(baseIDs, *fc.MergedVersionID)
		}
		owners = append(owners, models.FeatureVersion{SavedByID: fc.OwnerID})
	}
	names, err := h.saverNames(owners)
	if err != nil {
		return nil, err
	}
	bases := map[uint]CopyBase{}
	if len(baseIDs) > 0 {
		var versions []models.FeatureVersion
		if err := h.db.Select("id", "number", "tag", "publish_number").Where("id IN ?", baseIDs).Find(&versions).Error; err != nil {
			return nil, err
		}
		for _, v := range versions {
			bases[v.ID] = CopyBase{ID: v.ID, Number: v.Number, Tag: v.Tag, PublishNumber: v.PublishNumber}
		}
	}

	out := make([]CopyDTO, 0, len(copies))
	for _, fc := range copies {
		base, ok := bases[fc.BaseVersionID]
		if !ok {
			base = CopyBase{ID: fc.BaseVersionID}
		}
		out = append(out, CopyDTO{
			ID:           fc.ID,
			ProjectID:    fc.ProjectID,
			Number:       fc.Number,
			Name:         fc.Name,
			Source:       fc.Source,
			Base:         base,
			Owner:        VersionSaver{ID: fc.OwnerID, Name: names[fc.OwnerID]},
			Revision:     fc.Revision,
			FeatureCount: fc.FeatureCount,
			Mine:         fc.OwnerID == userID,
			PublishedAt:  fc.PublishedAt,
			MergedAt:     fc.MergedAt,
			CreatedAt:    fc.CreatedAt,
			UpdatedAt:    fc.UpdatedAt,
		})
		if fc.MergedVersionID != nil {
			merged := bases[*fc.MergedVersionID]
			out[len(out)-1].MergedVersion = &merged
		}
	}
	return out, nil
}
