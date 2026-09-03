package api

import (
	"encoding/json"
	"errors"
	"io"
	"reflect"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/go-playground/validator/v10"
)

// Bind reads and validates a JSON request body into dst.
//
// It exists so that a failed binding produces something a form can display.
// Gin's raw output is validator's own prose — "Key: 'CreateProjectRequest.Name'
// Error:Field validation for 'Name' failed on the 'required' tag" — which is a
// debugging string, not a message to put under an input. Bind turns that into
// per-field entries keyed by the JSON field name.
func Bind(c *gin.Context, dst any) error {
	err := c.ShouldBindJSON(dst)
	if err == nil {
		return nil
	}

	apiErr := Validation("The request body is not valid").WithCause(err)

	// A body that is not JSON at all, or has a value of the wrong type, never
	// reaches validation. Report it as the syntax problem it is.
	//
	// A truncated body surfaces as io.ErrUnexpectedEOF rather than a
	// json.SyntaxError, and an absent one as io.EOF, so all three are handled
	// together before anything else is attempted.
	var syntaxErr *json.SyntaxError
	switch {
	case errors.Is(err, io.EOF):
		return BadRequest("A request body is required").WithCause(err)
	case errors.Is(err, io.ErrUnexpectedEOF):
		return BadRequest("The request body is not valid JSON: it ends unexpectedly").WithCause(err)
	case errors.As(err, &syntaxErr):
		return BadRequest("The request body is not valid JSON").WithCause(err)
	}

	var typeErr *json.UnmarshalTypeError
	if errors.As(err, &typeErr) {
		return apiErr.WithField(typeErr.Field,
			"Expected "+friendlyType(typeErr.Type.String())+
				", received "+friendlyType(typeErr.Value))
	}

	var validationErrs validator.ValidationErrors
	if errors.As(err, &validationErrs) {
		for _, fieldErr := range validationErrs {
			apiErr.WithField(jsonFieldName(dst, fieldErr.Field()), describeRule(fieldErr))
		}
		return apiErr
	}

	return apiErr
}

// describeRule renders one failed validation rule as a sentence.
func describeRule(fe validator.FieldError) string {
	switch fe.Tag() {
	case "required":
		return "This field is required"
	case "min":
		if fe.Kind().String() == "string" {
			return "Must be at least " + fe.Param() + " characters"
		}
		return "Must be at least " + fe.Param()
	case "max":
		if fe.Kind().String() == "string" {
			return "Must be at most " + fe.Param() + " characters"
		}
		return "Must be at most " + fe.Param()
	case "email":
		return "Must be a valid email address"
	case "url":
		return "Must be a valid URL"
	case "oneof":
		return "Must be one of: " + strings.ReplaceAll(fe.Param(), " ", ", ")
	case "gt":
		return "Must be greater than " + fe.Param()
	case "gte":
		return "Must be " + fe.Param() + " or more"
	case "lt":
		return "Must be less than " + fe.Param()
	case "lte":
		return "Must be " + fe.Param() + " or less"
	default:
		return "Failed the " + fe.Tag() + " rule"
	}
}

// jsonFieldName maps a Go struct field name back to the JSON name a client
// sent, so the error keys match the request rather than the Go type. It falls
// back to a lowercased field name when no tag is found.
func jsonFieldName(dst any, structField string) string {
	t := reflect.TypeOf(dst)
	for t != nil && t.Kind() == reflect.Ptr {
		t = t.Elem()
	}

	if t != nil && t.Kind() == reflect.Struct {
		if field, ok := t.FieldByName(structField); ok {
			tag := field.Tag.Get("json")
			if name := strings.Split(tag, ",")[0]; name != "" && name != "-" {
				return name
			}
		}
	}

	return strings.ToLower(structField)
}

// friendlyType renders a Go type name in terms a client would recognise.
func friendlyType(goType string) string {
	switch {
	case strings.HasPrefix(goType, "int"), strings.HasPrefix(goType, "uint"),
		strings.HasPrefix(goType, "float"):
		return "a number"
	case goType == "string":
		return "text"
	case goType == "bool":
		return "true or false"
	case strings.HasPrefix(goType, "[]"):
		return "a list"
	case strings.HasPrefix(goType, "map"):
		return "an object"
	default:
		return goType
	}
}

// QueryInt reads an optional integer query parameter, returning fallback when
// it is absent and an error when it is present but unparseable.
func QueryInt(c *gin.Context, name string, fallback int) (int, error) {
	raw := c.Query(name)
	if raw == "" {
		return fallback, nil
	}

	n, err := strconv.Atoi(raw)
	if err != nil {
		return 0, BadRequest("Invalid " + name + ": expected a number").WithCause(err)
	}

	return n, nil
}
