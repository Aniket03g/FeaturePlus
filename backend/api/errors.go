// Package api holds the shape of the JSON API: how a response is enveloped,
// how an error is reported, and how a list is paginated. It is deliberately
// free of FeaturePlus domain types so that every resource package can depend on
// it without depending on each other.
package api

import (
	"errors"
	"net/http"

	"gorm.io/gorm"
)

// Code is a stable, machine-readable error identifier. Clients branch on these
// rather than on HTTP status or on message text, which is free to change.
type Code string

const (
	CodeBadRequest   Code = "bad_request"
	CodeValidation   Code = "validation_failed"
	CodeUnauthorized Code = "unauthorized"
	CodeForbidden    Code = "forbidden"
	CodeNotFound     Code = "not_found"
	CodeConflict     Code = "conflict"
	CodeInternal     Code = "internal_error"
)

// httpStatus maps each code to the status sent with it, so that a handler
// chooses a meaning and never a bare number.
var httpStatus = map[Code]int{
	CodeBadRequest:   http.StatusBadRequest,
	CodeValidation:   http.StatusUnprocessableEntity,
	CodeUnauthorized: http.StatusUnauthorized,
	CodeForbidden:    http.StatusForbidden,
	CodeNotFound:     http.StatusNotFound,
	CodeConflict:     http.StatusConflict,
	CodeInternal:     http.StatusInternalServerError,
}

// Error is an API-level failure. It carries what the client should be told,
// and separately the underlying cause, which is logged but never sent.
type Error struct {
	Code    Code              `json:"code"`
	Message string            `json:"message"`
	Fields  map[string]string `json:"fields,omitempty"`

	// cause is the wrapped error. It stays server-side: an internal failure
	// must not leak a database error string to the caller.
	cause error
}

func (e *Error) Error() string {
	if e.cause != nil {
		return string(e.Code) + ": " + e.Message + ": " + e.cause.Error()
	}
	return string(e.Code) + ": " + e.Message
}

func (e *Error) Unwrap() error { return e.cause }

// Status is the HTTP status this error is sent with.
func (e *Error) Status() int {
	if s, ok := httpStatus[e.Code]; ok {
		return s
	}
	return http.StatusInternalServerError
}

// WithCause attaches the underlying error for logging without changing what
// the client sees.
func (e *Error) WithCause(err error) *Error {
	e.cause = err
	return e
}

// WithField records a per-field validation message.
func (e *Error) WithField(name, message string) *Error {
	if e.Fields == nil {
		e.Fields = map[string]string{}
	}
	e.Fields[name] = message
	return e
}

// Constructors. Each states the meaning; the status follows from the code.

func BadRequest(message string) *Error {
	return &Error{Code: CodeBadRequest, Message: message}
}

func Validation(message string) *Error {
	return &Error{Code: CodeValidation, Message: message}
}

func Unauthorized(message string) *Error {
	return &Error{Code: CodeUnauthorized, Message: message}
}

func Forbidden(message string) *Error {
	return &Error{Code: CodeForbidden, Message: message}
}

func NotFound(resource string) *Error {
	return &Error{Code: CodeNotFound, Message: resource + " not found"}
}

func Conflict(message string) *Error {
	return &Error{Code: CodeConflict, Message: message}
}

// Internal reports a server-side failure. The message sent to the client is
// fixed and generic; the real cause travels in the wrapped error, is logged,
// and never reaches the response.
func Internal(err error) *Error {
	return &Error{
		Code:    CodeInternal,
		Message: "An internal error occurred",
		cause:   err,
	}
}

// FromDB converts a GORM error into an API error, so that handlers do not each
// re-derive that a missing row is a 404. resource names the thing being looked
// for, and appears in the message.
func FromDB(err error, resource string) *Error {
	switch {
	case err == nil:
		return nil
	case errors.Is(err, gorm.ErrRecordNotFound):
		return NotFound(resource)
	case errors.Is(err, gorm.ErrDuplicatedKey):
		return Conflict(resource + " already exists")
	default:
		return Internal(err)
	}
}

// AsError extracts an *Error from err, or wraps it as an internal error. This
// lets a handler return whatever error it has and still produce a correct
// response.
func AsError(err error) *Error {
	var apiErr *Error
	if errors.As(err, &apiErr) {
		return apiErr
	}
	return Internal(err)
}
