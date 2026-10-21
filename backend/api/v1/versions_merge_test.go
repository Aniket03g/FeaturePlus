package v1

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"testing"

	"github.com/FeaturePlus/backend/models"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// mergeFixture is a project with Payment > Refunds and Receipts needing
// Payment, saved as version 1, and the owner's routes.
type mergeFixture struct {
	db                         *gorm.DB
	owner, other               models.User
	project                    models.Project
	r                          *gin.Engine
	payment, refunds, receipts models.Feature
	version                    VersionDTO
	base                       string
}

func newMergeFixture(t *testing.T) mergeFixture {
	t.Helper()
	db := newTestDB(t)
	owner, other, project := seed(t, db)
	fx := mergeFixture{db: db, owner: owner, other: other, project: project,
		r: versionsRouterAs(t, db, owner.ID), base: "/api/v1/projects/" + strconv.Itoa(project.ID)}

	fx.payment = models.Feature{ProjectID: project.ID, Title: "Payment", Description: "Card only"}
	db.Create(&fx.payment)
	fx.refunds = models.Feature{ProjectID: project.ID, Title: "Refunds", ParentFeatureID: &fx.payment.ID}
	db.Create(&fx.refunds)
	fx.receipts = models.Feature{ProjectID: project.ID, Title: "Receipts"}
	db.Create(&fx.receipts)
	db.Create(&models.Dependency{ParentID: fx.payment.ID, ParentType: models.EntityTypeFeature,
		ChildID: fx.receipts.ID, ChildType: models.EntityTypeFeature, CreatedByID: uint(owner.ID)})

	w := do(fx.r, http.MethodPost, fx.base+"/versions", `{"tag":"v1"}`)
	if w.Code != http.StatusCreated {
		t.Fatalf("save version: %d %s", w.Code, w.Body.String())
	}
	fx.version = decodeVersion(t, w.Body.Bytes()).VersionDTO
	return fx
}

// publishCopy uploads rows (a JSON array) as the owner's copy and publishes it.
func (fx mergeFixture) publishCopy(t *testing.T, rows string) CopyDTO {
	t.Helper()
	w := do(fx.r, http.MethodPost, fx.base+"/copies", fmt.Sprintf(`{"base_version_id":%d,"features":%s}`, fx.version.ID, rows))
	if w.Code != http.StatusCreated {
		t.Fatalf("upload: %d %s", w.Code, w.Body.String())
	}
	copied := decodeCopy(t, w.Body.Bytes())
	if w := do(fx.r, http.MethodPost, fx.base+"/copies/"+strconv.Itoa(int(copied.ID))+"/publish", ""); w.Code != http.StatusOK {
		t.Fatalf("publish: %d %s", w.Code, w.Body.String())
	}
	return copied.CopyDTO
}

func (fx mergeFixture) preview(t *testing.T, copyID uint, query string) MergePreview {
	t.Helper()
	w := do(fx.r, http.MethodGet, fx.base+"/copies/"+strconv.Itoa(int(copyID))+"/merge"+query, "")
	if w.Code != http.StatusOK {
		t.Fatalf("preview: %d %s", w.Code, w.Body.String())
	}
	var env struct {
		Data MergePreview `json:"data"`
	}
	json.Unmarshal(w.Body.Bytes(), &env)
	return env.Data
}

func (fx mergeFixture) merge(copyID uint, body string) (int, MergeResult, string) {
	w := do(fx.r, http.MethodPost, fx.base+"/copies/"+strconv.Itoa(int(copyID))+"/merge", body)
	var env struct {
		Data MergeResult `json:"data"`
	}
	json.Unmarshal(w.Body.Bytes(), &env)
	return w.Code, env.Data, w.Body.String()
}

// liveList is the project's features by title, with each one's parent title
// and the titles it needs.
func (fx mergeFixture) liveList(t *testing.T) map[string]string {
	t.Helper()
	opened, err := openProject(fx.db, &fx.project, false)
	if err != nil {
		t.Fatal(err)
	}
	titles := map[string]string{}
	for _, row := range opened.Features {
		titles[row.Key] = row.Title
	}
	out := map[string]string{}
	for _, row := range opened.Features {
		needs := []string{}
		for _, n := range row.Needs {
			needs = append(needs, titles[n])
		}
		out[row.Title] = "in:" + titles[row.ParentKey] + " needs:" + strings.Join(needs, ",")
	}
	return out
}

