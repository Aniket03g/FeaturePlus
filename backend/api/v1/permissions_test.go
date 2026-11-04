package v1

import (
	"encoding/json"
	"net/http"
	"strconv"
	"testing"

	"github.com/FeaturePlus/backend/api"
	"github.com/FeaturePlus/backend/models"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// The project rules, one action each:
//   messages on features — anyone; a message belongs to its author
//   reading anyone's working set (copy) — editor
//   downloading a backup — owner or publisher

func messagesRouterAs(t *testing.T, db *gorm.DB, userID int) *gin.Engine {
	t.Helper()
	gin.SetMode(gin.TestMode)
	r := gin.New()
	g := r.Group("/api/v1")
	g.Use(func(c *gin.Context) {
		c.Set(api.ContextUserID, uint(userID))
		c.Set(api.ContextUserRole, "developer")
		c.Next()
	})
	registerMessageRoutes(g, db)
	return r
}

func TestMessagesOnFeatures(t *testing.T) {
	db := newTestDB(t)
	owner, other, project := seed(t, db)
	feature := models.Feature{ProjectID: project.ID, Title: "Checkout"}
	db.Create(&feature)
	path := "/api/v1/features/" + strconv.Itoa(int(feature.ID)) + "/messages"

	// Someone the project is not shared with cannot see or write messages.
	outsider := messagesRouterAs(t, db, other.ID)
	if w := do(outsider, http.MethodPost, path, `{"content":"hi"}`); w.Code != http.StatusNotFound {
		t.Fatalf("outsider: status %d, want 404", w.Code)
	}

	// A viewer may write one.
	share(t, db, project.ID, other.ID, models.RoleViewer)
	viewer := messagesRouterAs(t, db, other.ID)
	w := do(viewer, http.MethodPost, path, `{"content":"  Should guests be able to pay?  "}`)
	if w.Code != http.StatusCreated {
		t.Fatalf("viewer posts: status %d: %s", w.Code, w.Body.String())
	}
	var posted struct {
		Data MessageDTO `json:"data"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &posted)
	if posted.Data.Content != "Should guests be able to pay?" || !posted.Data.Mine || posted.Data.FeatureTitle != "Checkout" {
		t.Fatalf("posted = %+v", posted.Data)
	}
	if w := do(viewer, http.MethodPost, path, `{"content":"   "}`); w.Code != http.StatusUnprocessableEntity {
		t.Errorf("empty message: status %d, want 422", w.Code)
	}

	r := messagesRouterAs(t, db, owner.ID)
	do(r, http.MethodPost, path, `{"content":"Yes, by card only"}`)

	var list struct {
		Data []MessageDTO `json:"data"`
	}
	_ = json.Unmarshal(do(r, http.MethodGet, path, "").Body.Bytes(), &list)
	if len(list.Data) != 2 || list.Data[0].Content != "Should guests be able to pay?" || list.Data[0].Mine {
		t.Fatalf("thread as the owner = %+v", list.Data)
	}

	// Only the author changes or removes a message, not even the owner.
	msg := "/api/v1/messages/" + strconv.Itoa(int(posted.Data.ID))
	if w := do(r, http.MethodPatch, msg, `{"content":"x"}`); w.Code != http.StatusForbidden {
		t.Errorf("owner edits someone's message: status %d, want 403", w.Code)
	}
	if w := do(r, http.MethodDelete, msg, ""); w.Code != http.StatusForbidden {
		t.Errorf("owner deletes someone's message: status %d, want 403", w.Code)
	}
	if w := do(viewer, http.MethodPatch, msg, `{"content":"Can guests pay?"}`); w.Code != http.StatusOK {
		t.Errorf("author edits: status %d: %s", w.Code, w.Body.String())
	}

	// The project's messages, newest first.
	var feed struct {
		Data []MessageDTO `json:"data"`
	}
	_ = json.Unmarshal(do(r, http.MethodGet, "/api/v1/projects/"+strconv.Itoa(project.ID)+"/messages", "").Body.Bytes(), &feed)
	if len(feed.Data) != 2 || feed.Data[0].Content != "Yes, by card only" || feed.Data[1].Content != "Can guests pay?" {
		t.Fatalf("project feed = %+v", feed.Data)
	}

	if w := do(viewer, http.MethodDelete, msg, ""); w.Code != http.StatusNoContent {
		t.Errorf("author deletes: status %d", w.Code)
	}
	var left int64
	db.Model(&models.FeatureMessage{}).Count(&left)
	if left != 1 {
		t.Errorf("messages left = %d, want 1", left)
	}
}

func TestEditorsReadEveryonesCopies(t *testing.T) {
	db := newTestDB(t)
	owner, other, project := seed(t, db)
	db.Create(&models.Feature{ProjectID: project.ID, Title: "Cart"})
	base := "/api/v1/projects/" + strconv.Itoa(project.ID)

	// The owner starts a copy of their own, not published.
	w := do(versionsRouterAs(t, db, owner.ID), http.MethodPost, base+"/copies/start", `{"from":"working","name":"Owner's idea"}`)
	if w.Code != http.StatusCreated {
		t.Fatalf("start copy: status %d: %s", w.Code, w.Body.String())
	}
	copied := decodeCopyDetail(t, w.Body.Bytes())
	one := base + "/copies/" + strconv.Itoa(int(copied.ID))

	listCount := func(r *gin.Engine) int {
		var out struct {
			Data []CopyDTO `json:"data"`
		}
		_ = json.Unmarshal(do(r, http.MethodGet, base+"/copies", "").Body.Bytes(), &out)
		return len(out.Data)
	}

	// A viewer sees neither the list entry nor the copy.
	share(t, db, project.ID, other.ID, models.RoleViewer)
	as := versionsRouterAs(t, db, other.ID)
	if n := listCount(as); n != 0 {
		t.Errorf("viewer lists %d copies, want 0", n)
	}
	if w := do(as, http.MethodGet, one, ""); w.Code != http.StatusNotFound {
		t.Errorf("viewer opens it: status %d, want 404", w.Code)
	}

	// An editor sees and opens it, but it is not theirs to change.
	db.Model(&models.ProjectMember{}).Where("user_id = ?", other.ID).Update("role", models.RoleEditor)
	if n := listCount(as); n != 1 {
		t.Errorf("editor lists %d copies, want 1", n)
	}
	w = do(as, http.MethodGet, one, "")
	if w.Code != http.StatusOK {
		t.Fatalf("editor opens it: status %d", w.Code)
	}
	if got := decodeCopyDetail(t, w.Body.Bytes()); got.Mine {
		t.Error("an editor's view of someone's copy says it is theirs")
	}
	if w := do(as, http.MethodDelete, one, ""); w.Code == http.StatusNoContent {
		t.Error("an editor deleted someone else's copy")
	}
}

func TestPublishersDownloadBackups(t *testing.T) {
	db := newTestDB(t)
	files := newFileStore(t, db)
	fx := seedBackupProject(t, db, files)
	path := "/api/v1/projects/" + strconv.Itoa(fx.project.ID) + "/backup"

	db.Model(&models.ProjectMember{}).Where("project_id = ? AND user_id = ?", fx.project.ID, fx.other.ID).Update("role", models.RoleEditor)
	if w := do(backupRouter(t, db, files, fx.other.ID, "developer"), http.MethodGet, path, ""); w.Code != http.StatusForbidden {
		t.Errorf("editor: status %d, want 403", w.Code)
	}
	db.Model(&models.ProjectMember{}).Where("user_id = ?", fx.other.ID).Update("role", models.RolePublisher)
	if w := do(backupRouter(t, db, files, fx.other.ID, "developer"), http.MethodGet, path, ""); w.Code != http.StatusOK {
		t.Errorf("publisher: status %d, want 200", w.Code)
	}
}

func TestMessagesSurviveBackupAndRestore(t *testing.T) {
	db := newTestDB(t)
	files := newFileStore(t, db)
	fx := seedBackupProject(t, db, files)
	db.Create(&models.FeatureMessage{ProjectID: fx.project.ID, FeatureID: fx.child.ID, UserID: fx.owner.ID, Content: "Mind the refunds"})

	result := restored(t, postBackup(t, db, files, fx.owner.ID, "restore", downloadBackup(t, db, files, fx.owner.ID, fx.project.ID)))
	var got []models.FeatureMessage
	db.Where("project_id = ?", result.ProjectID).Find(&got)
	if len(got) != 1 || got[0].Content != "Mind the refunds" || got[0].FeatureID == fx.child.ID {
		t.Fatalf("restored messages = %+v", got)
	}
}
