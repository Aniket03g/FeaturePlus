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

// Merging a published copy into the project's list.
//
// A merge is three-way. The copy was made from a saved version (its base), and
// the project's list may have moved on since. What the copy changed is worked
// out against the base, and only those changes are made to the list as it is
// now, so someone else's newer edit to the list is not undone by a copy that
// never touched that feature.
//
// When the copy and the list both changed the same feature's name or place
// since the base, and differently, that is a clash. The preview shows each
// one, and the person merging picks per feature: keep the list's, or take the
// copy's. Nothing merges until every clash has a pick.
//
// A merge changes the plan only: names, nesting and dependencies. Tasks,
// status, descriptions and releases are left alone. A feature the copy added
// becomes a real feature; one the copy removed is deleted only when it has no
// tasks and nothing left inside it, and is otherwise kept and listed.
//
// The list is saved as a version straight before the merge and again straight
// after it, so a merge can always be looked back on, and the copy is marked as
// merged into that second version. Only the project's owner and editors merge.

// MergeChange is one change the merge makes to the list. From and To are
// names: a title, a place, or a dependency. A place is a path of names from
// the top, "Delivery › Driver app", and "" is the top level. Path is where the
// feature sits once merged, or where it sat for one that is removed.
type MergeChange struct {
	Kind  string `json:"kind"` // added, renamed, moved, removed, needs_added, needs_removed
	Key   string `json:"key"`
	Title string `json:"title"`
	From  string `json:"from,omitempty"`
	To    string `json:"to,omitempty"`
	Path  string `json:"path"`
}

// ClashField is one field both sides changed: what it was in the base, what
// the list has now, and what the copy has. Needs are names joined with ", ".
type ClashField struct {
	Field string `json:"field"` // title, parent or needs
	Base  string `json:"base"`
	List  string `json:"list"`
	Copy  string `json:"copy"`
}

// MergeClash is a feature both sides changed. Kind "changed" is two different
// edits; "removed" is a feature the copy removed but the list changed. Choice
// is the pick sent with the request, "" while there is none.
type MergeClash struct {
	Kind   string       `json:"kind"`
	Key    string       `json:"key"`
	Title  string       `json:"title"`
	Path   string       `json:"path"` // where it sits in the list now
	Fields []ClashField `json:"fields"`
	Choice string       `json:"choice"`
}

// MergeNote is something the copy asked for that the merge leaves out, and why.
type MergeNote struct {
	Title   string `json:"title"`
	Message string `json:"message"`
}

// MergePreview is what merging the copy would do to the list right now.
// Ready says it can go ahead: no clash is left without a pick, and nothing in
// Problems is in the way.
type MergePreview struct {
	Copy CopyDTO `json:"copy"`
	// ListFeatures is how many features the project's list has now.
	ListFeatures int           `json:"list_features"`
	Changes      []MergeChange `json:"changes"`
	Clashes      []MergeClash  `json:"clashes"`
	Notes        []MergeNote   `json:"notes"`
	Problems     []string      `json:"problems"`
	Ready        bool          `json:"ready"`
}

// MergeRequest carries the picks for clashes, by feature key: "list" or "copy".
type MergeRequest struct {
	Choices map[string]string `json:"choices"`
}

// MergeResult is a finished merge: the versions saved either side of it.
type MergeResult struct {
	Before  VersionDTO    `json:"before"`
	After   VersionDTO    `json:"after"`
	Changes []MergeChange `json:"changes"`
	Notes   []MergeNote   `json:"notes"`
}

// ---------- the plan ----------

type mergeCreate struct {
	key, title, parentKey string
}

type mergeUpdate struct {
	key       string
	title     *string
	parentSet bool
	parentKey string
}

type mergeNeed struct {
	childKey, parentKey string
}

// mergePlan is what a merge would write, worked out before anything is.
type mergePlan struct {
	changes  []MergeChange
	clashes  []MergeClash
	notes    []MergeNote
	problems []string
	ready    bool

	creates     []mergeCreate
	alias       map[string]string // a copy's new feature -> the list's feature of that name
	updates     []mergeUpdate
	needAdds    []mergeNeed
	needRemoves []mergeNeed
	deletes     []string
}

