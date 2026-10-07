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

func prRouter(t *testing.T, db *gorm.DB, userID int, role string) *gin.Engine {
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

	NewPullRequestsHandler(db).Register(g)
	return r
}

func decodePullRequests(t *testing.T, w *httptest.ResponseRecorder) ([]PullRequestDTO, api.Meta) {
	t.Helper()

	var out struct {
		Data []PullRequestDTO `json:"data"`
		Meta api.Meta         `json:"meta"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode: %v (%s)", err, w.Body.String())
	}
	return out.Data, out.Meta
}

func decodePullRequest(t *testing.T, w *httptest.ResponseRecorder) PullRequestDTO {
	t.Helper()

	var out struct {
		Data PullRequestDTO `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode: %v (%s)", err, w.Body.String())
	}
	return out.Data
}

func prPath(id uint, suffix string) string {
	return "/api/v1/pull-requests/" + strconv.Itoa(int(id)) + suffix
}

func TestCreatePullRequestOnTask(t *testing.T) {
	db := newTestDB(t)
	owner, _, project := seed(t, db)
	features := seedFeatures(t, db, project.ID, owner.ID)
	tasks := seedTasks(t, db, features[2].ID, owner.ID)

	r := prRouter(t, db, owner.ID, "developer")
	path := "/api/v1/tasks/" + strconv.Itoa(int(tasks[2].ID)) + "/pull-requests"
	body := `{"title":"Add the column","url":"https://github.com/acme/app/pull/7","branch":"feat/column"}`

	w := do(r, http.MethodPost, path, body)
	if w.Code != http.StatusCreated {
		t.Fatalf("status %d, want 201: %s", w.Code, w.Body.String())
	}

	got := decodePullRequest(t, w)
	// The feature comes from the task, never from the request body.
	if got.FeatureID != features[2].ID {
		t.Fatalf("feature %d, want %d", got.FeatureID, features[2].ID)
	}
	if got.Status != "Open" || got.Approved || got.Tested {
		t.Fatalf("new pull request %+v, want open, untested, unapproved", got)
	}

	// The same branch twice on one task is refused.
	if w := do(r, http.MethodPost, path, body); w.Code != http.StatusConflict {
		t.Fatalf("duplicate branch status %d, want 409: %s", w.Code, w.Body.String())
	}
}

func TestCreatePullRequestValidatesTheURL(t *testing.T) {
	db := newTestDB(t)
	owner, _, project := seed(t, db)
	features := seedFeatures(t, db, project.ID, owner.ID)
	tasks := seedTasks(t, db, features[0].ID, owner.ID)

	r := prRouter(t, db, owner.ID, "developer")
	w := do(r, http.MethodPost,
		"/api/v1/tasks/"+strconv.Itoa(int(tasks[2].ID))+"/pull-requests",
		`{"title":"Nope","url":"not-a-url","branch":"feat/x"}`)

	if w.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status %d, want 422: %s", w.Code, w.Body.String())
	}
	if fields := decodeAPIError(t, w).Fields; fields["url"] == "" {
		t.Fatalf("fields %v, want a message against url", fields)
	}
}

func TestListProjectPullRequestsPutsOutstandingWorkFirst(t *testing.T) {
	db := newTestDB(t)
	owner, _, project := seed(t, db)
	features := seedFeatures(t, db, project.ID, owner.ID)
	tasks := seedTasks(t, db, features[0].ID, owner.ID)

	r := prRouter(t, db, owner.ID, "developer")
	w := do(r, http.MethodGet, "/api/v1/projects/"+strconv.Itoa(project.ID)+"/pull-requests", "")
	if w.Code != http.StatusOK {
		t.Fatalf("status %d, want 200: %s", w.Code, w.Body.String())
	}

	items, meta := decodePullRequests(t, w)
	// seedTasks leaves one approved-and-tested pull request and one still open.
	if meta.Total != 2 || len(items) != 2 {
		t.Fatalf("listed %d (total %d), want 2", len(items), meta.Total)
	}
	if items[0].Approved {
		t.Fatalf("settled pull request came first: %+v", items[0])
	}
	if items[0].TaskName != tasks[1].TaskName || items[0].ProjectID != project.ID {
		t.Fatalf("row %+v is missing its task and project context", items[0])
	}
}

