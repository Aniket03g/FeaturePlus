package api

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

type sample struct {
	Name  string `json:"name" binding:"required,min=2,max=10"`
	Email string `json:"email" binding:"omitempty,email"`
	Count int    `json:"count"`
}

// bindBody runs Bind against a request body and returns the resulting error.
func bindBody(t *testing.T, body string) error {
	t.Helper()

	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/", bytes.NewBufferString(body))
	c.Request.Header.Set("Content-Type", "application/json")

	var dst sample
	return Bind(c, &dst)
}

func TestBindAcceptsAValidBody(t *testing.T) {
	if err := bindBody(t, `{"name":"Hiking","email":"a@b.com","count":3}`); err != nil {
		t.Fatalf("valid body was rejected: %v", err)
	}
}

// TestBindProducesFieldMessages is the point of Bind: a form needs a message
// it can show under an input, not validator's internal debugging prose.
func TestBindProducesFieldMessages(t *testing.T) {
	err := bindBody(t, `{"email":"not-an-email"}`)
	if err == nil {
		t.Fatal("invalid body was accepted")
	}

	apiErr := AsError(err)
	if apiErr.Code != CodeValidation {
		t.Fatalf("code = %q, want %q", apiErr.Code, CodeValidation)
	}

	// Keys must be the JSON names the client sent, not the Go field names.
	if got := apiErr.Fields["name"]; got != "This field is required" {
		t.Errorf("fields[name] = %q, want %q", got, "This field is required")
	}
	if got := apiErr.Fields["email"]; got != "Must be a valid email address" {
		t.Errorf("fields[email] = %q, want %q", got, "Must be a valid email address")
	}

	// The raw validator string must not survive into the response.
	for field, message := range apiErr.Fields {
		if bytes.Contains([]byte(message), []byte("Key:")) ||
			bytes.Contains([]byte(message), []byte("validation for")) {
			t.Errorf("fields[%s] leaked validator prose: %q", field, message)
		}
	}
}

func TestBindReportsLengthRules(t *testing.T) {
	err := bindBody(t, `{"name":"x"}`)
	if err == nil {
		t.Fatal("too-short name was accepted")
	}

	if got := AsError(err).Fields["name"]; got != "Must be at least 2 characters" {
		t.Errorf("fields[name] = %q, want a min-length message", got)
	}
}

func TestBindRejectsMalformedJSON(t *testing.T) {
	err := bindBody(t, `{"name": `)
	if err == nil {
		t.Fatal("malformed JSON was accepted")
	}

	if code := AsError(err).Code; code != CodeBadRequest {
		t.Errorf("code = %q, want %q", code, CodeBadRequest)
	}
}

func TestBindReportsTypeMismatch(t *testing.T) {
	err := bindBody(t, `{"name":"ok","count":"three"}`)
	if err == nil {
		t.Fatal("a string in a number field was accepted")
	}

	apiErr := AsError(err)
	if apiErr.Code != CodeValidation {
		t.Fatalf("code = %q, want %q", apiErr.Code, CodeValidation)
	}
	if apiErr.Fields["count"] == "" {
		t.Errorf("expected a message on the count field, got %v", apiErr.Fields)
	}
}

func TestBindRejectsEmptyBody(t *testing.T) {
	err := bindBody(t, ``)
	if err == nil {
		t.Fatal("an empty body was accepted")
	}

	if code := AsError(err).Code; code != CodeBadRequest {
		t.Errorf("code = %q, want %q", code, CodeBadRequest)
	}
}

// TestInternalErrorHidesItsCause checks a database failure cannot reach the
// client as a message, while remaining available server-side for logging.
func TestInternalErrorHidesItsCause(t *testing.T) {
	cause := errString("pq: relation \"secret_table\" does not exist")
	err := Internal(cause)

	if err.Message == cause.Error() {
		t.Error("the internal message repeats the cause")
	}
	if err.Message != "An internal error occurred" {
		t.Errorf("message = %q, want the fixed generic message", err.Message)
	}
	if err.Unwrap() != cause {
		t.Error("the cause is not retrievable for logging")
	}
}

func TestPageDefaultsAndCaps(t *testing.T) {
	gin.SetMode(gin.TestMode)

	tests := []struct {
		query       string
		wantPage    int
		wantPerPage int
	}{
		{"", 1, DefaultPerPage},
		{"?page=3&per_page=10", 3, 10},
		{"?per_page=99999", 1, MaxPerPage},
		{"?page=0", 1, DefaultPerPage},
		{"?page=-5", 1, DefaultPerPage},
		{"?page=abc", 1, DefaultPerPage},
		{"?per_page=0", 1, DefaultPerPage},
	}

	for _, tc := range tests {
		t.Run(tc.query, func(t *testing.T) {
			c, _ := gin.CreateTestContext(httptest.NewRecorder())
			c.Request = httptest.NewRequest(http.MethodGet, "/"+tc.query, nil)

			p := ParsePage(c)
			if p.Number != tc.wantPage || p.PerPage != tc.wantPerPage {
				t.Errorf("got page %d per_page %d, want %d and %d",
					p.Number, p.PerPage, tc.wantPage, tc.wantPerPage)
			}
		})
	}
}

func TestSliceHandlesOutOfRangePages(t *testing.T) {
	items := []int{1, 2, 3, 4, 5}

	if got := Slice(items, Page{Number: 2, PerPage: 3}); len(got) != 2 {
		t.Errorf("last partial page returned %d items, want 2", len(got))
	}
	if got := Slice(items, Page{Number: 99, PerPage: 3}); len(got) != 0 {
		t.Errorf("page past the end returned %d items, want 0", len(got))
	}
}

func TestMetaTotalPages(t *testing.T) {
	tests := []struct {
		total   int64
		perPage int
		want    int
	}{
		{0, 10, 0},
		{1, 10, 1},
		{10, 10, 1},
		{11, 10, 2},
		{100, 7, 15},
	}

	for _, tc := range tests {
		p := Page{Number: 1, PerPage: tc.perPage}
		if got := p.Meta(tc.total).TotalPages; got != tc.want {
			t.Errorf("total %d per_page %d: total_pages = %d, want %d",
				tc.total, tc.perPage, got, tc.want)
		}
	}
}

type errString string

func (e errString) Error() string { return string(e) }
