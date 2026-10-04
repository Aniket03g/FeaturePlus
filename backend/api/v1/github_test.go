package v1

import (
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/FeaturePlus/backend/api"
	"github.com/FeaturePlus/backend/models"
	"github.com/FeaturePlus/backend/services"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// fakeGitHub stands in for GitHub: sign-in, one person's installations, and
// one repository with its files and releases. API calls must carry a token it
// issued, so a stale or missing token fails the way it would for real.
type fakeGitHub struct {
	mu        sync.Mutex
	files     map[string]string
	commits   int
	releases  map[string]string // tag -> body
	canPush   bool
	installed bool
	issued    map[string]bool // live access tokens
	refreshes int
}

func newFakeGitHub(t *testing.T) (*fakeGitHub, *services.GitHubApp) {
	t.Helper()
	fake := &fakeGitHub{
		files: map[string]string{}, releases: map[string]string{}, canPush: true, installed: true,
		issued: map[string]bool{"tok-seed": true},
	}
	server := httptest.NewServer(http.HandlerFunc(fake.serve))
	t.Cleanup(server.Close)
	return fake, &services.GitHubApp{
		AppID: "1", Slug: "featureplus", ClientID: "Iv-test", ClientSecret: "secret",
		OAuthBaseURL: server.URL, APIBaseURL: server.URL, HTTP: server.Client(),
	}
}

func (f *fakeGitHub) issue() map[string]any {
	token := "tok-" + strconv.Itoa(len(f.issued)+1)
	f.issued[token] = true
	return map[string]any{
		"access_token": token, "expires_in": 28800,
		"refresh_token": "ref-" + token, "refresh_token_expires_in": 15897600,
	}
}

func (f *fakeGitHub) serve(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()

	path := r.URL.Path

	if path == "/login/oauth/access_token" && r.Method == http.MethodPost {
		_ = r.ParseForm()
		switch {
		case r.Form.Get("client_secret") != "secret":
			_ = json.NewEncoder(w).Encode(map[string]string{"error": "incorrect_client_credentials"})
		case r.Form.Get("grant_type") == "refresh_token" && strings.HasPrefix(r.Form.Get("refresh_token"), "ref-"):
			f.refreshes++
			_ = json.NewEncoder(w).Encode(f.issue())
		case r.Form.Get("code") == "good-code":
			_ = json.NewEncoder(w).Encode(f.issue())
		default:
			_ = json.NewEncoder(w).Encode(map[string]string{"error": "bad_verification_code"})
		}
		return
	}

	if !f.issued[strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")] {
		http.Error(w, `{"message":"Bad credentials"}`, http.StatusUnauthorized)
		return
	}

	switch {
	case path == "/user":
		_ = json.NewEncoder(w).Encode(map[string]string{"login": "octo"})
		return
	case path == "/user/installations":
		installs := []map[string]int{}
		if f.installed {
			installs = append(installs, map[string]int{"id": 7})
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"installations": installs})
		return
	case path == "/user/installations/7/repositories":
		_ = json.NewEncoder(w).Encode(map[string]any{"total_count": 1, "repositories": []map[string]any{{
			"full_name": "acme/trails", "default_branch": "main", "html_url": "https://github.com/acme/trails",
			"permissions": map[string]bool{"push": f.canPush},
		}}})
		return
	}

	const repo = "/repos/acme/trails"
	if !strings.HasPrefix(path, repo) {
		http.Error(w, `{"message":"Not Found"}`, http.StatusNotFound)
		return
	}
	rest := strings.TrimPrefix(path, repo)

	switch {
	case rest == "" && r.Method == http.MethodGet:
		_ = json.NewEncoder(w).Encode(map[string]any{
			"full_name": "acme/trails", "default_branch": "main",
			"permissions": map[string]bool{"push": f.canPush},
		})

	case strings.HasPrefix(rest, "/contents/") && r.Method == http.MethodGet:
		file := strings.TrimPrefix(rest, "/contents/")
		text, ok := f.files[file]
		if !ok {
			http.Error(w, `{"message":"Not Found"}`, http.StatusNotFound)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"sha": "blob" + strconv.Itoa(f.commits), "encoding": "base64",
			"content": base64.StdEncoding.EncodeToString([]byte(text)),
		})

	case strings.HasPrefix(rest, "/contents/") && r.Method == http.MethodPut:
		var body struct {
			Content string `json:"content"`
			SHA     string `json:"sha"`
		}
		raw, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(raw, &body)
		file := strings.TrimPrefix(rest, "/contents/")
		if _, exists := f.files[file]; exists && body.SHA == "" {
			http.Error(w, `{"message":"sha wasn't supplied"}`, http.StatusUnprocessableEntity)
			return
		}
		decoded, _ := base64.StdEncoding.DecodeString(body.Content)
		f.files[file] = string(decoded)
		f.commits++
		_ = json.NewEncoder(w).Encode(map[string]any{"commit": map[string]string{"sha": "c" + strconv.Itoa(f.commits)}})

	case rest == "/releases" && r.Method == http.MethodPost:
		var body struct {
			Tag  string `json:"tag_name"`
			Body string `json:"body"`
		}
		raw, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(raw, &body)
		if _, exists := f.releases[body.Tag]; exists {
			w.WriteHeader(http.StatusUnprocessableEntity)
			_, _ = w.Write([]byte(`{"message":"Validation Failed","errors":[{"resource":"Release","code":"already_exists","field":"tag_name"}]}`))
			return
		}
		f.releases[body.Tag] = body.Body
		_ = json.NewEncoder(w).Encode(map[string]string{"html_url": "https://github.com/acme/trails/releases/tag/" + body.Tag})

	case strings.HasPrefix(rest, "/releases/tags/") && r.Method == http.MethodGet:
		tag := strings.TrimPrefix(rest, "/releases/tags/")
		if _, ok := f.releases[tag]; !ok {
			http.Error(w, `{"message":"Not Found"}`, http.StatusNotFound)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]string{"html_url": "https://github.com/acme/trails/releases/tag/" + tag})

	default:
		http.Error(w, `{"message":"Not Found"}`, http.StatusNotFound)
	}
}

