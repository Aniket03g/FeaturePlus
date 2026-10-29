package v1

import (
	"net/http"
	"strconv"
	"testing"

	"github.com/FeaturePlus/backend/models"
)

func TestPublishNumbersPublishesAndRefusesRepeats(t *testing.T) {
	db := newTestDB(t)
	owner, other, project := seed(t, db)
	r := versionsRouterAs(t, db, owner.ID)
	base := "/api/v1/projects/" + strconv.Itoa(project.ID)

	// Nothing published yet: null, not an error.
	w := do(r, http.MethodGet, base+"/published", "")
	if w.Code != http.StatusOK {
		t.Fatalf("published before any: status %d: %s", w.Code, w.Body.String())
	}
	if got := decodeVersion(t, w.Body.Bytes()); got.ID != 0 {
		t.Fatalf("published before any = %+v, want nothing", got.VersionDTO)
	}

	feature := models.Feature{ProjectID: project.ID, Title: "Payment"}
	db.Create(&feature)

	w = do(r, http.MethodPost, base+"/publish", `{"notes":"  first cut  "}`)
	if w.Code != http.StatusCreated {
		t.Fatalf("publish: status %d: %s", w.Code, w.Body.String())
	}
	first := decodeVersion(t, w.Body.Bytes())
	if first.PublishNumber != 1 || first.PublishedAt == nil || first.Tag != "Published #1" ||
		first.Notes != "first cut" || first.FeatureCount != 1 {
		t.Fatalf("first publish = %+v", first.VersionDTO)
	}

	// The same list again is refused, and saves nothing.
	if w := do(r, http.MethodPost, base+"/publish", `{}`); w.Code != http.StatusConflict {
		t.Fatalf("repeat publish: status %d, want 409: %s", w.Code, w.Body.String())
	}

	// A plain saved version in between takes a version number but no publish number.
	if w := do(r, http.MethodPost, base+"/versions", `{"tag":"checkpoint"}`); w.Code != http.StatusCreated {
		t.Fatalf("save: status %d: %s", w.Code, w.Body.String())
	}

	db.Model(&feature).Update("title", "Payments")
	w = do(r, http.MethodPost, base+"/publish", `{}`)
	if w.Code != http.StatusCreated {
		t.Fatalf("second publish: status %d: %s", w.Code, w.Body.String())
	}
	if second := decodeVersion(t, w.Body.Bytes()); second.PublishNumber != 2 || second.Number != 3 || second.Notes != "" {
		t.Fatalf("second publish = %+v, want publish #2 as version 3", second.VersionDTO)
	}

	// The published list is the latest publish, as it was then.
	db.Model(&feature).Update("title", "Payments and refunds")
	got := decodeVersion(t, do(r, http.MethodGet, base+"/published", "").Body.Bytes())
	if got.PublishNumber != 2 {
		t.Fatalf("published = #%d, want #2", got.PublishNumber)
	}
	if snap := decodeSnapshot(t, got.Snapshot); len(snap.Features) != 1 || snap.Features[0].Title != "Payments" {
		t.Fatalf("published snapshot = %+v", snap.Features)
	}

	// A viewer can read the published list but not publish; an editor can publish.
	share(t, db, project.ID, other.ID, models.RoleViewer)
	viewer := versionsRouterAs(t, db, other.ID)
	if w := do(viewer, http.MethodGet, base+"/published", ""); w.Code != http.StatusOK {
		t.Errorf("viewer read: status %d, want 200", w.Code)
	}
	if w := do(viewer, http.MethodPost, base+"/publish", `{}`); w.Code != http.StatusForbidden {
		t.Errorf("viewer publish: status %d, want 403", w.Code)
	}
	db.Model(&models.ProjectMember{}).Where("user_id = ?", other.ID).Update("role", models.RoleEditor)
	if w := do(viewer, http.MethodPost, base+"/publish", `{}`); w.Code != http.StatusCreated {
		t.Errorf("editor publish: status %d, want 201: %s", w.Code, w.Body.String())
	}
}
