package v1

import (
	"bytes"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"github.com/FeaturePlus/backend/api"
	"github.com/FeaturePlus/backend/models"
	"github.com/gin-gonic/gin"
	"github.com/jilio/sqlitefs"
	"gorm.io/gorm"
)

// attachmentRouter mounts the attachment routes over a real SQLiteFS, since
// the whole point of these routes is that the bytes go into the database.
func attachmentRouter(t *testing.T, db *gorm.DB, userID int, role string) (*gin.Engine, *sqlitefs.SQLiteFS) {
	t.Helper()

	sqlDB, err := db.DB()
	if err != nil {
		t.Fatalf("sql db: %v", err)
	}

	files, err := sqlitefs.NewSQLiteFS(sqlDB)
	if err != nil {
		t.Fatalf("file store: %v", err)
	}

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

	NewAttachmentsHandler(db, files).Register(g)
	return r, files
}

// upload posts a file the way a browser would.
func upload(r *gin.Engine, path, filename, contentType string, body []byte) *httptest.ResponseRecorder {
	var buf bytes.Buffer
	writer := multipart.NewWriter(&buf)

	header := make(map[string][]string)
	header["Content-Disposition"] = []string{
		`form-data; name="file"; filename="` + filename + `"`,
	}
	if contentType != "" {
		header["Content-Type"] = []string{contentType}
	}

	part, _ := writer.CreatePart(header)
	part.Write(body)
	writer.Close()

	req := httptest.NewRequest(http.MethodPost, path, &buf)
	req.Header.Set("Content-Type", writer.FormDataContentType())

	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

func decodeAttachment(t *testing.T, w *httptest.ResponseRecorder) AttachmentDTO {
	t.Helper()

	var out struct {
		Data AttachmentDTO `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode: %v (%s)", err, w.Body.String())
	}
	return out.Data
}

func decodeAttachments(t *testing.T, w *httptest.ResponseRecorder) []AttachmentDTO {
	t.Helper()

	var out struct {
		Data []AttachmentDTO `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode: %v (%s)", err, w.Body.String())
	}
	return out.Data
}

func TestUploadAndDownloadAnAttachment(t *testing.T) {
	db := newTestDB(t)
	owner, _, project := seed(t, db)
	features := seedFeatures(t, db, project.ID, owner.ID)
	tasks := seedTasks(t, db, features[0].ID, owner.ID)

	r, _ := attachmentRouter(t, db, owner.ID, "developer")
	path := "/api/v1/tasks/" + strconv.Itoa(int(tasks[0].ID)) + "/attachments"
	content := []byte("timestamp,level,message\n1,info,started\n")

	w := upload(r, path, "run.csv", "text/csv", content)
	if w.Code != http.StatusCreated {
		t.Fatalf("upload status %d, want 201: %s", w.Code, w.Body.String())
	}

	attachment := decodeAttachment(t, w)
	if attachment.FileSize != int64(len(content)) {
		t.Fatalf("size %d, want %d", attachment.FileSize, len(content))
	}
	if attachment.MimeType != "text/csv" {
		t.Fatalf("mime type %q, want text/csv", attachment.MimeType)
	}

	if list := decodeAttachments(t, do(r, http.MethodGet, path, "")); len(list) != 1 {
		t.Fatalf("listed %d attachments, want 1", len(list))
	}

	download := do(r, http.MethodGet,
		"/api/v1/attachments/"+strconv.Itoa(int(attachment.ID))+"/content", "")
	if download.Code != http.StatusOK {
		t.Fatalf("download status %d, want 200: %s", download.Code, download.Body.String())
	}
	if !bytes.Equal(download.Body.Bytes(), content) {
		t.Fatalf("downloaded %q, want the bytes that went in", download.Body.String())
	}

	// The person gets back the name they uploaded, not the storage key.
	if disposition := download.Header().Get("Content-Disposition"); !strings.Contains(disposition, "run.csv") {
		t.Fatalf("disposition %q does not name the uploaded file", disposition)
	}
}

func TestUploadedNamesCannotCarryAPath(t *testing.T) {
	db := newTestDB(t)
	owner, _, project := seed(t, db)
	features := seedFeatures(t, db, project.ID, owner.ID)
	tasks := seedTasks(t, db, features[0].ID, owner.ID)

	r, _ := attachmentRouter(t, db, owner.ID, "developer")
	path := "/api/v1/tasks/" + strconv.Itoa(int(tasks[0].ID)) + "/attachments"

	// The store is a flat namespace keyed by name, so a name carrying a path
	// is how one upload lands on top of something else.
	w := upload(r, path, "../../etc/passwd", "text/plain", []byte("root:x:0:0"))
	if w.Code != http.StatusCreated {
		t.Fatalf("status %d, want 201: %s", w.Code, w.Body.String())
	}

	var stored models.TaskAttachment
	if err := db.First(&stored, decodeAttachment(t, w).ID).Error; err != nil {
		t.Fatalf("load: %v", err)
	}
	if strings.Contains(stored.FileName, "/") || strings.Contains(stored.FileName, "..") {
		t.Fatalf("stored under %q, which still carries a path", stored.FileName)
	}
}

func TestTwoUploadsOfTheSameNameDoNotCollide(t *testing.T) {
	db := newTestDB(t)
	owner, _, project := seed(t, db)
	features := seedFeatures(t, db, project.ID, owner.ID)
	tasks := seedTasks(t, db, features[0].ID, owner.ID)

	r, _ := attachmentRouter(t, db, owner.ID, "developer")
	path := "/api/v1/tasks/" + strconv.Itoa(int(tasks[0].ID)) + "/attachments"

	first := decodeAttachment(t, upload(r, path, "notes.txt", "text/plain", []byte("first")))
	second := decodeAttachment(t, upload(r, path, "notes.txt", "text/plain", []byte("second")))

	for _, spec := range []struct {
		id   uint
		want string
	}{{first.ID, "first"}, {second.ID, "second"}} {
		w := do(r, http.MethodGet, "/api/v1/attachments/"+strconv.Itoa(int(spec.id))+"/content", "")
		if body := w.Body.String(); body != spec.want {
			t.Fatalf("attachment %d holds %q, want %q", spec.id, body, spec.want)
		}
	}
}

func TestDownloadServesUnsafeTypesAsBytes(t *testing.T) {
	db := newTestDB(t)
	owner, _, project := seed(t, db)
	features := seedFeatures(t, db, project.ID, owner.ID)
	tasks := seedTasks(t, db, features[0].ID, owner.ID)

	r, _ := attachmentRouter(t, db, owner.ID, "developer")
	path := "/api/v1/tasks/" + strconv.Itoa(int(tasks[0].ID)) + "/attachments"

	// HTML runs script. Asking for it inline must not get it rendered on the
	// app's own origin.
	html := decodeAttachment(t, upload(r, path, "page.html", "text/html",
		[]byte("<script>alert(1)</script>")))
	w := do(r, http.MethodGet,
		"/api/v1/attachments/"+strconv.Itoa(int(html.ID))+"/content?disposition=inline", "")
	if got := w.Header().Get("Content-Type"); !strings.HasPrefix(got, "application/octet-stream") {
		t.Fatalf("html served as %q", got)
	}
	if got := w.Header().Get("Content-Disposition"); !strings.HasPrefix(got, "attachment") {
		t.Fatalf("html disposition %q, want attachment", got)
	}

	// A screenshot is worth showing in the page, so an image may go inline.
	png := decodeAttachment(t, upload(r, path, "shot.png", "image/png", []byte("\x89PNG\r\n")))
	w = do(r, http.MethodGet,
		"/api/v1/attachments/"+strconv.Itoa(int(png.ID))+"/content?disposition=inline", "")
	if got := w.Header().Get("Content-Type"); !strings.HasPrefix(got, "image/png") {
		t.Fatalf("png served as %q", got)
	}
	if got := w.Header().Get("Content-Disposition"); !strings.HasPrefix(got, "inline") {
		t.Fatalf("png disposition %q, want inline", got)
	}
}

func TestDeleteAttachmentKeepsItsComments(t *testing.T) {
	db := newTestDB(t)
	owner, _, project := seed(t, db)
	features := seedFeatures(t, db, project.ID, owner.ID)
	tasks := seedTasks(t, db, features[0].ID, owner.ID)

	r, _ := attachmentRouter(t, db, owner.ID, "developer")
	path := "/api/v1/tasks/" + strconv.Itoa(int(tasks[0].ID)) + "/attachments"
	attachment := decodeAttachment(t, upload(r, path, "notes.txt", "text/plain", []byte("hello")))

	comment := models.Comment{
		TaskID: tasks[0].ID, UserID: uint(owner.ID),
		Content: "See the attached log", AttachmentID: &attachment.ID,
	}
	if err := db.Create(&comment).Error; err != nil {
		t.Fatalf("create comment: %v", err)
	}

	w := do(r, http.MethodDelete, "/api/v1/attachments/"+strconv.Itoa(int(attachment.ID)), "")
	if w.Code != http.StatusNoContent {
		t.Fatalf("status %d, want 204: %s", w.Code, w.Body.String())
	}

	// Removing a file must not remove what somebody said about it.
	var kept models.Comment
	if err := db.First(&kept, comment.ID).Error; err != nil {
		t.Fatalf("the comment went with the attachment: %v", err)
	}
	if kept.AttachmentID != nil {
		t.Fatalf("comment still points at attachment %d", *kept.AttachmentID)
	}
}

func TestAttachmentWritesRequireOwnerOrManager(t *testing.T) {
	db := newTestDB(t)
	owner, other, project := seed(t, db)
	features := seedFeatures(t, db, project.ID, owner.ID)
	tasks := seedTasks(t, db, features[0].ID, owner.ID)

	r, _ := attachmentRouter(t, db, other.ID, "developer")
	path := "/api/v1/tasks/" + strconv.Itoa(int(tasks[0].ID)) + "/attachments"

	if w := do(r, http.MethodGet, path, ""); w.Code != http.StatusNotFound {
		t.Fatalf("outsider read status %d, want 404: %s", w.Code, w.Body.String())
	}

	share(t, db, project.ID, other.ID, models.RoleViewer)
	if w := upload(r, path, "notes.txt", "text/plain", []byte("hi")); w.Code != http.StatusForbidden {
		t.Fatalf("status %d, want 403: %s", w.Code, w.Body.String())
	}
	// A viewer can read them, the same as the rest of a task.
	if w := do(r, http.MethodGet, path, ""); w.Code != http.StatusOK {
		t.Fatalf("read status %d, want 200: %s", w.Code, w.Body.String())
	}
}

func TestUploadWithoutAFileIsABadRequest(t *testing.T) {
	db := newTestDB(t)
	owner, _, project := seed(t, db)
	features := seedFeatures(t, db, project.ID, owner.ID)
	tasks := seedTasks(t, db, features[0].ID, owner.ID)

	r, _ := attachmentRouter(t, db, owner.ID, "developer")
	w := do(r, http.MethodPost,
		"/api/v1/tasks/"+strconv.Itoa(int(tasks[0].ID))+"/attachments", `{"file":"nope"}`)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("status %d, want 400: %s", w.Code, w.Body.String())
	}
}

func TestOriginalAttachmentNameHandlesOldRows(t *testing.T) {
	// Rows written before the separator existed are named "task_<id>_<name>".
	// They are still live, and the download header reads from this.
	cases := map[string]string{
		"task_12_9f2b1c4de0a37f55|run.csv": "run.csv",
		"task_12_run.csv":                  "run.csv",
		"task_12_my_notes.txt":             "my_notes.txt",
		"whatever":                         "whatever",
	}

	for stored, want := range cases {
		if got := originalAttachmentName(stored); got != want {
			t.Errorf("%q -> %q, want %q", stored, got, want)
		}
	}
}
