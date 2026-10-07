package v1

import (
	"sort"
	"strings"

	"github.com/FeaturePlus/backend/api"
	"github.com/FeaturePlus/backend/internal/log"
	"github.com/FeaturePlus/backend/models"
	"github.com/FeaturePlus/backend/repositories"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// UsersHandler serves /api/v1 user routes — the team management screen.
//
// Every response goes through UserDTO, which has no password field. That is
// not incidental: the old GET /api/users returned models.User directly, and
// because a bcrypt hash is never empty, `json:"password,omitempty"` published
// every user's hash to any signed-in caller for as long as it existed.
type UsersHandler struct {
	repo *repositories.UserRepository
	db   *gorm.DB
}

// NewUsersHandler builds the handler.
func NewUsersHandler(db *gorm.DB) *UsersHandler {
	return &UsersHandler{repo: repositories.NewUserRepository(db), db: db}
}

// Register mounts the user routes onto an authenticated group.
func (h *UsersHandler) Register(g *gin.RouterGroup) {
	users := g.Group("/users")
	{
		users.GET("", h.List)
		users.GET("/:userId", h.Get)
		users.PATCH("/:userId", h.Update)
		users.DELETE("/:userId", h.Delete)
	}
}

// List returns everyone on the instance.
//
// GET /api/v1/users?q=&role=
//
// An admin, who runs the server, sees every account. Anyone else sees only the
// people they share a project with, and themselves: that is everyone they can
// assign work to or grant access to, and it keeps one team's roster hidden from
// another's on a shared server.
func (h *UsersHandler) List(c *gin.Context) {
	users, dbErr := h.repo.GetAllUsers()
	if dbErr != nil {
		api.Fail(c, api.Internal(dbErr))
		return
	}

	if !api.IsAdmin(c) {
		known, err := h.knownUsers(c)
		if err != nil {
			api.Fail(c, err)
			return
		}
		kept := make([]models.User, 0, len(users))
		for _, user := range users {
			if known[user.ID] {
				kept = append(kept, user)
			}
		}
		users = kept
	}

	roles := lowerSet(c.QueryArray("role"))
	query := strings.ToLower(c.Query("q"))

	filtered := make([]models.User, 0, len(users))
	for _, user := range users {
		if len(roles) > 0 && !roles[strings.ToLower(user.Role)] {
			continue
		}
		if query != "" &&
			!contains(lower(user.Username), query) &&
			!contains(lower(user.Name), query) &&
			!contains(lower(user.Email), query) {
			continue
		}
		filtered = append(filtered, user)
	}

	sort.SliceStable(filtered, func(i, j int) bool {
		return lower(filtered[i].Username) < lower(filtered[j].Username)
	})

	page := api.ParsePage(c)
	total := int64(len(filtered))
	items := api.Slice(filtered, page)

	dtos := make([]UserDTO, 0, len(items))
	for _, user := range items {
		dtos = append(dtos, NewUserDTO(user))
	}

	api.List(c, dtos, page.Meta(total))
}

// Get returns one user.
//
// GET /api/v1/users/:userId
func (h *UsersHandler) Get(c *gin.Context) {
	id, err := api.IDParam(c, "userId")
	if err != nil {
		api.Fail(c, err)
		return
	}

	if !api.IsAdmin(c) {
		known, err := h.knownUsers(c)
		if err != nil {
			api.Fail(c, err)
			return
		}
		if !known[id] {
			api.Fail(c, api.NotFound("User"))
			return
		}
	}

	user, dbErr := h.repo.GetUserByID(id)
	if dbErr != nil {
		api.Fail(c, api.FromDB(dbErr, "User"))
		return
	}

	api.OK(c, NewUserDTO(*user))
}

// Update changes a user's details.
//
// PATCH /api/v1/users/:userId
//
// Anyone may edit their own name, email and username. Only a manager may edit
// someone else, and only a manager may change a role at all — a user who could
// set their own role could make themselves a manager.
func (h *UsersHandler) Update(c *gin.Context) {
	id, err := api.IDParam(c, "userId")
	if err != nil {
		api.Fail(c, err)
		return
	}

	callerID, err := api.UserID(c)
	if err != nil {
		api.Fail(c, err)
		return
	}

	if _, dbErr := h.repo.GetUserByID(id); dbErr != nil {
		api.Fail(c, api.FromDB(dbErr, "User"))
		return
	}

	var req UpdateUserRequest
	if bindErr := api.Bind(c, &req); bindErr != nil {
		api.Fail(c, bindErr)
		return
	}

	isAdmin := api.IsAdmin(c)
	if id != callerID && !isAdmin {
		api.Fail(c, api.Forbidden("Only an admin can change someone else's account"))
		return
	}
	if req.Role != nil && !isAdmin {
		api.Fail(c, api.Forbidden("Only an admin can change a role"))
		return
	}
	if req.Role != nil && *req.Role != "admin" {
		if err := h.keepAnAdmin(id); err != nil {
			api.Fail(c, err)
			return
		}
	}

	// Email and username are unique columns. Asking first turns a driver-level
	// constraint error into a message naming the field a form can highlight.
	if req.Email != nil {
		taken, checkErr := h.taken("email", strings.TrimSpace(*req.Email), id)
		if checkErr != nil {
			api.Fail(c, api.Internal(checkErr))
			return
		}
		if taken {
			api.Fail(c, api.Conflict("That email address is already in use").
				WithField("email", "Already in use"))
			return
		}
	}
	if req.Username != nil {
		taken, checkErr := h.taken("username", strings.TrimSpace(*req.Username), id)
		if checkErr != nil {
			api.Fail(c, api.Internal(checkErr))
			return
		}
		if taken {
			api.Fail(c, api.Conflict("That username is already taken").
				WithField("username", "Already taken"))
			return
		}
	}

	updates := map[string]any{}
	if req.Name != nil {
		updates["name"] = strings.TrimSpace(*req.Name)
	}
	if req.Email != nil {
		updates["email"] = strings.TrimSpace(*req.Email)
	}
	if req.Username != nil {
		updates["username"] = strings.TrimSpace(*req.Username)
	}
	if req.Role != nil {
		updates["role"] = *req.Role
	}

	if len(updates) > 0 {
		// Updates by column map rather than by saving the model: saving would
		// carry the password hash back through the write path, and the only
		// thing protecting it there is a BeforeUpdate hook.
		if dbErr := h.db.Model(&models.User{}).Where("id = ?", id).
			Updates(updates).Error; dbErr != nil {
			api.Fail(c, api.FromDB(dbErr, "User"))
			return
		}
	}

	fresh, dbErr := h.repo.GetUserByID(id)
	if dbErr != nil {
		api.Fail(c, api.Internal(dbErr))
		return
	}

	api.OK(c, NewUserDTO(*fresh))
}

// Delete removes a user.
//
// DELETE /api/v1/users/:userId
//
// Refused while the user still owns projects: their work would become
// unreachable, since a project resolves its permissions through its owner.
// That is the same rule the feature and release deletes follow.
func (h *UsersHandler) Delete(c *gin.Context) {
	id, err := api.IDParam(c, "userId")
	if err != nil {
		api.Fail(c, err)
		return
	}

	callerID, err := api.UserID(c)
	if err != nil {
		api.Fail(c, err)
		return
	}

	if !api.IsAdmin(c) {
		api.Fail(c, api.Forbidden("Only an admin can remove a user"))
		return
	}
	if id == callerID {
		api.Fail(c, api.Conflict("You cannot remove your own account"))
		return
	}

	if _, dbErr := h.repo.GetUserByID(id); dbErr != nil {
		api.Fail(c, api.FromDB(dbErr, "User"))
		return
	}

	var owned int64
	if dbErr := h.db.Model(&models.Project{}).Where("owner_id = ?", id).
		Count(&owned).Error; dbErr != nil {
		api.Fail(c, api.Internal(dbErr))
		return
	}
	if owned > 0 {
		api.Fail(c, api.Conflict(
			"This user owns "+plural(int(owned), "project")+". Transfer them first."))
		return
	}

	// The grants go with the person. Leaving them behind would mean a later
	// user created with the same id inherits somebody else's access.
	if dbErr := h.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("user_id = ?", id).Delete(&models.FeatureScope{}).Error; err != nil {
			return err
		}
		if err := tx.Where("user_id = ?", id).Delete(&models.ProjectMember{}).Error; err != nil {
			return err
		}
		return tx.Delete(&models.User{}, id).Error
	}); dbErr != nil {
		api.Fail(c, api.Internal(dbErr))
		return
	}

	log.WithField("user_id", id).Info("user removed")
	api.NoContent(c)
}

