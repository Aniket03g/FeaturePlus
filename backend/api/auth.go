package api

import "github.com/gin-gonic/gin"

// The existing AuthMiddleware accepts a JWT from either an Authorization
// header or the token cookie, and stores the user id in the Gin context. That
// already covers both clients this API has to serve: a browser, where the
// cookie is set at login and sent automatically, and the desktop window, where
// the same cookie is set against the loopback server. No second scheme is
// needed — these helpers just read what the middleware left behind, with the
// type conversion in one place instead of in every handler.

// ContextUserID is the key AuthMiddleware stores the authenticated user under.
const ContextUserID = "user_id"

// ContextUserRole is the key RoleMiddleware stores the user's role under.
const ContextUserRole = "user_role"

// UserID returns the authenticated user's id.
//
// The middleware stores a uint, but the models use int for user ids, so the
// conversion happens here rather than being repeated — and mistyped — in each
// handler. An error means the route was reached without authentication, which
// is a routing mistake rather than a client mistake.
func UserID(c *gin.Context) (int, error) {
	raw, ok := c.Get(ContextUserID)
	if !ok {
		return 0, Unauthorized("Authentication required")
	}

	switch v := raw.(type) {
	case uint:
		return int(v), nil
	case int:
		return v, nil
	case float64: // A JWT claim that reached the context unconverted
		return int(v), nil
	default:
		return 0, Unauthorized("Authentication required")
	}
}

// UserRole returns the authenticated user's role, and whether one was set.
// Role is absent on routes that authenticate but do not apply RoleMiddleware.
func UserRole(c *gin.Context) (string, bool) {
	raw, ok := c.Get(ContextUserRole)
	if !ok {
		return "", false
	}

	role, ok := raw.(string)
	return role, ok
}

// IsManager reports whether the caller holds the manager role.
func IsManager(c *gin.Context) bool {
	role, ok := UserRole(c)
	return ok && role == "manager"
}
