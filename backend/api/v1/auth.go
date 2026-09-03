package v1

import (
	"strings"

	"github.com/FeaturePlus/backend/api"
	"github.com/FeaturePlus/backend/models"
	"github.com/FeaturePlus/backend/utils"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// requireAuth authenticates the caller and loads their role.
//
// It does what the existing AuthMiddleware and RoleMiddleware do together, and
// exists for one reason: those two report failures in three different shapes
// ({"code":..,"error":"str"} and {"error":"str"}), none of which is the
// envelope every other v1 response uses. A client that reads error.code would
// break on exactly the responses it most needs to handle — expired sessions.
//
// The token is accepted from an Authorization header or the token cookie, so
// the same middleware serves the browser (cookie set at login) and the desktop
// window (same cookie, against the loopback server).
func requireAuth(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		token := bearerToken(c)
		if token == "" {
			if cookie, err := c.Cookie("token"); err == nil {
				token = cookie
			}
		}

		if token == "" {
			c.Header("WWW-Authenticate", `Bearer realm="FeaturePlus API"`)
			api.Fail(c, api.Unauthorized("Authentication required"))
			return
		}

		claims, err := utils.ValidateToken(token)
		if err != nil {
			// An expired session is the common case and deserves its own
			// message, so a client can refresh rather than show a hard error.
			if strings.Contains(err.Error(), "token is expired") {
				c.Header("WWW-Authenticate", `Bearer error="expired_token"`)
				api.Fail(c, api.Unauthorized("Session has expired"))
				return
			}
			c.Header("WWW-Authenticate", `Bearer error="invalid_token"`)
			api.Fail(c, api.Unauthorized("Invalid authentication token"))
			return
		}

		rawID, ok := claims["user_id"].(float64)
		if !ok {
			api.Fail(c, api.Unauthorized("Invalid authentication token"))
			return
		}
		userID := int(rawID)

		// Load the user to resolve their role, and to reject a token that is
		// still signed correctly but names a user who no longer exists.
		var user models.User
		if dbErr := db.First(&user, userID).Error; dbErr != nil {
			api.Fail(c, api.Unauthorized("Account no longer exists"))
			return
		}

		// The same context keys the rest of the application uses, with the same
		// uint type, so any shared handler keeps working.
		c.Set(api.ContextUserID, uint(userID))
		c.Set(api.ContextUserRole, user.Role)

		c.Next()
	}
}

// bearerToken reads a token from the Authorization header, if present.
func bearerToken(c *gin.Context) string {
	header := c.GetHeader("Authorization")
	if header == "" {
		return ""
	}

	parts := strings.SplitN(header, " ", 2)
	if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") {
		return ""
	}

	return strings.TrimSpace(parts[1])
}

// requireManager rejects a caller who does not hold the manager role. It runs
// after requireAuth, which is what puts the role in the context.
func requireManager() gin.HandlerFunc {
	return func(c *gin.Context) {
		if !api.IsManager(c) {
			api.Fail(c, api.Forbidden("This action requires the manager role"))
			return
		}
		c.Next()
	}
}
