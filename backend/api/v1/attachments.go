package v1

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"io"
	"mime"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/FeaturePlus/backend/api"
	"github.com/FeaturePlus/backend/models"
	"github.com/FeaturePlus/backend/repositories"
	"github.com/gin-gonic/gin"
	"github.com/jilio/sqlitefs"
	"gorm.io/gorm"
)

// MaxAttachmentSize caps a single upload.
//
// The bytes go into the SQLite database rather than onto disk, so an unbounded
// upload is an unbounded database. Ten megabytes covers a screenshot, a log,
// or a spreadsheet, which is what actually gets attached to a task.
const MaxAttachmentSize = 10 << 20

// AttachmentsHandler serves task attachments.
//
// Files live in SQLiteFS — inside the database file itself — which is why the
// desktop build needs no separate storage directory and why a project is one
// file you can copy. It is also why the size cap above matters.
type AttachmentsHandler struct {
	repo        repositories.TaskAttachmentRepository
	taskRepo    repositories.TaskRepository
	featureRepo *repositories.FeatureRepository
	projectRepo *repositories.ProjectRepository
	files       *sqlitefs.SQLiteFS
	db          *gorm.DB
}

// NewAttachmentsHandler builds the handler. A nil files store disables the
// routes rather than panicking at request time.
func NewAttachmentsHandler(db *gorm.DB, files *sqlitefs.SQLiteFS) *AttachmentsHandler {
	return &AttachmentsHandler{
		repo:        repositories.NewTaskAttachmentRepository(db, files),
		taskRepo:    repositories.NewTaskRepository(db),
		featureRepo: repositories.NewFeatureRepository(db),
		projectRepo: repositories.NewProjectRepository(db),
		files:       files,
		db:          db,
	}
}

// Register mounts the attachment routes onto an authenticated group.
func (h *AttachmentsHandler) Register(g *gin.RouterGroup) {
	g.GET("/tasks/:taskId/attachments", h.List)
	g.POST("/tasks/:taskId/attachments", h.Upload)

	g.GET("/attachments/:attachmentId", h.Get)
	g.GET("/attachments/:attachmentId/content", h.Download)
	g.DELETE("/attachments/:attachmentId", h.Delete)
}

// List returns a task's attachments.
//
// GET /api/v1/tasks/:taskId/attachments
func (h *AttachmentsHandler) List(c *gin.Context) {
	taskID, err := api.IDParam(c, "taskId")
	if err != nil {
		api.Fail(c, err)
		return
	}

	if _, err := requireTask(c, h.db, uint(taskID), canView); err != nil {
		api.Fail(c, err)
		return
	}

	attachments, dbErr := h.repo.GetByTaskID(uint(taskID))
	if dbErr != nil {
		api.Fail(c, api.Internal(dbErr))
		return
	}

	dtos := make([]AttachmentDTO, 0, len(attachments))
	for _, a := range attachments {
		dtos = append(dtos, NewAttachmentDTO(a))
	}

	api.List(c, dtos, api.Meta{
		Total: int64(len(dtos)), Page: 1, PerPage: len(dtos), TotalPages: 1,
	})
}

// Get returns one attachment's metadata.
//
// GET /api/v1/attachments/:attachmentId
func (h *AttachmentsHandler) Get(c *gin.Context) {
	attachment, err := h.load(c)
	if err != nil {
		api.Fail(c, err)
		return
	}

	api.OK(c, NewAttachmentDTO(*attachment))
}

