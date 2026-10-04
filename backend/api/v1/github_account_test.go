package v1

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/FeaturePlus/backend/models"
	"github.com/FeaturePlus/backend/services"
	"github.com/gin-gonic/gin"
)

// browse makes a request carrying cookies, the way a browser following
// GitHub's redirects would.
func browse(r *gin.Engine, path string, cookies []*http.Cookie) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodGet, path, nil)
	// A response can clear a cookie and set it again; like a browser, keep the
	// last one of each name, and drop the ones that were cleared.
	last := map[string]*http.Cookie{}
	for _, cookie := range cookies {
		last[cookie.Name] = cookie
	}
	for _, cookie := range last {
		if cookie.MaxAge >= 0 && cookie.Value != "" {
			req.AddCookie(cookie)
		}
	}
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

// startConnect opens the connect route and returns the state GitHub would be
// handed and the cookie the browser keeps.
func startConnect(t *testing.T, r *gin.Engine, returnTo string) (string, []*http.Cookie, *url.URL) {
	t.Helper()
	w := browse(r, "/api/v1/github/connect?return_to="+url.QueryEscape(returnTo), nil)
	if w.Code != http.StatusFound {
		t.Fatalf("connect: %d %s", w.Code, w.Body.String())
	}
	target, err := url.Parse(w.Header().Get("Location"))
	if err != nil {
		t.Fatalf("location: %v", err)
	}
	return target.Query().Get("state"), w.Result().Cookies(), target
}

func TestGitHubConnectFlow(t *testing.T) {
	db := newTestDB(t)
	owner, _, _ := seed(t, db)
	_, app := newFakeGitHub(t)
	r := githubRouterAs(t, db, app, owner.ID)

	var account GitHubAccountDTO
	dataOf(t, browse(r, "/api/v1/github/account", nil), &account)
	if !account.AppConfigured || account.Connected {
		t.Fatalf("before: %+v", account)
	}

	state, cookies, target := startConnect(t, r, "/app/projects/3/releases")
	if target.Path != "/login/oauth/authorize" || state == "" ||
		target.Query().Get("client_id") != "Iv-test" ||
		target.Query().Get("redirect_uri") != "http://example.com/api/v1/github/callback" {
		t.Fatalf("authorize url: %s", target)
	}

	w := browse(r, "/api/v1/github/callback?code=good-code&state="+state, cookies)
	if w.Code != http.StatusFound || w.Header().Get("Location") != "http://example.com/app/projects/3/releases?github=connected" {
		t.Fatalf("callback: %d -> %q", w.Code, w.Header().Get("Location"))
	}

	var row models.UserGitHub
	if err := db.Where("user_id = ?", owner.ID).First(&row).Error; err != nil {
		t.Fatalf("no connection stored: %v", err)
	}
	if row.Login != "octo" || strings.HasPrefix(row.AccessToken, "tok-") || row.AccessExpiresAt == nil {
		t.Fatalf("stored connection: login %q, token stored in clear: %v", row.Login, strings.HasPrefix(row.AccessToken, "tok-"))
	}

	dataOf(t, browse(r, "/api/v1/github/account", nil), &account)
	if !account.Connected || account.Login != "octo" {
		t.Fatalf("after: %+v", account)
	}

	// The same answer cannot be used twice: the state cookie is spent.
	again := browse(r, "/api/v1/github/callback?code=good-code&state="+state, w.Result().Cookies())
	if !strings.Contains(again.Header().Get("Location"), "github=expired") {
		t.Fatalf("replayed callback: %q", again.Header().Get("Location"))
	}

	var repos []GitHubRepoDTO
	dataOf(t, browse(r, "/api/v1/github/repos", nil), &repos)
	if len(repos) != 1 || repos[0].FullName != "acme/trails" || !repos[0].CanPush {
		t.Fatalf("repos: %+v", repos)
	}

	// Disconnecting forgets the token.
	req := httptest.NewRequest(http.MethodDelete, "/api/v1/github/account", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("disconnect: %d", rec.Code)
	}
	dataOf(t, browse(r, "/api/v1/github/account", nil), &account)
	if account.Connected {
		t.Fatalf("still connected after disconnect")
	}
}

