package v1

import (
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

// featureRouter mounts the feature routes with a stubbed authenticated user.
func featureRouter(t *testing.T, db *gorm.DB, userID int, role string) *gin.Engine {
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

	NewFeaturesHandler(db).Register(g)
	return r
}

// seedFeatures adds three features with tags to the seeded project.
func seedFeatures(t *testing.T, db *gorm.DB, projectID int, ownerID int) []models.Feature {
	t.Helper()

	features := []models.Feature{
		{ProjectID: projectID, Title: "Trail search", Description: "Find trails", Status: models.StatusDone, Priority: models.PriorityHigh, Category: "search"},
		{ProjectID: projectID, Title: "Offline maps", Description: "Cache tiles", Status: models.StatusTodo, Priority: models.PriorityLow, Category: "maps"},
		{ProjectID: projectID, Title: "Elevation chart", Description: "Show gain", Status: models.StatusInProgress, Priority: models.PriorityMedium, Category: "maps"},
	}

	for i := range features {
		if err := db.Create(&features[i]).Error; err != nil {
			t.Fatalf("create feature: %v", err)
		}
	}

	tags := []models.FeatureTag{
		{TagName: "ui", FeatureID: features[0].ID, CreatedByUser: uint(ownerID)},
		{TagName: "backend", FeatureID: features[0].ID, CreatedByUser: uint(ownerID)},
		{TagName: "ui", FeatureID: features[1].ID, CreatedByUser: uint(ownerID)},
	}
	if err := db.Create(&tags).Error; err != nil {
		t.Fatalf("create tags: %v", err)
	}

	return features
}

func decodeFeatures(t *testing.T, w *httptest.ResponseRecorder) ([]FeatureDTO, api.Meta) {
	t.Helper()

	var out struct {
		Data []FeatureDTO `json:"data"`
		Meta api.Meta     `json:"meta"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode: %v (%s)", err, w.Body.String())
	}
	return out.Data, out.Meta
}

func decodeFeature(t *testing.T, w *httptest.ResponseRecorder) FeatureDTO {
	t.Helper()

	var out struct {
		Data FeatureDTO `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode: %v (%s)", err, w.Body.String())
	}
	return out.Data
}

func TestListFeaturesForProject(t *testing.T) {
	db := newTestDB(t)
	owner, _, project := seed(t, db)
	seedFeatures(t, db, project.ID, owner.ID)
	r := featureRouter(t, db, owner.ID, "developer")

	w := do(r, http.MethodGet, "/api/v1/projects/"+strconv.Itoa(project.ID)+"/features", "")
	if w.Code != http.StatusOK {
		t.Fatalf("status %d, want 200: %s", w.Code, w.Body.String())
	}

	data, meta := decodeFeatures(t, w)
	if meta.Total != 3 || len(data) != 3 {
		t.Fatalf("got %d of %d features, want 3", len(data), meta.Total)
	}

	// Highest priority first, so a list opens on the work that matters.
	if data[0].Priority != "high" {
		t.Errorf("first feature priority = %q, want high", data[0].Priority)
	}
	if data[len(data)-1].Priority != "low" {
		t.Errorf("last feature priority = %q, want low", data[len(data)-1].Priority)
	}
}

func TestListFeaturesIncludesTags(t *testing.T) {
	db := newTestDB(t)
	owner, _, project := seed(t, db)
	seedFeatures(t, db, project.ID, owner.ID)
	r := featureRouter(t, db, owner.ID, "developer")

	w := do(r, http.MethodGet, "/api/v1/projects/"+strconv.Itoa(project.ID)+"/features", "")
	data, _ := decodeFeatures(t, w)

	byTitle := map[string][]string{}
	for _, f := range data {
		byTitle[f.Title] = f.Tags
	}

	if got := byTitle["Trail search"]; len(got) != 2 {
		t.Errorf("Trail search tags = %v, want two", got)
	}
	// A feature with no tags must send [] rather than null.
	if got := byTitle["Elevation chart"]; got == nil {
		t.Error("an untagged feature sent null instead of an empty array")
	}
}

func TestFilterFeaturesByStatus(t *testing.T) {
	db := newTestDB(t)
	owner, _, project := seed(t, db)
	seedFeatures(t, db, project.ID, owner.ID)
	r := featureRouter(t, db, owner.ID, "developer")
	base := "/api/v1/projects/" + strconv.Itoa(project.ID) + "/features"

	t.Run("single status", func(t *testing.T) {
		w := do(r, http.MethodGet, base+"?status=todo", "")
		data, _ := decodeFeatures(t, w)
		if len(data) != 1 || data[0].Title != "Offline maps" {
			t.Errorf("got %d features, want just Offline maps", len(data))
		}
	})

	// Repeated values are OR-ed, so a board can ask for two columns at once.
	t.Run("repeated status", func(t *testing.T) {
		w := do(r, http.MethodGet, base+"?status=todo&status=done", "")
		data, _ := decodeFeatures(t, w)
		if len(data) != 2 {
			t.Errorf("got %d features, want 2", len(data))
		}
	})

	t.Run("comma separated", func(t *testing.T) {
		w := do(r, http.MethodGet, base+"?status=todo,done", "")
		data, _ := decodeFeatures(t, w)
		if len(data) != 2 {
			t.Errorf("got %d features, want 2", len(data))
		}
	})
}

func TestFilterFeaturesByTagAndSearch(t *testing.T) {
	db := newTestDB(t)
	owner, _, project := seed(t, db)
	seedFeatures(t, db, project.ID, owner.ID)
	r := featureRouter(t, db, owner.ID, "developer")
	base := "/api/v1/projects/" + strconv.Itoa(project.ID) + "/features"

	t.Run("by tag", func(t *testing.T) {
		w := do(r, http.MethodGet, base+"?tag=backend", "")
		data, _ := decodeFeatures(t, w)
		if len(data) != 1 || data[0].Title != "Trail search" {
			t.Errorf("tag filter returned %d features, want just Trail search", len(data))
		}
	})

	t.Run("search matches description too", func(t *testing.T) {
		w := do(r, http.MethodGet, base+"?q=cache", "")
		data, _ := decodeFeatures(t, w)
		if len(data) != 1 || data[0].Title != "Offline maps" {
			t.Errorf("search returned %d features, want just Offline maps", len(data))
		}
	})

	t.Run("filters combine", func(t *testing.T) {
		w := do(r, http.MethodGet, base+"?tag=ui&status=todo", "")
		data, _ := decodeFeatures(t, w)
		if len(data) != 1 || data[0].Title != "Offline maps" {
			t.Errorf("combined filter returned %d features, want 1", len(data))
		}
	})
}

func TestGetFeatureIncludesSubFeatures(t *testing.T) {
	db := newTestDB(t)
	owner, _, project := seed(t, db)
	features := seedFeatures(t, db, project.ID, owner.ID)
	parent := features[0]

	child := models.Feature{ProjectID: project.ID, Title: "Search by name", ParentFeatureID: &parent.ID, Status: models.StatusTodo}
	if err := db.Create(&child).Error; err != nil {
		t.Fatal(err)
	}

	r := featureRouter(t, db, owner.ID, "developer")
	w := do(r, http.MethodGet, "/api/v1/features/"+strconv.Itoa(int(parent.ID)), "")
	if w.Code != http.StatusOK {
		t.Fatalf("status %d, want 200: %s", w.Code, w.Body.String())
	}

	dto := decodeFeature(t, w)
	if len(dto.SubFeatures) != 1 || dto.SubFeatures[0].Title != "Search by name" {
		t.Errorf("sub_features = %+v, want one child", dto.SubFeatures)
	}
}

func TestRootOnlyFilterExcludesChildren(t *testing.T) {
	db := newTestDB(t)
	owner, _, project := seed(t, db)
	features := seedFeatures(t, db, project.ID, owner.ID)

	child := models.Feature{ProjectID: project.ID, Title: "A child", ParentFeatureID: &features[0].ID}
	if err := db.Create(&child).Error; err != nil {
		t.Fatal(err)
	}

	r := featureRouter(t, db, owner.ID, "developer")
	w := do(r, http.MethodGet, "/api/v1/projects/"+strconv.Itoa(project.ID)+"/features?root=true", "")
	data, _ := decodeFeatures(t, w)

	if len(data) != 3 {
		t.Errorf("got %d features, want the 3 root ones", len(data))
	}
	for _, f := range data {
		if f.ParentFeatureID != nil {
			t.Errorf("root filter returned a child feature: %s", f.Title)
		}
	}
}

func TestCreateFeatureWithTags(t *testing.T) {
	db := newTestDB(t)
	owner, _, project := seed(t, db)
	r := featureRouter(t, db, owner.ID, "developer")

	body := `{"title":"New feature","description":"d","priority":"high","tags":["UI"," ui ","Backend"]}`
	w := do(r, http.MethodPost, "/api/v1/projects/"+strconv.Itoa(project.ID)+"/features", body)
	if w.Code != http.StatusCreated {
		t.Fatalf("status %d, want 201: %s", w.Code, w.Body.String())
	}

	dto := decodeFeature(t, w)
	if dto.Title != "New feature" || dto.Priority != "high" {
		t.Errorf("unexpected feature: %+v", dto)
	}
	// Defaults apply where the request said nothing.
	if dto.Status != "todo" {
		t.Errorf("status = %q, want the todo default", dto.Status)
	}
	if dto.Category != "general" {
		t.Errorf("category = %q, want the general default", dto.Category)
	}

	// "UI", " ui " and "ui" are one tag, not three.
	if len(dto.Tags) != 2 {
		t.Errorf("tags = %v, want them normalised to two", dto.Tags)
	}
}

func TestCreateFeatureValidatesStatus(t *testing.T) {
	db := newTestDB(t)
	owner, _, project := seed(t, db)
	r := featureRouter(t, db, owner.ID, "developer")

	w := do(r, http.MethodPost, "/api/v1/projects/"+strconv.Itoa(project.ID)+"/features",
		`{"title":"x","status":"not-a-status"}`)

	if w.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status %d, want 422: %s", w.Code, w.Body.String())
	}
	if e := decodeErr(t, w); e.Fields["status"] == "" {
		t.Errorf("expected a message on the status field, got %v", e.Fields)
	}
}