func TestPullRequestListFilters(t *testing.T) {
	db := newTestDB(t)
	owner, _, project := seed(t, db)
	features := seedFeatures(t, db, project.ID, owner.ID)
	tasks := seedTasks(t, db, features[0].ID, owner.ID)

	// A third pull request whose status carries a space, to prove the filter
	// matches on the key a client sends rather than on the stored text.
	pr := models.PullRequest{
		TaskID: tasks[2].ID, FeatureID: features[0].ID, URL: "https://example.com/pr/3",
		Title: "Migration", Branch: "feat/migration", Status: "Changes requested",
	}
	if err := db.Create(&pr).Error; err != nil {
		t.Fatalf("create pr: %v", err)
	}

	r := prRouter(t, db, owner.ID, "developer")
	base := "/api/v1/projects/" + strconv.Itoa(project.ID) + "/pull-requests"

	items, _ := decodePullRequests(t, do(r, http.MethodGet, base+"?status=changes_requested", ""))
	if len(items) != 1 || items[0].ID != pr.ID {
		t.Fatalf("status filter returned %+v, want the changes-requested row", items)
	}

	items, _ = decodePullRequests(t, do(r, http.MethodGet, base+"?tested=false", ""))
	if len(items) != 1 || items[0].ID != pr.ID {
		t.Fatalf("tested filter returned %+v, want the untested row", items)
	}

	items, _ = decodePullRequests(t, do(r, http.MethodGet, base+"?q=screen", ""))
	if len(items) != 1 {
		t.Fatalf("search returned %+v, want one match", items)
	}
}

func TestReviewApprovingRecordsWhoApproved(t *testing.T) {
	db := newTestDB(t)
	owner, _, project := seed(t, db)
	features := seedFeatures(t, db, project.ID, owner.ID)
	tasks := seedTasks(t, db, features[0].ID, owner.ID)

	// The second task's pull request is tested but still open.
	var pr models.PullRequest
	if err := db.Where("task_id = ?", tasks[1].ID).First(&pr).Error; err != nil {
		t.Fatalf("load pr: %v", err)
	}

	r := prRouter(t, db, owner.ID, "developer")
	w := do(r, http.MethodPost, prPath(pr.ID, "/review"),
		`{"status":"approved","comment":"Looks right"}`)
	if w.Code != http.StatusOK {
		t.Fatalf("status %d, want 200: %s", w.Code, w.Body.String())
	}

	got := decodePullRequest(t, w)
	if !got.Approved {
		t.Fatalf("pull request %+v, want approved", got)
	}
	if len(got.Approvals) != 1 || got.Approvals[0].UserID != owner.ID {
		t.Fatalf("approvals %+v, want one by the reviewer", got.Approvals)
	}

	// The task-completion rule reads the same row, so the task is now done.
	tasksHandler := NewTasksHandler(db)
	if !tasksHandler.taskCompletion([]uint{tasks[1].ID})[tasks[1].ID] {
		t.Fatal("task did not become complete after its pull request was approved")
	}
}

func TestWithdrawingAnApprovalRemovesTheRecord(t *testing.T) {
	db := newTestDB(t)
	owner, _, project := seed(t, db)
	features := seedFeatures(t, db, project.ID, owner.ID)
	tasks := seedTasks(t, db, features[0].ID, owner.ID)

	var pr models.PullRequest
	if err := db.Where("task_id = ?", tasks[1].ID).First(&pr).Error; err != nil {
		t.Fatalf("load pr: %v", err)
	}

	r := prRouter(t, db, owner.ID, "developer")

	if w := do(r, http.MethodPost, prPath(pr.ID, "/review"),
		`{"status":"approved"}`); w.Code != http.StatusOK {
		t.Fatalf("approve status %d: %s", w.Code, w.Body.String())
	}
	// Approving twice must not stack up rows.
	if w := do(r, http.MethodPost, prPath(pr.ID, "/review"),
		`{"status":"approved"}`); w.Code != http.StatusOK {
		t.Fatalf("re-approve status %d: %s", w.Code, w.Body.String())
	}

	var count int64
	if err := db.Model(&models.ApprovedPR{}).Where("pull_request_id = ?", pr.ID).
		Count(&count).Error; err != nil {
		t.Fatalf("count approvals: %v", err)
	}
	if count != 1 {
		t.Fatalf("%d approval rows, want 1", count)
	}

	w := do(r, http.MethodPost, prPath(pr.ID, "/review"),
		`{"status":"changes_requested","comment":"Needs another look"}`)
	if w.Code != http.StatusOK {
		t.Fatalf("withdraw status %d: %s", w.Code, w.Body.String())
	}

	got := decodePullRequest(t, w)
	if got.Approved || got.Status != "Changes requested" {
		t.Fatalf("pull request %+v, want changes requested and unapproved", got)
	}

	// The status and the audit record must not drift apart.
	if err := db.Model(&models.ApprovedPR{}).Where("pull_request_id = ?", pr.ID).
		Count(&count).Error; err != nil {
		t.Fatalf("count approvals: %v", err)
	}
	if count != 0 {
		t.Fatalf("%d approval rows survived the withdrawal, want 0", count)
	}
}

