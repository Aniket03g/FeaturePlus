package v1

import (
	"encoding/json"
	"net/http"
	"strconv"
	"testing"

	"github.com/FeaturePlus/backend/models"
	"github.com/gin-gonic/gin"
)

func saveV(t *testing.T, r *gin.Engine, base, notes string) VersionDTO {
	t.Helper()
	w := do(r, http.MethodPost, base+"/versions", `{"notes":"`+notes+`"}`)
	if w.Code != http.StatusCreated {
		t.Fatalf("save: status %d: %s", w.Code, w.Body.String())
	}
	return decodeVersion(t, w.Body.Bytes()).VersionDTO
}

func publishV(r *gin.Engine, base string, id uint, body string) (int, VersionDTO, string) {
	w := do(r, http.MethodPost, base+"/versions/"+strconv.Itoa(int(id))+"/publish", body)
	var out struct {
		Data VersionDTO `json:"data"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &out)
	return w.Code, out.Data, w.Body.String()
}

// publishList saves the list as it is and publishes that save, the way the
// Feature List's Save then Publish does. It returns the publish's status.
func publishList(t *testing.T, r *gin.Engine, base, body string) int {
	t.Helper()
	w := do(r, http.MethodPost, base+"/versions", `{}`)
	if w.Code != http.StatusCreated {
		return w.Code
	}
	code, _, _ := publishV(r, base, decodeVersion(t, w.Body.Bytes()).ID, body)
	return code
}

func TestSavesAreMinorVersionsAndPublishingMakesTheNextWholeNumber(t *testing.T) {
	db := newTestDB(t)
	owner, other, project := seed(t, db)
	r := versionsRouterAs(t, db, owner.ID)
	base := "/api/v1/projects/" + strconv.Itoa(project.ID)

	feature := models.Feature{ProjectID: project.ID, Title: "Payment"}
	db.Create(&feature)

	// Saves before any publish are v0.1, v0.2; no tag is needed.
	if v := saveV(t, r, base, "first"); v.Label != "v0.1" {
		t.Fatalf("first save = %s, want v0.1", v.Label)
	}
	second := saveV(t, r, base, "second")
	if second.Label != "v0.2" {
		t.Fatalf("second save = %s, want v0.2", second.Label)
	}

	// Publishing the newest save turns it into v1 in place.
	code, pub, body := publishV(r, base, second.ID, `{"notes":"  first cut  "}`)
	if code != http.StatusCreated || pub.ID != second.ID || pub.Label != "v1" || pub.PublishNumber != 1 || pub.Notes != "first cut" {
		t.Fatalf("publish v0.2: %d %+v %s", code, pub, body)
	}
	// Publishing it again is refused.
	if code, _, _ := publishV(r, base, second.ID, `{}`); code != http.StatusConflict {
		t.Fatalf("repeat publish: status %d, want 409", code)
	}

	// Saves after it are v1.1, v1.2.
	db.Model(&feature).Update("title", "Payments")
	v11 := saveV(t, r, base, "")
	if v11.Label != "v1.1" {
		t.Fatalf("save after publish = %s, want v1.1", v11.Label)
	}
	db.Model(&feature).Update("title", "Payments and refunds")
	v12 := saveV(t, r, base, "")
	if v12.Label != "v1.2" {
		t.Fatalf("next save = %s, want v1.2", v12.Label)
	}

	// Publishing an older version makes a new row, v2, with its list.
	code, pub, body = publishV(r, base, v11.ID, `{}`)
	if code != http.StatusCreated || pub.ID == v11.ID || pub.Label != "v2" || pub.PublishNumber != 2 {
		t.Fatalf("publish older v1.1: %d %+v %s", code, pub, body)
	}
	got := decodeVersion(t, do(r, http.MethodGet, base+"/published", "").Body.Bytes())
	if snap := decodeSnapshot(t, got.Snapshot); got.Label != "v2" || snap.Features[0].Title != "Payments" {
		t.Fatalf("published = %s %+v", got.Label, snap.Features)
	}
	// v1.1 is unchanged and keeps its number.
	again := decodeVersion(t, do(r, http.MethodGet, base+"/versions/"+strconv.Itoa(int(v11.ID)), "").Body.Bytes())
	if again.Label != "v1.1" || again.PublishNumber != 0 {
		t.Fatalf("v1.1 after being republished = %+v", again.VersionDTO)
	}
	// A version with the same list as the published one is refused.
	if code, _, _ := publishV(r, base, v11.ID, `{}`); code != http.StatusConflict {
		t.Fatalf("publishing a copy of the live list: status %d, want 409", code)
	}
	// The next save counts under v2.
	if v := saveV(t, r, base, ""); v.Label != "v2.1" {
		t.Fatalf("save after v2 = %s, want v2.1", v.Label)
	}

	// What each version is based on.
	bases := map[string]string{}
	for _, v := range decodeVersions(t, do(r, http.MethodGet, base+"/versions", "").Body.Bytes()) {
		if v.BasedOn != nil {
			bases[v.Label] = v.BasedOn.Label
		} else {
			bases[v.Label] = "-"
		}
	}
	// v2 was published from the older v1.1 while the Feature List still held
	// v1.2, so the save after it is based on v1.2.
	want := map[string]string{"v0.1": "-", "v1": "v0.1", "v1.1": "v1", "v1.2": "v1.1", "v2": "v1.1", "v2.1": "v1.2"}
	for label, b := range want {
		if bases[label] != b {
			t.Errorf("%s based on %q, want %q (all: %v)", label, bases[label], b, bases)
		}
	}

	// Editors save but cannot publish; publishers can.
	share(t, db, project.ID, other.ID, models.RoleEditor)
	editor := versionsRouterAs(t, db, other.ID)
	db.Model(&feature).Update("title", "Pay")
	mine := saveV(t, editor, base, "")
	if code, _, _ := publishV(editor, base, mine.ID, `{}`); code != http.StatusForbidden {
		t.Fatalf("editor publish: status %d, want 403", code)
	}
	db.Model(&models.ProjectMember{}).Where("user_id = ?", other.ID).Update("role", models.RolePublisher)
	if code, pub, body := publishV(editor, base, mine.ID, `{}`); code != http.StatusCreated || pub.Label != "v3" {
		t.Fatalf("publisher publish: %d %+v %s", code, pub, body)
	}
}

func TestGoingBackPutsAVersionInPlaceOfTheList(t *testing.T) {
	db := newTestDB(t)
	owner, other, project := seed(t, db)
	r := versionsRouterAs(t, db, owner.ID)
	base := "/api/v1/projects/" + strconv.Itoa(project.ID)

	cart := models.Feature{ProjectID: project.ID, Title: "Cart", Description: "Old words"}
	db.Create(&cart)
	pay := models.Feature{ProjectID: project.ID, Title: "Pay"}
	db.Create(&pay)
	old := saveV(t, r, base, "the old list")

	// Since then: Cart renamed and redescribed, Pay deleted, two features added,
	// one of them with a task.
	db.Model(&cart).Updates(map[string]any{"title": "Basket", "description": "New words"})
	db.Unscoped().Delete(&pay)
	search := models.Feature{ProjectID: project.ID, Title: "Search"}
	db.Create(&search)
	wish := models.Feature{ProjectID: project.ID, Title: "Wishlist"}
	db.Create(&wish)
	db.Create(&models.Task{TaskName: "Build it", TaskType: "Dev", FeatureID: search.ID})

	restore := base + "/versions/" + strconv.Itoa(int(old.ID)) + "/restore"

	// Unsaved changes block it.
	var preview struct {
		Data RestorePreview `json:"data"`
	}
	w := do(r, http.MethodGet, restore, "")
	_ = json.Unmarshal(w.Body.Bytes(), &preview)
	if w.Code != http.StatusOK || preview.Data.Unsaved == 0 || preview.Data.Ready {
		t.Fatalf("preview with unsaved changes: %d %s", w.Code, w.Body.String())
	}
	if w := do(r, http.MethodPost, restore, ""); w.Code != http.StatusConflict {
		t.Fatalf("restore with unsaved changes: status %d, want 409", w.Code)
	}

	saveV(t, r, base, "the new list")

	// Viewers cannot open a version as the working version; editors can.
	share(t, db, project.ID, other.ID, models.RoleViewer)
	if w := do(versionsRouterAs(t, db, other.ID), http.MethodPost, restore, ""); w.Code != http.StatusForbidden {
		t.Fatalf("viewer restore: status %d, want 403", w.Code)
	}
	db.Model(&models.ProjectMember{}).Where("user_id = ?", other.ID).Update("role", models.RoleEditor)
	if w := do(versionsRouterAs(t, db, other.ID), http.MethodGet, restore, ""); w.Code != http.StatusOK {
		t.Fatalf("editor preview: status %d, want 200", w.Code)
	}

	w = do(r, http.MethodPost, restore, "")
	if w.Code != http.StatusOK {
		t.Fatalf("restore: status %d: %s", w.Code, w.Body.String())
	}
	var result struct {
		Data RestoreResult `json:"data"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &result)
	// Nothing new is saved: the working version is now based on v0.1.
	if result.Data.Base.Label != "v0.1" {
		t.Fatalf("based on after opening v0.1 = %+v", result.Data.Base)
	}
	if list := decodeVersions(t, do(r, http.MethodGet, base+"/versions", "").Body.Bytes()); len(list) != 2 {
		t.Fatalf("opening a version saved a new one: %d versions", len(list))
	}

	var features []models.Feature
	db.Where("project_id = ?", project.ID).Order("id").Find(&features)
	titles := map[string]models.Feature{}
	for _, f := range features {
		titles[f.Title] = f
	}
	if got, ok := titles["Cart"]; !ok || got.Description != "Old words" || got.ID != cart.ID {
		t.Errorf("Cart not put back as it was: %+v", titles)
	}
	if got, ok := titles["Pay"]; !ok || got.ID != pay.ID {
		t.Errorf("deleted Pay not brought back under its old id %d: %+v", pay.ID, titles)
	}
	// The list now matches the old version, apart from Search, kept for its task.
	var cmp struct {
		Data VersionComparison `json:"data"`
	}
	_ = json.Unmarshal(do(r, http.MethodGet, base+"/versions/compare?from="+strconv.Itoa(int(old.ID))+"&to=current", "").Body.Bytes(), &cmp)
	if len(cmp.Data.Changes) != 1 || cmp.Data.Changes[0].Title != "Search" || cmp.Data.Changes[0].Kind != "added" {
		t.Errorf("after going back, the list differs from the version: %+v", cmp.Data.Changes)
	}
	if _, ok := titles["Wishlist"]; ok {
		t.Errorf("Wishlist, added since and with no tasks, should be gone")
	}
	if _, ok := titles["Search"]; !ok {
		t.Errorf("Search has a task and must be kept")
	}
	if len(result.Data.Notes) != 1 {
		t.Errorf("notes = %+v, want one about Search being kept", result.Data.Notes)
	}
}