func TestCreateFeatureForbiddenForNonOwner(t *testing.T) {
	db := newTestDB(t)
	_, other, project := seed(t, db)
	r := featureRouter(t, db, other.ID, "developer")

	w := do(r, http.MethodPost, "/api/v1/projects/"+strconv.Itoa(project.ID)+"/features",
		`{"title":"Sneaky"}`)
	if w.Code != http.StatusNotFound {
		t.Fatalf("outsider status %d, want 404: %s", w.Code, w.Body.String())
	}

	share(t, db, project.ID, other.ID, models.RoleViewer)
	w = do(r, http.MethodPost, "/api/v1/projects/"+strconv.Itoa(project.ID)+"/features",
		`{"title":"Sneaky"}`)
	if w.Code != http.StatusForbidden {
		t.Fatalf("status %d, want 403: %s", w.Code, w.Body.String())
	}
}

func TestUpdateFeatureIsPartial(t *testing.T) {
	db := newTestDB(t)
	owner, _, project := seed(t, db)
	features := seedFeatures(t, db, project.ID, owner.ID)
	r := featureRouter(t, db, owner.ID, "developer")

	w := do(r, http.MethodPatch, "/api/v1/features/"+strconv.Itoa(int(features[1].ID)),
		`{"status":"done"}`)
	if w.Code != http.StatusOK {
		t.Fatalf("status %d, want 200: %s", w.Code, w.Body.String())
	}

	dto := decodeFeature(t, w)
	if dto.Status != "done" {
		t.Errorf("status = %q, want done", dto.Status)
	}
	if dto.Title != "Offline maps" {
		t.Errorf("title = %q, want it untouched", dto.Title)
	}
	if dto.Priority != "low" {
		t.Errorf("priority = %q, want it untouched", dto.Priority)
	}
}

