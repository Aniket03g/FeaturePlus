package middleware

import (
	"bytes"
	"fmt"
	"io"
	"time"

	"github.com/gin-gonic/gin"
)

type responseWriter struct {
	gin.ResponseWriter
	body *bytes.Buffer
}

func (w responseWriter) Write(b []byte) (int, error) {
	w.body.Write(b)
	return w.ResponseWriter.Write(b)
}

// LoggingMiddleware logs the incoming HTTP request and its duration.
func LoggingMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		// Start timer
		start := time.Now()

		// Read the request body
		var requestBody []byte
		if c.Request.Body != nil {
			requestBody, _ = io.ReadAll(c.Request.Body)
			// Restore the request body
			c.Request.Body = io.NopCloser(bytes.NewBuffer(requestBody))
		}

		// Create a buffer for the response body
		w := &responseWriter{body: &bytes.Buffer{}, ResponseWriter: c.Writer}
		c.Writer = w

		// Process request
		c.Next()

		// Log request and response details
		duration := time.Since(start)
		fmt.Printf("\n--- API Request Log ---\n")
		fmt.Printf("Timestamp: %v\n", time.Now().Format(time.RFC3339))
		fmt.Printf("Duration: %v\n", duration)
		fmt.Printf("Method: %v\n", c.Request.Method)
		fmt.Printf("Path: %v\n", c.Request.URL.Path)
		fmt.Printf("Query: %v\n", c.Request.URL.RawQuery)
		fmt.Printf("Status: %v\n", c.Writer.Status())
		fmt.Printf("Request Headers: %v\n", c.Request.Header)
		if len(requestBody) > 0 {
			fmt.Printf("Request Body: %s\n", string(requestBody))
		}
		if w.body.Len() > 0 {
			fmt.Printf("Response Body: %s\n", w.body.String())
		}
		fmt.Printf("------------------------\n")
	}
}
