package app

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/gin-gonic/gin"
)

// testConfig builds a configuration that points at the real templates and
// static files but writes to a throwaway database, so the suite exercises the
// actual startup path without touching the developer's data.
func testConfig(t *testing.T) Config {
	t.Helper()

	resourceDir, err := filepath.Abs("..")
	if err != nil {
		t.Fatalf("resolving resource dir: %v", err)
	}

	dataDir := t.TempDir()

	return Config{
		Mode:               ModeServer,
		Addr:               "127.0.0.1:0",
		ResourceDir:        resourceDir,
		DataDir:            dataDir,
		DBPath:             filepath.Join(dataDir, "test.db"),
		SourceRoot:         filepath.Dir(resourceDir),
		SourceRoots:        map[int]string{},
		RequireGitHubToken: false,
		RouteDumpPath:      "", // Don't overwrite the checked-in routes.txt
		MaxMultipartMemory: 8 << 20,
		LegacyRoutes:       true,
	}
}

func newTestApp(t *testing.T) *App {
	t.Helper()

	gin.SetMode(gin.TestMode)

	a, err := New(testConfig(t))
	if err != nil {
		t.Fatalf("app.New: %v", err)
	}
	t.Cleanup(func() { _ = a.Close() })

	return a
}

// TestAppStarts is the core Phase 0 guarantee: the application can be fully
// constructed from a Config, with no dependency on the working directory.
func TestAppStarts(t *testing.T) {
	a := newTestApp(t)

	if a.Router == nil {
		t.Fatal("router was not built")
	}
	if len(a.Router.Routes()) == 0 {
		t.Fatal("no routes registered")
	}
}

// TestRouteCoverage guards against a route group being dropped during the move
// out of main.go. The counts are lower bounds, not exact matches, so adding
// routes later does not break the test.
func TestRouteCoverage(t *testing.T) {
	a := newTestApp(t)

	groups := map[string]int{
		"/api/":           50,
		"/web/":           25,
		"/web/fragments/": 25,
	}

	counts := map[string]int{}
	for _, route := range a.Router.Routes() {
		for prefix := range groups {
			if len(route.Path) >= len(prefix) && route.Path[:len(prefix)] == prefix {
				counts[prefix]++
			}
		}
	}

	for prefix, want := range groups {
		if counts[prefix] < want {
			t.Errorf("only %d routes under %s, expected at least %d", counts[prefix], prefix, want)
		}
	}
}

// TestHealthEndpoint checks the app actually serves, and reports its mode.
func TestHealthEndpoint(t *testing.T) {
	a := newTestApp(t)

	w := httptest.NewRecorder()
	a.Router.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/health", nil))

	if w.Code != http.StatusOK {
		t.Fatalf("health returned %d, want 200", w.Code)
	}
	if body := w.Body.String(); body == "" {
		t.Fatal("health returned an empty body")
	}
}

// TestTemplatesRender proves the templates were found and parsed. Before the
// move this depended on the process having been started from inside backend/.
func TestTemplatesRender(t *testing.T) {
	a := newTestApp(t)

	w := httptest.NewRecorder()
	a.Router.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/web/login", nil))

	if w.Code != http.StatusOK {
		t.Fatalf("login page returned %d, want 200", w.Code)
	}
	if w.Body.Len() == 0 {
		t.Fatal("login page rendered empty")
	}
}

// TestStaticFilesResolve proves the static route points at a real directory
// rather than a path relative to the working directory.
func TestStaticFilesResolve(t *testing.T) {
	a := newTestApp(t)

	w := httptest.NewRecorder()
	a.Router.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/static/css/style.css", nil))

	if w.Code != http.StatusOK {
		t.Fatalf("static asset returned %d, want 200", w.Code)
	}
}

// TestListenPicksEphemeralPort covers the desktop case: bind port 0 and learn
// the real port, which the native window needs in order to load anything.
func TestListenPicksEphemeralPort(t *testing.T) {
	a := newTestApp(t)

	addr, err := a.Listen()
	if err != nil {
		t.Fatalf("Listen: %v", err)
	}
	if addr == "" {
		t.Fatal("Listen returned an empty address")
	}
	if url := a.URL(); url == "" {
		t.Fatal("URL returned empty after Listen")
	}
}

// TestValidateRejectsMissingResources checks the failure is a clear error
// rather than a confusing template panic much later in startup.
func TestValidateRejectsMissingResources(t *testing.T) {
	cfg := testConfig(t)
	cfg.ResourceDir = t.TempDir() // Exists, but holds no templates/

	if err := cfg.Validate(); err == nil {
		t.Fatal("Validate accepted a directory with no templates")
	}
}

// TestValidateRequiresGitHubToken keeps the server's existing startup contract.
func TestValidateRequiresGitHubToken(t *testing.T) {
	t.Setenv("GITHUB_TOKEN", "")

	cfg := testConfig(t)
	cfg.RequireGitHubToken = true

	if err := cfg.Validate(); err == nil {
		t.Fatal("Validate accepted a missing GITHUB_TOKEN")
	}
}

// TestDesktopDataDirIsPerUser checks desktop mode keeps its database in the
// user's own directory rather than beside the executable, which on Windows may
// sit under Program Files and be read-only.
func TestDesktopDataDirIsPerUser(t *testing.T) {
	t.Setenv("DATA_PATH", "")

	resourceDir := t.TempDir()
	dataDir := ResolveDataDir(ModeDesktop, resourceDir)

	if dataDir == filepath.Join(resourceDir, "data") {
		t.Errorf("desktop data dir fell back to the install directory: %s", dataDir)
	}
	if filepath.Base(dataDir) != appDirName {
		t.Errorf("desktop data dir = %s, want it to end in %s", dataDir, appDirName)
	}
}

// TestResolveResourceDirHonoursOverride covers the Docker and packaged-app case
// where the location is stated explicitly.
func TestResolveResourceDirHonoursOverride(t *testing.T) {
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, "templates"), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("FP_RESOURCE_DIR", dir)

	if got := ResolveResourceDir(); got != dir {
		t.Errorf("ResolveResourceDir() = %s, want %s", got, dir)
	}
}

func TestParseSourceRoots(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  map[int]string
	}{
		{"empty", "", map[int]string{}},
		{"single", "52=D:\\TaskTrackerGo", map[int]string{52: "D:\\TaskTrackerGo"}},
		{"multiple", "52=D:\\A;53=/srv/b", map[int]string{52: "D:\\A", 53: "/srv/b"}},
		{"spaces trimmed", " 52 = D:\\A ", map[int]string{52: "D:\\A"}},
		{"bad id skipped", "abc=/x;53=/srv/b", map[int]string{53: "/srv/b"}},
		{"missing value skipped", "52=;53=/srv/b", map[int]string{53: "/srv/b"}},
		{"no separator skipped", "garbage;53=/srv/b", map[int]string{53: "/srv/b"}},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := ParseSourceRoots(tc.input)
			if len(got) != len(tc.want) {
				t.Fatalf("got %v, want %v", got, tc.want)
			}
			for k, v := range tc.want {
				if got[k] != v {
					t.Errorf("key %d: got %q, want %q", k, got[k], v)
				}
			}
		})
	}
}
