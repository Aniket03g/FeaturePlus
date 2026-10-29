package v1

import (
	"net/http"
	"strconv"
	"testing"

	"github.com/FeaturePlus/backend/models"
)

func TestFeatureColors(t *testing.T) {
	db := newTestDB(t)
	owner, other, project := seed(t, db)
	feature := models.Feature{ProjectID: project.ID, Title: "Payment"}
	db.Create(&feature)
	second := models.Feature{ProjectID: project.ID, Title: "Refunds", Color: "blue"}
	db.Create(&second)

	r := featureRouter(t, db, owner.ID, "developer")
	one := "/api/v1/features/" + strconv.Itoa(int(feature.ID))
	color := func(id uint) string {
		var f models.Feature
		db.First(&f, id)
		return f.Color
	}

	if w := do(r, http.MethodPatch, one, `{"color":"red"}`); w.Code != http.StatusOK {
		t.Fatalf("set colour: status %d: %s", w.Code, w.Body.String())
	}
	if got := color(feature.ID); got != "red" {
		t.Errorf("colour = %q, want red", got)
	}
	if w := do(r, http.MethodPatch, one, `{"color":"magenta"}`); w.Code == http.StatusOK {
		t.Errorf("a colour outside the palette was accepted")
	}
	if w := do(r, http.MethodPatch, one, `{"color":""}`); w.Code != http.StatusOK || color(feature.ID) != "" {
		t.Errorf("clearing one colour: status %d, colour %q", w.Code, color(feature.ID))
	}

	// Clearing all: a viewer may not, an editor may.
	clear := "/api/v1/projects/" + strconv.Itoa(project.ID) + "/features/clear-colors"
	share(t, db, project.ID, other.ID, models.RoleViewer)
	if w := do(featureRouter(t, db, other.ID, "developer"), http.MethodPost, clear, ""); w.Code != http.StatusForbidden {
		t.Errorf("viewer clear: status %d, want 403", w.Code)
	}
	db.Model(&models.ProjectMember{}).Where("user_id = ?", other.ID).Update("role", models.RoleEditor)
	if w := do(featureRouter(t, db, other.ID, "developer"), http.MethodPost, clear, ""); w.Code != http.StatusOK {
		t.Fatalf("editor clear: status %d: %s", w.Code, w.Body.String())
	}
	if got := color(second.ID); got != "" {
		t.Errorf("after clearing all, colour = %q", got)
	}
}

// Colours are a working aid: changing one is not a change to the published plan.
func TestColorIsNotPublished(t *testing.T) {
	db := newTestDB(t)
	owner, _, project := seed(t, db)
	feature := models.Feature{ProjectID: project.ID, Title: "Payment"}
	db.Create(&feature)

	versions := versionsRouterAs(t, db, owner.ID)
	publish := "/api/v1/projects/" + strconv.Itoa(project.ID) + "/publish"
	if w := do(versions, http.MethodPost, publish, `{}`); w.Code != http.StatusCreated {
		t.Fatalf("publish: status %d: %s", w.Code, w.Body.String())
	}
	db.Model(&feature).Update("color", "green")
	if w := do(versions, http.MethodPost, publish, `{}`); w.Code != http.StatusConflict {
		t.Errorf("publish after only a colour change: status %d, want 409 (nothing changed)", w.Code)
	}
}
