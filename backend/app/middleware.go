package app

import (
	"bytes"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/FeaturePlus/backend/internal/log"
	"github.com/gin-gonic/gin"
	"github.com/sirupsen/logrus"
)

// LoggingMiddleware records one structured line per request.
func LoggingMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		path := c.Request.URL.Path
		raw := c.Request.URL.RawQuery

		c.Next()

		logFields := logrus.Fields{
			"method":      c.Request.Method,
			"path":        path,
			"status":      c.Writer.Status(),
			"duration_ms": time.Since(start).Milliseconds(),
			"ip":          c.ClientIP(),
		}
		if raw != "" {
			logFields["query"] = raw
		}

		log.WithFields(logFields).Info("HTTP request")
	}
}

// BodyLoggingMiddleware logs the request body for mutating requests, then
// restores it so later handlers can still read it.
func BodyLoggingMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		if c.Request.Method == "POST" || c.Request.Method == "PUT" || c.Request.Method == "PATCH" {
			bodyBytes, err := io.ReadAll(c.Request.Body)
			if err != nil {
				log.WithError(err).Error("Error reading request body")
			} else {
				log.WithField("body", string(bodyBytes)).Debug("Request Body")
			}
			c.Request.Body = io.NopCloser(bytes.NewBuffer(bodyBytes))
		}
		c.Next()
	}
}

// CORSMiddleware allows the local development origins and any Tailscale address.
func CORSMiddleware() gin.HandlerFunc {
	allowedOrigins := map[string]bool{
		"http://localhost:3000": true,
		"http://127.0.0.1:3000": true,
		"http://localhost:8080": true,
		"http://127.0.0.1:8080": true,
		"http://localhost:5173": true, // Vite dev server, for the React frontend
		"http://127.0.0.1:5173": true,
	}

	return func(c *gin.Context) {
		origin := c.Request.Header.Get("Origin")

		// Tailscale addresses are allowed dynamically rather than listed.
		isAllowed := allowedOrigins[origin] || strings.HasPrefix(origin, "http://100.")

		if isAllowed && origin != "" {
			c.Writer.Header().Set("Access-Control-Allow-Origin", origin)
			c.Writer.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, PATCH, OPTIONS")
			c.Writer.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
			c.Writer.Header().Set("Access-Control-Allow-Credentials", "true")
			c.Writer.Header().Set("Vary", "Origin")
		}

		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(http.StatusOK)
			return
		}

		c.Next()
	}
}

// FragmentHTMXGuard redirects non-HTMX requests for fragments to the app shell
// route that would have rendered them, so that pasting a fragment URL into the
// address bar lands somewhere sensible instead of returning a bare partial.
func FragmentHTMXGuard() gin.HandlerFunc {
	return func(c *gin.Context) {
		if c.GetHeader("HX-Request") == "true" {
			c.Next()
			return
		}

		path := c.Request.URL.Path
		parts := strings.Split(path, "/")

		switch {
		case strings.HasPrefix(path, "/web/fragments/projects/") && strings.HasSuffix(path, "/features"):
			// /web/fragments/projects/:id/features -> /web/projects/:id/features
			if len(parts) >= 6 {
				c.Redirect(http.StatusFound, "/web/projects/"+parts[4]+"/features")
				c.Abort()
				return
			}
		case strings.HasPrefix(path, "/web/fragments/features/"):
			// /web/fragments/features/:id -> /web/features/:id
			if len(parts) >= 5 {
				c.Redirect(http.StatusFound, "/web/features/"+parts[4])
				c.Abort()
				return
			}
		case strings.HasPrefix(path, "/web/fragments/projects/"):
			// /web/fragments/projects/:id -> /web/projects/:id
			if len(parts) >= 5 {
				c.Redirect(http.StatusFound, "/web/projects/"+parts[4])
				c.Abort()
				return
			}
		case path == "/web/fragments/projects":
			c.Redirect(http.StatusFound, "/web/projects")
			c.Abort()
			return
		}

		c.Redirect(http.StatusFound, "/web/dashboard")
		c.Abort()
	}
}