func testAccounts(t *testing.T, db *gorm.DB, app *services.GitHubApp) *githubAccounts {
	t.Helper()
	box, err := services.NewTokenBox(app.ClientSecret)
	if err != nil {
		t.Fatalf("token box: %v", err)
	}
	return &githubAccounts{db: db, app: app, box: box}
}

// connectUser stores a GitHub connection for a user, as the callback would.
func connectUser(t *testing.T, db *gorm.DB, app *services.GitHubApp, userID int) {
	t.Helper()
	later := time.Now().Add(8 * time.Hour)
	if err := testAccounts(t, db, app).save(userID, "octo", &services.GitHubUserToken{
		AccessToken: "tok-seed", AccessExpiresAt: &later, RefreshToken: "ref-seed",
	}); err != nil {
		t.Fatalf("connect: %v", err)
	}
}

// githubRouter mounts the GitHub and release routes as userID, connecting
// them to GitHub first if they are not already.
func githubRouter(t *testing.T, db *gorm.DB, app *services.GitHubApp, userID int) *gin.Engine {
	t.Helper()
	var count int64
	db.Model(&models.UserGitHub{}).Where("user_id = ?", userID).Count(&count)
	if count == 0 {
		connectUser(t, db, app, userID)
	}
	return githubRouterAs(t, db, app, userID)
}

// githubRouterAs mounts the same routes without connecting anyone.
func githubRouterAs(t *testing.T, db *gorm.DB, app *services.GitHubApp, userID int) *gin.Engine {
	t.Helper()

	gin.SetMode(gin.TestMode)
	r := gin.New()
	g := r.Group("/api/v1")
	g.Use(func(c *gin.Context) {
		c.Set(api.ContextUserID, uint(userID))
		c.Set(api.ContextUserRole, "developer")
		c.Next()
	})

	publisher := &githubPublisher{db: db, accounts: testAccounts(t, db, app)}
	newGitHubHandler(db, publisher).Register(g)
	releases := NewReleasesHandler(db)
	releases.github = publisher
	releases.Register(g)
	return r
}

