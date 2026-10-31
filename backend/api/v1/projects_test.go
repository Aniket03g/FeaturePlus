package v1

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/FeaturePlus/backend/api"
	"github.com/FeaturePlus/backend/models"
	"github.com/FeaturePlus/backend/repositories"
	"github.com/gin-gonic/gin"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// newTestDB builds an in-memory database with the schema these tests touch.
func newTestDB(t *testing.T) *gorm.DB {
	t.Helper()

	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Silent),
	})
	if err != nil {
		t.Fatalf("open db: %v", err)
	}

	if err := db.AutoMigrate(&models.User{}, &models.Project{}, &models.Feature{}, &models.Task{}, &models.PullRequest{}, &models.FeatureTag{}, &models.Comment{}, &models.TaskAttachment{}, &models.FeatureAttachment{}, &models.Dependency{}, &models.Release{}, &models.ApprovedPR{},
		&models.FeatureFile{}, &models.FeatureCommit{}, &models.FeatureScope{},
		&models.ContractArtifact{}, &models.ProjectGitHub{}, &models.ReleaseGitHub{}, &models.UserGitHub{}, &models.PlaygroundDraft{}, &models.ProjectMember{}, &models.FeatureVersion{}, &models.FeatureCopy{}, &models.ProjectVisit{}); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	return db
}

// seed creates two users and a project owned by the first.
func seed(t *testing.T, db *gorm.DB) (owner, other models.User, project models.Project) {
	t.Helper()

	owner = models.User{Username: "owner", Email: "owner@example.com", Password: "$2a$12$hashedvaluehere", Role: "developer"}
	other = models.User{Username: "other", Email: "other@example.com", Password: "$2a$12$anotherhash", Role: "developer"}
	if err := db.Create(&owner).Error; err != nil {
		t.Fatalf("create owner: %v", err)
	}
	if err := db.Create(&other).Error; err != nil {
		t.Fatalf("create other: %v", err)
	}

	project = models.Project{Name: "Hiking App", Description: "Trail planner", OwnerID: owner.ID}
	if err := db.Create(&project).Error; err != nil {
		t.Fatalf("create project: %v", err)
	}

	return owner, other, project
}

// share adds a user to a project in a role, as the members routes would.
func share(t *testing.T, db *gorm.DB, projectID, userID int, role models.ProjectRole) {
	t.Helper()
	if err := db.Create(&models.ProjectMember{ProjectID: projectID, UserID: userID, Role: role}).Error; err != nil {
		t.Fatalf("share project: %v", err)
	}
}

// testRouter mounts the project routes with a stubbed authenticated user, so
// the handlers are exercised without standing up JWT signing.
func testRouter(t *testing.T, db *gorm.DB, userID int, role string) *gin.Engine {
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

	NewProjectsHandler(repositories.NewProjectRepository(db), db).Register(g)

	return r
}

