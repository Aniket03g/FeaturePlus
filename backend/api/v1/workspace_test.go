package v1

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"

	"github.com/FeaturePlus/backend/api"
	"github.com/FeaturePlus/backend/models"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// workspaceRouter mounts the Phase 7 handlers with a stubbed session.
func workspaceRouter(t *testing.T, db *gorm.DB, userID int, role string) *gin.Engine {
	t.Helper()

	gin.SetMode(gin.TestMode)
	r := gin.New()

	g := r.Group("/api/v1")
	g.Use(func(c *gin.Context) {
		if userID > 0 {
			c.Set(api.ContextUserID, uint(userID))
			c.Set(api.ContextUserRole, role)
		}
		c.Next()
	})

	NewUsersHandler(db).Register(g)
	NewCodeHandler(db).Register(g)
	NewScopesHandler(db).Register(g)
	return r
}

func decodeUsers(t *testing.T, w *httptest.ResponseRecorder) []UserDTO {
	t.Helper()

	var out struct {
		Data []UserDTO `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode: %v (%s)", err, w.Body.String())
	}
	return out.Data
}

func decodeUser(t *testing.T, w *httptest.ResponseRecorder) UserDTO {
	t.Helper()

	var out struct {
		Data UserDTO `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode: %v (%s)", err, w.Body.String())
	}
	return out.Data
}

func decodeFiles(t *testing.T, w *httptest.ResponseRecorder) []FeatureFileDTO {
	t.Helper()

	var out struct {
		Data []FeatureFileDTO `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode: %v (%s)", err, w.Body.String())
	}
	return out.Data
}

func decodeScopes(t *testing.T, w *httptest.ResponseRecorder) []ScopeDTO {
	t.Helper()

	var out struct {
		Data []ScopeDTO `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode: %v (%s)", err, w.Body.String())
	}
	return out.Data
}