func TestGitHubCallbackRejectsAForeignState(t *testing.T) {
	db := newTestDB(t)
	owner, _, _ := seed(t, db)
	_, app := newFakeGitHub(t)
	r := githubRouterAs(t, db, app, owner.ID)

	_, cookies, _ := startConnect(t, r, "/app/")
	w := browse(r, "/api/v1/github/callback?code=good-code&state=someone-elses", cookies)
	if !strings.Contains(w.Header().Get("Location"), "github=expired") {
		t.Fatalf("location %q", w.Header().Get("Location"))
	}
	var count int64
	db.Model(&models.UserGitHub{}).Count(&count)
	if count != 0 {
		t.Fatalf("a connection was stored from a foreign state")
	}
}

func TestGitHubCallbackSendsNewUsersOnToChooseRepos(t *testing.T) {
	db := newTestDB(t)
	owner, _, _ := seed(t, db)
	fake, app := newFakeGitHub(t)
	fake.installed = false
	r := githubRouterAs(t, db, app, owner.ID)

	state, cookies, _ := startConnect(t, r, "/app/projects/3/releases")
	w := browse(r, "/api/v1/github/callback?code=good-code&state="+state, cookies)
	target, _ := url.Parse(w.Header().Get("Location"))
	if target.Path != "/apps/featureplus/installations/new" || target.Query().Get("state") == "" {
		t.Fatalf("not sent to install: %q", w.Header().Get("Location"))
	}

	// Coming back from choosing repositories finishes the connection.
	fake.installed = true
	w = browse(r, "/api/v1/github/callback?code=good-code&setup_action=install&installation_id=7&state="+
		target.Query().Get("state"), w.Result().Cookies())
	if w.Header().Get("Location") != "http://example.com/app/projects/3/releases?github=connected" {
		t.Fatalf("after install: %q", w.Header().Get("Location"))
	}
}

func TestGitHubActionsNeedAConnection(t *testing.T) {
	db := newTestDB(t)
	owner, _, project := seed(t, db)
	fake, app := newFakeGitHub(t)

	// Linked while connected, then disconnected.
	connected := githubRouter(t, db, app, owner.ID)
	base := "/api/v1/projects/" + strconv.Itoa(project.ID) + "/github"
	do(connected, http.MethodPut, base, `{"repo":"acme/trails"}`)
	db.Where("user_id = ?", owner.ID).Delete(&models.UserGitHub{})
	r := githubRouterAs(t, db, app, owner.ID)

	w := do(r, http.MethodPost, base+"/sync", "")
	if w.Code != http.StatusConflict {
		t.Fatalf("sync without a connection: %d %s", w.Code, w.Body.String())
	}
	if failure := decodeErr(t, w); failure.Fields["github"] != "not_connected" {
		t.Fatalf("error does not say not_connected: %+v", failure)
	}

	release := models.Release{ProjectID: project.ID, Tag: "v1.0", Status: models.ReleaseStatusDraft}
	db.Omit("Project", "PRs").Create(&release)
	db.Create(&models.Feature{ProjectID: project.ID, Title: "Trail map", Status: models.StatusDone, ReleaseID: &release.ID})

	var published ReleaseDTO
	dataOf(t, do(r, http.MethodPost, "/api/v1/releases/"+strconv.Itoa(int(release.ID))+"/publish", ""), &published)
	if published.Status != "published" || !strings.Contains(published.GitHubError, "Connect your GitHub") {
		t.Fatalf("%+v", published)
	}
	if fake.commits != 0 {
		t.Fatalf("wrote to GitHub without a connection")
	}
}

