package v1

import (
	"encoding/json"
	"net/http"
	"strconv"
	"testing"

	"github.com/FeaturePlus/backend/models"
)

func decodeCopyDetail(t *testing.T, body []byte) CopyDetailDTO {
	t.Helper()
	var env struct {
		Data CopyDetailDTO `json:"data"`
	}
	if err := json.Unmarshal(body, &env); err != nil {
		t.Fatalf("decode copy: %v: %s", err, body)
	}
	return env.Data
}

func TestStartCopyFromPublishedOrWorking(t *testing.T) {
	db := newTestDB(t)
	owner, _, project := seed(t, db)
	r := versionsRouterAs(t, db, owner.ID)
	base := "/api/v1/projects/" + strconv.Itoa(project.ID)

	feature := models.Feature{ProjectID: project.ID, Title: "Payment", Description: "Card only"}
	db.Create(&feature)

	// Nothing published: refused, and nothing made.
	if w := do(r, http.MethodPost, base+"/copies/start", `{"from":"published"}`); w.Code != http.StatusUnprocessableEntity {
		t.Fatalf("from published with none: status %d, want 422: %s", w.Code, w.Body.String())
	}

	// From the working list with no versions at all: one is saved automatically.
	w := do(r, http.MethodPost, base+"/copies/start", `{"from":"working","name":"Ideas"}`)
	if w.Code != http.StatusCreated {
		t.Fatalf("from working: status %d: %s", w.Code, w.Body.String())
	}
	first := decodeCopyDetail(t, w.Body.Bytes())
	if first.Source != "working" || first.Name != "Ideas" || first.Revision != 1 || first.FeatureCount != 1 || first.Base.Number != 1 {
		t.Fatalf("first copy = %+v", first.CopyDTO)
	}
	var auto models.FeatureVersion
	db.First(&auto, first.Base.ID)
	if !auto.Auto {
		t.Errorf("starting point version should be automatic: %+v", auto)
	}

	// Again with nothing changed: the same version is reused.
	second := decodeCopyDetail(t, do(r, http.MethodPost, base+"/copies/start", `{"from":"working"}`).Body.Bytes())
	if second.Base.ID != first.Base.ID {
		t.Errorf("unchanged list saved a new version: base %d, want %d", second.Base.ID, first.Base.ID)
	}

	// From the published list: based on the latest publish.
	do(r, http.MethodPost, base+"/publish", `{}`)
	third := decodeCopyDetail(t, do(r, http.MethodPost, base+"/copies/start", `{"from":"published"}`).Body.Bytes())
	if third.Source != "published" || third.Base.PublishNumber != 1 {
		t.Errorf("from published = %+v", third.CopyDTO)
	}
}

func TestSaveCopyListOnline(t *testing.T) {
	db := newTestDB(t)
	owner, other, project := seed(t, db)
	r := versionsRouterAs(t, db, owner.ID)
	base := "/api/v1/projects/" + strconv.Itoa(project.ID)

	feature := models.Feature{ProjectID: project.ID, Title: "Payment", Description: "Card only", Status: models.StatusTodo}
	db.Create(&feature)
	started := decodeCopyDetail(t, do(r, http.MethodPost, base+"/copies/start", `{"from":"working"}`).Body.Bytes())
	key := decodeSnapshot(t, started.Snapshot).Features[0].Key
	one := base + "/copies/" + strconv.Itoa(int(started.ID))

	// Rename, rewrite the text, and add a feature inside with a key the page made.
	body := `{"revision":1,"name":"Checkout rework","features":[
		{"key":"` + key + `","title":"Payments","description":"Card and UPI","notes":"ask finance","status":"in_progress","priority":"high"},
		{"key":"nabcdef012345","title":"Refunds","parent_key":"` + key + `"}]}`
	w := do(r, http.MethodPut, one+"/list", body)
	if w.Code != http.StatusOK {
		t.Fatalf("save: status %d: %s", w.Code, w.Body.String())
	}
	saved := decodeCopyDetail(t, w.Body.Bytes())
	snap := decodeSnapshot(t, saved.Snapshot)
	if saved.Revision != 2 || saved.Name != "Checkout rework" || len(snap.Features) != 2 {
		t.Fatalf("saved = %+v, %d features", saved.CopyDTO, len(snap.Features))
	}
	if f := snap.Features[0]; f.Title != "Payments" || f.Description != "Card and UPI" || f.Notes != "ask finance" ||
		f.Status != "in_progress" || f.Priority != "high" || f.FeatureID != feature.ID {
		t.Errorf("edited row = %+v", f)
	}
	if kid := snap.Features[1]; kid.Key != "nabcdef012345" || kid.ParentKey != key {
		t.Errorf("added row = %+v, want the page's key kept, inside %s", kid, key)
	}

	// The project's real list is untouched.
	var live models.Feature
	db.First(&live, feature.ID)
	if live.Title != "Payment" || live.Description != "Card only" {
		t.Errorf("live feature changed: %+v", live)
	}

	// A save from an older page is refused.
	if w := do(r, http.MethodPut, one+"/list", `{"revision":1,"features":[]}`); w.Code != http.StatusConflict {
		t.Errorf("stale save: status %d, want 409", w.Code)
	}
	// A bad status is refused.
	if w := do(r, http.MethodPut, one+"/list", `{"revision":2,"features":[{"key":"`+key+`","title":"x","status":"later"}]}`); w.Code == http.StatusOK {
		t.Errorf("bad status saved")
	}

	// Someone else, even sharing the project, can neither see nor change it.
	share(t, db, project.ID, other.ID, models.RoleEditor)
	stranger := versionsRouterAs(t, db, other.ID)
	if w := do(stranger, http.MethodPut, one+"/list", `{"revision":2,"features":[]}`); w.Code != http.StatusNotFound {
		t.Errorf("other's save: status %d, want 404", w.Code)
	}
	if w := do(stranger, http.MethodDelete, one, ""); w.Code != http.StatusNotFound {
		t.Errorf("other's delete: status %d, want 404", w.Code)
	}
	var theirs []MyCopyDTO
	json.Unmarshal(do(stranger, http.MethodGet, "/api/v1/me/copies", "").Body.Bytes(), &struct{ Data *[]MyCopyDTO }{&theirs})
	if len(theirs) != 0 {
		t.Errorf("other sees %d copies in My Space, want 0", len(theirs))
	}

	// Mine, across projects, with the project named.
	var mine []MyCopyDTO
	json.Unmarshal(do(r, http.MethodGet, "/api/v1/me/copies", "").Body.Bytes(), &struct{ Data *[]MyCopyDTO }{&mine})
	if len(mine) != 1 || mine[0].Project.Name != "Hiking App" || mine[0].Name != "Checkout rework" {
		t.Fatalf("my copies = %+v", mine)
	}

	if w := do(r, http.MethodDelete, one, ""); w.Code != http.StatusNoContent {
		t.Fatalf("delete: status %d: %s", w.Code, w.Body.String())
	}
	if w := do(r, http.MethodGet, one, ""); w.Code != http.StatusNotFound {
		t.Errorf("deleted copy still there: status %d", w.Code)
	}
}