// planMerge works out what merging copy (made from base) into live would do.
// taskCounts holds the number of tasks of each live feature that has any.
func planMerge(base, copied, live OpenedProject, taskCounts map[uint]int, choices map[string]string) mergePlan {
	plan := mergePlan{
		changes: []MergeChange{}, clashes: []MergeClash{}, notes: []MergeNote{}, problems: []string{},
		alias: map[string]string{},
	}
	baseRows := indexRows(base.Features)
	copyRows := indexRows(copied.Features)
	liveRows := indexRows(live.Features)

	// The list as the merge leaves it, filled in as the plan goes.
	finalTitle := map[string]string{}
	finalParent := map[string]string{}
	created := map[string]bool{}
	byName := map[string]string{}
	for _, row := range live.Features {
		finalTitle[row.Key] = row.Title
		finalParent[row.Key] = row.ParentKey
		if _, taken := byName[matchName(row.Title)]; !taken {
			byName[matchName(row.Title)] = row.Key
		}
	}
	resolve := func(key string) string {
		if to, ok := plan.alias[key]; ok {
			return to
		}
		return key
	}
	exists := func(key string) bool {
		_, inLive := liveRows[key]
		return inLive || created[key]
	}
	nameOf := func(key string) string {
		if key == "" {
			return ""
		}
		if title, ok := finalTitle[key]; ok {
			return title
		}
		if row, ok := copyRows[key]; ok {
			return row.Title
		}
		return baseRows[key].Title
	}

	// livePath is a place in the list as it is now, finalPath one in the list
	// as the merge leaves it: the names from the top down to key, inclusive.
	pathOf := func(key string, parent func(string) string, title func(string) string) string {
		names := []string{}
		for current, steps := key, 0; current != "" && steps <= len(finalParent)+len(liveRows); current, steps = parent(current), steps+1 {
			names = append([]string{title(current)}, names...)
		}
		return strings.Join(names, " › ")
	}
	livePath := func(key string) string {
		return pathOf(key, func(k string) string { return liveRows[k].ParentKey }, func(k string) string { return liveRows[k].Title })
	}
	finalPath := func(key string) string {
		return pathOf(key, func(k string) string { return finalParent[k] }, nameOf)
	}

	unresolved := 0
	renamedOrNew := map[string]bool{}

	// Names and places, parents before what is inside them.
	for _, row := range copied.Features {
		key := row.Key
		was, inBase := baseRows[key]

		if !inBase {
			if existing, ok := byName[matchName(row.Title)]; ok {
				plan.alias[key] = existing
				plan.notes = append(plan.notes, MergeNote{Title: row.Title,
					Message: "The copy adds it, but the list already has a feature by that name, so that one is used"})
				continue
			}
			parent := resolve(row.ParentKey)
			if parent != "" && !exists(parent) {
				plan.notes = append(plan.notes, MergeNote{Title: row.Title,
					Message: "The copy puts it inside a feature that is no longer in the list, so it goes at the top level"})
				parent = ""
			}
			plan.creates = append(plan.creates, mergeCreate{key: key, title: row.Title, parentKey: parent})
			created[key] = true
			renamedOrNew[key] = true
			finalTitle[key] = row.Title
			finalParent[key] = parent
			byName[matchName(row.Title)] = key
			plan.changes = append(plan.changes, MergeChange{Kind: "added", Key: key, Title: row.Title})
			continue
		}

		now, inLive := liveRows[key]
		copyRenamed := row.Title != was.Title
		copyMoved := row.ParentKey != was.ParentKey
		if !inLive {
			if copyRenamed || copyMoved || !sameSet(row.Needs, was.Needs) {
				plan.notes = append(plan.notes, MergeNote{Title: row.Title,
					Message: "It has been removed from the list since the copy's version, so the copy's changes to it are left out"})
			}
			continue
		}

		titleClash := copyRenamed && now.Title != was.Title && row.Title != now.Title
		parentClash := copyMoved && now.ParentKey != was.ParentKey && row.ParentKey != now.ParentKey
		takeCopy := false
		if titleClash || parentClash {
			clash := MergeClash{Kind: "changed", Key: key, Title: now.Title, Path: livePath(now.ParentKey),
				Fields: []ClashField{}, Choice: choices[key]}
			if titleClash {
				clash.Fields = append(clash.Fields, ClashField{Field: "title", Base: was.Title, List: now.Title, Copy: row.Title})
			}
			if parentClash {
				clash.Fields = append(clash.Fields, ClashField{Field: "parent",
					Base: baseRows[was.ParentKey].Title, List: nameOf(now.ParentKey), Copy: nameOf(row.ParentKey)})
			}
			switch clash.Choice {
			case "copy":
				takeCopy = true
			case "list":
			default:
				clash.Choice = ""
				unresolved++
			}
			plan.clashes = append(plan.clashes, clash)
		}

		update := mergeUpdate{key: key}
		if copyRenamed && (!titleClash || takeCopy) && row.Title != now.Title {
			title := row.Title
			update.title = &title
			plan.changes = append(plan.changes, MergeChange{Kind: "renamed", Key: key, Title: row.Title, From: now.Title, To: row.Title})
			finalTitle[key] = row.Title
			renamedOrNew[key] = true
		}
		if copyMoved && (!parentClash || takeCopy) {
			parent := resolve(row.ParentKey)
			switch {
			case parent != "" && !exists(parent):
				plan.notes = append(plan.notes, MergeNote{Title: row.Title,
					Message: "The copy moves it inside a feature that is no longer in the list, so it stays where it is"})
			case parent != now.ParentKey:
				update.parentSet = true
				update.parentKey = parent
				plan.changes = append(plan.changes, MergeChange{Kind: "moved", Key: key, Title: finalTitle[key],
					From: livePath(now.ParentKey)})
				finalParent[key] = parent
			}
		}
		if update.title != nil || update.parentSet {
			plan.updates = append(plan.updates, update)
		}
	}

	// Features the copy removed.
	deleted := map[string]bool{}
	for _, was := range base.Features {
		if _, kept := copyRows[was.Key]; kept {
			continue
		}
		now, inLive := liveRows[was.Key]
		if !inLive {
			continue
		}
		// Removing it would throw away whatever the list did to it since the
		// base, its dependencies included, so any of those is a clash.
		needsChanged := !sameSet(now.Needs, was.Needs)
		if now.Title != was.Title || now.ParentKey != was.ParentKey || needsChanged {
			clash := MergeClash{Kind: "removed", Key: was.Key, Title: now.Title, Path: livePath(now.ParentKey),
				Choice: choices[was.Key], Fields: []ClashField{}}
			if now.Title != was.Title {
				clash.Fields = append(clash.Fields, ClashField{Field: "title", Base: was.Title, List: now.Title})
			}
			if now.ParentKey != was.ParentKey {
				clash.Fields = append(clash.Fields, ClashField{Field: "parent",
					Base: baseRows[was.ParentKey].Title, List: nameOf(now.ParentKey)})
			}
			if needsChanged {
				clash.Fields = append(clash.Fields, ClashField{Field: "needs",
					Base: joinTitles(baseRows, was.Needs), List: joinTitles(liveRows, now.Needs)})
			}
			if clash.Choice != "copy" && clash.Choice != "list" {
				clash.Choice = ""
				unresolved++
			}
			plan.clashes = append(plan.clashes, clash)
			if clash.Choice != "copy" {
				continue
			}
		}
		if tasks := taskCounts[now.FeatureID]; tasks > 0 {
			plan.notes = append(plan.notes, MergeNote{Title: now.Title,
				Message: "The copy removes it, but it has " + plural(tasks, "task") + ", so it stays. Remove it by hand if you mean it"})
			continue
		}
		deleted[was.Key] = true
	}
	// A feature with something still inside it after the merge stays, and so
	// then does whatever it is inside. Repeat until nothing more changes.
	for changed := true; changed; {
		changed = false
		for key := range finalParent {
			if deleted[key] {
				continue
			}
			parent := finalParent[key]
			if deleted[parent] {
				delete(deleted, parent)
				plan.notes = append(plan.notes, MergeNote{Title: nameOf(parent),
					Message: "The copy removes it, but " + nameOf(key) + " is still inside it, so it stays"})
				changed = true
			}
		}
	}
	for _, was := range base.Features {
		if deleted[was.Key] {
			plan.deletes = append(plan.deletes, was.Key)
			plan.changes = append(plan.changes, MergeChange{Kind: "removed", Key: was.Key, Title: nameOf(was.Key)})
		}
	}

	// Dependencies, once every feature is placed. Only what the copy changed
	// against its base is touched.
	for _, row := range copied.Features {
		key := resolve(row.Key)
		if !exists(key) || deleted[key] {
			continue
		}
		var before []string
		if was, ok := baseRows[row.Key]; ok {
			before = was.Needs
		}
		has := map[string]bool{}
		if now, ok := liveRows[key]; ok {
			for _, need := range now.Needs {
				has[need] = true
			}
		}
		for _, need := range minus(row.Needs, before) {
			target := resolve(need)
			if !exists(target) || deleted[target] || has[target] || target == key {
				continue
			}
			has[target] = true
			plan.needAdds = append(plan.needAdds, mergeNeed{childKey: key, parentKey: target})
			plan.changes = append(plan.changes, MergeChange{Kind: "needs_added", Key: key, Title: nameOf(key), To: nameOf(target)})
		}
		for _, need := range minus(before, row.Needs) {
			if !has[need] || deleted[need] {
				continue
			}
			plan.needRemoves = append(plan.needRemoves, mergeNeed{childKey: key, parentKey: need})
			plan.changes = append(plan.changes, MergeChange{Kind: "needs_removed", Key: key, Title: nameOf(key), From: nameOf(need)})
		}
	}

	// Where each change sits, now every name and place is settled.
	for i := range plan.changes {
		change := &plan.changes[i]
		if change.Kind == "removed" {
			change.Path = livePath(liveRows[change.Key].ParentKey)
			continue
		}
		change.Path = finalPath(finalParent[resolve(change.Key)])
		if change.Kind == "moved" {
			change.To = change.Path
		}
	}

	// What would stop the merge outright.
	seenName := map[string]string{}
	for key := range finalTitle {
		if deleted[key] {
			continue
		}
		name := matchName(finalTitle[key])
		if other, dup := seenName[name]; dup && (renamedOrNew[key] || renamedOrNew[other]) {
			plan.problems = append(plan.problems, "Two features would both be called \""+finalTitle[key]+"\"")
			continue
		}
		seenName[name] = key
	}
	for key := range finalParent {
		steps := 0
		for current := finalParent[key]; current != "" && steps <= len(finalParent); current = finalParent[current] {
			if current == key {
				plan.problems = append(plan.problems, "\""+nameOf(key)+"\" would end up inside itself")
				break
			}
			steps++
		}
	}

	plan.ready = unresolved == 0 && len(plan.problems) == 0
	return plan
}

