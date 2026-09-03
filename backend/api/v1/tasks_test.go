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

func taskRouter(t *testing.T, db *gorm.DB, userID int, role string) *gin.Engine {
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

	NewTasksHandler(db).Register(g)
	return r
}

// seedTasks adds three tasks to a feature, the first of which is complete by
// virtue of a tested, approved pull request.
func seedTasks(t *testing.T, db *gorm.DB, featureID uint, userID int) []models.Task {
	t.Helper()

	tasks := []models.Task{
		{FeatureID: featureID, TaskName: "Build the endpoint", TaskType: "Backend", Description: "Wire up the route", CreatedByUser: uint(userID)},
		{FeatureID: featureID, TaskName: "Draw the screen", TaskType: "UI", Description: "React component", CreatedByUser: uint(userID)},
		{FeatureID: featureID, TaskName: "Add the migration", TaskType: "DB", Description: "New column", CreatedByUser: uint(userID)},
	}
	for i := range tasks {
		if err := db.Create(&tasks[i]).Error; err != nil {
			t.Fatalf("create task: %v", err)
		}
	}

	approved := models.PullRequest{
		TaskID: tasks[0].ID, URL: "https://example.com/pr/1", Title: "Endpoint",
		Branch: "feat/endpoint", Tested: true, Status: "Approved",
	}
	if err := db.Create(&approved).Error; err != nil {
		t.Fatalf("create pr: %v", err)
	}

	// Tested but still open: this must not count as complete.
	open := models.PullRequest{
		TaskID: tasks[1].ID, URL: "https://example.com/pr/2", Title: "Screen",
		Branch: "feat/screen", Tested: true, Status: "Open",
	}
	if err := db.Create(&open).Error; err != nil {
		t.Fatalf("create pr: %v", err)
	}

	return tasks
}

func decodeTasks(t *testing.T, w *httptest.ResponseRecorder) ([]TaskDTO, api.Meta) {
	t.Helper()

	var out struct {
		Data []TaskDTO `json:"data"`
		Meta api.Meta  `json:"meta"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode: %v (%s)", err, w.Body.String())
	}
	return out.Data, out.Meta
}

func decodeTask(t *testing.T, w *httptest.ResponseRecorder) TaskDTO {
	t.Helper()

	var out struct {
		Data TaskDTO `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode: %v (%s)", err, w.Body.String())
	}
	return out.Data
}