func dataOf(t *testing.T, w *httptest.ResponseRecorder, into any) {
	t.Helper()
	wrapper := struct {
		Data any `json:"data"`
	}{Data: into}
	if err := json.Unmarshal(w.Body.Bytes(), &wrapper); err != nil {
		t.Fatalf("decode: %v (%s)", err, w.Body.String())
	}
}

func TestParseGitHubRepo(t *testing.T) {
	good := map[string]string{
		"acme/trails":                           "acme/trails",
		"https://github.com/acme/trails":        "acme/trails",
		"https://github.com/acme/trails.git":    "acme/trails",
		"github.com/acme/trails/tree/main/docs": "acme/trails",
		"git@github.com:acme/trails.git":        "acme/trails",
		"  acme/my.repo_name-2 ":                "acme/my.repo_name-2",
	}
	for input, want := range good {
		owner, repo, ok := parseGitHubRepo(input)
		if !ok || owner+"/"+repo != want {
			t.Errorf("parseGitHubRepo(%q) = %q, %v; want %q", input, owner+"/"+repo, ok, want)
		}
	}
	for _, input := range []string{"", "trails", "acme/", "/trails", "acme/tr ails", "-acme/trails", "acme/.."} {
		if _, _, ok := parseGitHubRepo(input); ok {
			t.Errorf("parseGitHubRepo(%q) accepted a bad name", input)
		}
	}
}

func TestBuildPlanMarkdown(t *testing.T) {
	v1, v2 := uint(1), uint(2)
	dash, kanban := uint(10), uint(11)
	releases := []models.Release{
		{ID: 1, Tag: "v1.0", Status: models.ReleaseStatusPublished, Notes: "First cut."},
		{ID: 2, Tag: "v1.1", Status: models.ReleaseStatusDraft},
	}
	features := []models.Feature{
		{ID: dash, Title: "Dashboard", ReleaseID: &v2},
		{ID: kanban, Title: "Kanban\nviews", ParentFeatureID: &dash, ReleaseID: &v1, Status: models.StatusDone},
		{ID: 12, Title: "Charts", ParentFeatureID: &dash, ReleaseID: &v2},
		{ID: 13, Title: "Accounts", ReleaseID: &v1, Status: models.StatusDone},
		{ID: 14, Title: "Sign in", ParentFeatureID: func() *uint { v := uint(13); return &v }(), ReleaseID: &v1},
		{ID: 15, Title: "Reporting"},
	}

	got := buildPlanMarkdown("Trails", releases, features)
	want := `# Trails — plan

> Written by FeaturePlus. Edits made to this file are replaced on the next sync.

## v1.0 — published

First cut.

- [x] Dashboard › Kanban views
- [x] Accounts
  - [ ] Sign in

## v1.1 — planned

- [ ] Dashboard
  - [ ] Charts

## Not planned

- [ ] Reporting

`
	if got != want {
		t.Fatalf("plan markdown:\n%s\n--- want ---\n%s", got, want)
	}
}