// joinTitles names keys by their rows' titles, in order, joined with ", ".
func joinTitles(rows map[string]OpenedFeature, keys []string) string {
	return strings.Join(titlesOf(rows, keys), ", ")
}

// minus is what a has that b does not.
func minus(a, b []string) []string {
	drop := make(map[string]bool, len(b))
	for _, x := range b {
		drop[x] = true
	}
	out := []string{}
	for _, x := range a {
		if !drop[x] {
			out = append(out, x)
		}
	}
	return out
}

// ---------- the handlers ----------

// mergeInputs is everything a merge is worked out from.
type mergeInputs struct {
	copy       models.FeatureCopy
	base       versionSnapshot
	copied     versionSnapshot
	live       OpenedProject
	taskCounts map[uint]int
}

func (h *VersionsHandler) loadMerge(db *gorm.DB, project *models.Project, copyID uint, userID int) (mergeInputs, error) {
	var in mergeInputs
	fc, err := findVisibleCopy(db, project.ID, copyID, userID)
	if err != nil {
		return in, err
	}
	if fc.PublishedAt == nil {
		return in, api.Conflict("Publish the copy first: only published copies can be merged")
	}
	if fc.MergedAt != nil {
		return in, api.Conflict("This copy has already been merged")
	}
	var base models.FeatureVersion
	if dbErr := db.Where("id = ? AND project_id = ?", fc.BaseVersionID, project.ID).First(&base).Error; dbErr != nil {
		return in, api.FromDB(dbErr, "Version")
	}
	if in.base, err = readSnapshot(base.Snapshot); err != nil {
		return in, api.Internal(err)
	}
	if in.copied, err = readSnapshot(fc.Snapshot); err != nil {
		return in, api.Internal(err)
	}
	if in.live, err = openProject(db, project, false); err != nil {
		return in, api.Internal(err)
	}

	in.taskCounts = map[uint]int{}
	ids := make([]uint, 0, len(in.live.Features))
	for _, row := range in.live.Features {
		ids = append(ids, row.FeatureID)
	}
	if len(ids) > 0 {
		var counts []struct {
			FeatureID uint
			N         int
		}
		if err := db.Model(&models.Task{}).Select("feature_id, COUNT(*) AS n").
			Where("feature_id IN ? AND deleted_at IS NULL", ids).Group("feature_id").Scan(&counts).Error; err != nil {
			return in, api.Internal(err)
		}
		for _, c := range counts {
			in.taskCounts[c.FeatureID] = c.N
		}
	}
	in.copy = fc
	return in, nil
}

