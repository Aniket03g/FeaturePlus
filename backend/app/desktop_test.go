package app

import (
	"io"
	"net/http"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

// desktopConfig is the desktop configuration, redirected at a throwaway data
// directory so the test never touches the real per-user one.
func desktopConfig(t *testing.T) Config {
	t.Helper()

	cfg := testConfig(t)
	cfg.Mode = ModeDesktop
	cfg.Addr = "127.0.0.1:0"
	cfg.RequireGitHubToken = false
	cfg.RouteDumpPath = ""
	return cfg
}

// TestDesktopServesTheAppOverLoopback is the Phase 8 guarantee.
//
// The desktop build is a window pointed at this server, so what has to hold is
// that the server comes up on loopback, on a port the operating system chose,
// and serves the same React app and the same API the browser gets. If any of
// that stops being true, the window opens on nothing.
func TestDesktopServesTheAppOverLoopback(t *testing.T) {
	gin.SetMode(gin.TestMode)

	a, err := New(desktopConfig(t))
	if err != nil {
		t.Fatalf("app.New: %v", err)
	}
	t.Cleanup(func() { _ = a.Close() })

	addr, err := a.Listen()
	if err != nil {
		t.Fatalf("listen: %v", err)
	}

	// Loopback only: binding anything else would put the app on whatever
	// network the machine happens to be attached to.
	if !strings.HasPrefix(addr, "127.0.0.1:") {
		t.Fatalf("bound %q, want a loopback address", addr)
	}
	if strings.HasSuffix(addr, ":0") {
		t.Fatalf("bound %q, want a port the OS actually assigned", addr)
	}

	base := a.URL()
	if !strings.HasPrefix(base, "http://127.0.0.1:") {
		t.Fatalf("URL %q, want a loopback http URL", base)
	}

	go func() { _ = a.Serve() }()

	// The window is sent to /app/, so that has to answer with the frontend.
	body, status := get(t, base+"/app/")
	if status != http.StatusOK {
		t.Fatalf("GET /app/ returned %d, want 200", status)
	}
	if !strings.Contains(strings.ToLower(body), "<div id=\"root\"") &&
		!strings.Contains(strings.ToLower(body), "<script") {
		t.Fatalf("/app/ did not serve the frontend: %.200s", body)
	}

	// And the API the frontend talks to has to be on the same origin, or the
	// session cookie will not travel with its requests.
	if _, status := get(t, base+"/api/v1/health"); status != http.StatusOK {
		t.Fatalf("GET /api/v1/health returned %d, want 200", status)
	}
}

// TestDesktopKeepsItsDataOutsideTheInstallDirectory covers the reason desktop
// mode has its own data directory: the folder an application is installed into
// is usually not writable, so a database beside the binary would fail on the
// first write rather than at startup.
func TestDesktopKeepsItsDataOutsideTheInstallDirectory(t *testing.T) {
	resourceDir, err := filepath.Abs("..")
	if err != nil {
		t.Fatalf("abs: %v", err)
	}

	t.Setenv("DATA_PATH", "")

	dir := ResolveDataDir(ModeDesktop, resourceDir)
	if dir == "" {
		t.Fatal("desktop resolved no data directory")
	}
	if strings.HasPrefix(dir, resourceDir) {
		t.Fatalf("desktop data directory %q sits inside the install directory", dir)
	}
}

func get(t *testing.T, url string) (string, int) {
	t.Helper()

	response, err := http.Get(url)
	if err != nil {
		t.Fatalf("GET %s: %v", url, err)
	}
	defer response.Body.Close()

	body, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatalf("reading %s: %v", url, err)
	}

	return string(body), response.StatusCode
}
