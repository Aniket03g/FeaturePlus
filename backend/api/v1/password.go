package v1

import (
	"github.com/FeaturePlus/backend/api"
	"github.com/FeaturePlus/backend/internal/log"
	"github.com/FeaturePlus/backend/models"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// ChangePasswordRequest is the accepted body for changing your own password.
// The new password follows the same length rules as sign-up.
type ChangePasswordRequest struct {
	CurrentPassword string `json:"current_password" binding:"required"`
	NewPassword     string `json:"new_password" binding:"required,min=8,max=72"`
}

// changePasswordHandler changes the signed-in user's own password.
//
// POST /api/v1/me/password
//
// The current password is asked for even though the caller is signed in, so a
// session left open on someone else's screen cannot be used to take the
// account over. A wrong current password is a field error, not a 401: a 401
// tells the frontend the session is gone and signs the person out.
//
// Sessions already open elsewhere stay signed in until their token expires;
// the tokens carry no issue time to compare against a password change.
func changePasswordHandler(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID, err := api.UserID(c)
		if err != nil {
			api.Fail(c, err)
			return
		}

		var req ChangePasswordRequest
		if err := api.Bind(c, &req); err != nil {
			api.Fail(c, err)
			return
		}

		var user models.User
		if dbErr := db.First(&user, userID).Error; dbErr != nil {
			api.Fail(c, api.FromDB(dbErr, "User"))
			return
		}

		if !user.CheckPassword(req.CurrentPassword) {
			api.Fail(c, api.Validation("Check the highlighted fields").
				WithField("current_password", "This is not your current password"))
			return
		}
		if req.NewPassword == req.CurrentPassword {
			api.Fail(c, api.Validation("Check the highlighted fields").
				WithField("new_password", "Pick a password different from the current one"))
			return
		}

		if err := user.HashPassword(req.NewPassword); err != nil {
			api.Fail(c, api.Internal(err))
			return
		}
		// One column only: saving the whole model rewrites fields nobody asked to
		// change. The model passed in must be this user with the new hash set —
		// User.BeforeUpdate drops the password column when the model's own
		// password is empty, so Model(&models.User{}) would silently save nothing.
		if dbErr := db.Model(&user).Update("password", user.Password).Error; dbErr != nil {
			api.Fail(c, api.Internal(dbErr))
			return
		}

		log.WithField("user_id", userID).Info("password changed")
		api.NoContent(c)
	}
}

// ResetPasswordRequest is the accepted body for an admin setting someone
// else's password. Same length rules as sign-up.
type ResetPasswordRequest struct {
	NewPassword string `json:"new_password" binding:"required,min=8,max=72"`
}

// resetPasswordHandler lets an admin set a new password for another user, for
// when that person has forgotten theirs. Passwords are stored as bcrypt
// hashes, so the old one cannot be looked up — only replaced.
//
// POST /api/v1/users/:userId/password
//
// No current password is asked for: not knowing it is the reason for the
// call. An admin cannot use this on their own account; that goes through
// /me/password, which does ask, so an open admin session cannot be turned into
// a silent takeover of the admin account itself.
//
// As with changing your own password, sessions the user already has open stay
// signed in until their token expires.
func resetPasswordHandler(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		if !api.IsAdmin(c) {
			api.Fail(c, api.Forbidden("Only an admin can reset someone's password"))
			return
		}

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
		if id == callerID {
			api.Fail(c, api.Conflict("Change your own password from the user menu"))
			return
		}

		var req ResetPasswordRequest
		if err := api.Bind(c, &req); err != nil {
			api.Fail(c, err)
			return
		}

		var user models.User
		if dbErr := db.First(&user, id).Error; dbErr != nil {
			api.Fail(c, api.FromDB(dbErr, "User"))
			return
		}

		if err := user.HashPassword(req.NewPassword); err != nil {
			api.Fail(c, api.Internal(err))
			return
		}
		// Same single-column write as changePasswordHandler, for the same reason.
		if dbErr := db.Model(&user).Update("password", user.Password).Error; dbErr != nil {
			api.Fail(c, api.Internal(dbErr))
			return
		}

		log.WithField("user_id", id).WithField("admin_id", callerID).Info("password reset by admin")
		api.NoContent(c)
	}
}
