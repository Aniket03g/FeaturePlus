package api

import (
	"net/http"

	"github.com/FeaturePlus/backend/internal/log"
	"github.com/gin-gonic/gin"
)

// Every response from /api/v1 has one of two shapes.
//
// Success:  {"data": <payload>}                       — single resource
//           {"data": [...], "meta": {...pagination}}   — collection
//
// Failure:  {"error": {"code": "...", "message": "...", "fields": {...}}}
//
// The envelope exists so a client can tell success from failure without
// inspecting the payload, and so pagination has somewhere to live that is not
// mixed in with the resource's own fields.

// envelope is the success wrapper.
type envelope struct {
	Data any   `json:"data"`
	Meta *Meta `json:"meta,omitempty"`
}

// errEnvelope is the failure wrapper.
type errEnvelope struct {
	Error *Error `json:"error"`
}

// Meta carries pagination for a collection response.
type Meta struct {
	Total      int64 `json:"total"`
	Page       int   `json:"page"`
	PerPage    int   `json:"per_page"`
	TotalPages int   `json:"total_pages"`
}

// OK sends a single resource with 200.
func OK(c *gin.Context, data any) {
	c.JSON(http.StatusOK, envelope{Data: data})
}

// Created sends a newly created resource with 201.
func Created(c *gin.Context, data any) {
	c.JSON(http.StatusCreated, envelope{Data: data})
}

// NoContent reports success with no body, for deletes.
func NoContent(c *gin.Context) {
	c.Status(http.StatusNoContent)
}

// List sends a collection with its pagination metadata.
//
// data must be a non-nil slice: a nil slice marshals to JSON null, which forces
// every client to null-check before iterating. Callers should pass an empty
// slice, and EmptyIfNil is provided for the cases where that is awkward.
func List(c *gin.Context, data any, meta Meta) {
	c.JSON(http.StatusOK, envelope{Data: data, Meta: &meta})
}

// Fail sends an error response. Any non-API error is treated as internal, and
// internal errors are logged with their cause while the client receives only
// the generic message.
func Fail(c *gin.Context, err error) {
	apiErr := AsError(err)

	if apiErr.Code == CodeInternal {
		log.WithError(apiErr.Unwrap()).WithFields(map[string]any{
			"path":   c.Request.URL.Path,
			"method": c.Request.Method,
		}).Error("API internal error")
	}

	c.AbortWithStatusJSON(apiErr.Status(), errEnvelope{Error: apiErr})
}

// EmptyIfNil returns an empty slice when items is nil, so a collection
// response is always a JSON array.
func EmptyIfNil[T any](items []T) []T {
	if items == nil {
		return []T{}
	}
	return items
}
