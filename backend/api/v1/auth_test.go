package v1

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/FeaturePlus/backend/api"
	"github.com/FeaturePlus/backend/models"
	"github.com/FeaturePlus/backend/utils"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// realAuthRouter mounts the group with the actual auth middleware, rather than
// the stub used by the handler tests, so token handling is covered too.
func realAuthRouter(t *testing.T, db *gorm.DB) *gin.Engine {
	t.Helper()

	gin.SetMode(gin.TestMode)
	r := gin.New()
	// No files store and no data directories: those routes answer "nothing
	// here", which is what this test's subject — authentication — needs.
	Register(r, db, Deps{})
	return r
}

// TestAuthFailuresUseTheErrorEnvelope is the reason this middleware exists.
//
// The shared AuthMiddleware answers with {"code":..,"error":"string"} and
// RoleMiddleware with {"error":"string"}, neither of which matches the
// envelope every other v1 response uses. A client reading error.code would
// break on precisely the responses it most needs to handle.
func TestAuthFailuresUseTheErrorEnvelope(t *testing.T) {
	db := newTestDB(t)
	seed(t, db)
	r := realAuthRouter(t, db)

	cases := []struct {
		name   string
		header string
		cookie string
	}{
		{name: "no credentials"},
		{name: "malformed header", header: "NotBearer xyz"},
		{name: "garbage bearer token", header: "Bearer not-a-jwt"},
		{name: "garbage cookie", cookie: "not-a-jwt"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/api/v1/projects", nil)
			if tc.header != "" {
				req.Header.Set("Authorization", tc.header)
			}
			if tc.cookie != "" {
				req.AddCookie(&http.Cookie{Name: "token", Value: tc.cookie})
			}

			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)

			if w.Code != http.StatusUnauthorized {
				t.Fatalf("status %d, want 401: %s", w.Code, w.Body.String())
			}

			// The envelope must nest the error, so error.code is readable.
			var out struct {
				Error struct {
					Code    string `json:"code"`
					Message string `json:"message"`
				} `json:"error"`
			}
			if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
				t.Fatalf("response was not the error envelope: %v (%s)", err, w.Body.String())
			}
			if out.Error.Code != string(api.CodeUnauthorized) {
				t.Errorf("error.code = %q, want %q (body: %s)",
					out.Error.Code, api.CodeUnauthorized, w.Body.String())
			}
			if out.Error.Message == "" {
				t.Error("error.message was empty")
			}
		})
	}
}

func TestValidTokenIsAccepted(t *testing.T) {
	db := newTestDB(t)
	owner, _, _ := seed(t, db)
	r := realAuthRouter(t, db)

	token, err := utils.GenerateJWT(owner.ID)
	if err != nil {
		t.Fatalf("GenerateJWT: %v", err)
	}

	t.Run("via Authorization header", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/projects", nil)
		req.Header.Set("Authorization", "Bearer "+token)

		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("status %d, want 200: %s", w.Code, w.Body.String())
		}
	})

	// The desktop window relies on the cookie path just as the browser does.
	t.Run("via token cookie", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/projects", nil)
		req.AddCookie(&http.Cookie{Name: "token", Value: token})

		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("status %d, want 200: %s", w.Code, w.Body.String())
		}
	})
}

// TestTokenForDeletedUserIsRejected covers a token that is still correctly
// signed but names an account that has since been removed.
func TestTokenForDeletedUserIsRejected(t *testing.T) {
	db := newTestDB(t)
	owner, _, _ := seed(t, db)
	r := realAuthRouter(t, db)

	token, err := utils.GenerateJWT(owner.ID)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Unscoped().Delete(&models.User{}, owner.ID).Error; err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/v1/projects", nil)
	req.Header.Set("Authorization", "Bearer "+token)

	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("status %d, want 401: %s", w.Code, w.Body.String())
	}
}

func TestMeReturnsTheCallerWithoutPassword(t *testing.T) {
	db := newTestDB(t)
	owner, _, _ := seed(t, db)
	r := realAuthRouter(t, db)

	token, err := utils.GenerateJWT(owner.ID)
	if err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/v1/me", nil)
	req.Header.Set("Authorization", "Bearer "+token)

	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status %d, want 200: %s", w.Code, w.Body.String())
	}

	var out struct {
		Data UserDTO `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode: %v (%s)", err, w.Body.String())
	}
	if out.Data.ID != owner.ID {
		t.Errorf("id = %d, want %d", out.Data.ID, owner.ID)
	}
	if out.Data.Username != owner.Username {
		t.Errorf("username = %q, want %q", out.Data.Username, owner.Username)
	}
	if body := w.Body.String(); containsAny(body, "$2a$", "$2b$", "password") {
		t.Errorf("/me leaked credential material: %s", body)
	}
}

// TestHealthIsPublic covers the one route that must answer before login, so a
// desktop window can tell when its server has finished starting.
func TestHealthIsPublic(t *testing.T) {
	db := newTestDB(t)
	r := realAuthRouter(t, db)

	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/v1/health", nil))

	if w.Code != http.StatusOK {
		t.Fatalf("status %d, want 200: %s", w.Code, w.Body.String())
	}
}

// TestUnknownEndpointUsesTheErrorEnvelope keeps a 404 parseable. Gin's default
// is plain text, which a JSON client cannot read.
func TestUnknownEndpointUsesTheErrorEnvelope(t *testing.T) {
	db := newTestDB(t)
	r := realAuthRouter(t, db)

	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/v1/does-not-exist", nil))

	if w.Code != http.StatusNotFound {
		t.Fatalf("status %d, want 404", w.Code)
	}

	var out struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatalf("404 was not the error envelope: %v (%s)", err, w.Body.String())
	}
	if out.Error.Code != string(api.CodeNotFound) {
		t.Errorf("error.code = %q, want %q", out.Error.Code, api.CodeNotFound)
	}
}

// TestNotFoundLeavesNonAPIPathsAlone checks the engine-wide NoRoute handler
// did not change what the htmx site returns for an unknown page.
func TestNotFoundLeavesNonAPIPathsAlone(t *testing.T) {
	db := newTestDB(t)
	r := realAuthRouter(t, db)

	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/web/nope", nil))

	if w.Code != http.StatusNotFound {
		t.Fatalf("status %d, want 404", w.Code)
	}

	// Gin fills in its own plain-text body when a NoRoute handler writes none,
	// which is what the htmx site returned before this handler existed. What
	// matters is that a non-API path does not get the JSON envelope.
	if body := w.Body.String(); containsAny(body, `"error":{`) {
		t.Errorf("non-API 404 should not carry the API envelope, got: %s", body)
	}
}

func containsAny(s string, needles ...string) bool {
	for _, n := range needles {
		if len(n) > 0 && len(s) >= len(n) {
			for i := 0; i+len(n) <= len(s); i++ {
				if s[i:i+len(n)] == n {
					return true
				}
			}
		}
	}
	return false
}
