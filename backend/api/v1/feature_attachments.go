package v1

import (
	"fmt"
	"io"
	"mime"
	"net/http"
	"path/filepath"
	"strings"

	"github.com/FeaturePlus/backend/api"
	"github.com/FeaturePlus/backend/models"
	"github.com/gin-gonic/gin"
	"github.com/jilio/sqlitefs"
	"gorm.io/gorm"
)

// FeatureAttachmentsHandler serves files attached to a feature: the images
// and documents its description and notes link to. They are stored the way
// task attachments are, inside the database, under the same size cap.
//
// A description links to a file as "attachment:" and its name, not by id. The
// page turns that into this handler's content route when it shows the text,
// so a restored backup, where every id is new, keeps its pictures.
type FeatureAttachmentsHandler struct {
	db    *gorm.DB
	files *sqlitefs.SQLiteFS
}

// NewFeatureAttachmentsHandler builds the handler. A nil files store refuses
// uploads and downloads rather than panicking at request time.
func NewFeatureAttachmentsHandler(db *gorm.DB, files *sqlitefs.SQLiteFS) *FeatureAttachmentsHandler {
	return &FeatureAttachmentsHandler{db: db, files: files}
}

// Register mounts the routes onto an authenticated group.
func (h *FeatureAttachmentsHandler) Register(g *gin.RouterGroup) {
	g.GET("/features/:featureId/attachments", h.List)
	g.POST("/features/:featureId/attachments", h.Upload)

	g.GET("/feature-attachments/:attachmentId/content", h.Download)
	g.DELETE("/feature-attachments/:attachmentId", h.Delete)
}

// List returns a feature's files, oldest first.
//
// GET /api/v1/features/:featureId/attachments
func (h *FeatureAttachmentsHandler) List(c *gin.Context) {
	featureID, err := api.IDParam(c, "featureId")
	if err != nil {
		api.Fail(c, err)
		return
	}
	if _, err := requireFeature(c, h.db, uint(featureID), canView); err != nil {
		api.Fail(c, err)
		return
	}

	var rows []models.FeatureAttachment
	if err := h.db.Where("feature_id = ?", featureID).Order("id").Find(&rows).Error; err != nil {
		api.Fail(c, api.Internal(err))
		return
	}
	dtos := make([]FeatureAttachmentDTO, 0, len(rows))
	for _, a := range rows {
		dtos = append(dtos, NewFeatureAttachmentDTO(a))
	}
	api.List(c, dtos, api.Meta{Total: int64(len(dtos)), Page: 1, PerPage: len(dtos), TotalPages: 1})
}

// Upload attaches a file to a feature.
//
// POST /api/v1/features/:featureId/attachments  (multipart/form-data, field "file")
func (h *FeatureAttachmentsHandler) Upload(c *gin.Context) {
	if h.files == nil {
		api.Fail(c, api.Internal(fmt.Errorf("attachment storage is not configured")))
		return
	}
	featureID, err := api.IDParam(c, "featureId")
	if err != nil {
		api.Fail(c, err)
		return
	}
	if _, err := requireFeature(c, h.db, uint(featureID), canEdit); err != nil {
		api.Fail(c, err)
		return
	}

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

	name, err := freeAttachmentName(h.db, uint(featureID), header.Filename)
	if err != nil {
		api.Fail(c, api.Internal(err))
		return
	}
	stored := storedFeatureAttachmentName(uint(featureID), name)

	writer := h.files.NewWriter(stored)
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

	row := models.FeatureAttachment{
		FeatureID: uint(featureID), Name: name, FileName: stored, FileSize: written,
		MimeType: attachmentMimeType(header.Header.Get("Content-Type"), header.Filename),
	}
	if err := h.db.Create(&row).Error; err != nil {
		api.Fail(c, api.FromDB(err, "Attachment"))
		return
	}
	api.Created(c, NewFeatureAttachmentDTO(row))
}

// Download streams a file's bytes. As with task attachments, it is a download
// unless ?disposition=inline is asked for and the type is safe to show, which
// is how an image in a description is drawn.
//
// GET /api/v1/feature-attachments/:attachmentId/content
func (h *FeatureAttachmentsHandler) Download(c *gin.Context) {
	if h.files == nil {
		api.Fail(c, api.Internal(fmt.Errorf("attachment storage is not configured")))
		return
	}
	row, err := h.load(c, canView)
	if err != nil {
		api.Fail(c, err)
		return
	}
	file, openErr := h.files.Open(row.FileName)
	if openErr != nil {
		api.Fail(c, api.Internal(openErr))
		return
	}
	defer file.Close()

	contentType := row.MimeType
	inline := c.Query("disposition") == "inline" && isInlineSafe(contentType)
	disposition := "inline"
	if !inline {
		contentType = "application/octet-stream"
		disposition = "attachment"
	}
	c.Header("Content-Disposition", mime.FormatMediaType(disposition, map[string]string{"filename": row.Name}))
	c.Header("X-Content-Type-Options", "nosniff")
	c.DataFromReader(http.StatusOK, row.FileSize, contentType, file, nil)
}

