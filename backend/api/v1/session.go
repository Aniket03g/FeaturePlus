package v1

import (
	"net/http"
	"strings"

	"github.com/FeaturePlus/backend/api"
	"github.com/FeaturePlus/backend/models"
	"github.com/FeaturePlus/backend/utils"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// sessionCookie is the cookie the JWT travels in. It is HttpOnly, so the
// frontend cannot read it — which is why /me exists: after a page reload the
// app asks the server who it is rather than decoding a token itself.
const sessionCookie = "token"

// sessionMaxAge is how long the cookie lives, in seconds.
//
// It matches the 72-hour expiry that utils.GenerateJWT puts in the token. The
// older login route sets 3600 instead, so its cookie expires an hour into a
// three-day token and the user is signed out while still holding valid
// credentials.
const sessionMaxAge = 72 * 60 * 60

// LoginRequest is the accepted body for signing in.
type LoginRequest struct {
	Email    string `json:"email" binding:"required,email"`
	Password string `json:"password" binding:"required"`
}

// SessionResponse is returned on a successful sign-in. The token is included
// for non-browser clients such as the CLI; a browser ignores it and relies on
// the cookie that was set alongside.
type SessionResponse struct {
	User  UserDTO `json:"user"`
	Token string  `json:"token"`
}

// registerSessionRoutes mounts the public sign-in and sign-out routes.
func registerSessionRoutes(g *gin.RouterGroup, db *gorm.DB) {
	auth := g.Group("/auth")
	{
		auth.POST("/login", loginHandler(db))
		auth.POST("/logout", logoutHandler())
	}
}

// loginHandler verifies credentials and starts a session.
//
// POST /api/v1/auth/login
func loginHandler(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req LoginRequest
		if err := api.Bind(c, &req); err != nil {
			api.Fail(c, err)
			return
		}

		var user models.User
		lookupErr := db.Where("email = ?", strings.TrimSpace(req.Email)).First(&user).Error

		// A missing account, an account with no password, and a wrong password
		// all answer identically. Distinguishing them would let anyone probe
		// which email addresses are registered.
		if lookupErr != nil || user.Password == "" || !user.CheckPassword(req.Password) {
			api.Fail(c, api.Unauthorized("Incorrect email or password"))
			return
		}

		token, err := utils.GenerateJWT(user.ID)
		if err != nil {
			api.Fail(c, api.Internal(err))
			return
		}

		setSessionCookie(c, token, sessionMaxAge)

		api.OK(c, SessionResponse{User: NewUserDTO(user), Token: token})
	}
}

// logoutHandler clears the session cookie.
//
// POST /api/v1/auth/logout
func logoutHandler() gin.HandlerFunc {
	return func(c *gin.Context) {
		setSessionCookie(c, "", -1)
		c.Status(http.StatusNoContent)
	}
}

// setSessionCookie writes the session cookie. It is HttpOnly so scripts cannot
// read the token, and SameSite=Lax so it is not sent on cross-site requests
// while still surviving ordinary navigation.
//
// Secure is left off because the desktop build and local development both run
// over plain http on loopback; a Secure cookie would simply never be stored.
func setSessionCookie(c *gin.Context, value string, maxAge int) {
	c.SetSameSite(http.SameSiteLaxMode)
	c.SetCookie(sessionCookie, value, maxAge, "/", "", false, true)
}
