package v1

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/FeaturePlus/backend/models"
	"gorm.io/gorm"
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
	second := do(r, http.MethodPost, "/api/v1/auth/signup", `{"name":"B","email":"b@x.io","password":"password2","role":"manager","invite_code":"`+inviteFor(t, db, "")+`"}`)

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

	w := do(r, http.MethodPost, "/api/v1/auth/signup", `{"name":"O","email":"owner@elsewhere.org","password":"password1","invite_code":"`+inviteFor(t, db, "")+`"}`)
	if w.Code != http.StatusCreated {
		t.Fatalf("status %d: %s", w.Code, w.Body.String())
	}
	var user models.User
	db.Where("email = ?", "owner@elsewhere.org").First(&user)
	if user.Username != "owner2" {
		t.Errorf("username %q, want owner2", user.Username)
	}
}

// inviteFor makes an invite code straight in the database, as an admin would,
// and returns it. email "" makes one any address may use.
func inviteFor(t *testing.T, db *gorm.DB, email string) string {
	t.Helper()
	code, err := newInviteCode()
	if err != nil {
		t.Fatal(err)
	}
	inv := models.InviteCode{CodeHash: hashInviteCode(code), Hint: code[len(code)-4:], Email: email,
		CreatedByID: 1, ExpiresAt: time.Now().Add(inviteLifetime)}
	if err := db.Create(&inv).Error; err != nil {
		t.Fatal(err)
	}
	return code
}

func TestSignupNeedsAValidInviteCode(t *testing.T) {
	db := newTestDB(t)
	r := realAuthRouter(t, db)
	signup := func(email, code string) *httptest.ResponseRecorder {
		return do(r, http.MethodPost, "/api/v1/auth/signup",
			`{"name":"N","email":"`+email+`","password":"password1","invite_code":"`+code+`"}`)
	}

	// The server's first account needs no code, and the page is told so.
	var info struct {
		Data struct {
			InviteRequired bool `json:"invite_required"`
		} `json:"data"`
	}
	_ = json.Unmarshal(do(r, http.MethodGet, "/api/v1/auth/signup", "").Body.Bytes(), &info)
	if info.Data.InviteRequired {
		t.Fatal("an empty server asks for a code")
	}
	if w := signup("first@x.io", ""); w.Code != http.StatusCreated {
		t.Fatalf("first account: status %d: %s", w.Code, w.Body.String())
	}
	_ = json.Unmarshal(do(r, http.MethodGet, "/api/v1/auth/signup", "").Body.Bytes(), &info)
	if !info.Data.InviteRequired {
		t.Fatal("after the first account the page is not told to ask for a code")
	}

	refused := func(name, email, code string) {
		t.Helper()
		w := signup(email, code)
		if w.Code != http.StatusUnprocessableEntity {
			t.Errorf("%s: status %d, want 422: %s", name, w.Code, w.Body.String())
			return
		}
		assertFieldError(t, w.Body.Bytes(), "invite_code")
		var n int64
		db.Model(&models.User{}).Where("email = ?", email).Count(&n)
		if n != 0 {
			t.Errorf("%s: the account was made anyway", name)
		}
	}
	refused("no code", "a@x.io", "")
	refused("wrong code", "a@x.io", "AAAA-BBBB-CCCC")

	// A good code works once, typed in any case and without dashes.
	code := inviteFor(t, db, "")
	if w := signup("a@x.io", strings.ToLower(strings.ReplaceAll(code, "-", ""))); w.Code != http.StatusCreated {
		t.Fatalf("good code: status %d: %s", w.Code, w.Body.String())
	}
	refused("used code", "b@x.io", code)

	// A code made for an email works only for that email.
	forC := inviteFor(t, db, "c@x.io")
	refused("other email", "d@x.io", forC)
	if w := signup("C@x.io", forC); w.Code != http.StatusCreated {
		t.Fatalf("code for c@x.io: status %d: %s", w.Code, w.Body.String())
	}

	expired := inviteFor(t, db, "")
	db.Model(&models.InviteCode{}).Where("code_hash = ?", hashInviteCode(expired)).Update("expires_at", time.Now().Add(-time.Minute))
	refused("expired code", "e@x.io", expired)

	cancelled := inviteFor(t, db, "")
	db.Model(&models.InviteCode{}).Where("code_hash = ?", hashInviteCode(cancelled)).Update("cancelled_at", time.Now())
	refused("cancelled code", "f@x.io", cancelled)
}

func TestOnlyAdminsMakeAndCancelInviteCodes(t *testing.T) {
	db := newTestDB(t)
	r := realAuthRouter(t, db)
	admin := decodeSession(t, do(r, http.MethodPost, "/api/v1/auth/signup", `{"name":"Admin","email":"admin@x.io","password":"password1"}`).Body.Bytes())
	dev := decodeSession(t, do(r, http.MethodPost, "/api/v1/auth/signup",
		`{"name":"Dev","email":"dev@x.io","password":"password1","invite_code":"`+inviteFor(t, db, "")+`"}`).Body.Bytes())

	if w := doAuthed(r, dev.Token, http.MethodPost, "/api/v1/invites", `{}`); w.Code != http.StatusForbidden {
		t.Errorf("developer makes a code: status %d, want 403", w.Code)
	}
	if w := doAuthed(r, admin.Token, http.MethodPost, "/api/v1/invites", `{"email":"dev@x.io"}`); w.Code != http.StatusConflict {
		t.Errorf("code for an email with an account: status %d, want 409", w.Code)
	}

	w := doAuthed(r, admin.Token, http.MethodPost, "/api/v1/invites", `{"email":"New@x.io","note":"For Rahul"}`)
	if w.Code != http.StatusCreated {
		t.Fatalf("make code: status %d: %s", w.Code, w.Body.String())
	}
	var made struct {
		Data CreatedInviteDTO `json:"data"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &made)
	if len(made.Data.Code) != 14 || made.Data.Status != "active" || made.Data.Email != "new@x.io" ||
		made.Data.Hint != made.Data.Code[10:] {
		t.Fatalf("made = %+v", made.Data)
	}

	// The list never shows a code whole.
	list := doAuthed(r, admin.Token, http.MethodGet, "/api/v1/invites", "")
	if strings.Contains(list.Body.String(), made.Data.Code) {
		t.Error("the list shows the code")
	}

	path := "/api/v1/invites/" + strconv.Itoa(int(made.Data.ID))
	if w := doAuthed(r, admin.Token, http.MethodDelete, path, ""); w.Code != http.StatusNoContent {
		t.Fatalf("cancel: status %d", w.Code)
	}
	if w := do(r, http.MethodPost, "/api/v1/auth/signup",
		`{"name":"N","email":"new@x.io","password":"password1","invite_code":"`+made.Data.Code+`"}`); w.Code != http.StatusUnprocessableEntity {
		t.Errorf("cancelled code signs up: status %d", w.Code)
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