func TestNumberVersionsNumbersOldRows(t *testing.T) {
	db := newTestDB(t)
	_, _, project := seed(t, db)
	rows := []models.FeatureVersion{
		{Number: 1}, {Number: 2, PublishNumber: 1}, {Number: 3}, {Number: 4}, {Number: 5, PublishNumber: 2}, {Number: 6},
	}
	for i := range rows {
		rows[i].ProjectID, rows[i].Tag, rows[i].SavedByID, rows[i].Snapshot = project.ID, "t"+strconv.Itoa(i), 1, "{}"
		db.Create(&rows[i])
	}
	if err := NumberVersions(db); err != nil {
		t.Fatal(err)
	}
	var got []models.FeatureVersion
	db.Where("project_id = ?", project.ID).Order("number").Find(&got)
	want := []string{"v0.1", "v1", "v1.1", "v1.2", "v2", "v2.1"}
	for i, v := range got {
		if v.Label() != want[i] {
			t.Errorf("version %d = %s, want %s", v.Number, v.Label(), want[i])
		}
	}
}

func TestGoingBackKeepsAFeatureReAddedUnderTheSameName(t *testing.T) {
	db := newTestDB(t)
	owner, _, project := seed(t, db)
	r := versionsRouterAs(t, db, owner.ID)
	base := "/api/v1/projects/" + strconv.Itoa(project.ID)

	search := models.Feature{ProjectID: project.ID, Title: "Search"}
	db.Create(&search)
	results := models.Feature{ProjectID: project.ID, Title: "Results"}
	db.Create(&results)
	db.Create(&models.Dependency{ParentID: search.ID, ParentType: models.EntityTypeFeature,
		ChildID: results.ID, ChildType: models.EntityTypeFeature})
	old := saveV(t, r, base, "")

	// Search deleted, then a new Search added: a different feature, same name,
	// and Results made to need the new one.
	db.Unscoped().Where("parent_id = ? OR child_id = ?", search.ID, search.ID).Delete(&models.Dependency{})
	db.Unscoped().Delete(&search)
	again := models.Feature{ProjectID: project.ID, Title: "Search"}
	db.Create(&again)
	db.Create(&models.Dependency{ParentID: again.ID, ParentType: models.EntityTypeFeature,
		ChildID: results.ID, ChildType: models.EntityTypeFeature})
	saveV(t, r, base, "")

	if w := do(r, http.MethodPost, base+"/versions/"+strconv.Itoa(int(old.ID))+"/restore", ""); w.Code != http.StatusOK {
		t.Fatalf("restore: status %d: %s", w.Code, w.Body.String())
	}
	var features []models.Feature
	db.Where("project_id = ?", project.ID).Find(&features)
	if len(features) != 2 {
		t.Fatalf("after going back = %+v, want Search and Results", features)
	}
	var needs int64
	db.Model(&models.Dependency{}).Where("parent_id = ? AND child_id = ?", again.ID, results.ID).Count(&needs)
	if needs != 1 {
		t.Errorf("Results no longer needs the kept Search")
	}
}

