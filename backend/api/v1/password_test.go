package v1

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

// doAuthed sends a request carrying a bearer token, the way the CLI does.
func doAuthed(r *gin.Engine, token, method, path, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

func TestChangePasswordSwapsWhichPasswordSignsIn(t *testing.T) {
	db := newTestDB(t)
	r := realAuthRouter(t, db)

	w := do(r, http.MethodPost, "/api/v1/auth/signup", `{"name":"A","email":"a@x.io","password":"old-password"}`)
	token := decodeSession(t, w.Body.Bytes()).Token

	w = doAuthed(r, token, http.MethodPost, "/api/v1/me/password",
		`{"current_password":"old-password","new_password":"new-password"}`)
	if w.Code != http.StatusNoContent {
		t.Fatalf("status %d, want 204: %s", w.Code, w.Body.String())
	}

	if w = do(r, http.MethodPost, "/api/v1/auth/login", `{"email":"a@x.io","password":"new-password"}`); w.Code != http.StatusOK {
		t.Errorf("new password: status %d, want 200", w.Code)
	}
	if w = do(r, http.MethodPost, "/api/v1/auth/login", `{"email":"a@x.io","password":"old-password"}`); w.Code != http.StatusUnauthorized {
		t.Errorf("old password: status %d, want 401", w.Code)
	}
}

func TestChangePasswordRefusals(t *testing.T) {
	db := newTestDB(t)
	r := realAuthRouter(t, db)

	w := do(r, http.MethodPost, "/api/v1/auth/signup", `{"name":"A","email":"a@x.io","password":"old-password"}`)
	token := decodeSession(t, w.Body.Bytes()).Token

	cases := []struct {
		name, body, field string
	}{
		// Not a 401: that would make the frontend sign the person out.
		{"wrong current password", `{"current_password":"guess-guess","new_password":"new-password"}`, "current_password"},
		{"new password too short", `{"current_password":"old-password","new_password":"short"}`, "new_password"},
		{"new password same as old", `{"current_password":"old-password","new_password":"old-password"}`, "new_password"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			w := doAuthed(r, token, http.MethodPost, "/api/v1/me/password", tc.body)
			if w.Code != http.StatusUnprocessableEntity && w.Code != http.StatusBadRequest {
				t.Fatalf("status %d, want a validation failure: %s", w.Code, w.Body.String())
			}
			assertFieldError(t, w.Body.Bytes(), tc.field)
		})
	}

	// None of the refusals changed anything.
	if w = do(r, http.MethodPost, "/api/v1/auth/login", `{"email":"a@x.io","password":"old-password"}`); w.Code != http.StatusOK {
		t.Errorf("old password after refusals: status %d, want 200", w.Code)
	}

	// Signed-out callers are turned away.
	if w = do(r, http.MethodPost, "/api/v1/me/password", `{"current_password":"old-password","new_password":"new-password"}`); w.Code != http.StatusUnauthorized {
		t.Errorf("no session: status %d, want 401", w.Code)
	}
}