func TestGitHubLinkSyncAndPublish(t *testing.T) {
	db := newTestDB(t)
	owner, other, project := seed(t, db)
	fake, app := newFakeGitHub(t)
	r := githubRouter(t, db, app, owner.ID)
	base := "/api/v1/projects/" + strconv.Itoa(project.ID) + "/github"

	// Unlinked to begin with, and syncing says so.
	var link GitHubLinkDTO
	dataOf(t, do(r, http.MethodGet, base, ""), &link)
	if link.Linked || !link.AppConfigured {
		t.Fatalf("fresh project: %+v", link)
	}
	if w := do(r, http.MethodPost, base+"/sync", ""); w.Code != http.StatusConflict {
		t.Fatalf("sync unlinked: %d %s", w.Code, w.Body.String())
	}

	// Someone else cannot link it.
	if w := do(githubRouter(t, db, app, other.ID), http.MethodPut, base, `{"repo":"acme/trails"}`); w.Code != http.StatusForbidden {
		t.Fatalf("link by non-owner: %d", w.Code)
	}
	// An unknown repository is refused before anything is saved.
	if w := do(r, http.MethodPut, base, `{"repo":"acme/nope"}`); w.Code != http.StatusNotFound {
		t.Fatalf("unknown repo: %d %s", w.Code, w.Body.String())
	}

	w := do(r, http.MethodPut, base, `{"repo":"https://github.com/acme/trails.git"}`)
	if w.Code != http.StatusOK {
		t.Fatalf("link: %d %s", w.Code, w.Body.String())
	}
	dataOf(t, w, &link)
	if !link.Linked || link.Owner != "acme" || link.Repo != "trails" || link.Branch != "main" {
		t.Fatalf("link: %+v", link)
	}

	// A release with one finished feature.
	release := models.Release{ProjectID: project.ID, Tag: "v1.0", Status: models.ReleaseStatusDraft}
	db.Omit("Project", "PRs").Create(&release)
	db.Create(&models.Feature{ProjectID: project.ID, Title: "Trail map", Status: models.StatusDone, ReleaseID: &release.ID})

	var receipt GitHubSyncDTO
	dataOf(t, do(r, http.MethodPost, base+"/sync", ""), &receipt)
	if !receipt.Changed || fake.commits != 1 {
		t.Fatalf("first sync: %+v, commits %d", receipt, fake.commits)
	}
	if !strings.Contains(fake.files[PlanFilePath], "## v1.0 — planned") ||
		!strings.Contains(fake.files[PlanFilePath], "- [x] Trail map") {
		t.Fatalf("plan file:\n%s", fake.files[PlanFilePath])
	}

	// Nothing changed, so nothing is committed.
	dataOf(t, do(r, http.MethodPost, base+"/sync", ""), &receipt)
	if receipt.Changed || fake.commits != 1 {
		t.Fatalf("second sync committed again: %+v, commits %d", receipt, fake.commits)
	}

	// Publishing tags the repository, and the plan file now says published.
	w = do(r, http.MethodPost, "/api/v1/releases/"+strconv.Itoa(int(release.ID))+"/publish", "")
	if w.Code != http.StatusOK {
		t.Fatalf("publish: %d %s", w.Code, w.Body.String())
	}
	var published ReleaseDTO
	dataOf(t, w, &published)
	if published.GitHubURL != "https://github.com/acme/trails/releases/tag/v1.0" || published.GitHubError != "" {
		t.Fatalf("published: url %q, error %q", published.GitHubURL, published.GitHubError)
	}
	if !strings.Contains(fake.releases["v1.0"], "- [x] Trail map") {
		t.Fatalf("release notes:\n%s", fake.releases["v1.0"])
	}
	if !strings.Contains(fake.files[PlanFilePath], "## v1.0 — published") {
		t.Fatalf("plan not re-synced before tagging:\n%s", fake.files[PlanFilePath])
	}

	// Asking again returns the same GitHub Release rather than a second one.
	var again struct {
		GitHubURL string `json:"github_url"`
	}
	dataOf(t, do(r, http.MethodPost, "/api/v1/releases/"+strconv.Itoa(int(release.ID))+"/github", ""), &again)
	if again.GitHubURL != published.GitHubURL || len(fake.releases) != 1 {
		t.Fatalf("retry: %q, releases %d", again.GitHubURL, len(fake.releases))
	}

	// The release detail links to it.
	var detail ReleaseDTO
	dataOf(t, do(r, http.MethodGet, "/api/v1/releases/"+strconv.Itoa(int(release.ID)), ""), &detail)
	if detail.GitHubURL != published.GitHubURL {
		t.Fatalf("detail github_url %q", detail.GitHubURL)
	}

	// Unlinking touches nothing on GitHub.
	if w := do(r, http.MethodDelete, base, ""); w.Code != http.StatusNoContent {
		t.Fatalf("unlink: %d", w.Code)
	}
	dataOf(t, do(r, http.MethodGet, base, ""), &link)
	if link.Linked || len(fake.files) != 1 {
		t.Fatalf("after unlink: %+v, files %d", link, len(fake.files))
	}
}

