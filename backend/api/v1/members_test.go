package v1

import (
	"encoding/json"
	"net/http"
	"strconv"
	"testing"

	"github.com/FeaturePlus/backend/api"
	"github.com/FeaturePlus/backend/models"
	"github.com/FeaturePlus/backend/repositories"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func membersRouter(t *testing.T, db *gorm.DB, userID int) *gin.Engine {
	return membersRouterAs(t, db, userID, "developer")
}

func membersRouterAs(t *testing.T, db *gorm.DB, userID int, role string) *gin.Engine {
	t.Helper()

	gin.SetMode(gin.TestMode)
	r := gin.New()
	g := r.Group("/api/v1")
	g.Use(func(c *gin.Context) {
		c.Set(api.ContextUserID, uint(userID))
		c.Set(api.ContextUserRole, role)
		c.Next()
	})
	NewMembersHandler(db).Register(g)
	NewFeaturesHandler(db).Register(g)
	NewProjectsHandler(repositories.NewProjectRepository(db), db).Register(g)
	return r
}

func decodeMembers(t *testing.T, body []byte) []MemberDTO {
	t.Helper()
	var env struct {
		Data []MemberDTO `json:"data"`
	}
	if err := json.Unmarshal(body, &env); err != nil {
		t.Fatalf("decode members: %v: %s", err, body)
	}
	return env.Data
}

func TestShareAProjectByEmail(t *testing.T) {
	db := newTestDB(t)
	owner, other, project := seed(t, db)
	base := "/api/v1/projects/" + strconv.Itoa(project.ID) + "/members"
	r := membersRouter(t, db, owner.ID)

	// Email matching ignores case, since older accounts were not lowercased.
	w := do(r, http.MethodPost, base, `{"email":"OTHER@example.com","role":"viewer"}`)
	if w.Code != http.StatusCreated {
		t.Fatalf("add status %d, want 201: %s", w.Code, w.Body.String())
	}

	// Now they can see it, and so can read who it is shared with.
	them := membersRouter(t, db, other.ID)
	w = do(them, http.MethodGet, base, "")
	if w.Code != http.StatusOK {
		t.Fatalf("list status %d: %s", w.Code, w.Body.String())
	}
	members := decodeMembers(t, w.Body.Bytes())
	if len(members) != 2 || members[0].Role != models.RoleOwner || members[0].User.ID != owner.ID ||
		members[1].Role != models.RoleViewer || members[1].User.ID != other.ID {
		t.Fatalf("members = %+v", members)
	}

	// Sharing twice is refused; the role is changed instead.
	if w := do(r, http.MethodPost, base, `{"email":"other@example.com","role":"editor"}`); w.Code != http.StatusConflict {
		t.Fatalf("second add status %d, want 409", w.Code)
	}
	if w := do(r, http.MethodPatch, base+"/"+strconv.Itoa(other.ID), `{"role":"editor"}`); w.Code != http.StatusOK {
		t.Fatalf("update status %d: %s", w.Code, w.Body.String())
	}
	var member models.ProjectMember
	db.Where("user_id = ?", other.ID).First(&member)
	if member.Role != models.RoleEditor {
		t.Errorf("role = %q, want editor", member.Role)
	}

	// The owner removes them, and the project is hidden from them again.
	if w := do(r, http.MethodDelete, base+"/"+strconv.Itoa(other.ID), ""); w.Code != http.StatusNoContent {
		t.Fatalf("remove status %d: %s", w.Code, w.Body.String())
	}
	if w := do(them, http.MethodGet, base, ""); w.Code != http.StatusNotFound {
		t.Fatalf("after removal status %d, want 404", w.Code)
	}
}

func TestSharingRefusals(t *testing.T) {
	db := newTestDB(t)
	owner, other, project := seed(t, db)
	base := "/api/v1/projects/" + strconv.Itoa(project.ID) + "/members"
	r := membersRouter(t, db, owner.ID)

	cases := []struct {
		name string
		body string
		want int
	}{
		{"no such account", `{"email":"nobody@example.com","role":"viewer"}`, http.StatusUnprocessableEntity},
		{"the owner themselves", `{"email":"owner@example.com","role":"editor"}`, http.StatusConflict},
		{"owner is not a role to give", `{"email":"other@example.com","role":"owner"}`, http.StatusUnprocessableEntity},
		{"made-up role", `{"email":"other@example.com","role":"admin"}`, http.StatusUnprocessableEntity},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if w := do(r, http.MethodPost, base, tc.body); w.Code != tc.want {
				t.Fatalf("status %d, want %d: %s", w.Code, tc.want, w.Body.String())
			}
		})
	}

	// The owner cannot be removed.
	if w := do(r, http.MethodDelete, base+"/"+strconv.Itoa(owner.ID), ""); w.Code != http.StatusConflict {
		t.Fatalf("remove owner status %d, want 409", w.Code)
	}

	// An editor cannot share it onwards: that is the owner's call.
	share(t, db, project.ID, other.ID, models.RoleEditor)
	third := models.User{Username: "third", Email: "third@example.com", Password: "x", Role: "developer"}
	db.Create(&third)
	editor := membersRouter(t, db, other.ID)
	if w := do(editor, http.MethodPost, base, `{"email":"third@example.com","role":"viewer"}`); w.Code != http.StatusForbidden {
		t.Fatalf("editor sharing status %d, want 403", w.Code)
	}
	if w := do(editor, http.MethodPatch, base+"/"+strconv.Itoa(other.ID), `{"role":"viewer"}`); w.Code != http.StatusForbidden {
		t.Fatalf("editor changing roles status %d, want 403", w.Code)
	}
}