func decodeScope(t *testing.T, w *httptest.ResponseRecorder) ScopeDTO {
	t.Helper()

	var out struct {
		Data ScopeDTO `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode: %v (%s)", err, w.Body.String())
	}
	return out.Data
}

// --- team management --------------------------------------------------------

func TestListUsersNeverCarriesAPassword(t *testing.T) {
	db := newTestDB(t)
	owner, other, project := seed(t, db)
	share(t, db, project.ID, other.ID, models.RoleViewer)

	r := workspaceRouter(t, db, owner.ID, "developer")
	w := do(r, http.MethodGet, "/api/v1/users", "")
	if w.Code != http.StatusOK {
		t.Fatalf("status %d, want 200: %s", w.Code, w.Body.String())
	}

	// The hash is in the seeded rows, so if it can leak it will show here.
	if body := w.Body.String(); contains(body, "$2a$") || contains(body, "password") {
		t.Fatalf("the user list carried password material: %s", body)
	}
	if users := decodeUsers(t, w); len(users) != 2 {
		t.Fatalf("listed %d users, want 2", len(users))
	}
}

func TestUserListFilters(t *testing.T) {
	db := newTestDB(t)
	owner, other, project := seed(t, db)
	if err := db.Model(&models.User{}).Where("id = ?", other.ID).
		Update("role", "manager").Error; err != nil {
		t.Fatalf("set role: %v", err)
	}
	share(t, db, project.ID, other.ID, models.RoleViewer)

	r := workspaceRouter(t, db, owner.ID, "developer")

	if users := decodeUsers(t, do(r, http.MethodGet, "/api/v1/users?role=manager", "")); len(users) != 1 ||
		users[0].ID != other.ID {
		t.Fatalf("role filter returned %+v, want the manager", users)
	}
	if users := decodeUsers(t, do(r, http.MethodGet, "/api/v1/users?q=owner", "")); len(users) != 1 ||
		users[0].ID != owner.ID {
		t.Fatalf("search returned %+v, want the owner", users)
	}
}

func TestUsersCanEditThemselvesButNotEachOther(t *testing.T) {
	db := newTestDB(t)
	owner, other, _ := seed(t, db)

	r := workspaceRouter(t, db, owner.ID, "developer")

	w := do(r, http.MethodPatch, "/api/v1/users/"+strconv.Itoa(owner.ID), `{"name":"The Owner"}`)
	if w.Code != http.StatusOK {
		t.Fatalf("self edit status %d, want 200: %s", w.Code, w.Body.String())
	}
	if got := decodeUser(t, w); got.Name != "The Owner" {
		t.Fatalf("name %q was not saved", got.Name)
	}

	w = do(r, http.MethodPatch, "/api/v1/users/"+strconv.Itoa(other.ID), `{"name":"Nope"}`)
	if w.Code != http.StatusForbidden {
		t.Fatalf("editing someone else: status %d, want 403: %s", w.Code, w.Body.String())
	}
}

func TestOnlyAnAdminCanChangeARole(t *testing.T) {
	db := newTestDB(t)
	owner, _, _ := seed(t, db)

	// Editing your own account is allowed, but promoting yourself is not.
	r := workspaceRouter(t, db, owner.ID, "developer")
	w := do(r, http.MethodPatch, "/api/v1/users/"+strconv.Itoa(owner.ID), `{"role":"manager"}`)
	if w.Code != http.StatusForbidden {
		t.Fatalf("self promotion status %d, want 403: %s", w.Code, w.Body.String())
	}

	var unchanged models.User
	if err := db.First(&unchanged, owner.ID).Error; err != nil {
		t.Fatalf("reload: %v", err)
	}
	if unchanged.Role != "developer" {
		t.Fatalf("role became %q", unchanged.Role)
	}

	manager := workspaceRouter(t, db, owner.ID, "manager")
	if w := do(manager, http.MethodPatch, "/api/v1/users/"+strconv.Itoa(owner.ID),
		`{"role":"admin"}`); w.Code != http.StatusForbidden {
		t.Fatalf("manager status %d, want 403: %s", w.Code, w.Body.String())
	}

	admin := workspaceRouter(t, db, owner.ID, "admin")
	if w := do(admin, http.MethodPatch, "/api/v1/users/"+strconv.Itoa(owner.ID),
		`{"role":"manager"}`); w.Code != http.StatusOK {
		t.Fatalf("admin status %d, want 200: %s", w.Code, w.Body.String())
	}
}

func TestTheLastAdminCannotBeDemoted(t *testing.T) {
	db := newTestDB(t)
	owner, other, _ := seed(t, db)
	db.Model(&models.User{}).Where("id = ?", owner.ID).Update("role", "admin")

	admin := workspaceRouter(t, db, owner.ID, "admin")
	path := "/api/v1/users/" + strconv.Itoa(owner.ID)
	if w := do(admin, http.MethodPatch, path, `{"role":"developer"}`); w.Code != http.StatusConflict {
		t.Fatalf("only admin status %d, want 409: %s", w.Code, w.Body.String())
	}

	// With a second admin, stepping down is fine.
	if w := do(admin, http.MethodPatch, "/api/v1/users/"+strconv.Itoa(other.ID), `{"role":"admin"}`); w.Code != http.StatusOK {
		t.Fatalf("promote status %d: %s", w.Code, w.Body.String())
	}
	if w := do(admin, http.MethodPatch, path, `{"role":"developer"}`); w.Code != http.StatusOK {
		t.Fatalf("step down status %d: %s", w.Code, w.Body.String())
	}
}

func TestUpdateUserRejectsATakenEmail(t *testing.T) {
	db := newTestDB(t)
	owner, other, _ := seed(t, db)

	r := workspaceRouter(t, db, owner.ID, "developer")
	w := do(r, http.MethodPatch, "/api/v1/users/"+strconv.Itoa(owner.ID),
		fmt.Sprintf(`{"email":%q}`, other.Email))

	if w.Code != http.StatusConflict {
		t.Fatalf("status %d, want 409: %s", w.Code, w.Body.String())
	}
	if fields := decodeAPIError(t, w).Fields; fields["email"] == "" {
		t.Fatalf("fields %v, want a message against email", fields)
	}
}

func TestDeleteUserRefusesWhileTheyOwnProjects(t *testing.T) {
	db := newTestDB(t)
	owner, other, _ := seed(t, db)

	r := workspaceRouter(t, db, other.ID, "admin")

	w := do(r, http.MethodDelete, "/api/v1/users/"+strconv.Itoa(owner.ID), "")
	if w.Code != http.StatusConflict {
		t.Fatalf("status %d, want 409: %s", w.Code, w.Body.String())
	}

	// Removing yourself is refused whatever you own.
	if w := do(r, http.MethodDelete, "/api/v1/users/"+strconv.Itoa(other.ID),
		""); w.Code != http.StatusConflict {
		t.Fatalf("self delete status %d, want 409: %s", w.Code, w.Body.String())
	}

	// A developer cannot remove anyone at all.
	dev := workspaceRouter(t, db, other.ID, "developer")
	if w := do(dev, http.MethodDelete, "/api/v1/users/"+strconv.Itoa(owner.ID),
		""); w.Code != http.StatusForbidden {
		t.Fatalf("developer status %d, want 403: %s", w.Code, w.Body.String())
	}
}

// --- linked code ------------------------------------------------------------

func TestLinkAndUnlinkFiles(t *testing.T) {
	db := newTestDB(t)
	owner, _, project := seed(t, db)
	features := seedFeatures(t, db, project.ID, owner.ID)

	r := workspaceRouter(t, db, owner.ID, "developer")
	path := "/api/v1/features/" + strconv.Itoa(int(features[0].ID)) + "/files"

	w := do(r, http.MethodPost, path, `{"file_path":"trails/search.go"}`)
	if w.Code != http.StatusCreated {
		t.Fatalf("status %d, want 201: %s", w.Code, w.Body.String())
	}

	var created struct {
		Data FeatureFileDTO `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &created); err != nil {
		t.Fatalf("decode: %v", err)
	}

	// The same file twice on one feature is refused.
	if w := do(r, http.MethodPost, path,
		`{"file_path":"trails/search.go"}`); w.Code != http.StatusConflict {
		t.Fatalf("duplicate status %d, want 409: %s", w.Code, w.Body.String())
	}

	// And so is the same file on a second feature: one file, one owner, or the
	// access rules have no way to decide who may read it.
	other := "/api/v1/features/" + strconv.Itoa(int(features[1].ID)) + "/files"
	if w := do(r, http.MethodPost, other,
		`{"file_path":"trails/search.go"}`); w.Code != http.StatusConflict {
		t.Fatalf("cross-feature status %d, want 409: %s", w.Code, w.Body.String())
	}

	if files := decodeFiles(t, do(r, http.MethodGet, path, "")); len(files) != 1 {
		t.Fatalf("listed %d files, want 1", len(files))
	}

	w = do(r, http.MethodDelete, path+"/"+strconv.Itoa(int(created.Data.ID)), "")
	if w.Code != http.StatusNoContent {
		t.Fatalf("unlink status %d, want 204: %s", w.Code, w.Body.String())
	}
	if w := do(r, http.MethodDelete, path+"/"+strconv.Itoa(int(created.Data.ID)),
		""); w.Code != http.StatusNotFound {
		t.Fatalf("second unlink status %d, want 404: %s", w.Code, w.Body.String())
	}
}