func (h *VersionsHandler) mergeTarget(c *gin.Context) (*models.Project, uint, int, bool) {
	projectID, err := api.IDParam(c, "id")
	if err != nil {
		api.Fail(c, err)
		return nil, 0, 0, false
	}
	copyID, err := api.IDParam(c, "copyId")
	if err != nil {
		api.Fail(c, err)
		return nil, 0, 0, false
	}
	project, err := requireProject(c, h.db, projectID, canEdit)
	if err != nil {
		api.Fail(c, err)
		return nil, 0, 0, false
	}
	userID, err := api.UserID(c)
	if err != nil {
		api.Fail(c, err)
		return nil, 0, 0, false
	}
	return project, uint(copyID), userID, true
}

// PreviewMerge says what merging a published copy would do to the list now.
// Picks for clashes may be given as choices[<key>]=list|copy, and show in the
// preview as if they had been made.
//
// GET /api/v1/projects/:id/copies/:copyId/merge
func (h *VersionsHandler) PreviewMerge(c *gin.Context) {
	project, copyID, userID, ok := h.mergeTarget(c)
	if !ok {
		return
	}
	in, err := h.loadMerge(h.db, project, copyID, userID)
	if err != nil {
		api.Fail(c, err)
		return
	}
	choices := c.QueryMap("choices")
	plan := planMerge(in.base.OpenedProject, in.copied.OpenedProject, in.live, in.taskCounts, choices)

	dto, err := h.copyDTOs([]models.FeatureCopy{in.copy}, userID)
	if err != nil {
		api.Fail(c, api.Internal(err))
		return
	}
	api.OK(c, MergePreview{
		Copy: dto[0], ListFeatures: len(in.live.Features), Changes: plan.changes, Clashes: plan.clashes,
		Notes: plan.notes, Problems: plan.problems, Ready: plan.ready,
	})
}

