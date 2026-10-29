package v1

import (
	"encoding/json"
	"net/http"
	"strconv"
	"testing"

	"github.com/FeaturePlus/backend/models"
)

func decodeSpace(t *testing.T, body []byte) SpaceSummary {
	t.Helper()
	var env struct {
		Data SpaceSummary `json:"data"`
	}
	if err := json.Unmarshal(body, &env); err != nil {
		t.Fatalf("decode space: %v: %s", err, body)
	}
	return env.Data
}

func TestMySpaceSummary(t *testing.T) {
	db := newTestDB(t)
	owner, other, project := seed(t, db)
	base := "/api/v1/projects/" + strconv.Itoa(project.ID)
	asOwner := versionsRouterAs(t, db, owner.ID)
	asOther := versionsRouterAs(t, db, other.ID)

	feature := models.Feature{ProjectID: project.ID, Title: "Payment", Status: models.StatusDone}
	db.Create(&feature)
	db.Create(&models.Feature{ProjectID: project.ID, Title: "Refunds"})

	// Not on the project yet: it isn't on their dashboard.
	if got := decodeSpace(t, do(asOther, http.MethodGet, "/api/v1/me/space", "").Body.Bytes()); len(got.Projects) != 0 {
		t.Fatalf("stranger sees %d projects, want 0", len(got.Projects))
	}

	share(t, db, project.ID, other.ID, models.RoleViewer)
	first := decodeSpace(t, do(asOther, http.MethodGet, "/api/v1/me/space", "").Body.Bytes())
	if first.SeenAt != nil || len(first.New) != 0 || len(first.Projects) != 1 {
		t.Fatalf("first look = %+v", first)
	}
	if p := first.Projects[0]; p.Role != models.RoleViewer || p.Features != 2 || p.Done != 1 || p.Latest != nil || p.Unpublished != 2 {
		t.Fatalf("project before any publish = %+v", p)
	}

	if w := do(asOther, http.MethodPost, "/api/v1/me/space/seen", ""); w.Code != http.StatusOK {
		t.Fatalf("seen: status %d: %s", w.Code, w.Body.String())
	}

	// The owner publishes; then changes one feature without publishing.
	do(asOwner, http.MethodPost, base+"/publish", `{"notes":"first plan"}`)
	db.Model(&feature).Update("title", "Payments")

	got := decodeSpace(t, do(asOther, http.MethodGet, "/api/v1/me/space", "").Body.Bytes())
	if got.SeenAt == nil || len(got.New) != 1 || got.New[0].PublishNumber != 1 || got.New[0].Notes != "first plan" ||
		got.New[0].ProjectName != "Hiking App" || got.New[0].By != "owner" {
		t.Fatalf("after a publish: seen %v, new %+v", got.SeenAt, got.New)
	}
	if p := got.Projects[0]; p.Latest == nil || p.Latest.PublishNumber != 1 || p.Unpublished != 1 {
		t.Fatalf("project after publish = %+v", p)
	}

	// Your own publishes are not news to you.
	if mine := decodeSpace(t, do(asOwner, http.MethodGet, "/api/v1/me/space", "").Body.Bytes()); len(mine.New) != 0 {
		t.Errorf("owner's first look lists %d new publishes, want 0", len(mine.New))
	}
	do(asOwner, http.MethodPost, "/api/v1/me/space/seen", "")
	do(asOwner, http.MethodPost, base+"/publish", `{}`)
	if mine := decodeSpace(t, do(asOwner, http.MethodGet, "/api/v1/me/space", "").Body.Bytes()); len(mine.New) != 0 {
		t.Errorf("owner sees their own publish as new: %+v", mine.New)
	}
}
