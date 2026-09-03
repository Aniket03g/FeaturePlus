package app

import (
	"net/http"
	"strings"

	"github.com/FeaturePlus/backend/database"
	"github.com/FeaturePlus/backend/handlers"
	"github.com/FeaturePlus/backend/models"
	"github.com/FeaturePlus/backend/repositories"
	"github.com/gin-gonic/gin"
)

// ShellHandler renders the htmx app shell and the fragments that are not owned
// by a resource handler. It was AppHandler in main.go; the name changed only to
// avoid reading as "the handler for the app package".
type ShellHandler struct {
	db          *database.Database
	projectRepo *repositories.ProjectRepository
}

// NewShellHandler creates a shell handler with database access.
func NewShellHandler(db *database.Database) *ShellHandler {
	return &ShellHandler{
		db:          db,
		projectRepo: repositories.NewProjectRepository(db.DB),
	}
}

// RenderAppShell renders dashboard.html and passes the initial fragment URL for
// the requested path, so htmx can load the right panel on first paint.
func (h *ShellHandler) RenderAppShell(c *gin.Context) {
	path := strings.TrimPrefix(c.Request.URL.Path, "/web")
	parts := strings.Split(path, "/")

	fragment := "/web/fragments/projects"
	switch {
	case path == "/dashboard":
		fragment = "/web/fragments/dashboard-status"
	case path == "/projects":
		fragment = "/web/fragments/projects"
	case strings.HasPrefix(path, "/projects/") && strings.HasSuffix(path, "/features"):
		// /projects/8/features -> /web/projects/8/features/content
		if len(parts) >= 4 {
			fragment = "/web/projects/" + parts[2] + "/features/content"
		}
	case strings.HasPrefix(path, "/projects/") && strings.Contains(path, "/features/"):
		// /projects/8/features/33 -> /web/fragments/features/33
		if len(parts) >= 5 {
			fragment = "/web/fragments/features/" + parts[4]
		}
	case strings.HasPrefix(path, "/projects/"):
		// /projects/8 -> /web/fragments/projects/8
		if len(parts) >= 3 {
			fragment = "/web/fragments/projects/" + parts[2]
		}
	}

	userID, _ := c.Get("user_id")
	userRole, _ := c.Get("user_role")
	currentUser := map[string]interface{}{
		"ID":   userID,
		"Role": userRole,
	}

	var projects []models.Project
	h.db.DB.Find(&projects)

	c.HTML(http.StatusOK, "dashboard.html", gin.H{
		"InitialURL":  fragment,
		"CurrentUser": currentUser,
		"Projects":    projects,
	})
}

// DashboardStatusFragment renders the logged-in status strip.
//
// This is a method on ShellHandler so it uses the application's existing
// database connection. It previously called database.InitDB() on every request,
// which opened a fresh SQLite handle per hit and — once the database path
// became configurable — would have opened a different file than the rest of the
// application was using.
func (h *ShellHandler) DashboardStatusFragment(c *gin.Context) {
	userID, loggedIn := c.Get("user_id")
	userRole, hasRole := c.Get("user_role")

	currentUser := map[string]interface{}{
		"ID":        userID,
		"Role":      userRole,
		"IsManager": userRole == "manager",
	}

	username := "test1" // Fallback for an unauthenticated view
	if loggedIn {
		var user models.User
		if err := h.db.DB.First(&user, userID).Error; err == nil {
			username = user.Username
		}
	}

	c.HTML(http.StatusOK, "dashboard-status.html", gin.H{
		"LoggedIn":    loggedIn,
		"CurrentUser": currentUser,
		"HasRole":     hasRole,
		"Username":    username,
	})
}

// LoginPageHandler renders the login page.
func LoginPageHandler(c *gin.Context) {
	c.HTML(http.StatusOK, "login.html", nil)
}

// FeaturesByTagFragment renders the feature list filtered by a tag name.
func FeaturesByTagFragment(featureHandler *handlers.FeatureHandler) gin.HandlerFunc {
	return func(c *gin.Context) {
		tag := c.Query("tag")
		empty := gin.H{"Features": []interface{}{}, "TagFilter": tag}

		if tag == "" {
			c.HTML(http.StatusOK, "feature-list.html", empty)
			return
		}

		features, err := featureHandler.GetFeaturesByTagName(tag)
		if err != nil || len(features) == 0 {
			c.HTML(http.StatusOK, "feature-list.html", empty)
			return
		}

		c.HTML(http.StatusOK, "feature-list.html", gin.H{"Features": features, "TagFilter": tag})
	}
}