func TestMergeBringsTheCopysChangesIntoTheList(t *testing.T) {
	fx := newMergeFixture(t)
	p, rf, rc := key(fx.payment), key(fx.refunds), key(fx.receipts)

	// The copy renames Payment, moves Refunds to the top, adds Wallet inside
	// Payments needing Refunds, and removes Receipts.
	copied := fx.publishCopy(t, fmt.Sprintf(`[
		{"key":%q,"title":"Payments"},
		{"key":"w1","title":"Wallet","parent_key":%q,"needs":[%q]},
		{"key":%q,"title":"Refunds"}
	]`, p, p, rf, rf))
	_ = rc

	// Meanwhile someone adds Search to the real list; the merge leaves it be.
	fx.db.Create(&models.Feature{ProjectID: fx.project.ID, Title: "Search"})

	preview := fx.preview(t, copied.ID, "")
	if !preview.Ready || len(preview.Clashes) != 0 || len(preview.Problems) != 0 {
		t.Fatalf("preview = %+v", preview)
	}
	kinds := map[string]int{}
	for _, change := range preview.Changes {
		kinds[change.Kind]++
	}
	if kinds["renamed"] != 1 || kinds["moved"] != 1 || kinds["added"] != 1 || kinds["removed"] != 1 || kinds["needs_added"] != 1 {
		t.Errorf("changes = %+v", preview.Changes)
	}

	code, result, body := fx.merge(copied.ID, `{}`)
	if code != http.StatusOK {
		t.Fatalf("merge: %d %s", code, body)
	}
	if !result.Before.Auto || !result.After.Auto {
		t.Errorf("versions saved around a merge should be marked auto: %+v %+v", result.Before, result.After)
	}
	if result.Before.Number != 2 || result.After.Number != 3 || result.Before.FeatureCount != 4 || result.After.FeatureCount != 4 {
		t.Errorf("versions before %+v after %+v", result.Before, result.After)
	}

	got := fx.liveList(t)
	want := map[string]string{
		"Payments": "in: needs:",
		"Wallet":   "in:Payments needs:Refunds",
		"Refunds":  "in: needs:",
		"Search":   "in: needs:",
	}
	if len(got) != len(want) {
		t.Fatalf("list = %v, want %v", got, want)
	}
	for title, shape := range want {
		if got[title] != shape {
			t.Errorf("%s = %q, want %q", title, got[title], shape)
		}
	}
	// Plan only: the description stays, and Receipts' dependency went with it.
	var payment models.Feature
	fx.db.First(&payment, fx.payment.ID)
	if payment.Description != "Card only" {
		t.Errorf("description = %q", payment.Description)
	}
	var deps int64
	fx.db.Model(&models.Dependency{}).Where("child_id = ? OR parent_id = ?", fx.receipts.ID, fx.receipts.ID).Count(&deps)
	if deps != 0 {
		t.Errorf("Receipts' dependencies left = %d", deps)
	}

	var stored models.FeatureCopy
	fx.db.First(&stored, copied.ID)
	if stored.MergedAt == nil || stored.MergedVersionID == nil || *stored.MergedVersionID != result.After.ID {
		t.Errorf("copy after merge = %+v", stored)
	}
	if code, _, _ := fx.merge(copied.ID, `{}`); code != http.StatusConflict {
		t.Errorf("merge twice: %d, want 409", code)
	}
	if w := do(fx.r, http.MethodPost, fx.base+"/copies/"+strconv.Itoa(int(copied.ID))+"/unpublish", ""); w.Code != http.StatusConflict {
		t.Errorf("unpublish merged: %d, want 409", w.Code)
	}
}