func TestReplaceTags(t *testing.T) {
	db := newTestDB(t)
	owner, _, project := seed(t, db)
	features := seedFeatures(t, db, project.ID, owner.ID)
	r := featureRouter(t, db, owner.ID, "developer")

	// Trail search starts with two tags; this replaces them with one.
	w := do(r, http.MethodPut, "/api/v1/features/"+strconv.Itoa(int(features[0].ID))+"/tags",
		`{"tags":["api"]}`)
	if w.Code != http.StatusOK {
		t.Fatalf("status %d, want 200: %s", w.Code, w.Body.String())
	}

	var count int64
	db.Model(&models.FeatureTag{}).Where("feature_id = ?", features[0].ID).Count(&count)
	if count != 1 {
		t.Errorf("feature has %d tags, want exactly 1 after replacement", count)
	}
}

func TestReplaceTagsWithEmptyListClearsThem(t *testing.T) {
	db := newTestDB(t)
	owner, _, project := seed(t, db)
	features := seedFeatures(t, db, project.ID, owner.ID)
	r := featureRouter(t, db, owner.ID, "developer")

	w := do(r, http.MethodPut, "/api/v1/features/"+strconv.Itoa(int(features[0].ID))+"/tags",
		`{"tags":[]}`)
	if w.Code != http.StatusOK {
		t.Fatalf("status %d, want 200: %s", w.Code, w.Body.String())
	}

	var count int64
	db.Model(&models.FeatureTag{}).Where("feature_id = ?", features[0].ID).Count(&count)
	if count != 0 {
		t.Errorf("feature still has %d tags, want none", count)
	}
}

