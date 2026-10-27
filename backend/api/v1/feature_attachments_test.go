package v1

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"github.com/FeaturePlus/backend/api"
	"github.com/FeaturePlus/backend/models"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// featureAttachmentRouter mounts the feature file routes, and the feature
// routes beside them, as one person over a real file store.
func featureAttachmentRouter(t *testing.T, db *gorm.DB, userID int) *gin.Engine {
	t.Helper()
	files := newFileStore(t, db)
	gin.SetMode(gin.TestMode)
	r := gin.New()
	g := r.Group("/api/v1")
	g.Use(func(c *gin.Context) {
		c.Set(api.ContextUserID, uint(userID))
		c.Set(api.ContextUserRole, "developer")
		c.Next()
	})
	NewFeatureAttachmentsHandler(db, files).Register(g)
	NewFeaturesHandler(db).Register(g)
	return r
}

func decodeFeatureAttachment(t *testing.T, w *httptest.ResponseRecorder) FeatureAttachmentDTO {
	t.Helper()
	var out struct {
		Data FeatureAttachmentDTO `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode: %v (%s)", err, w.Body.String())
	}
	return out.Data
}

func TestFeatureFileUploadsAndShowsInline(t *testing.T) {
	db := newTestDB(t)
	owner, _, project := seed(t, db)
	feature := seedFeatures(t, db, project.ID, owner.ID)[0]
	r := featureAttachmentRouter(t, db, owner.ID)
	path := "/api/v1/features/" + strconv.Itoa(int(feature.ID)) + "/attachments"

	picture := []byte("\x89PNG pretend picture")
	w := upload(r, path, "My Screen shot (1).png", "image/png", picture)
	if w.Code != http.StatusCreated {
		t.Fatalf("upload status %d: %s", w.Code, w.Body.String())
	}
	got := decodeFeatureAttachment(t, w)
	// A space or bracket would end a markdown link, so the name loses them.
	if got.Name != "My-Screen-shot--1-.png" {
		t.Errorf("name %q", got.Name)
	}

	again := decodeFeatureAttachment(t, upload(r, path, "My Screen shot (1).png", "image/png", []byte("second")))
	if again.Name != "My-Screen-shot--1--2.png" {
		t.Errorf("second upload of the same name is called %q", again.Name)
	}

	content := "/api/v1/feature-attachments/" + strconv.Itoa(int(got.ID)) + "/content"
	inline := do(r, http.MethodGet, content+"?disposition=inline", "")
	if inline.Code != http.StatusOK || !bytes.Equal(inline.Body.Bytes(), picture) {
		t.Fatalf("inline: status %d, body %q", inline.Code, inline.Body.String())
	}
	if ct := inline.Header().Get("Content-Type"); ct != "image/png" {
		t.Errorf("inline content type %q", ct)
	}
	if plain := do(r, http.MethodGet, content, ""); plain.Header().Get("Content-Type") != "application/octet-stream" {
		t.Errorf("without inline, content type %q", plain.Header().Get("Content-Type"))
	}
}

func TestFeatureFilesNeedEditToChange(t *testing.T) {
	db := newTestDB(t)
	owner, other, project := seed(t, db)
	feature := seedFeatures(t, db, project.ID, owner.ID)[0]
	share(t, db, project.ID, other.ID, models.RoleViewer)
	path := "/api/v1/features/" + strconv.Itoa(int(feature.ID)) + "/attachments"

	viewer := featureAttachmentRouter(t, db, other.ID)
	if w := upload(viewer, path, "a.png", "image/png", []byte("x")); w.Code != http.StatusForbidden {
		t.Fatalf("viewer upload status %d, want 403: %s", w.Code, w.Body.String())
	}

	added := decodeFeatureAttachment(t, upload(featureAttachmentRouter(t, db, owner.ID), path, "a.png", "image/png", []byte("x")))
	one := "/api/v1/feature-attachments/" + strconv.Itoa(int(added.ID))
	if w := do(viewer, http.MethodGet, one+"/content", ""); w.Code != http.StatusOK {
		t.Errorf("viewer download status %d, want 200", w.Code)
	}
	if w := do(viewer, http.MethodDelete, one, ""); w.Code != http.StatusForbidden {
		t.Errorf("viewer delete status %d, want 403", w.Code)
	}
}

func TestDeletingAFeatureTakesItsFiles(t *testing.T) {
	db := newTestDB(t)
	owner, _, project := seed(t, db)
	feature := models.Feature{ProjectID: project.ID, Title: "Lonely"}
	mustCreate(t, db, &feature)
	r := featureAttachmentRouter(t, db, owner.ID)
	id := strconv.Itoa(int(feature.ID))
	upload(r, "/api/v1/features/"+id+"/attachments", "a.png", "image/png", []byte("x"))

	if w := do(r, http.MethodDelete, "/api/v1/features/"+id, ""); w.Code != http.StatusNoContent {
		t.Fatalf("delete status %d: %s", w.Code, w.Body.String())
	}
	var left int64
	db.Model(&models.FeatureAttachment{}).Count(&left)
	var stored int64
	db.Raw("SELECT COUNT(*) FROM file_metadata").Scan(&stored)
	if left != 0 || stored != 0 {
		t.Errorf("%d attachment rows and %d stored files left behind", left, stored)
	}
}

func TestFeatureNotesSaveAndClear(t *testing.T) {
	db := newTestDB(t)
	owner, _, project := seed(t, db)
	feature := seedFeatures(t, db, project.ID, owner.ID)[0]
	r := featureAttachmentRouter(t, db, owner.ID)
	path := "/api/v1/features/" + strconv.Itoa(int(feature.ID))

	w := do(r, http.MethodPatch, path, `{"notes":"# Open questions\n- refunds?"}`)
	if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), `"notes":"# Open questions\n- refunds?"`) {
		t.Fatalf("save notes: status %d: %s", w.Code, w.Body.String())
	}
	// A change to something else leaves the notes alone; sending "" clears them.
	do(r, http.MethodPatch, path, `{"title":"Renamed"}`)
	var stored models.Feature
	db.First(&stored, feature.ID)
	if stored.Notes != "# Open questions\n- refunds?" {
		t.Errorf("notes after a rename: %q", stored.Notes)
	}
	do(r, http.MethodPatch, path, `{"notes":""}`)
	db.First(&stored, feature.ID)
	if stored.Notes != "" {
		t.Errorf("notes after clearing: %q", stored.Notes)
	}
}