func TestPublishAdoptsAnExistingGitHubRelease(t *testing.T) {
	db := newTestDB(t)
	owner, _, project := seed(t, db)
	fake, app := newFakeGitHub(t)
	fake.releases["v2.0"] = "made by hand"
	r := githubRouter(t, db, app, owner.ID)

	do(r, http.MethodPut, "/api/v1/projects/"+strconv.Itoa(project.ID)+"/github", `{"repo":"acme/trails"}`)
	release := models.Release{ProjectID: project.ID, Tag: "v2.0", Status: models.ReleaseStatusDraft}
	db.Omit("Project", "PRs").Create(&release)
	db.Create(&models.Feature{ProjectID: project.ID, Title: "Offline maps", Status: models.StatusDone, ReleaseID: &release.ID})

	var published ReleaseDTO
	dataOf(t, do(r, http.MethodPost, "/api/v1/releases/"+strconv.Itoa(int(release.ID))+"/publish", ""), &published)
	if published.GitHubURL == "" || published.GitHubError != "" {
		t.Fatalf("url %q error %q", published.GitHubURL, published.GitHubError)
	}
	if fake.releases["v2.0"] != "made by hand" {
		t.Fatalf("the existing GitHub release was overwritten")
	}
}

func TestPublishWithoutGitHubLinkStillWorks(t *testing.T) {
	db := newTestDB(t)
	owner, _, project := seed(t, db)
	fake, app := newFakeGitHub(t)
	r := githubRouter(t, db, app, owner.ID)

	release := models.Release{ProjectID: project.ID, Tag: "v1.0", Status: models.ReleaseStatusDraft}
	db.Omit("Project", "PRs").Create(&release)
	db.Create(&models.Feature{ProjectID: project.ID, Title: "Trail map", Status: models.StatusDone, ReleaseID: &release.ID})

	var published ReleaseDTO
	dataOf(t, do(r, http.MethodPost, "/api/v1/releases/"+strconv.Itoa(int(release.ID))+"/publish", ""), &published)
	if published.Status != "published" || published.GitHubURL != "" || published.GitHubError != "" {
		t.Fatalf("%+v", published)
	}
	if fake.commits != 0 || len(fake.releases) != 0 {
		t.Fatalf("an unlinked project reached GitHub")
	}
}

func TestPublishReportsGitHubFailureButStaysPublished(t *testing.T) {
	db := newTestDB(t)
	owner, _, project := seed(t, db)
	_, app := newFakeGitHub(t)
	r := githubRouter(t, db, app, owner.ID)

	do(r, http.MethodPut, "/api/v1/projects/"+strconv.Itoa(project.ID)+"/github", `{"repo":"acme/trails"}`)
	// The repository goes away after linking.
	db.Model(&models.ProjectGitHub{}).Where("project_id = ?", project.ID).Update("repo", "gone")

	release := models.Release{ProjectID: project.ID, Tag: "v1.0", Status: models.ReleaseStatusDraft}
	db.Omit("Project", "PRs").Create(&release)
	db.Create(&models.Feature{ProjectID: project.ID, Title: "Trail map", Status: models.StatusDone, ReleaseID: &release.ID})

	var published ReleaseDTO
	dataOf(t, do(r, http.MethodPost, "/api/v1/releases/"+strconv.Itoa(int(release.ID))+"/publish", ""), &published)
	if published.Status != "published" || published.GitHubError == "" || published.GitHubURL != "" {
		t.Fatalf("%+v", published)
	}
}

