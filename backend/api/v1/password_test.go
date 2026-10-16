package v1

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"

	"github.com/FeaturePlus/backend/models"
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

func TestAdminResetsSomeonesPassword(t *testing.T) {
	db := newTestDB(t)
	r := realAuthRouter(t, db)

	w := do(r, http.MethodPost, "/api/v1/auth/signup", `{"name":"Admin","email":"admin@x.io","password":"admin-password"}`)
	adminSession := decodeSession(t, w.Body.Bytes())
	w = do(r, http.MethodPost, "/api/v1/auth/signup", `{"name":"B","email":"b@x.io","password":"forgotten-one"}`)
	other := decodeSession(t, w.Body.Bytes())
	// The role is read from the database on every request, so the token
	// issued at sign-up becomes an admin's straight away.
	db.Model(&models.User{}).Where("id = ?", adminSession.User.ID).Update("role", "admin")

	path := "/api/v1/users/" + strconv.Itoa(other.User.ID) + "/password"
	w = doAuthed(r, adminSession.Token, http.MethodPost, path, `{"new_password":"temporary-1"}`)
	if w.Code != http.StatusNoContent {
		t.Fatalf("status %d, want 204: %s", w.Code, w.Body.String())
	}

	if w = do(r, http.MethodPost, "/api/v1/auth/login", `{"email":"b@x.io","password":"temporary-1"}`); w.Code != http.StatusOK {
		t.Errorf("new password: status %d, want 200", w.Code)
	}
	if w = do(r, http.MethodPost, "/api/v1/auth/login", `{"email":"b@x.io","password":"forgotten-one"}`); w.Code != http.StatusUnauthorized {
		t.Errorf("old password: status %d, want 401", w.Code)
	}
}

func TestResetPasswordRefusals(t *testing.T) {
	db := newTestDB(t)
	r := realAuthRouter(t, db)

	w := do(r, http.MethodPost, "/api/v1/auth/signup", `{"name":"Admin","email":"admin@x.io","password":"admin-password"}`)
	admin := decodeSession(t, w.Body.Bytes())
	w = do(r, http.MethodPost, "/api/v1/auth/signup", `{"name":"B","email":"b@x.io","password":"b-password"}`)
	other := decodeSession(t, w.Body.Bytes())
	db.Model(&models.User{}).Where("id = ?", admin.User.ID).Update("role", "admin")

	adminPath := "/api/v1/users/" + strconv.Itoa(admin.User.ID) + "/password"
	otherPath := "/api/v1/users/" + strconv.Itoa(other.User.ID) + "/password"

	// A non-admin cannot reset anyone, not even to take over the admin.
	if w = doAuthed(r, other.Token, http.MethodPost, adminPath, `{"new_password":"taken-over"}`); w.Code != http.StatusForbidden {
		t.Errorf("non-admin: status %d, want 403", w.Code)
	}
	// An admin's own password goes through /me/password, which asks for it.
	if w = doAuthed(r, admin.Token, http.MethodPost, adminPath, `{"new_password":"no-check-1"}`); w.Code != http.StatusConflict {
		t.Errorf("own account: status %d, want 409", w.Code)
	}
	// Same length rule as sign-up.
	w = doAuthed(r, admin.Token, http.MethodPost, otherPath, `{"new_password":"short"}`)
	if w.Code != http.StatusUnprocessableEntity && w.Code != http.StatusBadRequest {
		t.Errorf("short password: status %d, want a validation failure", w.Code)
	}
	assertFieldError(t, w.Body.Bytes(), "new_password")
	// Nobody to reset.
	if w = doAuthed(r, admin.Token, http.MethodPost, "/api/v1/users/9999/password", `{"new_password":"temporary-1"}`); w.Code != http.StatusNotFound {
		t.Errorf("missing user: status %d, want 404", w.Code)
	}

	// None of the refusals changed anything.
	if w = do(r, http.MethodPost, "/api/v1/auth/login", `{"email":"admin@x.io","password":"admin-password"}`); w.Code != http.StatusOK {
		t.Errorf("admin password after refusals: status %d, want 200", w.Code)
	}
	if w = do(r, http.MethodPost, "/api/v1/auth/login", `{"email":"b@x.io","password":"b-password"}`); w.Code != http.StatusOK {
		t.Errorf("other password after refusals: status %d, want 200", w.Code)
	}
}