func decodeComment(t *testing.T, w *httptest.ResponseRecorder) CommentDTO {
	t.Helper()

	var out struct {
		Data CommentDTO `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode: %v (%s)", err, w.Body.String())
	}
	return out.Data
}

func TestListTasksForFeature(t *testing.T) {
	db := newTestDB(t)
	owner, _, project := seed(t, db)
	features := seedFeatures(t, db, project.ID, owner.ID)
	seedTasks(t, db, features[0].ID, owner.ID)

	r := taskRouter(t, db, owner.ID, "developer")
	w := do(r, http.MethodGet, "/api/v1/features/"+strconv.Itoa(int(features[0].ID))+"/tasks", "")
	if w.Code != http.StatusOK {
		t.Fatalf("status %d, want 200: %s", w.Code, w.Body.String())
	}

	data, meta := decodeTasks(t, w)
	if meta.Total != 3 || len(data) != 3 {
		t.Fatalf("got %d of %d tasks, want 3", len(data), meta.Total)
	}

	// Outstanding work first, since that is what the reader is looking for.
	if data[0].Done {
		t.Error("a completed task sorted ahead of the outstanding ones")
	}
	if !data[len(data)-1].Done {
		t.Error("the completed task should sort last")
	}
}

// TestTaskCompletionNeedsTestedAndApproved pins the rule down: a task has no
// status column, and only a pull request that is both tested and approved
// marks it done.
func TestTaskCompletionNeedsTestedAndApproved(t *testing.T) {
	db := newTestDB(t)
	owner, _, project := seed(t, db)
	features := seedFeatures(t, db, project.ID, owner.ID)
	tasks := seedTasks(t, db, features[0].ID, owner.ID)

	r := taskRouter(t, db, owner.ID, "developer")
	w := do(r, http.MethodGet, "/api/v1/features/"+strconv.Itoa(int(features[0].ID))+"/tasks", "")
	data, _ := decodeTasks(t, w)

	byID := map[uint]TaskDTO{}
	for _, task := range data {
		byID[task.ID] = task
	}

	if !byID[tasks[0].ID].Done {
		t.Error("a task with a tested, approved PR should be done")
	}
	if byID[tasks[1].ID].Done {
		t.Error("a task whose PR is tested but still open should not be done")
	}
	if byID[tasks[2].ID].Done {
		t.Error("a task with no PR at all should not be done")
	}
}

// TestApprovedStatusCasingIsIgnored covers the inconsistent data: both
// "Approved" and "approved" occur in the existing database.
func TestApprovedStatusCasingIsIgnored(t *testing.T) {
	db := newTestDB(t)
	owner, _, project := seed(t, db)
	features := seedFeatures(t, db, project.ID, owner.ID)

	task := models.Task{FeatureID: features[0].ID, TaskName: "t", TaskType: "Dev"}
	if err := db.Create(&task).Error; err != nil {
		t.Fatal(err)
	}
	pr := models.PullRequest{TaskID: task.ID, URL: "u", Title: "t", Branch: "b", Tested: true, Status: "approved"}
	if err := db.Create(&pr).Error; err != nil {
		t.Fatal(err)
	}

	r := taskRouter(t, db, owner.ID, "developer")
	w := do(r, http.MethodGet, "/api/v1/tasks/"+strconv.Itoa(int(task.ID)), "")

	if dto := decodeTask(t, w); !dto.Done {
		t.Error("lowercase \"approved\" should count the same as \"Approved\"")
	}
}

func TestFilterTasks(t *testing.T) {
	db := newTestDB(t)
	owner, _, project := seed(t, db)
	features := seedFeatures(t, db, project.ID, owner.ID)
	seedTasks(t, db, features[0].ID, owner.ID)

	r := taskRouter(t, db, owner.ID, "developer")
	base := "/api/v1/features/" + strconv.Itoa(int(features[0].ID)) + "/tasks"

	t.Run("by type", func(t *testing.T) {
		w := do(r, http.MethodGet, base+"?type=ui", "")
		data, _ := decodeTasks(t, w)
		if len(data) != 1 || data[0].TaskName != "Draw the screen" {
			t.Errorf("got %d tasks, want just the UI one", len(data))
		}
	})

	t.Run("outstanding only", func(t *testing.T) {
		w := do(r, http.MethodGet, base+"?done=false", "")
		data, _ := decodeTasks(t, w)
		if len(data) != 2 {
			t.Errorf("got %d tasks, want the 2 outstanding", len(data))
		}
	})

	t.Run("completed only", func(t *testing.T) {
		w := do(r, http.MethodGet, base+"?done=true", "")
		data, _ := decodeTasks(t, w)
		if len(data) != 1 {
			t.Errorf("got %d tasks, want the 1 completed", len(data))
		}
	})

	t.Run("search matches description", func(t *testing.T) {
		w := do(r, http.MethodGet, base+"?q=migration", "")
		data, _ := decodeTasks(t, w)
		if len(data) != 1 || data[0].TaskName != "Add the migration" {
			t.Errorf("got %d tasks, want just the migration one", len(data))
		}
	})
}

func TestCreateTask(t *testing.T) {
	db := newTestDB(t)
	owner, _, project := seed(t, db)
	features := seedFeatures(t, db, project.ID, owner.ID)

	r := taskRouter(t, db, owner.ID, "developer")
	w := do(r, http.MethodPost, "/api/v1/features/"+strconv.Itoa(int(features[0].ID))+"/tasks",
		`{"task_name":"Write the docs","description":"Explain it"}`)

	if w.Code != http.StatusCreated {
		t.Fatalf("status %d, want 201: %s", w.Code, w.Body.String())
	}

	dto := decodeTask(t, w)
	if dto.TaskName != "Write the docs" {
		t.Errorf("task_name = %q", dto.TaskName)
	}
	if dto.TaskType != "Dev" {
		t.Errorf("task_type = %q, want the Dev default", dto.TaskType)
	}
	if dto.Done {
		t.Error("a new task should not be done")
	}
	// A task with no pull requests must send [] rather than null.
	if dto.PullRequests == nil {
		t.Error("pull_requests was null, want an empty array")
	}
}

func TestCreateTaskValidatesName(t *testing.T) {
	db := newTestDB(t)
	owner, _, project := seed(t, db)
	features := seedFeatures(t, db, project.ID, owner.ID)

	r := taskRouter(t, db, owner.ID, "developer")
	w := do(r, http.MethodPost, "/api/v1/features/"+strconv.Itoa(int(features[0].ID))+"/tasks",
		`{"description":"no name"}`)

	if w.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status %d, want 422: %s", w.Code, w.Body.String())
	}
	if e := decodeErr(t, w); e.Fields["task_name"] == "" {
		t.Errorf("expected a message on task_name, got %v", e.Fields)
	}
}

func TestCreateTaskForbiddenForNonOwner(t *testing.T) {
	db := newTestDB(t)
	owner, other, project := seed(t, db)
	features := seedFeatures(t, db, project.ID, owner.ID)

	r := taskRouter(t, db, other.ID, "developer")
	w := do(r, http.MethodPost, "/api/v1/features/"+strconv.Itoa(int(features[0].ID))+"/tasks",
		`{"task_name":"Sneaky"}`)

	if w.Code != http.StatusForbidden {
		t.Fatalf("status %d, want 403: %s", w.Code, w.Body.String())
	}
}

func TestUpdateTaskIsPartial(t *testing.T) {
	db := newTestDB(t)
	owner, _, project := seed(t, db)
	features := seedFeatures(t, db, project.ID, owner.ID)
	tasks := seedTasks(t, db, features[0].ID, owner.ID)

	r := taskRouter(t, db, owner.ID, "developer")
	w := do(r, http.MethodPatch, "/api/v1/tasks/"+strconv.Itoa(int(tasks[1].ID)),
		`{"task_name":"Renamed"}`)

	if w.Code != http.StatusOK {
		t.Fatalf("status %d, want 200: %s", w.Code, w.Body.String())
	}

	dto := decodeTask(t, w)
	if dto.TaskName != "Renamed" {
		t.Errorf("task_name = %q, want Renamed", dto.TaskName)
	}
	if dto.TaskType != "UI" {
		t.Errorf("task_type = %q, want it untouched", dto.TaskType)
	}
	if dto.Description != "React component" {
		t.Errorf("description = %q, want it untouched", dto.Description)
	}
}

// TestDeleteTaskWithPullRequestsIsRefused protects a record of real work from
// being swept away with the task it hangs off.
func TestDeleteTaskWithPullRequestsIsRefused(t *testing.T) {
	db := newTestDB(t)
	owner, _, project := seed(t, db)
	features := seedFeatures(t, db, project.ID, owner.ID)
	tasks := seedTasks(t, db, features[0].ID, owner.ID)

	r := taskRouter(t, db, owner.ID, "developer")
	w := do(r, http.MethodDelete, "/api/v1/tasks/"+strconv.Itoa(int(tasks[0].ID)), "")

	if w.Code != http.StatusConflict {
		t.Fatalf("status %d, want 409: %s", w.Code, w.Body.String())
	}
	if e := decodeErr(t, w); !strings.Contains(e.Message, "1 pull request") {
		t.Errorf("message = %q, want it to name the blocking pull request", e.Message)
	}
}

// TestDeleteTaskRemovesItsComments checks the other half of the rule: comments
// belong to the task and have no meaning without it, so they go too.
func TestDeleteTaskRemovesItsComments(t *testing.T) {
	db := newTestDB(t)
	owner, _, project := seed(t, db)
	features := seedFeatures(t, db, project.ID, owner.ID)
	tasks := seedTasks(t, db, features[0].ID, owner.ID)

	comment := models.Comment{TaskID: tasks[2].ID, UserID: uint(owner.ID), Content: "A note"}
	if err := db.Create(&comment).Error; err != nil {
		t.Fatal(err)
	}

	r := taskRouter(t, db, owner.ID, "developer")
	w := do(r, http.MethodDelete, "/api/v1/tasks/"+strconv.Itoa(int(tasks[2].ID)), "")
	if w.Code != http.StatusNoContent {
		t.Fatalf("status %d, want 204: %s", w.Code, w.Body.String())
	}

	var orphans int64
	db.Model(&models.Comment{}).Where("task_id = ?", tasks[2].ID).Count(&orphans)
	if orphans != 0 {
		t.Errorf("%d comments outlived their task", orphans)
	}
}

func TestAddAndListComments(t *testing.T) {
	db := newTestDB(t)
	owner, _, project := seed(t, db)
	features := seedFeatures(t, db, project.ID, owner.ID)
	tasks := seedTasks(t, db, features[0].ID, owner.ID)
	path := "/api/v1/tasks/" + strconv.Itoa(int(tasks[0].ID)) + "/comments"

	r := taskRouter(t, db, owner.ID, "developer")

	w := do(r, http.MethodPost, path, `{"content":"  Looks good to me  "}`)
	if w.Code != http.StatusCreated {
		t.Fatalf("status %d, want 201: %s", w.Code, w.Body.String())
	}

	dto := decodeComment(t, w)
	if dto.Content != "Looks good to me" {
		t.Errorf("content = %q, want it trimmed", dto.Content)
	}
	// The response carries the author, so a list can show a name not an id.
	if dto.Author == nil || dto.Author.Username != owner.Username {
		t.Errorf("author = %+v, want %s", dto.Author, owner.Username)
	}

	list := do(r, http.MethodGet, path, "")
	var out struct {
		Data []CommentDTO `json:"data"`
	}
	if err := json.Unmarshal(list.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	if len(out.Data) != 1 {
		t.Errorf("got %d comments, want 1", len(out.Data))
	}
}

// TestAnyoneCanCommentOnATask records the deliberate difference from editing:
// discussion is open to any authenticated user, since it changes nothing about
// the work itself.
func TestAnyoneCanCommentOnATask(t *testing.T) {
	db := newTestDB(t)
	owner, other, project := seed(t, db)
	features := seedFeatures(t, db, project.ID, owner.ID)
	tasks := seedTasks(t, db, features[0].ID, owner.ID)

	r := taskRouter(t, db, other.ID, "developer")
	w := do(r, http.MethodPost,
		"/api/v1/tasks/"+strconv.Itoa(int(tasks[0].ID))+"/comments",
		`{"content":"A question from someone else"}`)

	if w.Code != http.StatusCreated {
		t.Fatalf("status %d, want 201: %s", w.Code, w.Body.String())
	}
}

func TestCommentValidatesContent(t *testing.T) {
	db := newTestDB(t)
	owner, _, project := seed(t, db)
	features := seedFeatures(t, db, project.ID, owner.ID)
	tasks := seedTasks(t, db, features[0].ID, owner.ID)

	r := taskRouter(t, db, owner.ID, "developer")
	w := do(r, http.MethodPost,
		"/api/v1/tasks/"+strconv.Itoa(int(tasks[0].ID))+"/comments", `{"content":""}`)

	if w.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status %d, want 422: %s", w.Code, w.Body.String())
	}
}

// TestOnlyTheAuthorCanEditAComment covers the rule that a comment belongs to
// whoever wrote it — the project owner can remove the task, but not rewrite
// someone else's words.
func TestOnlyTheAuthorCanEditAComment(t *testing.T) {
	db := newTestDB(t)
	owner, other, project := seed(t, db)
	features := seedFeatures(t, db, project.ID, owner.ID)
	tasks := seedTasks(t, db, features[0].ID, owner.ID)

	comment := models.Comment{TaskID: tasks[0].ID, UserID: uint(other.ID), Content: "Mine"}
	if err := db.Create(&comment).Error; err != nil {
		t.Fatal(err)
	}
	path := "/api/v1/comments/" + strconv.Itoa(int(comment.ID))

	t.Run("the project owner cannot", func(t *testing.T) {
		r := taskRouter(t, db, owner.ID, "developer")
		w := do(r, http.MethodPatch, path, `{"content":"Rewritten"}`)
		if w.Code != http.StatusForbidden {
			t.Fatalf("status %d, want 403: %s", w.Code, w.Body.String())
		}
	})

	t.Run("the author can", func(t *testing.T) {
		r := taskRouter(t, db, other.ID, "developer")
		w := do(r, http.MethodPatch, path, `{"content":"Edited by me"}`)
		if w.Code != http.StatusOK {
			t.Fatalf("status %d, want 200: %s", w.Code, w.Body.String())
		}
		if dto := decodeComment(t, w); dto.Content != "Edited by me" {
			t.Errorf("content = %q", dto.Content)
		}
	})

	t.Run("a manager can", func(t *testing.T) {
		r := taskRouter(t, db, owner.ID, "manager")
		w := do(r, http.MethodDelete, path, "")
		if w.Code != http.StatusNoContent {
			t.Fatalf("status %d, want 204: %s", w.Code, w.Body.String())
		}
	})
}

func TestTaskDetailIncludesCommentsAndPullRequests(t *testing.T) {
	db := newTestDB(t)
	owner, _, project := seed(t, db)
	features := seedFeatures(t, db, project.ID, owner.ID)
	tasks := seedTasks(t, db, features[0].ID, owner.ID)

	comment := models.Comment{TaskID: tasks[0].ID, UserID: uint(owner.ID), Content: "Note"}
	if err := db.Create(&comment).Error; err != nil {
		t.Fatal(err)
	}

	r := taskRouter(t, db, owner.ID, "developer")
	w := do(r, http.MethodGet, "/api/v1/tasks/"+strconv.Itoa(int(tasks[0].ID)), "")
	dto := decodeTask(t, w)

	if len(dto.Comments) != 1 {
		t.Errorf("got %d comments, want 1", len(dto.Comments))
	}
	if len(dto.PullRequests) != 1 {
		t.Fatalf("got %d pull requests, want 1", len(dto.PullRequests))
	}
	if !dto.PullRequests[0].Approved {
		t.Error("the PR status was Approved, so approved should be true")
	}
	if dto.CommentCount != 1 {
		t.Errorf("comment_count = %d, want 1", dto.CommentCount)
	}
}

func TestTasksForMissingFeatureAre404(t *testing.T) {
	db := newTestDB(t)
	owner, _, _ := seed(t, db)

	r := taskRouter(t, db, owner.ID, "developer")
	w := do(r, http.MethodGet, "/api/v1/features/9999/tasks", "")

	if w.Code != http.StatusNotFound {
		t.Fatalf("status %d, want 404: %s", w.Code, w.Body.String())
	}
}

// TestWhitespaceOnlyCommentIsRejected covers the gap between validation and
// trimming: "   " satisfies a minimum length, then trims away to nothing, so
// checking only the raw string lets an empty comment through.
func TestWhitespaceOnlyCommentIsRejected(t *testing.T) {
	db := newTestDB(t)
	owner, _, project := seed(t, db)
	features := seedFeatures(t, db, project.ID, owner.ID)
	tasks := seedTasks(t, db, features[0].ID, owner.ID)
	r := taskRouter(t, db, owner.ID, "developer")

	// The second body carries an escaped newline and tab, so the JSON itself is
	// valid and the whitespace only appears once it is parsed. A literal newline
	// inside a JSON string would be rejected as malformed before ever reaching
	// the emptiness check.
	whitespaceBodies := []string{
		`{"content":"   "}`,
		`{"content":"\n\t "}`,
	}

	for _, body := range whitespaceBodies {
		w := do(r, http.MethodPost,
			"/api/v1/tasks/"+strconv.Itoa(int(tasks[0].ID))+"/comments", body)

		if w.Code != http.StatusUnprocessableEntity {
			t.Fatalf("body %s: status %d, want 422: %s", body, w.Code, w.Body.String())
		}
		if e := decodeErr(t, w); e.Fields["content"] == "" {
			t.Errorf("expected a message on the content field, got %v", e.Fields)
		}
	}

	var count int64
	db.Model(&models.Comment{}).Count(&count)
	if count != 0 {
		t.Errorf("%d empty comments were stored", count)
	}
}

func TestWhitespaceOnlyCommentEditIsRejected(t *testing.T) {
	db := newTestDB(t)
	owner, _, project := seed(t, db)
	features := seedFeatures(t, db, project.ID, owner.ID)
	tasks := seedTasks(t, db, features[0].ID, owner.ID)

	comment := models.Comment{TaskID: tasks[0].ID, UserID: uint(owner.ID), Content: "Real content"}
	if err := db.Create(&comment).Error; err != nil {
		t.Fatal(err)
	}

	r := taskRouter(t, db, owner.ID, "developer")
	w := do(r, http.MethodPatch,
		"/api/v1/comments/"+strconv.Itoa(int(comment.ID)), `{"content":"   "}`)

	if w.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status %d, want 422: %s", w.Code, w.Body.String())
	}

	var stored models.Comment
	db.First(&stored, comment.ID)
	if stored.Content != "Real content" {
		t.Errorf("content = %q, want the original preserved", stored.Content)
	}
}