func TestMergeClashesWaitForAPick(t *testing.T) {
	fx := newMergeFixture(t)
	p, rf, rc := key(fx.payment), key(fx.refunds), key(fx.receipts)

	// The copy renames Payment and removes Refunds...
	copied := fx.publishCopy(t, fmt.Sprintf(`[{"key":%q,"title":"Payments"},{"key":%q,"title":"Receipts","needs":[%q]}]`, p, rc, p))
	// ...while the list renamed Payment differently and moved Refunds.
	fx.db.Model(&models.Feature{}).Where("id = ?", fx.payment.ID).Update("title", "Pay")
	fx.db.Model(&models.Feature{}).Where("id = ?", fx.refunds.ID).Update("parent_feature_id", nil)

	preview := fx.preview(t, copied.ID, "")
	if preview.Ready || len(preview.Clashes) != 2 {
		t.Fatalf("preview = %+v, want two clashes, not ready", preview)
	}
	byKey := map[string]MergeClash{}
	for _, clash := range preview.Clashes {
		byKey[clash.Key] = clash
	}
	if c := byKey[p]; c.Kind != "changed" || len(c.Fields) != 1 || c.Fields[0].List != "Pay" || c.Fields[0].Copy != "Payments" {
		t.Errorf("payment clash = %+v", c)
	}
	if c := byKey[rf]; c.Kind != "removed" {
		t.Errorf("refunds clash = %+v", c)
	}

	// Without picks nothing is written.
	if code, _, _ := fx.merge(copied.ID, `{}`); code != http.StatusConflict {
		t.Errorf("merge without picks: %d, want 409", code)
	}
	var versions int64
	fx.db.Model(&models.FeatureVersion{}).Count(&versions)
	if versions != 1 {
		t.Errorf("versions = %d, want only the base", versions)
	}

	// A preview with picks is ready.
	if got := fx.preview(t, copied.ID, "?choices["+p+"]=list&choices["+rf+"]=copy"); !got.Ready {
		t.Errorf("preview with picks = %+v", got)
	}

	code, _, body := fx.merge(copied.ID, fmt.Sprintf(`{"choices":{%q:"list",%q:"copy"}}`, p, rf))
	if code != http.StatusOK {
		t.Fatalf("merge: %d %s", code, body)
	}
	got := fx.liveList(t)
	if _, ok := got["Pay"]; !ok || len(got) != 2 {
		t.Errorf("list = %v, want Pay kept and Refunds removed", got)
	}
}

func TestMergeKeepsFeaturesWithTasksOrSomethingInside(t *testing.T) {
	fx := newMergeFixture(t)
	p, rc := key(fx.payment), key(fx.receipts)

	// The copy removes Payment (and Refunds inside it).
	copied := fx.publishCopy(t, fmt.Sprintf(`[{"key":%q,"title":"Receipts"}]`, rc))
	// Refunds has a task, so it must stay, and so then must Payment.
	fx.db.Create(&models.Task{TaskType: "dev", TaskName: "Write refund rules", FeatureID: fx.refunds.ID})

	preview := fx.preview(t, copied.ID, "")
	if !preview.Ready {
		t.Fatalf("preview = %+v", preview)
	}
	for _, change := range preview.Changes {
		if change.Kind == "removed" {
			t.Errorf("unexpected removal %+v", change)
		}
	}
	if len(preview.Notes) != 2 {
		t.Errorf("notes = %+v, want the task and the feature inside", preview.Notes)
	}
	if code, _, body := fx.merge(copied.ID, `{}`); code != http.StatusOK {
		t.Fatalf("merge: %d %s", code, body)
	}
	got := fx.liveList(t)
	if got["Refunds"] != "in:Payment needs:" || got["Receipts"] != "in: needs:" {
		t.Errorf("list = %v", got)
	}
	_ = p
}

func TestMergeRefusals(t *testing.T) {
	fx := newMergeFixture(t)
	p, rf, rc := key(fx.payment), key(fx.refunds), key(fx.receipts)
	rows := fmt.Sprintf(`[{"key":%q,"title":"Search"},{"key":%q,"title":"Refunds","parent_key":%q},{"key":%q,"title":"Receipts","needs":[%q]}]`, p, rf, p, rc, p)

	// A draft cannot be merged.
	w := do(fx.r, http.MethodPost, fx.base+"/copies", fmt.Sprintf(`{"base_version_id":%d,"features":%s}`, fx.version.ID, rows))
	draft := decodeCopy(t, w.Body.Bytes())
	if code, _, _ := fx.merge(draft.ID, `{}`); code != http.StatusConflict {
		t.Errorf("merge a draft: %d, want 409", code)
	}
	if w := do(fx.r, http.MethodPost, fx.base+"/copies/"+strconv.Itoa(int(draft.ID))+"/publish", ""); w.Code != http.StatusOK {
		t.Fatalf("publish: %d", w.Code)
	}

	// The copy renames Payment to Search, which the list has gained since.
	fx.db.Create(&models.Feature{ProjectID: fx.project.ID, Title: "search"})
	if got := fx.preview(t, draft.ID, ""); got.Ready || len(got.Problems) != 1 {
		t.Errorf("preview = %+v, want a name problem", got)
	}
	if code, _, _ := fx.merge(draft.ID, `{}`); code != http.StatusConflict {
		t.Errorf("merge with a problem: %d, want 409", code)
	}

	// Viewers may see published copies but not merge them.
	share(t, fx.db, fx.project.ID, fx.other.ID, models.RoleViewer)
	viewer := versionsRouterAs(t, fx.db, fx.other.ID)
	path := fx.base + "/copies/" + strconv.Itoa(int(draft.ID)) + "/merge"
	if w := do(viewer, http.MethodGet, path, ""); w.Code != http.StatusForbidden {
		t.Errorf("viewer preview: %d, want 403", w.Code)
	}
	if w := do(viewer, http.MethodPost, path, `{}`); w.Code != http.StatusForbidden {
		t.Errorf("viewer merge: %d, want 403", w.Code)
	}
}