// taken reports whether another user already holds this value in a column.
func (h *UsersHandler) taken(column, value string, exceptID int) (bool, error) {
	var count int64
	err := h.db.Model(&models.User{}).
		Where(column+" = ? AND id <> ?", value, exceptID).
		Count(&count).Error
	return count > 0, err
}

// keepAnAdmin refuses a change that would leave the server with no admin,
// since nobody else could then make one.
func (h *UsersHandler) keepAnAdmin(losingID int) error {
	var user models.User
	if err := h.db.First(&user, losingID).Error; err != nil {
		return api.FromDB(err, "User")
	}
	if user.Role != "admin" {
		return nil
	}
	var admins int64
	if err := h.db.Model(&models.User{}).Where("role = ?", "admin").Count(&admins).Error; err != nil {
		return api.Internal(err)
	}
	if admins <= 1 {
		return api.Conflict("This is the only admin. Make someone else an admin first.")
	}
	return nil
}

// knownUsers is the caller and everyone who owns or was added to a project the
// caller can see.
func (h *UsersHandler) knownUsers(c *gin.Context) (map[int]bool, error) {
	userID, err := api.UserID(c)
	if err != nil {
		return nil, err
	}
	known := map[int]bool{userID: true}

	projectIDs, dbErr := visibleProjectIDs(h.db, userID)
	if dbErr != nil {
		return nil, api.Internal(dbErr)
	}
	if len(projectIDs) == 0 {
		return known, nil
	}

	var owners, members []int
	if dbErr := h.db.Model(&models.Project{}).Where("id IN ?", projectIDs).Pluck("owner_id", &owners).Error; dbErr != nil {
		return nil, api.Internal(dbErr)
	}
	if dbErr := h.db.Model(&models.ProjectMember{}).Where("project_id IN ?", projectIDs).Pluck("user_id", &members).Error; dbErr != nil {
		return nil, api.Internal(dbErr)
	}
	for _, id := range append(owners, members...) {
		known[id] = true
	}
	return known, nil
}
