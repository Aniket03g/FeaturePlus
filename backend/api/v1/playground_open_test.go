package v1

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"testing"

	"github.com/FeaturePlus/backend/models"
)

func TestPlaygroundOpensAProjectAndWritesItBack(t *testing.T) {
	db := newTestDB(t)
	owner, _, project := seed(t, db)

	mk := func(title string, parent *uint) models.Feature {
		f := models.Feature{ProjectID: project.ID, Title: title, Status: models.StatusTodo, Priority: models.PriorityMedium, Category: "general", ParentFeatureID: parent}
		if err := db.Create(&f).Error; err != nil {
			t.Fatalf("create %s: %v", title, err)
		}
		return f
	}
	checkout := mk("Checkout", nil)
	cart := mk("Cart", &checkout.ID)
	payment := mk("Payment", &checkout.ID)
	catalogue := mk("Catalogue", nil)
	if err := db.Create(&models.Dependency{ParentID: cart.ID, ParentType: models.EntityTypeFeature, ChildID: payment.ID, ChildType: models.EntityTypeFeature}).Error; err != nil {
		t.Fatalf("dependency: %v", err)
	}
	release := models.Release{ProjectID: project.ID, Tag: "v1.0", Status: models.ReleaseStatusDraft}
	if err := db.Omit("Project", "PRs").Create(&release).Error; err != nil {
		t.Fatalf("release: %v", err)
	}
	db.Model(&models.Feature{}).Where("id = ?", cart.ID).Update("release_id", release.ID)

	r := playgroundRouter(t, db, owner.ID, "developer")
	w := do(r, http.MethodGet, "/api/v1/playground/projects/"+strconv.Itoa(project.ID), "")
	if w.Code != http.StatusOK {
		t.Fatalf("open: status %d: %s", w.Code, w.Body.String())
	}
	var opened struct {
		Data struct {
			Features []OpenedFeature `json:"features"`
			Releases []OpenedRelease `json:"releases"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &opened); err != nil {
		t.Fatalf("decode: %v", err)
	}
	rows := opened.Data.Features
	if len(rows) != 4 || rows[0].Title != "Checkout" || rows[1].Title != "Cart" || rows[2].Title != "Payment" || rows[3].Title != "Catalogue" {
		t.Fatalf("rows not in tree order: %+v", rows)
	}
	if rows[2].ParentKey != rows[0].Key || len(rows[2].Needs) != 1 || rows[2].Needs[0] != rows[1].Key {
		t.Errorf("Payment should sit in Checkout and need Cart: %+v", rows[2])
	}
	if len(opened.Data.Releases) != 1 || rows[1].ReleaseKey != opened.Data.Releases[0].Key {
		t.Errorf("Cart should be planned into v1.0: %+v / %+v", rows[1], opened.Data.Releases)
	}

	id := func(f models.Feature) string { return strconv.Itoa(int(f.ID)) }
	// Rename Cart to Basket, move Catalogue inside Checkout, add a Wishlist
	// that needs Basket, and add a new row called Cart (the rename frees it).
	body := `{"project_id":` + strconv.Itoa(project.ID) + `,"features":[
		{"key":"` + rows[0].Key + `","title":"Checkout","feature_id":` + id(checkout) + `},
		{"key":"` + rows[1].Key + `","title":"Basket","parent_key":"` + rows[0].Key + `","feature_id":` + id(cart) + `},
		{"key":"` + rows[2].Key + `","title":"Payment","parent_key":"` + rows[0].Key + `","feature_id":` + id(payment) + `,"needs":["` + rows[1].Key + `"]},
		{"key":"` + rows[3].Key + `","title":"Catalogue","parent_key":"` + rows[0].Key + `","moved":true,"feature_id":` + id(catalogue) + `},
		{"key":"new","title":"Wishlist","needs":["` + rows[1].Key + `"]},
		{"key":"again","title":"Cart"}
	]}`

	preview := decodeImport(t, do(r, http.MethodPost, "/api/v1/playground/import",
		strings.Replace(body, `{"project_id"`, `{"dry_run":true,"project_id"`, 1)))
	if preview.Updated != 2 || preview.Created != 2 || preview.Existing != 2 {
		t.Errorf("dry run: updated %d created %d existing %d; want 2, 2, 2", preview.Updated, preview.Created, preview.Existing)
	}
	if f := featuresOf(t, db, project.ID); f["Cart"].ID != cart.ID {
		t.Fatalf("a dry run renamed a feature")
	}

	result := decodeImport(t, do(r, http.MethodPost, "/api/v1/playground/import", body))
	if result.Updated != 2 || result.Created != 2 {
		t.Fatalf("import: %+v", result)
	}
	got := featuresOf(t, db, project.ID)
	if got["Basket"].ID != cart.ID {
		t.Errorf("Cart should have been renamed to Basket in place")
	}
	if got["Cart"].ID == cart.ID || got["Cart"].ID == 0 {
		t.Errorf("the new row named Cart should be a new feature")
	}
	if p := got["Catalogue"].ParentFeatureID; p == nil || *p != checkout.ID {
		t.Errorf("Catalogue should now sit inside Checkout")
	}
	if got["Basket"].ReleaseID == nil || *got["Basket"].ReleaseID != release.ID {
		t.Errorf("renaming must not touch the release")
	}
	pairs := dependencyPairs(t, db, project.ID)
	if !pairs["Basket > Payment"] || !pairs["Basket > Wishlist"] || len(pairs) != 2 {
		t.Errorf("dependencies = %v", pairs)
	}
}

func TestPlaygroundRenamesAndMovesSafely(t *testing.T) {
	db := newTestDB(t)
	owner, _, project := seed(t, db)
	a := models.Feature{ProjectID: project.ID, Title: "Cart", Status: models.StatusTodo, Priority: models.PriorityMedium, Category: "general"}
	b := models.Feature{ProjectID: project.ID, Title: "Payment", Status: models.StatusTodo, Priority: models.PriorityMedium, Category: "general"}
	db.Create(&a)
	db.Create(&b)
	r := playgroundRouter(t, db, owner.ID, "developer")
	ida, idb := strconv.Itoa(int(a.ID)), strconv.Itoa(int(b.ID))

	// Renaming Cart to Payment while Payment is not in the list would leave the
	// project with the same name twice.
	w := do(r, http.MethodPost, "/api/v1/playground/import", `{"project_id":`+strconv.Itoa(project.ID)+
		`,"features":[{"key":"x","title":"Payment","feature_id":`+ida+`}]}`)
	if w.Code != http.StatusUnprocessableEntity && w.Code != http.StatusBadRequest {
		t.Errorf("clashing rename: status %d, want a validation failure: %s", w.Code, w.Body.String())
	}

	// Payment sits inside Cart. Taking Payment out and putting Cart inside it
	// in one import is fine: Payment moves first.
	db.Model(&models.Feature{}).Where("id = ?", b.ID).Update("parent_feature_id", a.ID)
	w = do(r, http.MethodPost, "/api/v1/playground/import", `{"project_id":`+strconv.Itoa(project.ID)+`,"features":[
		{"key":"b","title":"Payment","feature_id":`+idb+`,"moved":true},
		{"key":"a","title":"Cart","parent_key":"b","moved":true,"feature_id":`+ida+`}]}`)
	if w.Code != http.StatusCreated {
		t.Fatalf("swap: status %d %s", w.Code, w.Body.String())
	}
	got := featuresOf(t, db, project.ID)
	if got["Payment"].ParentFeatureID != nil || got["Cart"].ParentFeatureID == nil || *got["Cart"].ParentFeatureID != b.ID {
		t.Errorf("the two should have swapped")
	}

	// A row that does not say it moved leaves the parent alone, even though
	// it is sent at the top level (its parent was unticked in the list).
	w = do(r, http.MethodPost, "/api/v1/playground/import", `{"project_id":`+strconv.Itoa(project.ID)+
		`,"features":[{"key":"a","title":"Cart","feature_id":`+ida+`}]}`)
	if w.Code != http.StatusCreated && w.Code != http.StatusOK {
		t.Fatalf("status %d %s", w.Code, w.Body.String())
	}
	if got := featuresOf(t, db, project.ID); got["Cart"].ParentFeatureID == nil {
		t.Errorf("an unmoved row must not be taken out of its parent")
	}
}

func TestPlaygroundSavesEachPersonsDraft(t *testing.T) {
	db := newTestDB(t)
	owner, other, _ := seed(t, db)
	mine := playgroundRouter(t, db, owner.ID, "developer")
	theirs := playgroundRouter(t, db, other.ID, "developer")

	if w := do(mine, http.MethodGet, "/api/v1/playground/saved", ""); !strings.Contains(w.Body.String(), `"draft":null`) {
		t.Fatalf("nothing saved yet should read as null: %s", w.Body.String())
	}
	if w := do(mine, http.MethodPut, "/api/v1/playground/saved", `{"name":"Grove","items":[1,2]}`); w.Code != http.StatusOK {
		t.Fatalf("save: %d %s", w.Code, w.Body.String())
	}
	if w := do(mine, http.MethodPut, "/api/v1/playground/saved", `{"name":"Grove v2","items":[]}`); w.Code != http.StatusOK {
		t.Fatalf("second save: %d %s", w.Code, w.Body.String())
	}
	if w := do(mine, http.MethodGet, "/api/v1/playground/saved", ""); !strings.Contains(w.Body.String(), `"name":"Grove v2"`) {
		t.Errorf("should read back the latest save: %s", w.Body.String())
	}
	if w := do(theirs, http.MethodGet, "/api/v1/playground/saved", ""); !strings.Contains(w.Body.String(), `"draft":null`) {
		t.Errorf("another person must not see it: %s", w.Body.String())
	}
	var count int64
	db.Model(&models.PlaygroundDraft{}).Count(&count)
	if count != 1 {
		t.Errorf("%d rows, want one per person", count)
	}
	if w := do(mine, http.MethodPut, "/api/v1/playground/saved", `[1,2]`); w.Code == http.StatusOK {
		t.Error("a draft that is not an object should be refused")
	}
	if w := do(mine, http.MethodGet, "/api/v1/playground/ai", ""); !strings.Contains(w.Body.String(), `"connected":false`) {
		t.Errorf("without a key the stand-in answers: %s", w.Body.String())
	}
}