func TestProjectTagsAreCounted(t *testing.T) {
	db := newTestDB(t)
	owner, _, project := seed(t, db)
	seedFeatures(t, db, project.ID, owner.ID)
	r := featureRouter(t, db, owner.ID, "developer")

	w := do(r, http.MethodGet, "/api/v1/projects/"+strconv.Itoa(project.ID)+"/tags", "")
	if w.Code != http.StatusOK {
		t.Fatalf("status %d, want 200: %s", w.Code, w.Body.String())
	}

	var out struct {
		Data []TagCount `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode: %v (%s)", err, w.Body.String())
	}

	counts := map[string]int{}
	for _, tag := range out.Data {
		counts[tag.Name] = tag.Count
	}
	if counts["ui"] != 2 {
		t.Errorf("ui count = %d, want 2", counts["ui"])
	}
	if counts["backend"] != 1 {
		t.Errorf("backend count = %d, want 1", counts["backend"])
	}
}

// TestDeleteFeatureWithChildrenIsRefused checks a parent cannot be removed out
// from under its sub-features, which would leave rows no list query returns.
func TestDeleteFeatureWithChildrenIsRefused(t *testing.T) {
	db := newTestDB(t)
	owner, _, project := seed(t, db)
	features := seedFeatures(t, db, project.ID, owner.ID)

	child := models.Feature{ProjectID: project.ID, Title: "child", ParentFeatureID: &features[0].ID}
	if err := db.Create(&child).Error; err != nil {
		t.Fatal(err)
	}

	r := featureRouter(t, db, owner.ID, "developer")
	w := do(r, http.MethodDelete, "/api/v1/features/"+strconv.Itoa(int(features[0].ID)), "")

	if w.Code != http.StatusConflict {
		t.Fatalf("status %d, want 409: %s", w.Code, w.Body.String())
	}
	if e := decodeErr(t, w); e.Code != api.CodeConflict {
		t.Errorf("code = %q, want %q", e.Code, api.CodeConflict)
	}
}

func TestDeleteFeatureWithoutChildren(t *testing.T) {
	db := newTestDB(t)
	owner, _, project := seed(t, db)
	features := seedFeatures(t, db, project.ID, owner.ID)
	r := featureRouter(t, db, owner.ID, "developer")

	w := do(r, http.MethodDelete, "/api/v1/features/"+strconv.Itoa(int(features[1].ID)), "")
	if w.Code != http.StatusNoContent {
		t.Fatalf("status %d, want 204: %s", w.Code, w.Body.String())
	}
}

// TestDeleteFeatureTakesItsDependenciesWithIt: an arrow left behind would
// point at nothing, and a feature that later reused the id would inherit it.
func TestDeleteFeatureTakesItsDependenciesWithIt(t *testing.T) {
	db := newTestDB(t)
	owner, _, project := seed(t, db)
	features := seedFeatures(t, db, project.ID, owner.ID)

	link := func(parent, child models.Feature) {
		dep := models.Dependency{ParentID: parent.ID, ParentType: models.EntityTypeFeature,
			ChildID: child.ID, ChildType: models.EntityTypeFeature}
		if err := db.Create(&dep).Error; err != nil {
			t.Fatal(err)
		}
	}
	link(features[0], features[1]) // goes with features[1]
	link(features[1], features[2]) // goes with features[1]
	link(features[0], features[2]) // stays

	r := featureRouter(t, db, owner.ID, "developer")
	w := do(r, http.MethodDelete, "/api/v1/features/"+strconv.Itoa(int(features[1].ID)), "")
	if w.Code != http.StatusNoContent {
		t.Fatalf("status %d, want 204: %s", w.Code, w.Body.String())
	}

	var left []models.Dependency
	db.Unscoped().Find(&left)
	if len(left) != 1 || left[0].ParentID != features[0].ID || left[0].ChildID != features[2].ID {
		t.Errorf("dependencies left = %+v, want only %d→%d", left, features[0].ID, features[2].ID)
	}
}

func TestFeatureTaskCounts(t *testing.T) {
	db := newTestDB(t)
	owner, _, project := seed(t, db)
	features := seedFeatures(t, db, project.ID, owner.ID)

	var taskIDs []uint
	for i := 0; i < 2; i++ {
		task := models.Task{TaskName: "t", TaskType: "Dev", FeatureID: features[0].ID}
		if err := db.Create(&task).Error; err != nil {
			t.Fatal(err)
		}
		taskIDs = append(taskIDs, task.ID)
	}
	// Only a tested and approved PR marks a task complete.
	pr := models.PullRequest{TaskID: taskIDs[0], URL: "u", Title: "t", Branch: "b", Tested: true, Status: "Approved"}
	if err := db.Create(&pr).Error; err != nil {
		t.Fatal(err)
	}

	r := featureRouter(t, db, owner.ID, "developer")
	w := do(r, http.MethodGet, "/api/v1/features/"+strconv.Itoa(int(features[0].ID)), "")
	dto := decodeFeature(t, w)

	if dto.Tasks == nil {
		t.Fatal("expected task counts on the feature")
	}
	if dto.Tasks.Total != 2 || dto.Tasks.Completed != 1 {
		t.Errorf("tasks = %+v, want 2 total and 1 completed", dto.Tasks)
	}
}

func TestFeaturesForMissingProjectAre404(t *testing.T) {
	db := newTestDB(t)
	owner, _, _ := seed(t, db)
	r := featureRouter(t, db, owner.ID, "developer")

	w := do(r, http.MethodGet, "/api/v1/projects/9999/features", "")
	if w.Code != http.StatusNotFound {
		t.Fatalf("status %d, want 404: %s", w.Code, w.Body.String())
	}
}

// TestDeleteFeatureWithTasksIsRefused covers the other way a delete can orphan
// rows: a feature with no sub-features but with tasks hanging off it. Nothing
// lists a task whose feature is gone, so it would survive unreachable.
func TestDeleteFeatureWithTasksIsRefused(t *testing.T) {
	db := newTestDB(t)
	owner, _, project := seed(t, db)
	features := seedFeatures(t, db, project.ID, owner.ID)

	task := models.Task{TaskName: "Wire it up", TaskType: "Dev", FeatureID: features[0].ID}
	if err := db.Create(&task).Error; err != nil {
		t.Fatal(err)
	}

	r := featureRouter(t, db, owner.ID, "developer")
	w := do(r, http.MethodDelete, "/api/v1/features/"+strconv.Itoa(int(features[0].ID)), "")

	if w.Code != http.StatusConflict {
		t.Fatalf("status %d, want 409: %s", w.Code, w.Body.String())
	}

	// The message should name what is in the way, not just refuse.
	if e := decodeErr(t, w); !strings.Contains(e.Message, "1 task") {
		t.Errorf("message = %q, want it to name the blocking task", e.Message)
	}

	var count int64
	db.Model(&models.Feature{}).Where("id = ?", features[0].ID).Count(&count)
	if count != 1 {
		t.Error("the feature was deleted despite the 409")
	}
}
