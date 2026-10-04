package v1

import (
	"fmt"
	"regexp"
	"strings"

	"github.com/FeaturePlus/backend/api"
	"github.com/FeaturePlus/backend/models"
	"github.com/FeaturePlus/backend/utils"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// SignupRequest is the accepted body for creating an account.
//
// There is deliberately no role field. The older /api/auth/signup let the
// caller pick "manager", which made anyone who could reach the page able to
// edit and delete other people's projects. Roles are changed afterwards, by a
// manager, on the Team screen.
type SignupRequest struct {
	Name     string `json:"name" binding:"required,max=100"`
	Email    string `json:"email" binding:"required,email,max=254"`
	Password string `json:"password" binding:"required,min=8,max=72"`
}

// signupHandler creates an account and signs it in.
//
// The first account on an empty database becomes a manager; every later one
// is a developer. Without that, a fresh server would have nobody able to
// change a role, and so no way to ever get a manager.
//
// POST /api/v1/auth/signup
func signupHandler(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req SignupRequest
		if err := api.Bind(c, &req); err != nil {
			api.Fail(c, err)
			return
		}

		name := strings.TrimSpace(req.Name)
		email := strings.ToLower(strings.TrimSpace(req.Email))
		if name == "" {
			api.Fail(c, api.Validation("Check the highlighted fields").WithField("name", "This field is required"))
			return
		}

		var user models.User
		err := db.Transaction(func(tx *gorm.DB) error {
			var taken int64
			if err := tx.Model(&models.User{}).Where("LOWER(email) = ?", email).Count(&taken).Error; err != nil {
				return api.Internal(err)
			}
			if taken > 0 {
				return api.Conflict("An account with this email already exists").
					WithField("email", "An account with this email already exists")
			}

			var total int64
			if err := tx.Model(&models.User{}).Count(&total).Error; err != nil {
				return api.Internal(err)
			}
			role := "developer"
			if total == 0 {
				role = "manager"
			}

			username, err := freeUsername(tx, email)
			if err != nil {
				return api.Internal(err)
			}

			user = models.User{Name: name, Email: email, Username: username, Role: role}
			if err := user.HashPassword(req.Password); err != nil {
				return api.Internal(err)
			}
			if err := tx.Create(&user).Error; err != nil {
				return api.Internal(err)
			}
			return nil
		})
		if err != nil {
			api.Fail(c, err)
			return
		}

		token, err := utils.GenerateJWT(user.ID)
		if err != nil {
			api.Fail(c, api.Internal(err))
			return
		}

		setSessionCookie(c, token, sessionMaxAge)

		api.Created(c, SessionResponse{User: NewUserDTO(user), Token: token})
	}
}

var usernameJunk = regexp.MustCompile(`[^a-z0-9._-]+`)

// freeUsername derives a username from the email's local part, adding a number
// when it is already in use. People sign up with an email and a name; the
// username is still a unique column, so one is picked for them.
func freeUsername(tx *gorm.DB, email string) (string, error) {
	base := usernameJunk.ReplaceAllString(strings.SplitN(email, "@", 2)[0], "")
	if base == "" {
		base = "user"
	}

	candidate := base
	for i := 2; ; i++ {
		var n int64
		if err := tx.Model(&models.User{}).Where("LOWER(username) = ?", candidate).Count(&n).Error; err != nil {
			return "", err
		}
		if n == 0 {
			return candidate, nil
		}
		candidate = fmt.Sprintf("%s%d", base, i)
	}
}