func TestPlaygroundImportCreatesAndPlansReleases(t *testing.T) {
	db := newTestDB(t)
	owner, _, project := seed(t, db)
	r := playgroundRouter(t, db, owner.ID, "developer")

	// The project already has a published v0.9 holding "Receipts".
	shipped := models.Release{ProjectID: project.ID, Tag: "v0.9", Status: models.ReleaseStatusPublished}
	db.Omit("Project", "PRs").Create(&shipped)
	db.Create(&models.Feature{ProjectID: project.ID, Title: "Receipts", ReleaseID: &shipped.ID})

	body := `{"project_id":` + strconv.Itoa(project.ID) + `,
		"releases":[{"key":"r1","name":"v1.0"},{"key":"r2","name":"v1.1"},{"key":"r0","name":"V0.9"}],
		"features":[
			{"key":"p","title":"Payment","release_key":"r1"},
			{"key":"c","title":"Card payment","parent_key":"p","release_key":"r2"},
			{"key":"x","title":"Receipts","release_key":"r1"},
			{"key":"s","title":"Search","release_key":"r0"},
			{"key":"n","title":"Notes"}
		]}`

	// A dry run counts and writes nothing.
	dry := decodeImport(t, do(r, http.MethodPost, "/api/v1/playground/import",
		strings.Replace(body, `"releases"`, `"dry_run":true,"releases"`, 1)))
	if dry.ReleasesCreated != 2 || dry.ReleasesExisting != 1 || len(dry.Skipped) != 1 {
		t.Fatalf("dry run: %+v", dry)
	}
	var count int64
	db.Model(&models.Release{}).Where("project_id = ?", project.ID).Count(&count)
	if count != 1 {
		t.Fatalf("dry run wrote releases: %d", count)
	}

	w := do(r, http.MethodPost, "/api/v1/playground/import", body)
	if w.Code != http.StatusCreated {
		t.Fatalf("import: %d %s", w.Code, w.Body.String())
	}
	result := decodeImport(t, w)
	if result.ReleasesCreated != 2 || result.ReleasesExisting != 1 || len(result.Skipped) != 1 || result.Skipped[0] != "v0.9" {
		t.Fatalf("result: %+v", result)
	}

	var releases []models.Release
	db.Where("project_id = ?", project.ID).Order("id").Find(&releases)
	if len(releases) != 3 || releases[1].Tag != "v1.0" || releases[2].Tag != "v1.1" {
		t.Fatalf("releases: %+v", releases)
	}
	v10, v11 := releases[1].ID, releases[2].ID

	features := featuresOf(t, db, project.ID)
	check := func(title string, want *uint) {
		t.Helper()
		got := features[title].ReleaseID
		if (got == nil) != (want == nil) || (got != nil && *got != *want) {
			t.Errorf("%s: release %v, want %v", title, got, want)
		}
	}
	check("Payment", &v10)
	check("Card payment", &v11)
	check("Receipts", &shipped.ID) // already shipped; stays in v0.9
	check("Search", nil)           // planned into a published release; left alone
	check("Notes", nil)

	// Importing the same list again adds nothing.
	again := decodeImport(t, do(r, http.MethodPost, "/api/v1/playground/import", body))
	if again.ReleasesCreated != 0 || again.Created != 0 {
		t.Fatalf("second import: %+v", again)
	}
}

func TestPlaygroundImportRejectsBadReleases(t *testing.T) {
	db := newTestDB(t)
	owner, _, project := seed(t, db)
	r := playgroundRouter(t, db, owner.ID, "developer")
	id := strconv.Itoa(project.ID)

	cases := map[string]string{
		"unknown release": `{"project_id":` + id + `,"releases":[],"features":[{"key":"a","title":"A","release_key":"r9"}]}`,
		"duplicate name":  `{"project_id":` + id + `,"releases":[{"key":"r1","name":"v1"},{"key":"r2","name":"V1"}],"features":[{"key":"a","title":"A"}]}`,
	}
	for name, body := range cases {
		if w := do(r, http.MethodPost, "/api/v1/playground/import", body); w.Code != http.StatusUnprocessableEntity {
			t.Errorf("%s: %d %s", name, w.Code, w.Body.String())
		}
	}
}