// Delete removes a file and its bytes. A description still linking to it
// shows the link as missing.
//
// DELETE /api/v1/feature-attachments/:attachmentId
func (h *FeatureAttachmentsHandler) Delete(c *gin.Context) {
	row, err := h.load(c, canEdit)
	if err != nil {
		api.Fail(c, err)
		return
	}
	if err := h.db.Transaction(func(tx *gorm.DB) error {
		return deleteFeatureAttachmentsTx(tx, []models.FeatureAttachment{*row})
	}); err != nil {
		api.Fail(c, api.Internal(err))
		return
	}
	api.NoContent(c)
}

// load fetches the attachment named in the path, if the caller has the role
// asked for in its feature's project.
func (h *FeatureAttachmentsHandler) load(c *gin.Context, need models.ProjectRole) (*models.FeatureAttachment, error) {
	id, err := api.IDParam(c, "attachmentId")
	if err != nil {
		return nil, err
	}
	var row models.FeatureAttachment
	if err := h.db.First(&row, id).Error; err != nil {
		return nil, api.FromDB(err, "Attachment")
	}
	if _, err := requireFeature(c, h.db, row.FeatureID, need); err != nil {
		return nil, asHidden(err, "Attachment")
	}
	return &row, nil
}

// deleteFeatureAttachmentsTx removes attachment rows and their stored bytes,
// writing the store's tables directly so it can share a transaction.
func deleteFeatureAttachmentsTx(tx *gorm.DB, rows []models.FeatureAttachment) error {
	for _, a := range rows {
		if err := tx.Exec("DELETE FROM file_fragments WHERE file_id IN (SELECT id FROM file_metadata WHERE path = ?)", a.FileName).Error; err != nil {
			return err
		}
		if err := tx.Exec("DELETE FROM file_metadata WHERE path = ?", a.FileName).Error; err != nil {
			return err
		}
		if err := tx.Delete(&models.FeatureAttachment{}, a.ID).Error; err != nil {
			return err
		}
	}
	return nil
}

// cleanAttachmentName makes an uploaded name safe to link to from markdown:
// no directory, and nothing but letters, digits, dots, dashes and
// underscores, since a space or bracket would end the link.
func cleanAttachmentName(uploaded string) string {
	base := strings.TrimSpace(filepath.Base(strings.ReplaceAll(uploaded, "\\", "/")))
	var b strings.Builder
	for _, r := range base {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9', r == '.', r == '-', r == '_':
			b.WriteRune(r)
		default:
			b.WriteRune('-')
		}
	}
	name := strings.Trim(b.String(), ".-")
	if name == "" {
		name = "file"
	}
	if len(name) > 200 {
		ext := filepath.Ext(name)
		if len(ext) > 20 {
			ext = ""
		}
		name = name[:200-len(ext)] + ext
	}
	return name
}

// freeAttachmentName is the cleaned name, or the first of name-2, name-3…
// that the feature does not already use.
func freeAttachmentName(db *gorm.DB, featureID uint, uploaded string) (string, error) {
	name := cleanAttachmentName(uploaded)
	var taken []string
	if err := db.Model(&models.FeatureAttachment{}).Where("feature_id = ?", featureID).Pluck("name", &taken).Error; err != nil {
		return "", err
	}
	used := map[string]bool{}
	for _, t := range taken {
		used[strings.ToLower(t)] = true
	}
	ext := filepath.Ext(name)
	stem := strings.TrimSuffix(name, ext)
	for i, candidate := 2, name; ; i++ {
		if !used[strings.ToLower(candidate)] {
			return candidate, nil
		}
		candidate = fmt.Sprintf("%s-%d%s", stem, i, ext)
	}
}

// storedFeatureAttachmentName is the key a feature's file is stored under,
// built the way task attachment keys are: unique, and free of any path.
func storedFeatureAttachmentName(featureID uint, name string) string {
	return fmt.Sprintf("feature_%d_%s|%s", featureID, randomToken(), name)
}
