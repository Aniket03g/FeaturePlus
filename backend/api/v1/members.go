package v1

import (
	"strings"
	"time"

	"github.com/FeaturePlus/backend/api"
	"github.com/FeaturePlus/backend/models"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// MembersHandler serves who a project is shared with.
//
// Only the owner changes the list. Anyone on it can read it, so a team can see
// who else is working on the project. Someone added can also take themselves
// off, which is the one change that is not the owner's to make.
type MembersHandler struct {
	db *gorm.DB
}

// NewMembersHandler builds the handler.
func NewMembersHandler(db *gorm.DB) *MembersHandler {
	return &MembersHandler{db: db}
}

// Register mounts the member routes onto an authenticated group.
func (h *MembersHandler) Register(g *gin.RouterGroup) {
	g.GET("/projects/:id/members", h.List)
	g.POST("/projects/:id/members", h.Add)
	g.PATCH("/projects/:id/members/:userId", h.Update)
	g.DELETE("/projects/:id/members/:userId", h.Remove)
	g.POST("/projects/:id/transfer", h.Transfer)
}

// MemberDTO is one person on a project. The owner appears too, with the role
// "owner", so a client shows one list rather than an owner and then a list.
type MemberDTO struct {
	User    UserDTO            `json:"user"`
	Role    models.ProjectRole `json:"role"`
	AddedAt *time.Time         `json:"added_at,omitempty"`
}

// AddMemberRequest shares a project with someone who has an account.
type AddMemberRequest struct {
	Email string `json:"email" binding:"required,email,max=255"`
	Role  string `json:"role" binding:"required"`
}

// TransferRequest hands a project to someone else.
type TransferRequest struct {
	Email string `json:"email" binding:"required,email,max=255"`
}

// UpdateMemberRequest changes someone's role.
type UpdateMemberRequest struct {
	Role string `json:"role" binding:"required"`
}

// List returns the owner and everyone the project is shared with.
//
// GET /api/v1/projects/:id/members
func (h *MembersHandler) List(c *gin.Context) {
	projectID, err := api.IDParam(c, "id")
	if err != nil {
		api.Fail(c, err)
		return
	}

	project, err := requireProject(c, h.db, projectID, canView)
	if err != nil {
		api.Fail(c, err)
		return
	}

	out := []MemberDTO{}

	var owner models.User
	if dbErr := h.db.First(&owner, project.OwnerID).Error; dbErr == nil {
		out = append(out, MemberDTO{User: NewUserDTO(owner), Role: models.RoleOwner})
	}

	var members []models.ProjectMember
	if dbErr := h.db.Where("project_id = ?", projectID).Order("created_at, id").Find(&members).Error; dbErr != nil {
		api.Fail(c, api.Internal(dbErr))
		return
	}
	users, dbErr := h.usersByID(members)
	if dbErr != nil {
		api.Fail(c, api.Internal(dbErr))
		return
	}
	for _, m := range members {
		user, ok := users[m.UserID]
		if !ok {
			continue // The account is gone; the row is left over.
		}
		added := m.CreatedAt
		out = append(out, MemberDTO{User: NewUserDTO(user), Role: m.Role, AddedAt: &added})
	}

	api.List(c, out, api.Meta{Total: int64(len(out)), Page: 1, PerPage: len(out), TotalPages: 1})
}

// Add shares the project with the person whose account uses this email.
//
// POST /api/v1/projects/:id/members
func (h *MembersHandler) Add(c *gin.Context) {
	projectID, err := api.IDParam(c, "id")
	if err != nil {
		api.Fail(c, err)
		return
	}

	project, err := requireProject(c, h.db, projectID, ownerOnly)
	if err != nil {
		api.Fail(c, err)
		return
	}

	var req AddMemberRequest
	if bindErr := api.Bind(c, &req); bindErr != nil {
		api.Fail(c, bindErr)
		return
	}

	role, err := shareableRole(req.Role)
	if err != nil {
		api.Fail(c, err)
		return
	}

	// Sign-up stores emails lowercased, but older accounts may not be.
	var user models.User
	email := strings.ToLower(strings.TrimSpace(req.Email))
	if dbErr := h.db.Where("LOWER(email) = ?", email).First(&user).Error; dbErr != nil {
		if dbErr == gorm.ErrRecordNotFound {
			api.Fail(c, api.Validation("No FeaturePlus account uses that email").
				WithField("email", "No FeaturePlus account uses this email. They need to sign up first."))
			return
		}
		api.Fail(c, api.Internal(dbErr))
		return
	}

	if user.ID == project.OwnerID {
		api.Fail(c, api.Conflict("That is the project's owner, who already has access"))
		return
	}

	var existing int64
	if dbErr := h.db.Model(&models.ProjectMember{}).
		Where("project_id = ? AND user_id = ?", projectID, user.ID).
		Count(&existing).Error; dbErr != nil {
		api.Fail(c, api.Internal(dbErr))
		return
	}
	if existing > 0 {
		api.Fail(c, api.Conflict("This project is already shared with them. Change their role instead."))
		return
	}

	addedBy, _ := api.UserID(c)
	member := models.ProjectMember{ProjectID: projectID, UserID: user.ID, Role: role, AddedBy: addedBy}
	if dbErr := h.db.Create(&member).Error; dbErr != nil {
		api.Fail(c, api.FromDB(dbErr, "Member"))
		return
	}

	added := member.CreatedAt
	api.Created(c, MemberDTO{User: NewUserDTO(user), Role: member.Role, AddedAt: &added})
}

// Update changes someone's role.
//
// PATCH /api/v1/projects/:id/members/:userId
func (h *MembersHandler) Update(c *gin.Context) {
	projectID, err := api.IDParam(c, "id")
	if err != nil {
		api.Fail(c, err)
		return
	}
	userID, err := api.IDParam(c, "userId")
	if err != nil {
		api.Fail(c, err)
		return
	}

	if _, err := requireProject(c, h.db, projectID, ownerOnly); err != nil {
		api.Fail(c, err)
		return
	}

	var req UpdateMemberRequest
	if bindErr := api.Bind(c, &req); bindErr != nil {
		api.Fail(c, bindErr)
		return
	}
	role, err := shareableRole(req.Role)
	if err != nil {
		api.Fail(c, err)
		return
	}

	member, err := h.member(projectID, userID)
	if err != nil {
		api.Fail(c, err)
		return
	}
	member.Role = role
	if dbErr := h.db.Save(member).Error; dbErr != nil {
		api.Fail(c, api.Internal(dbErr))
		return
	}

	var user models.User
	if dbErr := h.db.First(&user, userID).Error; dbErr != nil {
		api.Fail(c, api.FromDB(dbErr, "User"))
		return
	}
	added := member.CreatedAt
	api.OK(c, MemberDTO{User: NewUserDTO(user), Role: member.Role, AddedAt: &added})
}

// Remove stops sharing the project with someone. The owner can remove anyone;
// anyone else can only remove themselves, which is how they leave a project.
//
// DELETE /api/v1/projects/:id/members/:userId
func (h *MembersHandler) Remove(c *gin.Context) {
	projectID, err := api.IDParam(c, "id")
	if err != nil {
		api.Fail(c, err)
		return
	}
	userID, err := api.IDParam(c, "userId")
	if err != nil {
		api.Fail(c, err)
		return
	}

	callerID, err := api.UserID(c)
	if err != nil {
		api.Fail(c, err)
		return
	}
	need := ownerOnly
	if userID == callerID {
		need = canView
	}
	project, err := requireProject(c, h.db, projectID, need)
	if err != nil {
		api.Fail(c, err)
		return
	}
	if userID == project.OwnerID {
		api.Fail(c, api.Conflict("The owner cannot be removed from their own project"))
		return
	}

	member, err := h.member(projectID, userID)
	if err != nil {
		api.Fail(c, err)
		return
	}
	if dbErr := h.db.Delete(member).Error; dbErr != nil {
		api.Fail(c, api.Internal(dbErr))
		return
	}

	api.NoContent(c)
}

// Transfer makes someone else the project's owner. The owner or an admin can
// do it; it is how an admin gets a project away from a person who has left.
// The old owner stays on as an editor, so they do not lose their work without
// being told; the new owner can remove them.
//
// POST /api/v1/projects/:id/transfer
func (h *MembersHandler) Transfer(c *gin.Context) {
	projectID, err := api.IDParam(c, "id")
	if err != nil {
		api.Fail(c, err)
		return
	}

	project, err := requireProject(c, h.db, projectID, ownerOnly)
	if err != nil {
		api.Fail(c, err)
		return
	}

	var req TransferRequest
	if bindErr := api.Bind(c, &req); bindErr != nil {
		api.Fail(c, bindErr)
		return
	}

	var next models.User
	email := strings.ToLower(strings.TrimSpace(req.Email))
	if dbErr := h.db.Where("LOWER(email) = ?", email).First(&next).Error; dbErr != nil {
		if dbErr == gorm.ErrRecordNotFound {
			api.Fail(c, api.Validation("No FeaturePlus account uses that email").
				WithField("email", "No FeaturePlus account uses this email. They need to sign up first."))
			return
		}
		api.Fail(c, api.Internal(dbErr))
		return
	}
	if next.ID == project.OwnerID {
		api.Fail(c, api.Conflict("They already own this project"))
		return
	}

	callerID, _ := api.UserID(c)
	previous := project.OwnerID
	if dbErr := h.db.Transaction(func(tx *gorm.DB) error {
		// The new owner's own row would now say less than they are.
		if err := tx.Where("project_id = ? AND user_id = ?", projectID, next.ID).
			Delete(&models.ProjectMember{}).Error; err != nil {
			return err
		}
		if err := tx.Model(&models.Project{}).Where("id = ?", projectID).
			Update("owner_id", next.ID).Error; err != nil {
			return err
		}
		return tx.Create(&models.ProjectMember{
			ProjectID: projectID, UserID: previous, Role: models.RoleEditor, AddedBy: callerID,
		}).Error
	}); dbErr != nil {
		api.Fail(c, api.Internal(dbErr))
		return
	}

	api.OK(c, MemberDTO{User: NewUserDTO(next), Role: models.RoleOwner})
}

// member finds one person's row on a project.
func (h *MembersHandler) member(projectID, userID int) (*models.ProjectMember, error) {
	var member models.ProjectMember
	if dbErr := h.db.Where("project_id = ? AND user_id = ?", projectID, userID).First(&member).Error; dbErr != nil {
		return nil, api.FromDB(dbErr, "Member")
	}
	return &member, nil
}

// usersByID loads the accounts behind a set of member rows.
func (h *MembersHandler) usersByID(members []models.ProjectMember) (map[int]models.User, error) {
	out := map[int]models.User{}
	if len(members) == 0 {
		return out, nil
	}
	ids := make([]int, 0, len(members))
	for _, m := range members {
		ids = append(ids, m.UserID)
	}
	var users []models.User
	if err := h.db.Where("id IN ?", ids).Find(&users).Error; err != nil {
		return nil, err
	}
	for _, u := range users {
		out[u.ID] = u
	}
	return out, nil
}

// shareableRole reads a role a project can be shared with.
func shareableRole(raw string) (models.ProjectRole, error) {
	role := models.ProjectRole(strings.ToLower(strings.TrimSpace(raw)))
	if !role.IsShareable() {
		return "", api.Validation("Choose editor or viewer").
			WithField("role", "Must be editor or viewer")
	}
	return role, nil
}