// Upload attaches a file to a task.
//
// POST /api/v1/tasks/:taskId/attachments  (multipart/form-data, field "file")
//
// This is the one route in the API that does not take JSON. A file has to
// arrive as bytes, and base64 inside a JSON body would inflate every upload by
// a third for no gain.
func (h *AttachmentsHandler) Upload(c *gin.Context) {
	if h.files == nil {
		api.Fail(c, api.Internal(fmt.Errorf("attachment storage is not configured")))
		return
	}

	taskID, err := api.IDParam(c, "taskId")
	if err != nil {
		api.Fail(c, err)
		return
	}

	task, dbErr := h.taskRepo.GetByID(uint(taskID))
	if dbErr != nil {
		api.Fail(c, api.FromDB(dbErr, "Task"))
		return
	}

	if err := h.authorise(c, task); err != nil {
		api.Fail(c, err)
		return
	}

	// Cap the reader before anything is read, so an oversized upload is
	// refused rather than buffered and then refused.
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, MaxAttachmentSize)

	file, header, formErr := c.Request.FormFile("file")
	if formErr != nil {
		if strings.Contains(formErr.Error(), "too large") {
			api.Fail(c, api.Validation("That file is too large").
				WithField("file", "The limit is "+humanSize(MaxAttachmentSize)))
			return
		}
		api.Fail(c, api.BadRequest("Expected a file in the \"file\" field").WithCause(formErr))
		return
	}
	defer file.Close()

	if header.Size > MaxAttachmentSize {
		api.Fail(c, api.Validation("That file is too large").
			WithField("file", "The limit is "+humanSize(MaxAttachmentSize)))
		return
	}

	// The stored name is derived, never taken from the client: an uploaded
	// name can contain path separators, and the store is keyed by name.
	storedName := storedAttachmentName(uint(taskID), header.Filename)

	writer := h.files.NewWriter(storedName)
	written, copyErr := io.Copy(writer, file)
	if copyErr != nil {
		writer.Close()
		api.Fail(c, api.Internal(copyErr))
		return
	}
	if closeErr := writer.Close(); closeErr != nil {
		api.Fail(c, api.Internal(closeErr))
		return
	}

	attachment := models.TaskAttachment{
		TaskID:   uint(taskID),
		FileName: storedName,
		FileSize: written,
		MimeType: attachmentMimeType(header.Header.Get("Content-Type"), header.Filename),
	}

	if dbErr := h.repo.Create(&attachment); dbErr != nil {
		api.Fail(c, api.FromDB(dbErr, "Attachment"))
		return
	}

	api.Created(c, NewAttachmentDTO(attachment))
}

// Download streams an attachment's bytes.
//
// GET /api/v1/attachments/:attachmentId/content?disposition=inline
//
// The default is a download. Inline is offered because a screenshot attached
// to a task is worth showing in the page rather than saving and opening, but
// it is opt-in: serving arbitrary uploaded bytes inline by default is how a
// file store becomes a way to run scripts on your own origin.
func (h *AttachmentsHandler) Download(c *gin.Context) {
	if h.files == nil {
		api.Fail(c, api.Internal(fmt.Errorf("attachment storage is not configured")))
		return
	}

	attachment, err := h.load(c)
	if err != nil {
		api.Fail(c, err)
		return
	}

	file, openErr := h.files.Open(attachment.FileName)
	if openErr != nil {
		// The row exists but the bytes do not. That is a broken record, not a
		// missing resource, so say so rather than implying it was deleted.
		api.Fail(c, api.Internal(openErr))
		return
	}
	defer file.Close()

	contentType := attachment.MimeType
	inline := c.Query("disposition") == "inline" && isInlineSafe(contentType)
	if !inline {
		// Anything not being deliberately displayed is served as bytes, so a
		// browser downloads it instead of interpreting it.
		contentType = "application/octet-stream"
	}

	disposition := "attachment"
	if inline {
		disposition = "inline"
	}

	// The original name is what a person expects to see in their downloads,
	// and it is quoted and escaped because it came from a client.
	c.Header("Content-Disposition",
		mime.FormatMediaType(disposition, map[string]string{
			"filename": originalAttachmentName(attachment.FileName),
		}))
	c.Header("X-Content-Type-Options", "nosniff")

	c.DataFromReader(http.StatusOK, attachment.FileSize, contentType, file, nil)
}

// Delete removes an attachment and its bytes.
//
// DELETE /api/v1/attachments/:attachmentId
func (h *AttachmentsHandler) Delete(c *gin.Context) {
	attachment, err := h.load(c)
	if err != nil {
		api.Fail(c, err)
		return
	}

	task, dbErr := h.taskRepo.GetByID(attachment.TaskID)
	if dbErr != nil {
		api.Fail(c, api.FromDB(dbErr, "Task"))
		return
	}
	if err := h.authorise(c, task); err != nil {
		api.Fail(c, err)
		return
	}

	// A comment can point at an attachment. Detach rather than delete those:
	// removing a file should not remove what somebody said about it.
	if dbErr := h.db.Model(&models.Comment{}).
		Where("attachment_id = ?", attachment.ID).
		Update("attachment_id", nil).Error; dbErr != nil {
		api.Fail(c, api.Internal(dbErr))
		return
	}

	if dbErr := h.repo.Delete(attachment.ID); dbErr != nil {
		api.Fail(c, api.Internal(dbErr))
		return
	}

	api.NoContent(c)
}

