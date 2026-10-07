package v1

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/FeaturePlus/backend/models"
)

func decodeSession(t *testing.T, body []byte) SessionResponse {
	t.Helper()
	var env struct {
		Data SessionResponse `json:"data"`
	}
	if err := json.Unmarshal(body, &env); err != nil {
		t.Fatalf("decode: %v", err)
	}
	return env.Data
}

func TestSignupCreatesAnAccountAndSignsIn(t *testing.T) {
	db := newTestDB(t)
	r := realAuthRouter(t, db)

	w := do(r, http.MethodPost, "/api/v1/auth/signup",
		`{"name":"Asha Rao","email":"Asha@Example.com","password":"long-enough"}`)
	if w.Code != http.StatusCreated {
		t.Fatalf("status %d, want 201: %s", w.Code, w.Body.String())
	}
	if w.Result().Cookies() == nil || len(w.Result().Cookies()) == 0 {
		t.Fatal("no session cookie set")
	}

	session := decodeSession(t, w.Body.Bytes())
	if session.User.Email != "asha@example.com" {
		t.Errorf("email %q, want it lowercased", session.User.Email)
	}

	// The new account can sign in with what it signed up with, capitals and
	// all: the address is stored lowercased, so sign-in must ignore case too.
	for _, email := range []string{"asha@example.com", "Asha@Example.com"} {
		w = do(r, http.MethodPost, "/api/v1/auth/login", `{"email":"`+email+`","password":"long-enough"}`)
		if w.Code != http.StatusOK {
			t.Fatalf("login as %s: status %d: %s", email, w.Code, w.Body.String())
		}
	}
}

func TestSignupFirstAccountIsAdminThenDevelopers(t *testing.T) {
	db := newTestDB(t)
	r := realAuthRouter(t, db)

	first := do(r, http.MethodPost, "/api/v1/auth/signup", `{"name":"A","email":"a@x.io","password":"password1"}`)
	second := do(r, http.MethodPost, "/api/v1/auth/signup", `{"name":"B","email":"b@x.io","password":"password2","role":"manager"}`)

	if got := decodeSession(t, first.Body.Bytes()).User.Role; got != "admin" {
		t.Errorf("first account role %q, want admin", got)
	}
	// A role in the body is ignored.
	if got := decodeSession(t, second.Body.Bytes()).User.Role; got != "developer" {
		t.Errorf("second account role %q, want developer", got)
	}
}

func TestSignupRejectsDuplicateEmailAndShortPassword(t *testing.T) {
	db := newTestDB(t)
	seed(t, db) // owner@example.com exists
	r := realAuthRouter(t, db)

	w := do(r, http.MethodPost, "/api/v1/auth/signup", `{"name":"X","email":"OWNER@example.com","password":"password1"}`)
	if w.Code != http.StatusConflict {
		t.Errorf("duplicate email: status %d, want 409", w.Code)
	}
	assertFieldError(t, w.Body.Bytes(), "email")

	w = do(r, http.MethodPost, "/api/v1/auth/signup", `{"name":"X","email":"new@example.com","password":"short"}`)
	if w.Code != http.StatusUnprocessableEntity && w.Code != http.StatusBadRequest {
		t.Errorf("short password: status %d, want a validation failure", w.Code)
	}
	assertFieldError(t, w.Body.Bytes(), "password")
}

func TestSignupPicksAFreeUsername(t *testing.T) {
	db := newTestDB(t)
	seed(t, db) // username "owner" is taken
	r := realAuthRouter(t, db)

	w := do(r, http.MethodPost, "/api/v1/auth/signup", `{"name":"O","email":"owner@elsewhere.org","password":"password1"}`)
	if w.Code != http.StatusCreated {
		t.Fatalf("status %d: %s", w.Code, w.Body.String())
	}
	var user models.User
	db.Where("email = ?", "owner@elsewhere.org").First(&user)
	if user.Username != "owner2" {
		t.Errorf("username %q, want owner2", user.Username)
	}
}

func assertFieldError(t *testing.T, body []byte, field string) {
	t.Helper()
	var env struct {
		Error struct {
			Fields map[string]string `json:"fields"`
		} `json:"error"`
	}
	if err := json.Unmarshal(body, &env); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if env.Error.Fields[field] == "" {
		t.Errorf("no %q field error in %s", field, body)
	}
}
