package v1

import (
	"github.com/FeaturePlus/backend/api"
	"github.com/FeaturePlus/backend/models"
	"github.com/FeaturePlus/backend/repositories"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// ScopesHandler serves per-feature access grants — who can see what.
//
// A grant of owner access on a feature means the holder sees that feature's
// mapped files in full, sees the files of the features it depends on as
// stripped contracts, and sees nothing else in the project. Only the project
// owner may grant or revoke, and that is deliberately stricter than the rest
// of the API: everywhere else a manager can act on any project, but handing
// out access to somebody's source is the owner's decision to make.
type ScopesHandler struct {
	featureRepo *repositories.FeatureRepository
	projectRepo *repositories.ProjectRepository
	db          *gorm.DB
}

// NewScopesHandler builds the handler.
func NewScopesHandler(db *gorm.DB) *ScopesHandler {
	return &ScopesHandler{
		featureRepo: repositories.NewFeatureRepository(db),
		projectRepo: repositories.NewProjectRepository(db),
		db:          db,
	}
}

// Register mounts the scope routes onto an authenticated group.
func (h *ScopesHandler) Register(g *gin.RouterGroup) {
	g.GET("/features/:featureId/scopes", h.List)
	g.POST("/features/:featureId/scopes", h.Grant)
	g.DELETE("/features/:featureId/scopes/:scopeId", h.Revoke)

	g.GET("/projects/:id/scopes", h.ListForProject)
}

// List returns a feature's grants.
//
// GET /api/v1/features/:featureId/scopes
func (h *ScopesHandler) List(c *gin.Context) {
	feature, err := h.load(c)
	if err != nil {
		api.Fail(c, err)
		return
	}

	var scopes []models.FeatureScope
	if dbErr := h.db.Preload("User").
		Where("feature_id = ?", feature.ID).
		Order("created_at").Find(&scopes).Error; dbErr != nil {
		api.Fail(c, api.Internal(dbErr))
		return
	}

	dtos := NewScopeDTOs(scopes)
	api.List(c, dtos, api.Meta{
		Total: int64(len(dtos)), Page: 1, PerPage: len(dtos), TotalPages: 1,
	})
}

// ListForProject returns every grant in a project, so the team screen can show
// who has access to what without a request per feature.
//
// GET /api/v1/projects/:id/scopes
func (h *ScopesHandler) ListForProject(c *gin.Context) {
	projectID, err := api.IDParam(c, "id")
	if err != nil {
		api.Fail(c, err)
		return
	}

	if _, dbErr := h.projectRepo.GetProjectByID(projectID); dbErr != nil {
		api.Fail(c, api.FromDB(dbErr, "Project"))
		return
	}

	var scopes []models.FeatureScope
	if dbErr := h.db.Preload("User").
		Where("project_id = ?", projectID).
		Order("feature_id, created_at").Find(&scopes).Error; dbErr != nil {
		api.Fail(c, api.Internal(dbErr))
		return
	}

	page := api.ParsePage(c)
	total := int64(len(scopes))
	api.List(c, NewScopeDTOs(api.Slice(scopes, page)), page.Meta(total))
}

// Grant gives a collaborator access to a feature, or changes the level they
// already hold.
//
// POST /api/v1/features/:featureId/scopes
func (h *ScopesHandler) Grant(c *gin.Context) {
	feature, err := h.loadForOwner(c)
	if err != nil {
		api.Fail(c, err)
		return
	}

	var req GrantScopeRequest
	if bindErr := api.Bind(c, &req); bindErr != nil {
		api.Fail(c, bindErr)
		return
	}

	var user models.User
	if dbErr := h.db.First(&user, req.UserID).Error; dbErr != nil {
		api.Fail(c, api.FromDB(dbErr, "User"))
		return
	}

	granterID, err := api.UserID(c)
	if err != nil {
		api.Fail(c, err)
		return
	}

	// Granting to the project's owner is meaningless — they already see
	// everything — and a grant sitting there implies otherwise.
	project, dbErr := h.projectRepo.GetProjectByID(feature.ProjectID)
	if dbErr != nil {
		api.Fail(c, api.FromDB(dbErr, "Project"))
		return
	}
	if project.OwnerID == req.UserID {
		api.Fail(c, api.Conflict("The project owner already has access to every feature"))
		return
	}

	level := models.FeatureAccessLevel(req.AccessLevel)

	// One grant per person per feature: re-granting changes the level rather
	// than stacking a second row the access rules would have to rank.
	var existing models.FeatureScope
	lookupErr := h.db.Where("user_id = ? AND feature_id = ?", req.UserID, feature.ID).
		First(&existing).Error

	switch {
	case lookupErr == nil:
		if dbErr := h.db.Model(&models.FeatureScope{}).Where("id = ?", existing.ID).
			Updates(map[string]any{
				"access_level":  level,
				"granted_by_id": granterID,
			}).Error; dbErr != nil {
			api.Fail(c, api.Internal(dbErr))
			return
		}
		existing.AccessLevel = level
		existing.GrantedByID = granterID
		existing.User = user
		api.OK(c, NewScopeDTO(existing))

	case lookupErr == gorm.ErrRecordNotFound:
		scope := models.FeatureScope{
			ProjectID:   feature.ProjectID,
			FeatureID:   feature.ID,
			UserID:      req.UserID,
			AccessLevel: level,
			GrantedByID: granterID,
		}
		if dbErr := h.db.Omit("Feature", "User", "GrantedBy").Create(&scope).Error; dbErr != nil {
			api.Fail(c, api.FromDB(dbErr, "Access grant"))
			return
		}
		scope.User = user
		api.Created(c, NewScopeDTO(scope))

	default:
		api.Fail(c, api.Internal(lookupErr))
	}
}

// Revoke removes a grant.
//
// DELETE /api/v1/features/:featureId/scopes/:scopeId
func (h *ScopesHandler) Revoke(c *gin.Context) {
	feature, err := h.loadForOwner(c)
	if err != nil {
		api.Fail(c, err)
		return
	}

	scopeID, err := api.IDParam(c, "scopeId")
	if err != nil {
		api.Fail(c, err)
		return
	}

	// Scoped to this feature, so a grant cannot be revoked through the wrong
	// feature's URL.
	result := h.db.Where("id = ? AND feature_id = ?", scopeID, feature.ID).
		Delete(&models.FeatureScope{})
	if result.Error != nil {
		api.Fail(c, api.Internal(result.Error))
		return
	}
	if result.RowsAffected == 0 {
		api.Fail(c, api.NotFound("Access grant"))
		return
	}

	api.NoContent(c)
}

// load fetches the feature named in the path.
func (h *ScopesHandler) load(c *gin.Context) (*models.Feature, error) {
	id, err := api.IDParam(c, "featureId")
	if err != nil {
		return nil, err
	}

	feature, dbErr := h.featureRepo.GetFeatureByID(id)
	if dbErr != nil {
		return nil, api.FromDB(dbErr, "Feature")
	}

	return feature, nil
}

// loadForOwner fetches the feature and checks the caller owns its project.
func (h *ScopesHandler) loadForOwner(c *gin.Context) (*models.Feature, error) {
	feature, err := h.load(c)
	if err != nil {
		return nil, err
	}

	userID, err := api.UserID(c)
	if err != nil {
		return nil, err
	}

	project, dbErr := h.projectRepo.GetProjectByID(feature.ProjectID)
	if dbErr != nil {
		return nil, api.FromDB(dbErr, "Project")
	}

	if project.OwnerID != userID {
		return nil, api.Forbidden("Only the project owner can change who has access")
	}

	return feature, nil
}