func TestReviewRejectsAnUnknownDecision(t *testing.T) {
	db := newTestDB(t)
	owner, _, project := seed(t, db)
	features := seedFeatures(t, db, project.ID, owner.ID)
	tasks := seedTasks(t, db, features[0].ID, owner.ID)

	var pr models.PullRequest
	if err := db.Where("task_id = ?", tasks[0].ID).First(&pr).Error; err != nil {
		t.Fatalf("load pr: %v", err)
	}

	r := prRouter(t, db, owner.ID, "developer")
	if w := do(r, http.MethodPost, prPath(pr.ID, "/review"),
		`{"status":"merged"}`); w.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status %d, want 422: %s", w.Code, w.Body.String())
	}
}

func TestMarkTested(t *testing.T) {
	db := newTestDB(t)
	owner, _, project := seed(t, db)
	features := seedFeatures(t, db, project.ID, owner.ID)
	tasks := seedTasks(t, db, features[2].ID, owner.ID)

	pr := models.PullRequest{
		TaskID: tasks[0].ID, FeatureID: features[2].ID, URL: "https://example.com/pr/11",
		Title: "Chart", Branch: "feat/chart", Status: "Open",
	}
	if err := db.Create(&pr).Error; err != nil {
		t.Fatalf("create pr: %v", err)
	}

	r := prRouter(t, db, owner.ID, "developer")

	w := do(r, http.MethodPost, prPath(pr.ID, "/tested"), `{"tested":true}`)
	if w.Code != http.StatusOK {
		t.Fatalf("status %d, want 200: %s", w.Code, w.Body.String())
	}
	if !decodePullRequest(t, w).Tested {
		t.Fatal("pull request did not become tested")
	}

	// Sending false clears the flag rather than reading as an absent field.
	w = do(r, http.MethodPost, prPath(pr.ID, "/tested"), `{"tested":false}`)
	if w.Code != http.StatusOK {
		t.Fatalf("clear status %d, want 200: %s", w.Code, w.Body.String())
	}
	if decodePullRequest(t, w).Tested {
		t.Fatal("pull request stayed tested after being cleared")
	}
}

func TestUpdatePullRequestCannotChangeStatus(t *testing.T) {
	db := newTestDB(t)
	owner, _, project := seed(t, db)
	features := seedFeatures(t, db, project.ID, owner.ID)
	tasks := seedTasks(t, db, features[0].ID, owner.ID)

	var pr models.PullRequest
	if err := db.Where("task_id = ?", tasks[1].ID).First(&pr).Error; err != nil {
		t.Fatalf("load pr: %v", err)
	}

	r := prRouter(t, db, owner.ID, "developer")
	w := do(r, http.MethodPatch, prPath(pr.ID, ""),
		`{"title":"Draw the screen, properly","status":"approved"}`)
	if w.Code != http.StatusOK {
		t.Fatalf("status %d, want 200: %s", w.Code, w.Body.String())
	}

	got := decodePullRequest(t, w)
	if got.Title != "Draw the screen, properly" {
		t.Fatalf("title %q was not updated", got.Title)
	}
	// Approval has to go through review, which records who decided.
	if got.Approved {
		t.Fatal("a plain update approved the pull request")
	}
}

