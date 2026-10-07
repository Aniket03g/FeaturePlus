package v1

import (
	"encoding/json"
	"fmt"
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

func releaseRouter(t *testing.T, db *gorm.DB, userID int, role string) *gin.Engine {
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

	NewReleasesHandler(db).Register(g)
	return r
}

func decodeReleases(t *testing.T, w *httptest.ResponseRecorder) ([]ReleaseDTO, api.Meta) {
	t.Helper()

	var out struct {
		Data []ReleaseDTO `json:"data"`
		Meta api.Meta     `json:"meta"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode: %v (%s)", err, w.Body.String())
	}
	return out.Data, out.Meta
}

func decodeRelease(t *testing.T, w *httptest.ResponseRecorder) ReleaseDTO {
	t.Helper()

	var out struct {
		Data ReleaseDTO `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode: %v (%s)", err, w.Body.String())
	}
	return out.Data
}

func decodeAPIError(t *testing.T, w *httptest.ResponseRecorder) api.Error {
	t.Helper()

	var out struct {
		Error api.Error `json:"error"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode: %v (%s)", err, w.Body.String())
	}
	return out.Error
}

// newRelease creates a draft release directly, for tests that are about what
// happens afterwards rather than about creation.
func newRelease(t *testing.T, db *gorm.DB, projectID int, tag string) models.Release {
	t.Helper()

	release := models.Release{ProjectID: projectID, Tag: tag, Status: models.ReleaseStatusDraft}
	if err := db.Omit("Project", "PRs").Create(&release).Error; err != nil {
		t.Fatalf("create release: %v", err)
	}
	return release
}

func releasePath(id uint, suffix string) string {
	return "/api/v1/releases/" + strconv.Itoa(int(id)) + suffix
}

func TestCreateReleaseWithPlannedFeatures(t *testing.T) {
	db := newTestDB(t)
	owner, _, project := seed(t, db)
	features := seedFeatures(t, db, project.ID, owner.ID)

	r := releaseRouter(t, db, owner.ID, "developer")
	body := fmt.Sprintf(`{"tag":"v1.0.0","notes":"First cut","feature_ids":[%d,%d]}`,
		features[0].ID, features[1].ID)

	w := do(r, http.MethodPost, "/api/v1/projects/"+strconv.Itoa(project.ID)+"/releases", body)
	if w.Code != http.StatusCreated {
		t.Fatalf("status %d, want 201: %s", w.Code, w.Body.String())
	}

	release := decodeRelease(t, w)
	if release.Tag != "v1.0.0" || release.Status != string(models.ReleaseStatusDraft) {
		t.Fatalf("got tag %q status %q, want v1.0.0/draft", release.Tag, release.Status)
	}
	// features[0] is done, features[1] is not.
	if release.Features.Total != 2 || release.Features.Done != 1 {
		t.Fatalf("feature counts %+v, want 2 total / 1 done", release.Features)
	}

	w = do(r, http.MethodGet, "/api/v1/projects/"+strconv.Itoa(project.ID)+"/releases", "")
	items, meta := decodeReleases(t, w)
	if meta.Total != 1 || len(items) != 1 {
		t.Fatalf("listed %d releases (total %d), want 1", len(items), meta.Total)
	}
}

func TestCreateReleaseRejectsDuplicateTag(t *testing.T) {
	db := newTestDB(t)
	owner, _, project := seed(t, db)
	newRelease(t, db, project.ID, "v1.0.0")

	r := releaseRouter(t, db, owner.ID, "developer")
	w := do(r, http.MethodPost, "/api/v1/projects/"+strconv.Itoa(project.ID)+"/releases",
		`{"tag":"v1.0.0"}`)

	if w.Code != http.StatusConflict {
		t.Fatalf("status %d, want 409: %s", w.Code, w.Body.String())
	}
}

func TestCreateReleaseRequiresOwnerOrManager(t *testing.T) {
	db := newTestDB(t)
	owner, other, project := seed(t, db)
	_ = owner

	share(t, db, project.ID, other.ID, models.RoleViewer)
	r := releaseRouter(t, db, other.ID, "developer")
	w := do(r, http.MethodPost, "/api/v1/projects/"+strconv.Itoa(project.ID)+"/releases",
		`{"tag":"v1.0.0"}`)
	if w.Code != http.StatusForbidden {
		t.Fatalf("status %d, want 403: %s", w.Code, w.Body.String())
	}

	// An editor may plan a release in a project they do not own.
	db.Model(&models.ProjectMember{}).Where("user_id = ?", other.ID).Update("role", models.RoleEditor)
	w = do(r, http.MethodPost, "/api/v1/projects/"+strconv.Itoa(project.ID)+"/releases",
		`{"tag":"v1.0.0"}`)
	if w.Code != http.StatusCreated {
		t.Fatalf("editor status %d, want 201: %s", w.Code, w.Body.String())
	}
}

func TestAssignFeatureFromAnotherProjectIsRefused(t *testing.T) {
	db := newTestDB(t)
	owner, _, project := seed(t, db)

	otherProject := models.Project{Name: "Other", OwnerID: owner.ID}
	if err := db.Create(&otherProject).Error; err != nil {
		t.Fatalf("create project: %v", err)
	}
	stray := models.Feature{ProjectID: otherProject.ID, Title: "Elsewhere", Status: models.StatusTodo}
	if err := db.Create(&stray).Error; err != nil {
		t.Fatalf("create feature: %v", err)
	}

	release := newRelease(t, db, project.ID, "v1.0.0")
	r := releaseRouter(t, db, owner.ID, "developer")

	w := do(r, http.MethodPost, releasePath(release.ID, "/features"),
		fmt.Sprintf(`{"feature_ids":[%d]}`, stray.ID))
	if w.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status %d, want 422: %s", w.Code, w.Body.String())
	}
}

func TestAssignAndUnassignFeatures(t *testing.T) {
	db := newTestDB(t)
	owner, _, project := seed(t, db)
	features := seedFeatures(t, db, project.ID, owner.ID)
	release := newRelease(t, db, project.ID, "v1.0.0")

	r := releaseRouter(t, db, owner.ID, "developer")

	w := do(r, http.MethodPost, releasePath(release.ID, "/features"),
		fmt.Sprintf(`{"feature_ids":[%d,%d]}`, features[1].ID, features[2].ID))
	if w.Code != http.StatusOK {
		t.Fatalf("assign status %d, want 200: %s", w.Code, w.Body.String())
	}
	if got := decodeRelease(t, w); len(got.PlannedFeatures) != 2 {
		t.Fatalf("planned %d features, want 2", len(got.PlannedFeatures))
	}

	w = do(r, http.MethodDelete,
		releasePath(release.ID, "/features/"+strconv.Itoa(int(features[1].ID))), "")
	if w.Code != http.StatusNoContent {
		t.Fatalf("unassign status %d, want 204: %s", w.Code, w.Body.String())
	}

	// Unassigning something that is not in the release is a 404, not a silent
	// success, so a stale screen does not look like it worked.
	w = do(r, http.MethodDelete,
		releasePath(release.ID, "/features/"+strconv.Itoa(int(features[0].ID))), "")
	if w.Code != http.StatusNotFound {
		t.Fatalf("second unassign status %d, want 404: %s", w.Code, w.Body.String())
	}

	var reloaded models.Feature
	if err := db.First(&reloaded, features[1].ID).Error; err != nil {
		t.Fatalf("reload feature: %v", err)
	}
	if reloaded.ReleaseID != nil {
		t.Fatalf("feature still assigned to release %d", *reloaded.ReleaseID)
	}
}

func TestEmptyReleaseIsNotReady(t *testing.T) {
	db := newTestDB(t)
	owner, _, project := seed(t, db)
	release := newRelease(t, db, project.ID, "v1.0.0")

	r := releaseRouter(t, db, owner.ID, "developer")
	w := do(r, http.MethodGet, releasePath(release.ID, ""), "")
	if w.Code != http.StatusOK {
		t.Fatalf("status %d, want 200: %s", w.Code, w.Body.String())
	}

	got := decodeRelease(t, w)
	if got.Readiness == nil || got.Readiness.Ready {
		t.Fatalf("readiness %+v, want not ready", got.Readiness)
	}
	if len(got.Readiness.Blockers) != 1 {
		t.Fatalf("blockers %v, want one", got.Readiness.Blockers)
	}
}

func TestReadinessNamesWhatIsOutstanding(t *testing.T) {
	db := newTestDB(t)
	owner, _, project := seed(t, db)
	features := seedFeatures(t, db, project.ID, owner.ID)
	tasks := seedTasks(t, db, features[1].ID, owner.ID)
	release := newRelease(t, db, project.ID, "v1.0.0")

	// One unfinished feature (a warning) and one unapproved pull request (a blocker).
	pr := models.PullRequest{
		TaskID: tasks[2].ID, FeatureID: features[1].ID, URL: "https://example.com/pr/9",
		Title: "Migration", Branch: "feat/migration", Status: "Open",
	}
	if err := db.Create(&pr).Error; err != nil {
		t.Fatalf("create pr: %v", err)
	}

	r := releaseRouter(t, db, owner.ID, "developer")

	if w := do(r, http.MethodPost, releasePath(release.ID, "/features"),
		fmt.Sprintf(`{"feature_ids":[%d]}`, features[1].ID)); w.Code != http.StatusOK {
		t.Fatalf("assign status %d: %s", w.Code, w.Body.String())
	}
	if w := do(r, http.MethodPost, releasePath(release.ID, "/pull-requests"),
		fmt.Sprintf(`{"pull_request_ids":[%d]}`, pr.ID)); w.Code != http.StatusOK {
		t.Fatalf("link status %d: %s", w.Code, w.Body.String())
	}

	w := do(r, http.MethodGet, releasePath(release.ID, ""), "")
	got := decodeRelease(t, w)

	if got.Readiness.Ready {
		t.Fatal("release reported ready with an unfinished feature and an open pull request")
	}
	if len(got.Readiness.Blockers) != 1 {
		t.Fatalf("blockers %v, want one", got.Readiness.Blockers)
	}
	if len(got.Readiness.Warnings) != 1 {
		t.Fatalf("warnings %v, want one", got.Readiness.Warnings)
	}
	if got.PullRequests.Total != 1 || got.PullRequests.Done != 0 {
		t.Fatalf("pull request counts %+v, want 1 total / 0 done", got.PullRequests)
	}
	if len(got.LinkedPullRequests) != 1 || got.LinkedPullRequests[0].TaskName != tasks[2].TaskName {
		t.Fatalf("linked pull requests %+v, want one naming its task", got.LinkedPullRequests)
	}
}

func TestPublishGoesAheadOverUnfinishedFeatures(t *testing.T) {
	db := newTestDB(t)
	owner, _, project := seed(t, db)
	features := seedFeatures(t, db, project.ID, owner.ID)
	release := newRelease(t, db, project.ID, "v1.0.0")

	r := releaseRouter(t, db, owner.ID, "developer")
	// features[1] is not done.
	if w := do(r, http.MethodPost, releasePath(release.ID, "/features"),
		fmt.Sprintf(`{"feature_ids":[%d]}`, features[1].ID)); w.Code != http.StatusOK {
		t.Fatalf("assign status %d: %s", w.Code, w.Body.String())
	}

	w := do(r, http.MethodGet, releasePath(release.ID, ""), "")
	got := decodeRelease(t, w)
	if !got.Readiness.Ready || len(got.Readiness.Warnings) != 1 {
		t.Fatalf("readiness %+v, want ready with one warning", got.Readiness)
	}

	w = do(r, http.MethodPost, releasePath(release.ID, "/publish"), "")
	if w.Code != http.StatusOK {
		t.Fatalf("status %d, want 200: %s", w.Code, w.Body.String())
	}

	var reloaded models.Release
	if err := db.First(&reloaded, release.ID).Error; err != nil {
		t.Fatalf("reload release: %v", err)
	}
	if reloaded.Status != models.ReleaseStatusPublished {
		t.Fatalf("status %q, want published", reloaded.Status)
	}
}

func TestPublishRefusesAnUnapprovedPullRequest(t *testing.T) {
	db := newTestDB(t)
	owner, _, project := seed(t, db)
	features := seedFeatures(t, db, project.ID, owner.ID)
	tasks := seedTasks(t, db, features[1].ID, owner.ID)
	release := newRelease(t, db, project.ID, "v1.0.0")

	pr := models.PullRequest{
		TaskID: tasks[2].ID, FeatureID: features[1].ID, URL: "https://example.com/pr/9",
		Title: "Migration", Branch: "feat/migration", Status: "Open",
	}
	if err := db.Create(&pr).Error; err != nil {
		t.Fatalf("create pr: %v", err)
	}

	r := releaseRouter(t, db, owner.ID, "developer")
	if w := do(r, http.MethodPost, releasePath(release.ID, "/pull-requests"),
		fmt.Sprintf(`{"pull_request_ids":[%d]}`, pr.ID)); w.Code != http.StatusOK {
		t.Fatalf("link status %d: %s", w.Code, w.Body.String())
	}

	w := do(r, http.MethodPost, releasePath(release.ID, "/publish"), "")
	if w.Code != http.StatusConflict {
		t.Fatalf("status %d, want 409: %s", w.Code, w.Body.String())
	}

	// The reason has to reach the client, not just the status code.
	if fields := decodeAPIError(t, w).Fields; len(fields) == 0 {
		t.Fatal("publish refusal carried no blockers")
	}

	var reloaded models.Release
	if err := db.First(&reloaded, release.ID).Error; err != nil {
		t.Fatalf("reload release: %v", err)
	}
	if reloaded.Status != models.ReleaseStatusDraft {
		t.Fatalf("status %q, want it left as draft", reloaded.Status)
	}
}

func TestPublishSucceedsWhenEverythingIsDone(t *testing.T) {
	db := newTestDB(t)
	owner, _, project := seed(t, db)
	features := seedFeatures(t, db, project.ID, owner.ID)
	release := newRelease(t, db, project.ID, "v1.0.0")

	r := releaseRouter(t, db, owner.ID, "developer")
	// features[0] is the done one.
	if w := do(r, http.MethodPost, releasePath(release.ID, "/features"),
		fmt.Sprintf(`{"feature_ids":[%d]}`, features[0].ID)); w.Code != http.StatusOK {
		t.Fatalf("assign status %d: %s", w.Code, w.Body.String())
	}

	w := do(r, http.MethodPost, releasePath(release.ID, "/publish"), "")
	if w.Code != http.StatusOK {
		t.Fatalf("status %d, want 200: %s", w.Code, w.Body.String())
	}
	if got := decodeRelease(t, w); got.Status != string(models.ReleaseStatusPublished) {
		t.Fatalf("status %q, want published", got.Status)
	}

	// Publishing twice is a conflict rather than a no-op.
	w = do(r, http.MethodPost, releasePath(release.ID, "/publish"), "")
	if w.Code != http.StatusConflict {
		t.Fatalf("second publish status %d, want 409: %s", w.Code, w.Body.String())
	}
}

func TestPublishedReleaseIsFrozen(t *testing.T) {
	db := newTestDB(t)
	owner, _, project := seed(t, db)
	features := seedFeatures(t, db, project.ID, owner.ID)

	release := newRelease(t, db, project.ID, "v1.0.0")
	if err := db.Model(&models.Release{}).Where("id = ?", release.ID).
		Update("status", models.ReleaseStatusPublished).Error; err != nil {
		t.Fatalf("publish: %v", err)
	}

	r := releaseRouter(t, db, owner.ID, "developer")

	if w := do(r, http.MethodPatch, releasePath(release.ID, ""),
		`{"tag":"v1.0.1"}`); w.Code != http.StatusConflict {
		t.Fatalf("re-tag status %d, want 409: %s", w.Code, w.Body.String())
	}

	// Notes can still be corrected after the fact.
	if w := do(r, http.MethodPatch, releasePath(release.ID, ""),
		`{"notes":"Corrected"}`); w.Code != http.StatusOK {
		t.Fatalf("notes status %d, want 200: %s", w.Code, w.Body.String())
	}

	if w := do(r, http.MethodPost, releasePath(release.ID, "/features"),
		fmt.Sprintf(`{"feature_ids":[%d]}`, features[0].ID)); w.Code != http.StatusConflict {
		t.Fatalf("assign status %d, want 409: %s", w.Code, w.Body.String())
	}

	if w := do(r, http.MethodDelete, releasePath(release.ID, ""), ""); w.Code != http.StatusConflict {
		t.Fatalf("delete status %d, want 409: %s", w.Code, w.Body.String())
	}
}

// TestFailedReleaseCanBeDiscarded covers a status the model never declared but
// the older Git finalize flow writes, and which real data holds. It never
// shipped, so unlike a published release it is not a record worth keeping.
func TestFailedReleaseCanBeDiscarded(t *testing.T) {
	db := newTestDB(t)
	owner, _, project := seed(t, db)

	release := newRelease(t, db, project.ID, "v1.0.0")
	if err := db.Model(&models.Release{}).Where("id = ?", release.ID).
		Update("status", "failed").Error; err != nil {
		t.Fatalf("set failed: %v", err)
	}

	r := releaseRouter(t, db, owner.ID, "developer")

	// Its readiness has to name the real status, not claim it already shipped.
	got := decodeRelease(t, do(r, http.MethodGet, releasePath(release.ID, ""), ""))
	if got.Readiness == nil || got.Readiness.Ready {
		t.Fatalf("readiness %+v, want not ready", got.Readiness)
	}
	if blocker := got.Readiness.Blockers[0]; !strings.Contains(blocker, "failed") {
		t.Fatalf("blocker %q does not name the status", blocker)
	}

	if w := do(r, http.MethodPost, releasePath(release.ID, "/publish"), ""); w.Code != http.StatusConflict {
		t.Fatalf("publish status %d, want 409: %s", w.Code, w.Body.String())
	}
	if w := do(r, http.MethodDelete, releasePath(release.ID, ""), ""); w.Code != http.StatusNoContent {
		t.Fatalf("delete status %d, want 204: %s", w.Code, w.Body.String())
	}
}

func TestDeleteDraftReleaseReleasesItsFeatures(t *testing.T) {
	db := newTestDB(t)
	owner, _, project := seed(t, db)
	features := seedFeatures(t, db, project.ID, owner.ID)
	release := newRelease(t, db, project.ID, "v1.0.0")

	r := releaseRouter(t, db, owner.ID, "developer")
	if w := do(r, http.MethodPost, releasePath(release.ID, "/features"),
		fmt.Sprintf(`{"feature_ids":[%d,%d]}`, features[0].ID, features[1].ID)); w.Code != http.StatusOK {
		t.Fatalf("assign status %d: %s", w.Code, w.Body.String())
	}

	if w := do(r, http.MethodDelete, releasePath(release.ID, ""), ""); w.Code != http.StatusNoContent {
		t.Fatalf("delete status %d, want 204: %s", w.Code, w.Body.String())
	}

	// Abandoning the plan must not take the work with it.
	var surviving int64
	if err := db.Model(&models.Feature{}).Where("id IN ?", []uint{features[0].ID, features[1].ID}).
		Count(&surviving).Error; err != nil {
		t.Fatalf("count features: %v", err)
	}
	if surviving != 2 {
		t.Fatalf("%d features survived, want 2", surviving)
	}

	var stillAssigned int64
	if err := db.Model(&models.Feature{}).Where("release_id = ?", release.ID).
		Count(&stillAssigned).Error; err != nil {
		t.Fatalf("count assignments: %v", err)
	}
	if stillAssigned != 0 {
		t.Fatalf("%d features still point at the deleted release", stillAssigned)
	}
}

func TestLinkAndUnlinkPullRequests(t *testing.T) {
	db := newTestDB(t)
	owner, _, project := seed(t, db)
	features := seedFeatures(t, db, project.ID, owner.ID)
	tasks := seedTasks(t, db, features[0].ID, owner.ID)
	release := newRelease(t, db, project.ID, "v1.0.0")

	pr := models.PullRequest{
		TaskID: tasks[0].ID, FeatureID: features[0].ID, URL: "https://example.com/pr/5",
		Title: "Search", Branch: "feat/search", Tested: true, Status: "Approved",
	}
	if err := db.Create(&pr).Error; err != nil {
		t.Fatalf("create pr: %v", err)
	}

	r := releaseRouter(t, db, owner.ID, "developer")
	body := fmt.Sprintf(`{"pull_request_ids":[%d]}`, pr.ID)

	if w := do(r, http.MethodPost, releasePath(release.ID, "/pull-requests"), body); w.Code != http.StatusOK {
		t.Fatalf("link status %d: %s", w.Code, w.Body.String())
	}

	// Linking the same pull request again must not create a second join row.
	if w := do(r, http.MethodPost, releasePath(release.ID, "/pull-requests"), body); w.Code != http.StatusOK {
		t.Fatalf("relink status %d: %s", w.Code, w.Body.String())
	}

	w := do(r, http.MethodGet, releasePath(release.ID, ""), "")
	got := decodeRelease(t, w)
	if got.PullRequests.Total != 1 || got.PullRequests.Done != 1 {
		t.Fatalf("counts %+v, want 1 total / 1 done", got.PullRequests)
	}

	w = do(r, http.MethodDelete,
		releasePath(release.ID, "/pull-requests/"+strconv.Itoa(int(pr.ID))), "")
	if w.Code != http.StatusNoContent {
		t.Fatalf("unlink status %d, want 204: %s", w.Code, w.Body.String())
	}

	w = do(r, http.MethodDelete,
		releasePath(release.ID, "/pull-requests/"+strconv.Itoa(int(pr.ID))), "")
	if w.Code != http.StatusNotFound {
		t.Fatalf("second unlink status %d, want 404: %s", w.Code, w.Body.String())
	}
}

func TestReleaseListFilters(t *testing.T) {
	db := newTestDB(t)
	owner, _, project := seed(t, db)

	draft := newRelease(t, db, project.ID, "v2.0.0")
	shipped := newRelease(t, db, project.ID, "v1.0.0")
	if err := db.Model(&models.Release{}).Where("id = ?", shipped.ID).
		Update("status", models.ReleaseStatusPublished).Error; err != nil {
		t.Fatalf("publish: %v", err)
	}

	r := releaseRouter(t, db, owner.ID, "developer")
	base := "/api/v1/projects/" + strconv.Itoa(project.ID) + "/releases"

	items, _ := decodeReleases(t, do(r, http.MethodGet, base+"?status=draft", ""))
	if len(items) != 1 || items[0].ID != draft.ID {
		t.Fatalf("status filter returned %+v, want only the draft", items)
	}

	items, _ = decodeReleases(t, do(r, http.MethodGet, base+"?q=v1.0", ""))
	if len(items) != 1 || items[0].ID != shipped.ID {
		t.Fatalf("search returned %+v, want only v1.0.0", items)
	}
}

func TestUnknownReleaseIs404(t *testing.T) {
	db := newTestDB(t)
	owner, _, _ := seed(t, db)

	r := releaseRouter(t, db, owner.ID, "developer")
	if w := do(r, http.MethodGet, "/api/v1/releases/9999", ""); w.Code != http.StatusNotFound {
		t.Fatalf("status %d, want 404: %s", w.Code, w.Body.String())
	}
}

// TestDeliveryRoutesRegisterCleanly guards the wiring rather than the
// behaviour: Gin panics at registration time when two routes disagree about a
// path parameter's name, which no other test would reach.
func TestDeliveryRoutesRegisterCleanly(t *testing.T) {
	db := newTestDB(t)

	gin.SetMode(gin.TestMode)
	r := gin.New()
	g := r.Group("/api/v1")

	NewProjectsHandler(nil, db).Register(g)
	NewFeaturesHandler(db).Register(g)
	NewTasksHandler(db).Register(g)
	NewDependenciesHandler(db).Register(g)
	NewReleasesHandler(db).Register(g)
	NewPullRequestsHandler(db).Register(g)

	if len(r.Routes()) == 0 {
		t.Fatal("no routes registered")
	}
}
