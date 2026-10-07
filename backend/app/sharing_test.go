package app

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"strconv"
	"testing"

	"github.com/gin-gonic/gin"
)

// person is one signed-in browser: its own cookie jar against the server.
type person struct {
	t      *testing.T
	base   string
	client *http.Client
}

func newPerson(t *testing.T, base string) *person {
	jar, _ := cookiejar.New(nil)
	return &person{t: t, base: base, client: &http.Client{Jar: jar}}
}

func (p *person) call(method, path, body string) (int, map[string]any) {
	p.t.Helper()
	var reader io.Reader
	if body != "" {
		reader = bytes.NewBufferString(body)
	}
	req, _ := http.NewRequest(method, p.base+path, reader)
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := p.client.Do(req)
	if err != nil {
		p.t.Fatalf("%s %s: %v", method, path, err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	var out map[string]any
	_ = json.Unmarshal(raw, &out)
	return resp.StatusCode, out
}

func (p *person) want(status int, method, path, body string) map[string]any {
	p.t.Helper()
	got, out := p.call(method, path, body)
	if got != status {
		p.t.Fatalf("%s %s = %d, want %d: %v", method, path, got, status, out)
	}
	return out
}

func idOf(t *testing.T, out map[string]any) int {
	t.Helper()
	data, _ := out["data"].(map[string]any)
	id, ok := data["id"].(float64)
	if !ok {
		t.Fatalf("no id in %v", out)
	}
	return int(id)
}

// TestSharingEndToEnd runs the whole application as a hosted server would:
// real sign-up, real session cookies, old routes off. Two people, one project.
func TestSharingEndToEnd(t *testing.T) {
	gin.SetMode(gin.TestMode)
	cfg := testConfig(t)
	cfg.LegacyRoutes = false
	a, err := New(cfg)
	if err != nil {
		t.Fatalf("app.New: %v", err)
	}
	t.Cleanup(func() { _ = a.Close() })

	server := httptest.NewServer(a.Router)
	t.Cleanup(server.Close)

	alice := newPerson(t, server.URL)
	bob := newPerson(t, server.URL)
	alice.want(201, "POST", "/api/v1/auth/signup", `{"name":"Alice","email":"alice@example.com","password":"password123"}`)
	bob.want(201, "POST", "/api/v1/auth/signup", `{"name":"Bob","email":"bob@example.com","password":"password123"}`)

	project := idOf(t, alice.want(201, "POST", "/api/v1/projects", `{"name":"Alice private"}`))
	p := "/api/v1/projects/" + strconv.Itoa(project)

	// Bob cannot see it, or its list entry, or that it exists.
	bob.want(404, "GET", p, "")
	bob.want(404, "GET", p+"/features", "")
	if out := bob.want(200, "GET", "/api/v1/projects", ""); out["meta"].(map[string]any)["total"].(float64) != 0 {
		t.Fatalf("bob's list before sharing: %v", out)
	}

	// Shared as a viewer: he can look, not change.
	alice.want(201, "POST", p+"/members", `{"email":"BOB@example.com","role":"viewer"}`)
	out := bob.want(200, "GET", p, "")
	if role := out["data"].(map[string]any)["my_role"]; role != "viewer" {
		t.Fatalf("my_role = %v, want viewer", role)
	}
	bob.want(403, "POST", p+"/features", `{"title":"From Bob"}`)

	// As an editor he can add work, but not delete or share it.
	bobID := idOf(t, bob.want(200, "GET", "/api/v1/me", ""))
	alice.want(200, "PATCH", p+"/members/"+strconv.Itoa(bobID), `{"role":"editor"}`)
	bob.want(201, "POST", p+"/features", `{"title":"From Bob"}`)
	bob.want(403, "DELETE", p, "")
	bob.want(403, "POST", p+"/members", `{"email":"alice@example.com","role":"viewer"}`)

	// He leaves, and it is hidden again.
	bob.want(204, "DELETE", p+"/members/"+strconv.Itoa(bobID), "")
	bob.want(404, "GET", p, "")

	// Alice signed up first, so she is the admin: Bob's own project is not in
	// her list, but is in the admin view and opens for her.
	bobs := idOf(t, bob.want(201, "POST", "/api/v1/projects", `{"name":"Bob private"}`))
	if out := alice.want(200, "GET", "/api/v1/projects", ""); out["meta"].(map[string]any)["total"].(float64) != 1 {
		t.Fatalf("alice's own list: %v", out)
	}
	if out := alice.want(200, "GET", "/api/v1/projects?all=true", ""); out["meta"].(map[string]any)["total"].(float64) != 2 {
		t.Fatalf("admin view: %v", out)
	}
	out = alice.want(200, "GET", "/api/v1/projects/"+strconv.Itoa(bobs), "")
	if role := out["data"].(map[string]any)["my_role"]; role != "admin" {
		t.Fatalf("admin my_role = %v", role)
	}
	// Bob's ?all=true gets him nothing extra.
	if out := bob.want(200, "GET", "/api/v1/projects?all=true", ""); out["meta"].(map[string]any)["total"].(float64) != 1 {
		t.Fatalf("bob all: %v", out)
	}

	// The old routes are gone; health and the API stay.
	for _, path := range []string{"/api/users", "/api/projects", "/web/dashboard", "/api/auth/login"} {
		if got, _ := bob.call("GET", path, ""); got != 404 {
			t.Errorf("old route %s = %d, want 404", path, got)
		}
	}
	bob.want(200, "GET", "/api/health", "")
}