func TestPullRequestWritesRequireOwnerOrManager(t *testing.T) {
	db := newTestDB(t)
	owner, other, project := seed(t, db)
	features := seedFeatures(t, db, project.ID, owner.ID)
	tasks := seedTasks(t, db, features[0].ID, owner.ID)

	var pr models.PullRequest
	if err := db.Where("task_id = ?", tasks[1].ID).First(&pr).Error; err != nil {
		t.Fatalf("load pr: %v", err)
	}

	r := prRouter(t, db, other.ID, "developer")
	if w := do(r, http.MethodGet, prPath(pr.ID, ""), ""); w.Code != http.StatusNotFound {
		t.Fatalf("outsider read status %d, want 404: %s", w.Code, w.Body.String())
	}

	share(t, db, project.ID, other.ID, models.RoleViewer)
	if w := do(r, http.MethodPost, prPath(pr.ID, "/review"),
		`{"status":"approved"}`); w.Code != http.StatusForbidden {
		t.Fatalf("status %d, want 403: %s", w.Code, w.Body.String())
	}

	// A viewer can read it.
	if w := do(r, http.MethodGet, prPath(pr.ID, ""), ""); w.Code != http.StatusOK {
		t.Fatalf("read status %d, want 200: %s", w.Code, w.Body.String())
	}
}

func TestDeletePullRequestInAReleaseIsRefused(t *testing.T) {
	db := newTestDB(t)
	owner, _, project := seed(t, db)
	features := seedFeatures(t, db, project.ID, owner.ID)
	tasks := seedTasks(t, db, features[0].ID, owner.ID)
	release := newRelease(t, db, project.ID, "v1.0.0")

	var pr models.PullRequest
	if err := db.Where("task_id = ?", tasks[0].ID).First(&pr).Error; err != nil {
		t.Fatalf("load pr: %v", err)
	}

	releases := releaseRouter(t, db, owner.ID, "developer")
	if w := do(releases, http.MethodPost, releasePath(release.ID, "/pull-requests"),
		fmt.Sprintf(`{"pull_request_ids":[%d]}`, pr.ID)); w.Code != http.StatusOK {
		t.Fatalf("link status %d: %s", w.Code, w.Body.String())
	}

	r := prRouter(t, db, owner.ID, "developer")
	if w := do(r, http.MethodDelete, prPath(pr.ID, ""), ""); w.Code != http.StatusConflict {
		t.Fatalf("status %d, want 409: %s", w.Code, w.Body.String())
	}

	// Once it is out of the release it can go.
	if w := do(releases, http.MethodDelete,
		releasePath(release.ID, "/pull-requests/"+strconv.Itoa(int(pr.ID))), ""); w.Code != http.StatusNoContent {
		t.Fatalf("unlink status %d: %s", w.Code, w.Body.String())
	}
	if w := do(r, http.MethodDelete, prPath(pr.ID, ""), ""); w.Code != http.StatusNoContent {
		t.Fatalf("delete status %d, want 204: %s", w.Code, w.Body.String())
	}
}

func TestDeletePullRequestRemovesItsApprovals(t *testing.T) {
	db := newTestDB(t)
	owner, _, project := seed(t, db)
	features := seedFeatures(t, db, project.ID, owner.ID)
	tasks := seedTasks(t, db, features[0].ID, owner.ID)

	var pr models.PullRequest
	if err := db.Where("task_id = ?", tasks[1].ID).First(&pr).Error; err != nil {
		t.Fatalf("load pr: %v", err)
	}

	r := prRouter(t, db, owner.ID, "developer")
	if w := do(r, http.MethodPost, prPath(pr.ID, "/review"),
		`{"status":"approved"}`); w.Code != http.StatusOK {
		t.Fatalf("approve status %d: %s", w.Code, w.Body.String())
	}
	if w := do(r, http.MethodDelete, prPath(pr.ID, ""), ""); w.Code != http.StatusNoContent {
		t.Fatalf("delete status %d: %s", w.Code, w.Body.String())
	}

	var orphans int64
	if err := db.Model(&models.ApprovedPR{}).Where("pull_request_id = ?", pr.ID).
		Count(&orphans).Error; err != nil {
		t.Fatalf("count approvals: %v", err)
	}
	if orphans != 0 {
		t.Fatalf("%d approvals outlived their pull request", orphans)
	}
}

func TestUnknownPullRequestIs404(t *testing.T) {
	db := newTestDB(t)
	owner, _, _ := seed(t, db)

	r := prRouter(t, db, owner.ID, "developer")
	if w := do(r, http.MethodGet, "/api/v1/pull-requests/9999", ""); w.Code != http.StatusNotFound {
		t.Fatalf("status %d, want 404: %s", w.Code, w.Body.String())
	}
}
