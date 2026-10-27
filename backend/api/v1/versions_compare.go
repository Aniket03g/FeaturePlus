package v1

import (
	"encoding/json"
	"strconv"
	"strings"

	"github.com/FeaturePlus/backend/api"
	"github.com/FeaturePlus/backend/models"
	"github.com/gin-gonic/gin"
)

// Comparing two versions of a feature list.
//
// Features are matched by their id, not their title or position: a renamed
// feature is the same feature with a new title, and a moved one is the same
// feature under a new parent. A line-by-line comparison of the two lists would
// see both as one feature removed and another added.

// VersionSide names one side of a comparison: a saved version, one of your
// own copies, or the project's list as it is now.
type VersionSide struct {
	Current bool   `json:"current"`
	ID      uint   `json:"id,omitempty"`
	Number  int    `json:"number,omitempty"`
	Tag     string `json:"tag,omitempty"`
	// Copy is set, with the copy's number in Number, when this side is a copy.
	Copy bool `json:"copy,omitempty"`
}

// FieldChange is one field of a feature that differs between the two sides.
// Parent and release are given by name, and needs as a list of names, since
// that is what a person reading the change knows them by.
type FieldChange struct {
	Field string `json:"field"`
	From  any    `json:"from"`
	To    any    `json:"to"`
}

// FeatureChange is one feature that was added, removed or changed.
type FeatureChange struct {
	Kind      string        `json:"kind"` // added, removed or changed
	Key       string        `json:"key"`
	FeatureID uint          `json:"feature_id"`
	Title     string        `json:"title"`
	Fields    []FieldChange `json:"fields,omitempty"`
}

// VersionComparison is the answer to "what changed from one side to the other".
type VersionComparison struct {
	From    VersionSide     `json:"from"`
	To      VersionSide     `json:"to"`
	Added   int             `json:"added"`
	Removed int             `json:"removed"`
	Changed int             `json:"changed"`
	Changes []FeatureChange `json:"changes"`

	// Both lists in full, sent only when asked for with full=1, so a page
	// can draw the changes inside the tree.
	FromList *OpenedProject `json:"from_list,omitempty"`
	ToList   *OpenedProject `json:"to_list,omitempty"`
}

// Compare reports what changed between two versions, or between a version and
// the current list.
//
// GET /api/v1/projects/:id/versions/compare?from=<id|c<id>|current>&to=<…>
//
// With full=1 both lists come back in full as well.
//
// A side is a version's id, "c" and the id of a copy you can see (your own,
// or a published one), or "current".
//
// Changes come in the order of the newer side's tree, with removed features
// after them in the order the older side had them.
func (h *VersionsHandler) Compare(c *gin.Context) {
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

	load := func(param string) (OpenedProject, VersionSide, error) {
		raw := strings.TrimSpace(c.Query(param))
		if raw == "current" {
			opened, err := openProject(h.db, project, true)
			if err != nil {
				return OpenedProject{}, VersionSide{}, api.Internal(err)
			}
			return opened, VersionSide{Current: true}, nil
		}
		copyRef := strings.HasPrefix(raw, "c")
		id, convErr := strconv.Atoi(strings.TrimPrefix(raw, "c"))
		if convErr != nil || id <= 0 {
			return OpenedProject{}, VersionSide{}, api.Validation("Check the highlighted fields").
				WithField(param, "Pick a version, or \"current\" for the list as it is now")
		}
		if copyRef {
			userID, err := api.UserID(c)
			if err != nil {
				return OpenedProject{}, VersionSide{}, err
			}
			fc, err := findVisibleCopy(h.db, projectID, uint(id), userID)
			if err != nil {
				return OpenedProject{}, VersionSide{}, err
			}
			snap, err := readSnapshot(fc.Snapshot)
			if err != nil {
				return OpenedProject{}, VersionSide{}, api.Internal(err)
			}
			return snap.OpenedProject, VersionSide{Copy: true, ID: fc.ID, Number: fc.Number, Tag: fc.Name}, nil
		}
		var version models.FeatureVersion
		if dbErr := h.db.Where("id = ? AND project_id = ?", id, projectID).
			First(&version).Error; dbErr != nil {
			return OpenedProject{}, VersionSide{}, api.FromDB(dbErr, "Version")
		}
		var snap versionSnapshot
		if err := json.Unmarshal([]byte(version.Snapshot), &snap); err != nil {
			return OpenedProject{}, VersionSide{}, api.Internal(err)
		}
		return snap.OpenedProject, VersionSide{ID: version.ID, Number: version.Number, Tag: version.Tag}, nil
	}

	from, fromSide, err := load("from")
	if err != nil {
		api.Fail(c, err)
		return
	}
	to, toSide, err := load("to")
	if err != nil {
		api.Fail(c, err)
		return
	}

	result := compareLists(from, to)
	result.From, result.To = fromSide, toSide
	if c.Query("full") == "1" {
		result.FromList, result.ToList = &from, &to
	}
	api.OK(c, result)
}