func decodeWorking(t *testing.T, r *gin.Engine, base string) WorkingDTO {
	t.Helper()
	var out struct {
		Data WorkingDTO `json:"data"`
	}
	w := do(r, http.MethodGet, base+"/working", "")
	if w.Code != http.StatusOK {
		t.Fatalf("working: status %d: %s", w.Code, w.Body.String())
	}
	_ = json.Unmarshal(w.Body.Bytes(), &out)
	return out.Data
}

func TestWorkingVersionBaseNoteAndDiscard(t *testing.T) {
	db := newTestDB(t)
	owner, other, project := seed(t, db)
	r := versionsRouterAs(t, db, owner.ID)
	base := "/api/v1/projects/" + strconv.Itoa(project.ID)

	// Nothing saved: no base, the next save is v0.1.
	if w := decodeWorking(t, r, base); w.Base != nil || w.NextSave != "v0.1" || w.NextPublish != "v1" {
		t.Fatalf("before any save = %+v", w)
	}

	cart := models.Feature{ProjectID: project.ID, Title: "Cart"}
	db.Create(&cart)

	// A note on the working version, offered to and cleared by the save.
	if w := do(r, http.MethodPatch, base+"/working", `{"note":" Reworking the cart "}`); w.Code != http.StatusNoContent {
		t.Fatalf("set note: status %d: %s", w.Code, w.Body.String())
	}
	if w := decodeWorking(t, r, base); w.Note != "Reworking the cart" || w.NoteBy != "owner" {
		t.Fatalf("note = %+v", w)
	}
	v01 := saveV(t, r, base, "first")
	if w := decodeWorking(t, r, base); w.Note != "" || w.Base == nil || w.Base.ID != v01.ID ||
		w.Unsaved == nil || w.Unsaved.Added+w.Unsaved.Removed+w.Unsaved.Changed != 0 {
		t.Fatalf("after save = %+v", w)
	}

	db.Model(&cart).Update("title", "Basket")
	v02 := saveV(t, r, base, "")

	// Open v0.1 as the working version: based on it, unchanged, nothing saved.
	restore := func(id uint, body string) int {
		return do(r, http.MethodPost, base+"/versions/"+strconv.Itoa(int(id))+"/restore", body).Code
	}
	if code := restore(v01.ID, ""); code != http.StatusOK {
		t.Fatalf("open v0.1: status %d", code)
	}
	w := decodeWorking(t, r, base)
	if w.Base == nil || w.Base.Label != "v0.1" || w.Unsaved.Changed != 0 {
		t.Fatalf("after opening v0.1 = %+v", w)
	}
	// The next save is numbered on from the newest (v0.3) and based on v0.1.
	db.Model(&cart).Updates(map[string]any{"title": "Trolley", "status": models.StatusDone})
	if w := decodeWorking(t, r, base); w.NextSave != "v0.3" || w.Unsaved.Changed != 1 {
		t.Fatalf("with a change = %+v", w)
	}

	// Changes block opening another version, unless discarded.
	if code := restore(v02.ID, ""); code != http.StatusConflict {
		t.Fatalf("open with changes: status %d, want 409", code)
	}
	// Discard: open the version it is based on again.
	if code := restore(v01.ID, `{"discard":true}`); code != http.StatusOK {
		t.Fatalf("discard: status %d", code)
	}
	var now models.Feature
	db.First(&now, cart.ID)
	if now.Title != "Cart" || now.Status == models.StatusDone {
		t.Fatalf("after discard = %q / %s, want Cart and its old status", now.Title, now.Status)
	}
	if w := decodeWorking(t, r, base); w.Unsaved.Added+w.Unsaved.Removed+w.Unsaved.Changed != 0 {
		t.Fatalf("after discard there are still changes: %+v", w.Unsaved)
	}

	saved := saveV(t, r, base, "")
	if saved.BasedOn == nil || saved.BasedOn.Label != "v0.1" {
		t.Fatalf("save after opening v0.1 based on %+v, want v0.1", saved.BasedOn)
	}

	// A saved version's note can be changed, by anyone who can edit.
	w2 := do(r, http.MethodPatch, base+"/versions/"+strconv.Itoa(int(v02.ID)), `{"notes":"Renamed the cart"}`)
	if w2.Code != http.StatusOK || decodeVersion(t, w2.Body.Bytes()).Notes != "Renamed the cart" {
		t.Fatalf("edit note: %d %s", w2.Code, w2.Body.String())
	}
	share(t, db, project.ID, other.ID, models.RoleViewer)
	if w := do(versionsRouterAs(t, db, other.ID), http.MethodPatch, base+"/working", `{"note":"x"}`); w.Code != http.StatusForbidden {
		t.Fatalf("viewer note: status %d, want 403", w.Code)
	}
}