func TestGitHubRenewsAnExpiredToken(t *testing.T) {
	db := newTestDB(t)
	owner, _, project := seed(t, db)
	fake, app := newFakeGitHub(t)

	earlier := time.Now().Add(-time.Minute)
	if err := testAccounts(t, db, app).save(owner.ID, "octo", &services.GitHubUserToken{
		AccessToken: "tok-dead", AccessExpiresAt: &earlier, RefreshToken: "ref-seed",
	}); err != nil {
		t.Fatal(err)
	}
	r := githubRouterAs(t, db, app, owner.ID)

	w := do(r, http.MethodPut, "/api/v1/projects/"+strconv.Itoa(project.ID)+"/github", `{"repo":"acme/trails"}`)
	if w.Code != http.StatusOK {
		t.Fatalf("link with an expired token: %d %s", w.Code, w.Body.String())
	}
	if fake.refreshes != 1 {
		t.Fatalf("refreshes %d, want 1", fake.refreshes)
	}

	var row models.UserGitHub
	db.Where("user_id = ?", owner.ID).First(&row)
	if row.AccessExpiresAt == nil || row.AccessExpiresAt.Before(time.Now()) {
		t.Fatalf("renewed token not stored")
	}
}

func TestSafeReturnPath(t *testing.T) {
	cases := map[string]string{
		"/app/projects/3/releases": "/app/projects/3/releases",
		"/app/":                    "/app/",
		"":                         "/app/",
		"https://evil.example/app": "/app/",
		"//evil.example/app":       "/app/",
		"/api/v1/users":            "/app/",
		"/app\\..\\evil":           "/app/",
	}
	for input, want := range cases {
		if got := safeReturnPath(input); got != want {
			t.Errorf("safeReturnPath(%q) = %q, want %q", input, got, want)
		}
	}
}

func TestTokenBox(t *testing.T) {
	box, _ := services.NewTokenBox("one")
	sealed, err := box.Seal("ghu_secret")
	if err != nil || strings.Contains(sealed, "ghu_secret") {
		t.Fatalf("seal: %q %v", sealed, err)
	}
	if plain, err := box.Open(sealed); err != nil || plain != "ghu_secret" {
		t.Fatalf("open: %q %v", plain, err)
	}
	other, _ := services.NewTokenBox("two")
	if _, err := other.Open(sealed); err == nil {
		t.Fatalf("a different secret opened the token")
	}
}

// In development the app is open on Vite's port while GitHub returns to the
// server's. The browser goes back to where it started, and never to another
// host.
func TestGitHubCallbackReturnsToTheStartingPort(t *testing.T) {
	db := newTestDB(t)
	owner, _, _ := seed(t, db)
	_, app := newFakeGitHub(t)
	r := githubRouterAs(t, db, app, owner.ID)

	start := httptest.NewRequest(http.MethodGet, "/api/v1/github/connect?return_to=%2Fapp%2Fprojects%2F3%2Freleases", nil)
	start.Host = "localhost:5173"
	started := httptest.NewRecorder()
	r.ServeHTTP(started, start)
	target, _ := url.Parse(started.Header().Get("Location"))
	if target.Query().Get("redirect_uri") != "http://localhost:5173/api/v1/github/callback" {
		t.Fatalf("redirect_uri %q", target.Query().Get("redirect_uri"))
	}

	back := httptest.NewRequest(http.MethodGet, "/api/v1/github/callback?code=good-code&state="+target.Query().Get("state"), nil)
	back.Host = "localhost:8080"
	for _, cookie := range started.Result().Cookies() {
		back.AddCookie(cookie)
	}
	done := httptest.NewRecorder()
	r.ServeHTTP(done, back)
	if got := done.Header().Get("Location"); got != "http://localhost:5173/app/projects/3/releases?github=connected" {
		t.Fatalf("returned to %q", got)
	}

	// Reached on a different host, the saved origin is ignored.
	evil := httptest.NewRequest(http.MethodGet, "/api/v1/github/callback?code=good-code&state=x", nil)
	evil.Host = "evil.example"
	evil.AddCookie(&http.Cookie{Name: githubStateCookie, Value: "x|%2Fapp%2F|http%3A%2F%2Flocalhost%3A5173"})
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, evil)
	if got := rec.Header().Get("Location"); strings.Contains(got, "localhost:5173") {
		t.Fatalf("followed an origin on another host: %q", got)
	}
}
