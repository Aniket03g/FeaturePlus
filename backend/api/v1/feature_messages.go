package v1

import (
	"strconv"
	"strings"
	"time"

	"github.com/FeaturePlus/backend/api"
	"github.com/FeaturePlus/backend/models"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// Messages on features. Anyone who can see a project may read and write
// them; a message belongs to its author, who alone edits or removes it. See
// models.FeatureMessage.

const maxMessageLength = 5000

// MessageDTO is one message, with its author and its feature named.
type MessageDTO struct {
	ID           uint         `json:"id"`
	FeatureID    uint         `json:"feature_id"`
	FeatureTitle string       `json:"feature_title"`
	Content      string       `json:"content"`
	Author       VersionSaver `json:"author"`
	// Mine says the signed-in person wrote it, and so may edit or remove it.
	Mine      bool      `json:"mine"`
	Edited    bool      `json:"edited"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// MessageRequest is the accepted body for writing or changing a message.
type MessageRequest struct {
	Content string `json:"content" binding:"required,max=5000"`
}

func registerMessageRoutes(g *gin.RouterGroup, db *gorm.DB) {
	g.GET("/features/:featureId/messages", listFeatureMessagesHandler(db))
	g.POST("/features/:featureId/messages", createFeatureMessageHandler(db))
	g.PATCH("/messages/:messageId", updateMessageHandler(db))
	g.DELETE("/messages/:messageId", deleteMessageHandler(db))
	g.GET("/projects/:id/messages", listProjectMessagesHandler(db))
}

func messageText(raw string) (string, error) {
	text := strings.TrimSpace(raw)
	if text == "" {
		return "", api.Validation("Write something first").WithField("content", "Write something first")
	}
	if len(text) > maxMessageLength {
		return "", api.Validation("Too long").WithField("content", "Keep it under "+strconv.Itoa(maxMessageLength)+" characters")
	}
	return text, nil
}

// messageDTOs names the authors and features of messages.
func messageDTOs(db *gorm.DB, messages []models.FeatureMessage, userID int) ([]MessageDTO, error) {
	userIDs := []int{}
	featureIDs := []uint{}
	for _, m := range messages {
		userIDs = append(userIDs, m.UserID)
		featureIDs = append(featureIDs, m.FeatureID)
	}
	names := map[int]string{}
	if len(userIDs) > 0 {
		var users []models.User
		if err := db.Select("id", "name", "username").Where("id IN ?", userIDs).Find(&users).Error; err != nil {
			return nil, err
		}
		for _, u := range users {
			names[u.ID] = u.Name
			if names[u.ID] == "" {
				names[u.ID] = u.Username
			}
		}
	}
	titles := map[uint]string{}
	if len(featureIDs) > 0 {
		var features []models.Feature
		if err := db.Select("id", "title").Where("id IN ?", featureIDs).Find(&features).Error; err != nil {
			return nil, err
		}
		for _, f := range features {
			titles[f.ID] = f.Title
		}
	}
	out := make([]MessageDTO, 0, len(messages))
	for _, m := range messages {
		out = append(out, MessageDTO{
			ID: m.ID, FeatureID: m.FeatureID, FeatureTitle: titles[m.FeatureID], Content: m.Content,
			Author: VersionSaver{ID: m.UserID, Name: names[m.UserID]}, Mine: m.UserID == userID,
			Edited: m.UpdatedAt.Sub(m.CreatedAt) > time.Second, CreatedAt: m.CreatedAt, UpdatedAt: m.UpdatedAt,
		})
	}
	return out, nil
}

// listFeatureMessagesHandler lists a feature's messages, oldest first, as a
// conversation reads.
//
// GET /api/v1/features/:featureId/messages
func listFeatureMessagesHandler(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, err := api.IDParam(c, "featureId")
		if err != nil {
			api.Fail(c, err)
			return
		}
		feature, err := requireFeature(c, db, uint(id), canView)
		if err != nil {
			api.Fail(c, err)
			return
		}
		userID, err := api.UserID(c)
		if err != nil {
			api.Fail(c, err)
			return
		}
		var messages []models.FeatureMessage
		if err := db.Where("feature_id = ?", feature.ID).Order("created_at, id").Find(&messages).Error; err != nil {
			api.Fail(c, api.Internal(err))
			return
		}
		out, err := messageDTOs(db, messages, userID)
		if err != nil {
			api.Fail(c, api.Internal(err))
			return
		}
		api.OK(c, out)
	}
}

// createFeatureMessageHandler leaves a message on a feature. Anyone on the
// project may.
//
// POST /api/v1/features/:featureId/messages
func createFeatureMessageHandler(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, err := api.IDParam(c, "featureId")
		if err != nil {
			api.Fail(c, err)
			return
		}
		feature, err := requireFeature(c, db, uint(id), canView)
		if err != nil {
			api.Fail(c, err)
			return
		}
		userID, err := api.UserID(c)
		if err != nil {
			api.Fail(c, err)
			return
		}
		var req MessageRequest
		if err := api.Bind(c, &req); err != nil {
			api.Fail(c, err)
			return
		}
		text, err := messageText(req.Content)
		if err != nil {
			api.Fail(c, err)
			return
		}
		message := models.FeatureMessage{ProjectID: feature.ProjectID, FeatureID: feature.ID, UserID: userID, Content: text}
		if err := db.Create(&message).Error; err != nil {
			api.Fail(c, api.Internal(err))
			return
		}
		out, err := messageDTOs(db, []models.FeatureMessage{message}, userID)
		if err != nil {
			api.Fail(c, api.Internal(err))
			return
		}
		api.Created(c, out[0])
	}
}

// ownMessage loads a message its author is changing: it must be theirs, in a
// project they can still see.
func ownMessage(c *gin.Context, db *gorm.DB) (models.FeatureMessage, int, error) {
	var message models.FeatureMessage
	id, err := api.IDParam(c, "messageId")
	if err != nil {
		return message, 0, err
	}
	userID, err := api.UserID(c)
	if err != nil {
		return message, 0, err
	}
	if dbErr := db.First(&message, id).Error; dbErr != nil {
		return message, 0, api.FromDB(dbErr, "Message")
	}
	if _, err := requireProject(c, db, message.ProjectID, canView); err != nil {
		return message, 0, asHidden(err, "Message")
	}
	if message.UserID != userID {
		return message, 0, api.Forbidden("Only the person who wrote a message can change or remove it")
	}
	return message, userID, nil
}

// updateMessageHandler changes the words of your own message.
//
// PATCH /api/v1/messages/:messageId
func updateMessageHandler(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		message, userID, err := ownMessage(c, db)
		if err != nil {
			api.Fail(c, err)
			return
		}
		var req MessageRequest
		if err := api.Bind(c, &req); err != nil {
			api.Fail(c, err)
			return
		}
		text, err := messageText(req.Content)
		if err != nil {
			api.Fail(c, err)
			return
		}
		message.Content = text
		if err := db.Model(&message).Updates(map[string]any{"content": text, "updated_at": time.Now()}).Error; err != nil {
			api.Fail(c, api.Internal(err))
			return
		}
		db.First(&message, message.ID)
		out, err := messageDTOs(db, []models.FeatureMessage{message}, userID)
		if err != nil {
			api.Fail(c, api.Internal(err))
			return
		}
		api.OK(c, out[0])
	}
}

// deleteMessageHandler removes your own message.
//
// DELETE /api/v1/messages/:messageId
func deleteMessageHandler(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		message, _, err := ownMessage(c, db)
		if err != nil {
			api.Fail(c, err)
			return
		}
		if err := db.Delete(&message).Error; err != nil {
			api.Fail(c, api.Internal(err))
			return
		}
		api.NoContent(c)
	}
}

// listProjectMessagesHandler lists the project's newest messages across all
// its features.
//
// GET /api/v1/projects/:id/messages?limit=50
func listProjectMessagesHandler(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		projectID, err := api.IDParam(c, "id")
		if err != nil {
			api.Fail(c, err)
			return
		}
		if _, err := requireProject(c, db, projectID, canView); err != nil {
			api.Fail(c, err)
			return
		}
		userID, err := api.UserID(c)
		if err != nil {
			api.Fail(c, err)
			return
		}
		limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
		if limit <= 0 || limit > 200 {
			limit = 50
		}
		var messages []models.FeatureMessage
		if err := db.Where("project_id = ?", projectID).Order("created_at DESC, id DESC").Limit(limit).
			Find(&messages).Error; err != nil {
			api.Fail(c, api.Internal(err))
			return
		}
		out, err := messageDTOs(db, messages, userID)
		if err != nil {
			api.Fail(c, api.Internal(err))
			return
		}
		api.OK(c, out)
	}
}