// load fetches the attachment named in the path, if the caller can see the
// project its task belongs to.
func (h *AttachmentsHandler) load(c *gin.Context) (*models.TaskAttachment, error) {
	id, err := api.IDParam(c, "attachmentId")
	if err != nil {
		return nil, err
	}

	attachment, dbErr := h.repo.GetByID(uint(id))
	if dbErr != nil {
		return nil, api.FromDB(dbErr, "Attachment")
	}

	if _, err := requireTask(c, h.db, attachment.TaskID, canView); err != nil {
		return nil, asHidden(err, "Attachment")
	}

	return attachment, nil
}

// authorise permits writes by anyone who can edit the task's project.
func (h *AttachmentsHandler) authorise(c *gin.Context, task *models.Task) error {
	_, err := requireTask(c, h.db, task.ID, canEdit)
	return err
}

// storedAttachmentName builds the key a file is stored under.
//
// The store is a flat namespace keyed by name, so two people attaching
// "screenshot.png" must not collide, and an uploaded name must not be able to
// contain a path. filepath.Base strips any directory the client sent, and the
// random middle makes the key unique.
//
// The uniqueness comes from randomness rather than a timestamp because the
// Windows clock has millisecond-scale resolution: two uploads in the same
// request handler can read the same nanosecond value, and the second one then
// overwrites the first.
func storedAttachmentName(taskID uint, uploaded string) string {
	base := filepath.Base(strings.ReplaceAll(uploaded, "\\", "/"))
	base = strings.TrimSpace(base)
	if base == "" || base == "." || base == "/" {
		base = "file"
	}

	// The separator is what originalAttachmentName splits on, so it must not
	// appear in the part that came from the client.
	base = strings.ReplaceAll(base, "|", "-")

	return fmt.Sprintf("task_%d_%s|%s", taskID, randomToken(), base)
}

// randomToken returns 16 hex characters, falling back to the clock if the
// system random source is unavailable.
func randomToken() string {
	var buf [8]byte
	if _, err := rand.Read(buf[:]); err != nil {
		return strconv.FormatInt(time.Now().UnixNano(), 16)
	}
	return hex.EncodeToString(buf[:])
}

// originalAttachmentName recovers the name a person uploaded, for the download
// header. Older rows were stored as "task_<id>_<name>" with no separator, so
// that shape is handled too.
func originalAttachmentName(stored string) string {
	if _, name, found := strings.Cut(stored, "|"); found {
		return name
	}

	rest := strings.TrimPrefix(stored, "task_")
	if i := strings.Index(rest, "_"); i >= 0 {
		if _, err := strconv.Atoi(rest[:i]); err == nil {
			return rest[i+1:]
		}
	}
	return stored
}

// attachmentMimeType settles on a type for a stored file, preferring the one
// the browser reported and falling back to the extension.
func attachmentMimeType(reported, filename string) string {
	if reported = strings.TrimSpace(reported); reported != "" &&
		reported != "application/octet-stream" {
		return reported
	}
	if byExt := mime.TypeByExtension(filepath.Ext(filename)); byExt != "" {
		return byExt
	}
	return "application/octet-stream"
}

// isInlineSafe reports whether a type may be rendered in the page.
//
// The list is an allowlist rather than a blocklist of dangerous types: HTML
// and SVG both execute script, and a blocklist only catches what was thought
// of when it was written.
func isInlineSafe(contentType string) bool {
	base, _, err := mime.ParseMediaType(contentType)
	if err != nil {
		return false
	}

	switch base {
	case "image/png", "image/jpeg", "image/gif", "image/webp", "image/bmp",
		"application/pdf", "text/plain":
		return true
	default:
		return false
	}
}

// humanSize renders a byte count for a message a person reads.
func humanSize(bytes int64) string {
	const mb = 1 << 20
	if bytes >= mb {
		return strconv.FormatInt(bytes/mb, 10) + " MB"
	}
	return strconv.FormatInt(bytes/1024, 10) + " KB"
}
