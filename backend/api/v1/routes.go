package v1

import (
	"net/http"
	"strings"

	"github.com/FeaturePlus/backend/api"
	"github.com/FeaturePlus/backend/models"
	"github.com/FeaturePlus/backend/repositories"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// Register mounts /api/v1 onto the router.
//
// Everything but the health check runs behind requireAuth, which accepts a JWT
// from either the Authorization header or the token cookie and resolves the
// caller's role. Only the health route is public.
func Register(router *gin.Engine, db *gorm.DB) {
	v1 := router.Group("/api/v1")

	// Public: lets a client check the API is reachable before authenticating,
	// which the desktop window needs while waiting for its server to come up.
	v1.GET("/health", func(c *gin.Context) {
		api.OK(c, gin.H{"status": "ok", "version": "v1"})
	})

	authed := v1.Group("", requireAuth(db))

	authed.GET("/me", meHandler(db))

	NewProjectsHandler(repositories.NewProjectRepository(db), db).Register(authed)

	registerNotFound(router)
}

// meHandler returns the authenticated user, which is how the frontend learns
// who it is after a page reload — the JWT lives in an HttpOnly cookie that
// JavaScript cannot read.
func meHandler(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID, err := api.UserID(c)
		if err != nil {
			api.Fail(c, err)
			return
		}

		var user models.User
		if dbErr := db.First(&user, userID).Error; dbErr != nil {
			api.Fail(c, api.FromDB(dbErr, "User"))
			return
		}

		api.OK(c, NewUserDTO(user))
	}
}

// registerNotFound makes unmatched /api/v1 paths answer with the API's own
// error envelope. Gin's default 404 is plain text, which gives a JSON client a
// parse error instead of a readable failure.
//
// This has to hang off the engine's NoRoute rather than a catch-all inside the
// group: Gin's router rejects a wildcard that sits beside a static segment, so
// registering "/*any" alongside "/projects" panics at startup.
func registerNotFound(router *gin.Engine) {
	router.NoRoute(func(c *gin.Context) {
		if !strings.HasPrefix(c.Request.URL.Path, "/api/v1") {
			// Leave every other path to the existing behaviour.
			c.Status(http.StatusNotFound)
			return
		}

		api.Fail(c, api.NotFound("Endpoint "+c.Request.Method+" "+c.Request.URL.Path))
	})
}

// lower and contains are tiny wrappers so the search helpers in this package
// read the same way regardless of which string package they came from.
func lower(s string) string { return strings.ToLower(s) }

func contains(haystack, needle string) bool { return strings.Contains(haystack, needle) }
