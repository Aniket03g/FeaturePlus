package v1

import (
	"time"

	"github.com/FeaturePlus/backend/api"
	"github.com/FeaturePlus/backend/models"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm/clause"
)

// VisitDTO is the time of the visit before this one, or null on the first.
type VisitDTO struct {
	Previous *time.Time `json:"previous"`
}

// Visit records that the signed-in person has opened the project's working
// list now, and answers with when they last did, so the page can show what
// changed in between.
//
// POST /api/v1/projects/:id/visit
func (h *FeaturesHandler) Visit(c *gin.Context) {
	projectID, err := api.IDParam(c, "id")
	if err != nil {
		api.Fail(c, err)
		return
	}
	if _, err := requireProject(c, h.db, projectID, canView); err != nil {
		api.Fail(c, err)
		return
	}
	userID, err := api.UserID(c)
	if err != nil {
		api.Fail(c, err)
		return
	}

	out := VisitDTO{}
	var last models.ProjectVisit
	if h.db.Where("user_id = ? AND project_id = ?", userID, projectID).Limit(1).Find(&last).RowsAffected > 0 {
		out.Previous = &last.SeenAt
	}
	visit := models.ProjectVisit{UserID: uint(userID), ProjectID: projectID, SeenAt: time.Now()}
	if err := h.db.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "user_id"}, {Name: "project_id"}},
		DoUpdates: clause.AssignmentColumns([]string{"seen_at"}),
	}).Create(&visit).Error; err != nil {
		api.Fail(c, api.Internal(err))
		return
	}
	api.OK(c, out)
}