func TestMergeUsesAnExistingFeatureOfTheSameName(t *testing.T) {
	fx := newMergeFixture(t)
	p, rf, rc := key(fx.payment), key(fx.refunds), key(fx.receipts)
	copied := fx.publishCopy(t, fmt.Sprintf(`[{"key":%q,"title":"Payment"},{"key":%q,"title":"Refunds","parent_key":%q},{"key":%q,"title":"Receipts","needs":[%q]},{"key":"n1","title":"Search","needs":[%q]}]`, p, rf, p, rc, p, rc))
	search := models.Feature{ProjectID: fx.project.ID, Title: "Search"}
	fx.db.Create(&search)

	preview := fx.preview(t, copied.ID, "")
	if !preview.Ready || len(preview.Notes) != 1 {
		t.Fatalf("preview = %+v", preview)
	}
	if code, _, body := fx.merge(copied.ID, `{}`); code != http.StatusOK {
		t.Fatalf("merge: %d %s", code, body)
	}
	got := fx.liveList(t)
	if len(got) != 4 || got["Search"] != "in: needs:Receipts" {
		t.Errorf("list = %v, want the existing Search to gain the dependency", got)
	}
}

func TestMergeShowsWhereChangesSit(t *testing.T) {
	fx := newMergeFixture(t)
	p, rf, rc := key(fx.payment), key(fx.refunds), key(fx.receipts)

	// Wallet goes inside Refunds (inside Payment); Refunds is renamed; Receipts
	// moves inside Payment.
	copied := fx.publishCopy(t, fmt.Sprintf(`[
		{"key":%q,"title":"Payment"},
		{"key":%q,"title":"Refund requests","parent_key":%q},
		{"key":"w1","title":"Wallet","parent_key":%q},
		{"key":%q,"title":"Receipts","parent_key":%q}
	]`, p, rf, p, rf, rc, p))

	got := map[string]MergeChange{}
	for _, change := range fx.preview(t, copied.ID, "").Changes {
		got[change.Kind+" "+change.Title] = change
	}
	if c := got["added Wallet"]; c.Path != "Payment › Refund requests" {
		t.Errorf("added = %+v", c)
	}
	if c := got["renamed Refund requests"]; c.Path != "Payment" {
		t.Errorf("renamed = %+v", c)
	}
	if c := got["moved Receipts"]; c.From != "" || c.To != "Payment" || c.Path != "Payment" {
		t.Errorf("moved = %+v", c)
	}
}

func TestMergeRemovingAFeatureWhoseDependenciesChangedIsAClash(t *testing.T) {
	fx := newMergeFixture(t)
	p, rf := key(fx.payment), key(fx.refunds)

	// The copy removes Receipts; meanwhile the list made Receipts need Refunds too.
	copied := fx.publishCopy(t, fmt.Sprintf(`[{"key":%q,"title":"Payment"},{"key":%q,"title":"Refunds","parent_key":%q}]`, p, rf, p))
	fx.db.Create(&models.Dependency{ParentID: fx.refunds.ID, ParentType: models.EntityTypeFeature,
		ChildID: fx.receipts.ID, ChildType: models.EntityTypeFeature, CreatedByID: uint(fx.owner.ID)})

	preview := fx.preview(t, copied.ID, "")
	if preview.Ready || len(preview.Clashes) != 1 {
		t.Fatalf("preview = %+v, want one clash", preview)
	}
	clash := preview.Clashes[0]
	if clash.Kind != "removed" || clash.Title != "Receipts" || len(clash.Fields) != 1 ||
		clash.Fields[0].Field != "needs" || clash.Fields[0].Base != "Payment" || clash.Fields[0].List != "Payment, Refunds" {
		t.Errorf("clash = %+v", clash)
	}
	if preview.ListFeatures != 3 {
		t.Errorf("list features = %d, want 3", preview.ListFeatures)
	}
}