func TestAMemberCanLeave(t *testing.T) {
	db := newTestDB(t)
	_, other, project := seed(t, db)
	share(t, db, project.ID, other.ID, models.RoleViewer)
	base := "/api/v1/projects/" + strconv.Itoa(project.ID) + "/members/"

	r := membersRouter(t, db, other.ID)
	if w := do(r, http.MethodDelete, base+strconv.Itoa(other.ID), ""); w.Code != http.StatusNoContent {
		t.Fatalf("leave status %d: %s", w.Code, w.Body.String())
	}
	var count int64
	db.Model(&models.ProjectMember{}).Count(&count)
	if count != 0 {
		t.Errorf("%d member rows left, want 0", count)
	}
}

func TestAFeatureCannotBeHungInsideAnotherProject(t *testing.T) {
	db := newTestDB(t)
	owner, other, project := seed(t, db)
	features := seedFeatures(t, db, project.ID, owner.ID)
	theirs := models.Project{Name: "Their own", OwnerID: other.ID}
	db.Create(&theirs)

	r := membersRouter(t, db, other.ID)
	body := `{"title":"Planted","parent_feature_id":` + strconv.Itoa(int(features[0].ID)) + `}`
	w := do(r, http.MethodPost, "/api/v1/projects/"+strconv.Itoa(theirs.ID)+"/features", body)
	if w.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status %d, want 422: %s", w.Code, w.Body.String())
	}
}

func TestHiddenFeatureReadsAsMissing(t *testing.T) {
	db := newTestDB(t)
	owner, other, project := seed(t, db)
	features := seedFeatures(t, db, project.ID, owner.ID)

	r := membersRouter(t, db, other.ID)
	w := do(r, http.MethodGet, "/api/v1/features/"+strconv.Itoa(int(features[0].ID)), "")
	if w.Code != http.StatusNotFound {
		t.Fatalf("status %d, want 404: %s", w.Code, w.Body.String())
	}
	if e := decodeErr(t, w); e.Message != "Feature not found" {
		t.Errorf("message = %q, want it to read as a missing feature", e.Message)
	}
}

func TestAnAdminSeesAndManagesEveryProject(t *testing.T) {
	db := newTestDB(t)
	owner, other, project := seed(t, db)
	theirs := models.Project{Name: "Their own", OwnerID: other.ID}
	db.Create(&theirs)
	admin := models.User{Username: "admin", Email: "admin@example.com", Password: "x", Role: "admin"}
	db.Create(&admin)
	r := membersRouterAs(t, db, admin.ID, "admin")
	p := "/api/v1/projects/" + strconv.Itoa(project.ID)

	// Their normal list is their own projects; ?all=true is everything.
	data, _ := decodeList(t, do(r, http.MethodGet, "/api/v1/projects", ""))
	if len(data) != 0 {
		t.Fatalf("default list = %d projects, want 0", len(data))
	}
	data, _ = decodeList(t, do(r, http.MethodGet, "/api/v1/projects?all=true", ""))
	if len(data) != 2 || data[0].MyRole != models.RoleAdmin {
		t.Fatalf("all = %+v", data)
	}

	// ?all=true means nothing to anyone else.
	data, _ = decodeList(t, do(membersRouter(t, db, other.ID), http.MethodGet, "/api/v1/projects?all=true", ""))
	if len(data) != 1 {
		t.Fatalf("non-admin all = %d projects, want 1", len(data))
	}

	// Opening, editing and sharing someone else's project.
	if w := do(r, http.MethodGet, p, ""); w.Code != http.StatusOK || decodeOne(t, w).MyRole != models.RoleAdmin {
		t.Fatalf("get: %d %s", w.Code, w.Body.String())
	}
	if w := do(r, http.MethodPost, p+"/features", `{"title":"By admin"}`); w.Code != http.StatusCreated {
		t.Fatalf("create feature: %d %s", w.Code, w.Body.String())
	}
	if w := do(r, http.MethodPost, p+"/members", `{"email":"other@example.com","role":"viewer"}`); w.Code != http.StatusCreated {
		t.Fatalf("share: %d %s", w.Code, w.Body.String())
	}
	_ = owner
}

func TestTransferAProject(t *testing.T) {
	db := newTestDB(t)
	owner, other, project := seed(t, db)
	p := "/api/v1/projects/" + strconv.Itoa(project.ID)

	// An editor cannot give it away.
	share(t, db, project.ID, other.ID, models.RoleEditor)
	if w := do(membersRouter(t, db, other.ID), http.MethodPost, p+"/transfer", `{"email":"other@example.com"}`); w.Code != http.StatusForbidden {
		t.Fatalf("editor transfer status %d, want 403", w.Code)
	}

	// An admin can, and the old owner stays on as an editor.
	admin := models.User{Username: "admin", Email: "admin@example.com", Password: "x", Role: "admin"}
	db.Create(&admin)
	r := membersRouterAs(t, db, admin.ID, "admin")
	if w := do(r, http.MethodPost, p+"/transfer", `{"email":"OTHER@example.com"}`); w.Code != http.StatusOK {
		t.Fatalf("transfer status %d: %s", w.Code, w.Body.String())
	}

	var reloaded models.Project
	db.First(&reloaded, project.ID)
	if reloaded.OwnerID != other.ID {
		t.Fatalf("owner = %d, want %d", reloaded.OwnerID, other.ID)
	}
	var rows []models.ProjectMember
	db.Where("project_id = ?", project.ID).Find(&rows)
	if len(rows) != 1 || rows[0].UserID != owner.ID || rows[0].Role != models.RoleEditor {
		t.Fatalf("members after transfer = %+v", rows)
	}

	// Transferring to the current owner is refused.
	if w := do(r, http.MethodPost, p+"/transfer", `{"email":"other@example.com"}`); w.Code != http.StatusConflict {
		t.Fatalf("same owner status %d, want 409", w.Code)
	}
}