// compareLists works out what changed from one list to another.
func compareLists(from, to OpenedProject) VersionComparison {
	oldRows := indexRows(from.Features)
	newRows := indexRows(to.Features)
	oldReleases := releaseNames(from.Releases)
	newReleases := releaseNames(to.Releases)

	result := VersionComparison{Changes: []FeatureChange{}}

	for _, row := range to.Features {
		before, existed := oldRows[row.Key]
		if !existed {
			result.Added++
			result.Changes = append(result.Changes, FeatureChange{
				Kind: "added", Key: row.Key, FeatureID: row.FeatureID, Title: row.Title,
			})
			continue
		}

		var fields []FieldChange
		same := func(field string, a, b string) {
			if a != b {
				fields = append(fields, FieldChange{Field: field, From: a, To: b})
			}
		}
		same("title", before.Title, row.Title)
		same("description", before.Description, row.Description)
		same("notes", before.Notes, row.Notes)
		same("status", before.Status, row.Status)
		same("priority", before.Priority, row.Priority)
		same("category", before.Category, row.Category)
		// Parent and release are compared by key and shown by name: renaming a
		// parent does not move its children, and two parents can share a name.
		if before.ParentKey != row.ParentKey {
			fields = append(fields, FieldChange{
				Field: "parent", From: titleOf(oldRows, before.ParentKey), To: titleOf(newRows, row.ParentKey),
			})
		}
		if before.ReleaseKey != row.ReleaseKey {
			fields = append(fields, FieldChange{
				Field: "release", From: oldReleases[before.ReleaseKey], To: newReleases[row.ReleaseKey],
			})
		}
		if !sameSet(before.Needs, row.Needs) {
			fields = append(fields, FieldChange{
				Field: "needs", From: titlesOf(oldRows, before.Needs), To: titlesOf(newRows, row.Needs),
			})
		}

		if len(fields) > 0 {
			result.Changed++
			result.Changes = append(result.Changes, FeatureChange{
				Kind: "changed", Key: row.Key, FeatureID: row.FeatureID, Title: row.Title, Fields: fields,
			})
		}
	}

	for _, row := range from.Features {
		if _, kept := newRows[row.Key]; !kept {
			result.Removed++
			result.Changes = append(result.Changes, FeatureChange{
				Kind: "removed", Key: row.Key, FeatureID: row.FeatureID, Title: row.Title,
			})
		}
	}

	return result
}

func indexRows(rows []OpenedFeature) map[string]OpenedFeature {
	out := make(map[string]OpenedFeature, len(rows))
	for _, row := range rows {
		out[row.Key] = row
	}
	return out
}

func releaseNames(releases []OpenedRelease) map[string]string {
	out := map[string]string{"": ""}
	for _, r := range releases {
		out[r.Key] = r.Name
	}
	return out
}

// titleOf names a row by key; an empty key is the top level.
func titleOf(rows map[string]OpenedFeature, key string) string {
	if key == "" {
		return ""
	}
	return rows[key].Title
}

func titlesOf(rows map[string]OpenedFeature, keys []string) []string {
	out := make([]string, 0, len(keys))
	for _, key := range keys {
		out = append(out, titleOf(rows, key))
	}
	return out
}

func sameSet(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	seen := make(map[string]int, len(a))
	for _, x := range a {
		seen[x]++
	}
	for _, x := range b {
		if seen[x] == 0 {
			return false
		}
		seen[x]--
	}
	return true
}