// Merge brings a published copy's changes into the project's list.
//
// POST /api/v1/projects/:id/copies/:copyId/merge
//
// The plan is worked out again inside the transaction, against the list as it
// is at that moment. If that is no longer ready — the list changed since the
// preview and a new clash appeared, or a pick is missing — nothing is written.
func (h *VersionsHandler) Merge(c *gin.Context) {
	project, copyID, userID, ok := h.mergeTarget(c)
	if !ok {
		return
	}
	var req MergeRequest
	if err := api.Bind(c, &req); err != nil {
		api.Fail(c, err)
		return
	}

	var result MergeResult
	var merged models.FeatureCopy
	var saved []models.FeatureVersion
	txErr := h.db.Transaction(func(tx *gorm.DB) error {
		in, err := h.loadMerge(tx, project, copyID, userID)
		if err != nil {
			return err
		}
		plan := planMerge(in.base.OpenedProject, in.copied.OpenedProject, in.live, in.taskCounts, req.Choices)
		if !plan.ready {
			return api.Conflict("The merge is not ready: a clash has no pick yet, something is in the way, or the list has changed since the preview. Look at the merge again")
		}
		number := strconv.Itoa(in.copy.Number)

		tag, err := freeTag(tx, project.ID, "Before merging copy "+number)
		if err != nil {
			return api.Internal(err)
		}
		before, err := saveVersion(tx, project, tag, "Saved automatically before copy "+number+" was merged", userID, true)
		if err != nil {
			return err
		}

		if err := applyMerge(tx, project.ID, in.live, plan, uint(userID), number); err != nil {
			return err
		}

		if tag, err = freeTag(tx, project.ID, "Merged copy "+number); err != nil {
			return api.Internal(err)
		}
		after, err := saveVersion(tx, project, tag, "The list after copy "+number+" was merged", userID, true)
		if err != nil {
			return err
		}

		now := time.Now()
		merger := userID
		if err := tx.Model(&in.copy).Updates(map[string]any{
			"merged_at": now, "merged_by_id": merger, "merged_version_id": after.ID,
		}).Error; err != nil {
			return api.Internal(err)
		}
		merged = in.copy
		saved = []models.FeatureVersion{before, after}
		result = MergeResult{Changes: plan.changes, Notes: plan.notes}
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

	// Read once the transaction is done: h.db is another connection.
	names, err := h.saverNames(saved)
	if err != nil {
		api.Fail(c, api.Internal(err))
		return
	}
	result.Before, result.After = newVersionDTO(saved[0], names), newVersionDTO(saved[1], names)

	log.WithField("project", project.ID).WithField("copy", merged.Number).
		WithField("version", result.After.Number).Info("copy merged")
	api.OK(c, result)
}

// applyMerge writes a ready plan into the project.
func applyMerge(tx *gorm.DB, projectID int, live OpenedProject, plan mergePlan, userID uint, copyNumber string) error {
	ids := map[string]uint{}
	for _, row := range live.Features {
		ids[row.Key] = row.FeatureID
	}
	parentID := func(key string) *uint {
		if key == "" {
			return nil
		}
		id := ids[key]
		return &id
	}

	for _, add := range plan.creates {
		feature := models.Feature{
			ProjectID:       projectID,
			Title:           add.title,
			Category:        "general",
			Status:          models.StatusTodo,
			Priority:        models.PriorityMedium,
			ParentFeatureID: parentID(add.parentKey),
		}
		if err := tx.Create(&feature).Error; err != nil {
			return err
		}
		ids[add.key] = feature.ID
	}
	for from, to := range plan.alias {
		ids[from] = ids[to]
	}

	for _, up := range plan.updates {
		updates := map[string]any{}
		if up.title != nil {
			updates["title"] = *up.title
		}
		if up.parentSet {
			updates["parent_feature_id"] = parentID(up.parentKey)
		}
		if err := tx.Model(&models.Feature{}).Where("id = ?", ids[up.key]).Updates(updates).Error; err != nil {
			return err
		}
	}

	for _, need := range plan.needRemoves {
		if err := tx.Unscoped().
			Where("parent_id = ? AND child_id = ? AND parent_type = ? AND child_type = ?",
				ids[need.parentKey], ids[need.childKey], models.EntityTypeFeature, models.EntityTypeFeature).
			Delete(&models.Dependency{}).Error; err != nil {
			return err
		}
	}
	for _, need := range plan.needAdds {
		if err := tx.Create(&models.Dependency{
			ParentID: ids[need.parentKey], ParentType: models.EntityTypeFeature,
			ChildID: ids[need.childKey], ChildType: models.EntityTypeFeature,
			Description: "From merging copy " + copyNumber, CreatedByID: userID,
		}).Error; err != nil {
			return err
		}
	}

	// The same as deleting a feature by hand: its dependencies go with it.
	for _, key := range plan.deletes {
		id := ids[key]
		if err := tx.Unscoped().
			Where("(parent_type = ? AND parent_id = ?) OR (child_type = ? AND child_id = ?)",
				models.EntityTypeFeature, id, models.EntityTypeFeature, id).
			Delete(&models.Dependency{}).Error; err != nil {
			return err
		}
		if err := tx.Unscoped().Delete(&models.Feature{}, id).Error; err != nil {
			return err
		}
	}
	return nil
}
