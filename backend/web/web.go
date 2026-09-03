// Package web serves the React frontend from inside the Go binary.
//
// dist/ is produced by `npm run build` in ../../frontend and is committed, so
// that building the server needs only the Go toolchain — the Docker image and
// the desktop build both rely on that.
package web

import (
	"embed"
	"io/fs"
	"net/http"
	"path"
	"strings"

	"github.com/gin-gonic/gin"
)

// The all: prefix includes files whose names begin with _ or ., which Vite
// occasionally emits and which a bare embed would silently skip.
//
//go:embed all:dist
var distFS embed.FS

// MountPath is where the app is served, in development and once embedded.
// It matches Vite's `base` so asset URLs resolve identically either way.
const MountPath = "/app"

// Assets returns the built frontend as a filesystem rooted at dist/.
func Assets() (fs.FS, error) {
	return fs.Sub(distFS, "dist")
}

// Available reports whether a build is actually present. An empty dist/ with
// only a placeholder means the frontend was never built, and the server should
// say so rather than serve blank pages.
func Available() bool {
	entries, err := distFS.ReadDir("dist")
	if err != nil {
		return false
	}

	for _, entry := range entries {
		if entry.Name() == "index.html" {
			return true
		}
	}
	return false
}

// Mount serves the frontend at /app.
//
// Two behaviours matter. Hashed assets under assets/ are immutable — their
// name changes whenever their content does — so they are cached for a year,
// while index.html is never cached, or a browser would keep loading an old
// build that points at assets which no longer exist.
//
// Anything else under /app falls back to index.html, because the client router
// owns those paths: a reload on /app/projects must reach the app, not a 404.
func Mount(router *gin.Engine) error {
	assets, err := Assets()
	if err != nil {
		return err
	}

	fileServer := http.FileServer(http.FS(assets))

	handler := func(c *gin.Context) {
		requested := strings.TrimPrefix(c.Request.URL.Path, MountPath)
		requested = strings.TrimPrefix(requested, "/")

		if requested == "" || !fileExists(assets, requested) {
			serveIndex(c, assets)
			return
		}

		if strings.HasPrefix(requested, "assets/") {
			c.Header("Cache-Control", "public, max-age=31536000, immutable")
		} else {
			c.Header("Cache-Control", "no-cache")
		}

		c.Request.URL.Path = "/" + requested
		fileServer.ServeHTTP(c.Writer, c.Request)
	}

	// Redirect /app to /app/ so relative asset URLs resolve from the right base.
	router.GET(MountPath, func(c *gin.Context) {
		c.Redirect(http.StatusMovedPermanently, MountPath+"/")
	})
	router.GET(MountPath+"/*path", handler)
	router.HEAD(MountPath+"/*path", handler)

	return nil
}

// serveIndex writes index.html for a client-routed path.
func serveIndex(c *gin.Context, assets fs.FS) {
	index, err := fs.ReadFile(assets, "index.html")
	if err != nil {
		c.String(http.StatusInternalServerError,
			"The frontend has not been built. Run `npm run build` in frontend/.")
		return
	}

	c.Header("Cache-Control", "no-cache")
	c.Data(http.StatusOK, "text/html; charset=utf-8", index)
}

// fileExists reports whether name is a real file in the built assets.
func fileExists(assets fs.FS, name string) bool {
	if name == "" || strings.Contains(name, "..") {
		return false
	}

	info, err := fs.Stat(assets, path.Clean(name))
	return err == nil && !info.IsDir()
}
