package v1

import (
	"encoding/json"
	"net/http"
	"strconv"
	"testing"

	"github.com/FeaturePlus/backend/models"
)

func TestProjectVisit(t *testing.T) {
	db := newTestDB(t)
	owner, other, project := seed(t, db)
	visit := "/api/v1/projects/" + strconv.Itoa(project.ID) + "/visit"

	previous := func(w interface{ Bytes() []byte }) *string {
		var body struct {
			Data struct {
				Previous *string `json:"previous"`
			} `json:"data"`
		}
		if err := json.Unmarshal(w.Bytes(), &body); err != nil {
			t.Fatalf("decode: %v", err)
		}
		return body.Data.Previous
	}

	r := featureRouter(t, db, owner.ID, "developer")
	w := do(r, http.MethodPost, visit, "")
	if w.Code != http.StatusOK {
		t.Fatalf("first visit: status %d: %s", w.Code, w.Body.String())
	}
	if p := previous(w.Body); p != nil {
		t.Errorf("first visit: previous = %s, want null", *p)
	}
	w = do(r, http.MethodPost, visit, "")
	if p := previous(w.Body); p == nil {
		t.Errorf("second visit: previous is null, want the first visit's time")
	}

	var rows int64
	db.Model(&models.ProjectVisit{}).Count(&rows)
	if rows != 1 {
		t.Errorf("visits stored = %d, want 1 (one per person and project)", rows)
	}

	// Someone the project isn't shared with can't record a visit.
	if w := do(featureRouter(t, db, other.ID, "developer"), http.MethodPost, visit, ""); w.Code == http.StatusOK {
		t.Errorf("outsider visit: status %d, want refused", w.Code)
	}
}