func TestFilePathsThatEscapeTheRepositoryAreRefused(t *testing.T) {
	db := newTestDB(t)
	owner, _, project := seed(t, db)
	features := seedFeatures(t, db, project.ID, owner.ID)

	r := workspaceRouter(t, db, owner.ID, "developer")
	path := "/api/v1/features/" + strconv.Itoa(int(features[0].ID)) + "/files"

	// These are handed to a reader that opens real files, so a path leaving
	// the repository is an access-control hole, not a tidiness problem.
	for _, bad := range []string{
		`{"file_path":"../../../etc/passwd"}`,
		`{"file_path":"/etc/passwd"}`,
		`{"file_path":"C:/Windows/system.ini"}`,
		`{"file_path":"a/../../b.go"}`,
	} {
		if w := do(r, http.MethodPost, path, bad); w.Code != http.StatusUnprocessableEntity {
			t.Errorf("%s: status %d, want 422: %s", bad, w.Code, w.Body.String())
		}
	}

	// A normal path with a redundant segment is cleaned rather than refused.
	w := do(r, http.MethodPost, path, `{"file_path":"./trails/../trails/search.go"}`)
	if w.Code != http.StatusCreated {
		t.Fatalf("status %d, want 201: %s", w.Code, w.Body.String())
	}
	var created struct {
		Data FeatureFileDTO `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &created); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if created.Data.FilePath != "trails/search.go" {
		t.Fatalf("path stored as %q, want it cleaned", created.Data.FilePath)
	}
}

func TestLinkCommitValidatesTheHash(t *testing.T) {
	db := newTestDB(t)
	owner, _, project := seed(t, db)
	features := seedFeatures(t, db, project.ID, owner.ID)

	r := workspaceRouter(t, db, owner.ID, "developer")
	path := "/api/v1/features/" + strconv.Itoa(int(features[0].ID)) + "/commits"

	if w := do(r, http.MethodPost, path,
		`{"commit_hash":"not-a-hash"}`); w.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status %d, want 422: %s", w.Code, w.Body.String())
	}

	if w := do(r, http.MethodPost, path,
		`{"commit_hash":"A1B2C3D4E5F6789"}`); w.Code != http.StatusCreated {
		t.Fatalf("status %d, want 201: %s", w.Code, w.Body.String())
	}

	// Stored lowercase, so the same commit in different casing is one commit.
	if w := do(r, http.MethodPost, path,
		`{"commit_hash":"a1b2c3d4e5f6789"}`); w.Code != http.StatusConflict {
		t.Fatalf("status %d, want 409: %s", w.Code, w.Body.String())
	}
}

func TestMappingCodeRequiresOwnerOrManager(t *testing.T) {
	db := newTestDB(t)
	owner, other, project := seed(t, db)
	features := seedFeatures(t, db, project.ID, owner.ID)

	r := workspaceRouter(t, db, other.ID, "developer")
	path := "/api/v1/features/" + strconv.Itoa(int(features[0].ID)) + "/files"

	if w := do(r, http.MethodGet, path, ""); w.Code != http.StatusNotFound {
		t.Fatalf("outsider read status %d, want 404: %s", w.Code, w.Body.String())
	}

	share(t, db, project.ID, other.ID, models.RoleViewer)
	if w := do(r, http.MethodPost, path,
		`{"file_path":"a.go"}`); w.Code != http.StatusForbidden {
		t.Fatalf("status %d, want 403: %s", w.Code, w.Body.String())
	}
	// A viewer can read the map.
	if w := do(r, http.MethodGet, path, ""); w.Code != http.StatusOK {
		t.Fatalf("read status %d, want 200: %s", w.Code, w.Body.String())
	}
}

func TestListProjectFiles(t *testing.T) {
	db := newTestDB(t)
	owner, _, project := seed(t, db)
	features := seedFeatures(t, db, project.ID, owner.ID)

	r := workspaceRouter(t, db, owner.ID, "developer")
	for i, spec := range []struct {
		feature int
		path    string
	}{
		{0, "trails/search.go"},
		{1, "maps/tiles.go"},
	} {
		body := fmt.Sprintf(`{"file_path":%q}`, spec.path)
		url := "/api/v1/features/" + strconv.Itoa(int(features[spec.feature].ID)) + "/files"
		if w := do(r, http.MethodPost, url, body); w.Code != http.StatusCreated {
			t.Fatalf("link %d status %d: %s", i, w.Code, w.Body.String())
		}
	}

	base := "/api/v1/projects/" + strconv.Itoa(project.ID) + "/files"
	if files := decodeFiles(t, do(r, http.MethodGet, base, "")); len(files) != 2 {
		t.Fatalf("listed %d files, want 2", len(files))
	}
	if files := decodeFiles(t, do(r, http.MethodGet, base+"?q=maps", "")); len(files) != 1 {
		t.Fatalf("search returned %d files, want 1", len(files))
	}
}

// --- access grants ----------------------------------------------------------

func TestGrantAndRevokeFeatureAccess(t *testing.T) {
	db := newTestDB(t)
	owner, other, project := seed(t, db)
	features := seedFeatures(t, db, project.ID, owner.ID)

	r := workspaceRouter(t, db, owner.ID, "developer")
	path := "/api/v1/features/" + strconv.Itoa(int(features[0].ID)) + "/scopes"

	w := do(r, http.MethodPost, path,
		fmt.Sprintf(`{"user_id":%d,"access_level":"contract"}`, other.ID))
	if w.Code != http.StatusCreated {
		t.Fatalf("status %d, want 201: %s", w.Code, w.Body.String())
	}
	granted := decodeScope(t, w)
	if granted.AccessLevel != "contract" || granted.User == nil ||
		granted.User.ID != other.ID {
		t.Fatalf("grant %+v is not what was asked for", granted)
	}

	// Granting again changes the level rather than adding a second row: the
	// access rules rank one grant per person per feature.
	w = do(r, http.MethodPost, path,
		fmt.Sprintf(`{"user_id":%d,"access_level":"owner"}`, other.ID))
	if w.Code != http.StatusOK {
		t.Fatalf("regrant status %d, want 200: %s", w.Code, w.Body.String())
	}

	scopes := decodeScopes(t, do(r, http.MethodGet, path, ""))
	if len(scopes) != 1 || scopes[0].AccessLevel != "owner" {
		t.Fatalf("scopes %+v, want one owner grant", scopes)
	}

	w = do(r, http.MethodDelete, path+"/"+strconv.Itoa(int(scopes[0].ID)), "")
	if w.Code != http.StatusNoContent {
		t.Fatalf("revoke status %d, want 204: %s", w.Code, w.Body.String())
	}
	if w := do(r, http.MethodDelete, path+"/"+strconv.Itoa(int(scopes[0].ID)),
		""); w.Code != http.StatusNotFound {
		t.Fatalf("second revoke status %d, want 404: %s", w.Code, w.Body.String())
	}
}

func TestOnlyTheProjectOwnerManagesAccess(t *testing.T) {
	db := newTestDB(t)
	owner, other, project := seed(t, db)
	features := seedFeatures(t, db, project.ID, owner.ID)
	path := "/api/v1/features/" + strconv.Itoa(int(features[0].ID)) + "/scopes"
	body := fmt.Sprintf(`{"user_id":%d,"access_level":"contract"}`, other.ID)

	// Handing out access to somebody's source is the owner's call: an editor
	// is not enough.
	share(t, db, project.ID, other.ID, models.RoleEditor)
	editor := workspaceRouter(t, db, other.ID, "manager")
	if w := do(editor, http.MethodPost, path, body); w.Code != http.StatusForbidden {
		t.Fatalf("editor status %d, want 403: %s", w.Code, w.Body.String())
	}

	r := workspaceRouter(t, db, owner.ID, "developer")
	if w := do(r, http.MethodPost, path, body); w.Code != http.StatusCreated {
		t.Fatalf("owner status %d, want 201: %s", w.Code, w.Body.String())
	}
}

func TestGrantingToTheProjectOwnerIsRefused(t *testing.T) {
	db := newTestDB(t)
	owner, _, project := seed(t, db)
	features := seedFeatures(t, db, project.ID, owner.ID)

	r := workspaceRouter(t, db, owner.ID, "developer")
	w := do(r, http.MethodPost,
		"/api/v1/features/"+strconv.Itoa(int(features[0].ID))+"/scopes",
		fmt.Sprintf(`{"user_id":%d,"access_level":"contract"}`, owner.ID))

	if w.Code != http.StatusConflict {
		t.Fatalf("status %d, want 409: %s", w.Code, w.Body.String())
	}
}

func TestGrantRejectsAnUnknownLevel(t *testing.T) {
	db := newTestDB(t)
	owner, other, project := seed(t, db)
	features := seedFeatures(t, db, project.ID, owner.ID)

	r := workspaceRouter(t, db, owner.ID, "developer")
	w := do(r, http.MethodPost,
		"/api/v1/features/"+strconv.Itoa(int(features[0].ID))+"/scopes",
		fmt.Sprintf(`{"user_id":%d,"access_level":"none"}`, other.ID))

	// "none" is not a level you grant — revoking is a delete, and two ways to
	// say the same thing is two places to get it wrong.
	if w.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status %d, want 422: %s", w.Code, w.Body.String())
	}
}
