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
	want := map[string]string{"v0.1": "-", "v1": "v0.1", "v1.1": "v1", "v1.2": "v1.1", "v2": "v1.1", "v2.1": "v2"}
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

	// Editors cannot go back.
	share(t, db, project.ID, other.ID, models.RoleEditor)
	if w := do(versionsRouterAs(t, db, other.ID), http.MethodPost, restore, ""); w.Code != http.StatusForbidden {
		t.Fatalf("editor restore: status %d, want 403", w.Code)
	}

	w = do(r, http.MethodPost, restore, "")
	if w.Code != http.StatusOK {
		t.Fatalf("restore: status %d: %s", w.Code, w.Body.String())
	}
	var result struct {
		Data RestoreResult `json:"data"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &result)
	if result.Data.Saved.Label != "v0.3" || result.Data.Saved.Notes != "Went back to v0.1" ||
		result.Data.Saved.BasedOn == nil || result.Data.Saved.BasedOn.Label != "v0.1" {
		t.Fatalf("saved after going back = %+v", result.Data.Saved)
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