func do(r *gin.Engine, method, path, body string) *httptest.ResponseRecorder {
	var req *http.Request
	if body == "" {
		req = httptest.NewRequest(method, path, nil)
	} else {
		req = httptest.NewRequest(method, path, bytes.NewBufferString(body))
		req.Header.Set("Content-Type", "application/json")
	}

	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

// decodeList reads a collection envelope.
func decodeList(t *testing.T, w *httptest.ResponseRecorder) (data []ProjectDTO, meta api.Meta) {
	t.Helper()

	var out struct {
		Data []ProjectDTO `json:"data"`
		Meta api.Meta     `json:"meta"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode list: %v (body: %s)", err, w.Body.String())
	}
	return out.Data, out.Meta
}

// decodeOne reads a single-resource envelope.
func decodeOne(t *testing.T, w *httptest.ResponseRecorder) ProjectDTO {
	t.Helper()

	var out struct {
		Data ProjectDTO `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode one: %v (body: %s)", err, w.Body.String())
	}
	return out.Data
}

// decodeErr reads an error envelope.
func decodeErr(t *testing.T, w *httptest.ResponseRecorder) api.Error {
	t.Helper()

	var out struct {
		Error api.Error `json:"error"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode error: %v (body: %s)", err, w.Body.String())
	}
	return out.Error
}

func TestListReturnsEnvelopeWithMeta(t *testing.T) {
	db := newTestDB(t)
	owner, _, _ := seed(t, db)
	r := testRouter(t, db, owner.ID, "developer")

	w := do(r, http.MethodGet, "/api/v1/projects", "")
	if w.Code != http.StatusOK {
		t.Fatalf("status %d, want 200: %s", w.Code, w.Body.String())
	}

	data, meta := decodeList(t, w)
	if len(data) != 1 {
		t.Fatalf("got %d projects, want 1", len(data))
	}
	if meta.Total != 1 || meta.Page != 1 || meta.PerPage != api.DefaultPerPage {
		t.Errorf("meta = %+v, want total 1, page 1, per_page %d", meta, api.DefaultPerPage)
	}
	if meta.TotalPages != 1 {
		t.Errorf("total_pages = %d, want 1", meta.TotalPages)
	}
}

// TestListNeverLeaksPasswordHash is the regression guard for the leak found
// before this API existed: /api/users returned every user's bcrypt hash,
// because models.User serialised its Password field.
func TestListNeverLeaksPasswordHash(t *testing.T) {
	db := newTestDB(t)
	owner, _, _ := seed(t, db)
	r := testRouter(t, db, owner.ID, "developer")

	for _, path := range []string{"/api/v1/projects", "/api/v1/projects/1"} {
		w := do(r, http.MethodGet, path, "")
		body := w.Body.String()

		if strings.Contains(body, "$2a$") || strings.Contains(body, "$2b$") {
			t.Errorf("%s leaked a bcrypt hash: %s", path, body)
		}
		if strings.Contains(strings.ToLower(body), "password") {
			t.Errorf("%s mentions a password field: %s", path, body)
		}
	}
}

func TestListEmptyReturnsArrayNotNull(t *testing.T) {
	db := newTestDB(t)
	user := models.User{Username: "solo", Email: "solo@example.com", Password: "x", Role: "developer"}
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	r := testRouter(t, db, user.ID, "developer")

	w := do(r, http.MethodGet, "/api/v1/projects", "")

	// A nil slice marshals to null and forces every client to null-check.
	if !strings.Contains(w.Body.String(), `"data":[]`) {
		t.Errorf("empty list should send [], got: %s", w.Body.String())
	}
}

func TestListPagination(t *testing.T) {
	db := newTestDB(t)
	owner, _, _ := seed(t, db)
	for i := 0; i < 7; i++ {
		p := models.Project{Name: "Extra", OwnerID: owner.ID}
		if err := db.Create(&p).Error; err != nil {
			t.Fatal(err)
		}
	}
	r := testRouter(t, db, owner.ID, "developer")

	w := do(r, http.MethodGet, "/api/v1/projects?page=2&per_page=3", "")
	data, meta := decodeList(t, w)

	if len(data) != 3 {
		t.Errorf("got %d items, want 3", len(data))
	}
	if meta.Total != 8 {
		t.Errorf("total = %d, want 8", meta.Total)
	}
	if meta.TotalPages != 3 {
		t.Errorf("total_pages = %d, want 3", meta.TotalPages)
	}
}

func TestListPerPageIsCapped(t *testing.T) {
	db := newTestDB(t)
	owner, _, _ := seed(t, db)
	r := testRouter(t, db, owner.ID, "developer")

	w := do(r, http.MethodGet, "/api/v1/projects?per_page=99999", "")
	_, meta := decodeList(t, w)

	if meta.PerPage != api.MaxPerPage {
		t.Errorf("per_page = %d, want it capped at %d", meta.PerPage, api.MaxPerPage)
	}
}

func TestListSearch(t *testing.T) {
	db := newTestDB(t)
	owner, _, _ := seed(t, db)
	other := models.Project{Name: "Task Tracker", Description: "Kanban", OwnerID: owner.ID}
	if err := db.Create(&other).Error; err != nil {
		t.Fatal(err)
	}
	r := testRouter(t, db, owner.ID, "developer")

	w := do(r, http.MethodGet, "/api/v1/projects?q=hiking", "")
	data, meta := decodeList(t, w)

	if meta.Total != 1 || len(data) != 1 {
		t.Fatalf("search returned %d of total %d, want 1", len(data), meta.Total)
	}
	if data[0].Name != "Hiking App" {
		t.Errorf("got %q, want Hiking App", data[0].Name)
	}
}

func TestListIncludesStats(t *testing.T) {
	db := newTestDB(t)
	owner, _, project := seed(t, db)

	feature := models.Feature{Title: "Trail search", ProjectID: project.ID, Status: models.StatusDone}
	if err := db.Create(&feature).Error; err != nil {
		t.Fatal(err)
	}
	todo := models.Feature{Title: "Offline maps", ProjectID: project.ID, Status: models.StatusTodo}
	if err := db.Create(&todo).Error; err != nil {
		t.Fatal(err)
	}

	// Three tasks; only the first gets a tested+approved PR, which is what
	// makes a task complete. models.Task has no status column.
	var taskIDs []uint
	for i := 0; i < 3; i++ {
		task := models.Task{TaskName: "t", TaskType: "Dev", FeatureID: feature.ID}
		if err := db.Create(&task).Error; err != nil {
			t.Fatal(err)
		}
		taskIDs = append(taskIDs, task.ID)
	}
	approved := models.PullRequest{TaskID: taskIDs[0], URL: "u", Title: "t", Branch: "b", Tested: true, Status: "Approved"}
	if err := db.Create(&approved).Error; err != nil {
		t.Fatal(err)
	}
	// Tested but not approved, and approved but not tested: neither counts.
	untested := models.PullRequest{TaskID: taskIDs[1], URL: "u", Title: "t", Branch: "b", Tested: false, Status: "approved"}
	if err := db.Create(&untested).Error; err != nil {
		t.Fatal(err)
	}
	open := models.PullRequest{TaskID: taskIDs[2], URL: "u", Title: "t", Branch: "b", Tested: true, Status: "Open"}
	if err := db.Create(&open).Error; err != nil {
		t.Fatal(err)
	}

	r := testRouter(t, db, owner.ID, "developer")
	w := do(r, http.MethodGet, "/api/v1/projects", "")
	data, _ := decodeList(t, w)

	if len(data) == 0 || data[0].Stats == nil {
		t.Fatal("expected stats on the listed project")
	}
	s := data[0].Stats
	if s.FeatureCount != 2 {
		t.Errorf("feature_count = %d, want 2", s.FeatureCount)
	}
	if s.CompletedFeatures != 1 {
		t.Errorf("completed_features = %d, want 1", s.CompletedFeatures)
	}
	if s.TaskCount != 3 {
		t.Errorf("task_count = %d, want 3", s.TaskCount)
	}
	if s.CompletedTasks != 1 {
		t.Errorf("completed_tasks = %d, want 1", s.CompletedTasks)
	}
}

func TestGetNotFoundUsesErrorEnvelope(t *testing.T) {
	db := newTestDB(t)
	owner, _, _ := seed(t, db)
	r := testRouter(t, db, owner.ID, "developer")

	w := do(r, http.MethodGet, "/api/v1/projects/9999", "")
	if w.Code != http.StatusNotFound {
		t.Fatalf("status %d, want 404", w.Code)
	}

	e := decodeErr(t, w)
	if e.Code != api.CodeNotFound {
		t.Errorf("code = %q, want %q", e.Code, api.CodeNotFound)
	}
	if e.Message == "" {
		t.Error("error message was empty")
	}
}

func TestGetRejectsNonNumericID(t *testing.T) {
	db := newTestDB(t)
	owner, _, _ := seed(t, db)
	r := testRouter(t, db, owner.ID, "developer")

	w := do(r, http.MethodGet, "/api/v1/projects/not-a-number", "")
	if w.Code != http.StatusBadRequest {
		t.Fatalf("status %d, want 400", w.Code)
	}
	if e := decodeErr(t, w); e.Code != api.CodeBadRequest {
		t.Errorf("code = %q, want %q", e.Code, api.CodeBadRequest)
	}
}

func TestCreateUsesSessionOwnerNotRequestBody(t *testing.T) {
	db := newTestDB(t)
	owner, other, _ := seed(t, db)
	r := testRouter(t, db, owner.ID, "developer")

	// owner_id in the body must be ignored; the session decides ownership.
	body := `{"name":"New Project","description":"d","owner_id":` + itoa(other.ID) + `}`
	w := do(r, http.MethodPost, "/api/v1/projects", body)

	if w.Code != http.StatusCreated {
		t.Fatalf("status %d, want 201: %s", w.Code, w.Body.String())
	}
	if got := decodeOne(t, w); got.OwnerID != owner.ID {
		t.Errorf("owner_id = %d, want the session user %d", got.OwnerID, owner.ID)
	}
}

func TestCreateValidatesName(t *testing.T) {
	db := newTestDB(t)
	owner, _, _ := seed(t, db)
	r := testRouter(t, db, owner.ID, "developer")

	w := do(r, http.MethodPost, "/api/v1/projects", `{"description":"no name"}`)
	if w.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status %d, want 422: %s", w.Code, w.Body.String())
	}
	if e := decodeErr(t, w); e.Code != api.CodeValidation {
		t.Errorf("code = %q, want %q", e.Code, api.CodeValidation)
	}
}

func TestUpdateIsPartial(t *testing.T) {
	db := newTestDB(t)
	owner, _, project := seed(t, db)
	r := testRouter(t, db, owner.ID, "developer")

	// Sending only name must leave description alone.
	w := do(r, http.MethodPatch, "/api/v1/projects/"+itoa(project.ID), `{"name":"Renamed"}`)
	if w.Code != http.StatusOK {
		t.Fatalf("status %d, want 200: %s", w.Code, w.Body.String())
	}

	got := decodeOne(t, w)
	if got.Name != "Renamed" {
		t.Errorf("name = %q, want Renamed", got.Name)
	}
	if got.Description != "Trail planner" {
		t.Errorf("description = %q, want it untouched", got.Description)
	}
}

func TestUpdateCanClearAField(t *testing.T) {
	db := newTestDB(t)
	owner, _, project := seed(t, db)
	r := testRouter(t, db, owner.ID, "developer")

	// An explicit empty string differs from omitting the field.
	w := do(r, http.MethodPatch, "/api/v1/projects/"+itoa(project.ID), `{"description":""}`)
	if w.Code != http.StatusOK {
		t.Fatalf("status %d, want 200: %s", w.Code, w.Body.String())
	}
	if got := decodeOne(t, w); got.Description != "" {
		t.Errorf("description = %q, want it cleared", got.Description)
	}
}

func TestUpdateForbiddenForNonOwner(t *testing.T) {
	db := newTestDB(t)
	_, other, project := seed(t, db)
	r := testRouter(t, db, other.ID, "developer")

	// Someone the project is not shared with is told it does not exist.
	w := do(r, http.MethodPatch, "/api/v1/projects/"+itoa(project.ID), `{"name":"Hijacked"}`)
	if w.Code != http.StatusNotFound {
		t.Fatalf("outsider status %d, want 404: %s", w.Code, w.Body.String())
	}

	// A viewer can see it, so is told why not.
	share(t, db, project.ID, other.ID, models.RoleViewer)
	w = do(r, http.MethodPatch, "/api/v1/projects/"+itoa(project.ID), `{"name":"Hijacked"}`)
	if w.Code != http.StatusForbidden {
		t.Fatalf("status %d, want 403: %s", w.Code, w.Body.String())
	}
	if e := decodeErr(t, w); e.Code != api.CodeForbidden {
		t.Errorf("code = %q, want %q", e.Code, api.CodeForbidden)
	}
}

func TestManagerHasNoAccessToOthersProjects(t *testing.T) {
	db := newTestDB(t)
	_, other, project := seed(t, db)
	r := testRouter(t, db, other.ID, "manager")

	// Manager runs the app; it does not open other people's projects.
	if w := do(r, http.MethodGet, "/api/v1/projects/"+itoa(project.ID), ""); w.Code != http.StatusNotFound {
		t.Fatalf("read status %d, want 404: %s", w.Code, w.Body.String())
	}
	if w := do(r, http.MethodPatch, "/api/v1/projects/"+itoa(project.ID), `{"name":"By manager"}`); w.Code != http.StatusNotFound {
		t.Fatalf("update status %d, want 404: %s", w.Code, w.Body.String())
	}
}

func TestEditorCanUpdateButNotDelete(t *testing.T) {
	db := newTestDB(t)
	_, other, project := seed(t, db)
	share(t, db, project.ID, other.ID, models.RoleEditor)
	r := testRouter(t, db, other.ID, "developer")

	if w := do(r, http.MethodPatch, "/api/v1/projects/"+itoa(project.ID), `{"name":"Renamed"}`); w.Code != http.StatusOK {
		t.Fatalf("update status %d, want 200: %s", w.Code, w.Body.String())
	}
	if w := do(r, http.MethodDelete, "/api/v1/projects/"+itoa(project.ID), ""); w.Code != http.StatusForbidden {
		t.Fatalf("delete status %d, want 403: %s", w.Code, w.Body.String())
	}
}

func TestListShowsOnlyOwnAndSharedProjects(t *testing.T) {
	db := newTestDB(t)
	owner, other, project := seed(t, db)
	theirs := models.Project{Name: "Their own", OwnerID: other.ID}
	if err := db.Create(&theirs).Error; err != nil {
		t.Fatalf("create: %v", err)
	}

	// Before sharing, each sees only their own.
	r := testRouter(t, db, other.ID, "developer")
	data, _ := decodeList(t, do(r, http.MethodGet, "/api/v1/projects", ""))
	if len(data) != 1 || data[0].ID != theirs.ID || data[0].MyRole != models.RoleOwner {
		t.Fatalf("before sharing: %+v", data)
	}

	share(t, db, project.ID, other.ID, models.RoleViewer)
	data, _ = decodeList(t, do(r, http.MethodGet, "/api/v1/projects", ""))
	if len(data) != 2 {
		t.Fatalf("after sharing: got %d projects, want 2", len(data))
	}
	for _, p := range data {
		if p.ID == project.ID && p.MyRole != models.RoleViewer {
			t.Errorf("shared project role = %q, want viewer", p.MyRole)
		}
	}

	// ?mine=true is the ones they own.
	data, _ = decodeList(t, do(r, http.MethodGet, "/api/v1/projects?mine=true", ""))
	if len(data) != 1 || data[0].ID != theirs.ID {
		t.Fatalf("mine: %+v", data)
	}

	// The owner still sees only their own.
	ro := testRouter(t, db, owner.ID, "developer")
	data, _ = decodeList(t, do(ro, http.MethodGet, "/api/v1/projects", ""))
	if len(data) != 1 || data[0].ID != project.ID {
		t.Fatalf("owner: %+v", data)
	}
}

func TestDeleteForbiddenForNonOwner(t *testing.T) {
	db := newTestDB(t)
	_, other, project := seed(t, db)
	r := testRouter(t, db, other.ID, "developer")

	share(t, db, project.ID, other.ID, models.RoleEditor)
	w := do(r, http.MethodDelete, "/api/v1/projects/"+itoa(project.ID), "")
	if w.Code != http.StatusForbidden {
		t.Fatalf("status %d, want 403", w.Code)
	}

	// The project must still be there.
	var count int64
	db.Model(&models.Project{}).Where("id = ?", project.ID).Count(&count)
	if count != 1 {
		t.Error("project was deleted despite the 403")
	}
}

func TestDeleteByOwnerReturnsNoContent(t *testing.T) {
	db := newTestDB(t)
	owner, _, project := seed(t, db)
	r := testRouter(t, db, owner.ID, "developer")

	w := do(r, http.MethodDelete, "/api/v1/projects/"+itoa(project.ID), "")
	if w.Code != http.StatusNoContent {
		t.Fatalf("status %d, want 204: %s", w.Code, w.Body.String())
	}
	if w.Body.Len() != 0 {
		t.Errorf("204 should have an empty body, got %q", w.Body.String())
	}
}

func TestUnauthenticatedIsRejected(t *testing.T) {
	db := newTestDB(t)
	seed(t, db)
	r := testRouter(t, db, 0, "") // No user set in the context

	w := do(r, http.MethodGet, "/api/v1/projects", "")
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("status %d, want 401: %s", w.Code, w.Body.String())
	}
}

func itoa(i int) string {
	return strings.TrimSpace(strings.Join(strings.Fields(jsonNumber(i)), ""))
}

func jsonNumber(i int) string {
	b, _ := json.Marshal(i)
	return string(b)
}
