package contracts

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

const trailsContract = `package trails

// Trail is a hiking trail.
type Trail struct {
	ID         string
	Name       string
	Difficulty string
}

var ErrTrailNotFound = errors.New("trail not found")
var ErrTrailClosed = errors.New("trail closed")

// GetTrailByID looks up a trail by ID.
func GetTrailByID(id string) (*Trail, error)

// ListTrails returns all trails.
func ListTrails() ([]Trail, error)
`

func TestMockDispatchesEachSentinelError(t *testing.T) {
	mock, err := GenerateMock("trail_service.go", []byte(trailsContract))
	if err != nil {
		t.Fatalf("GenerateMock: %v", err)
	}
	// Each declared sentinel error must be reachable via a magic input case.
	for _, want := range []string{
		`case "trail-not-found":`, "ErrTrailNotFound",
		`case "trail-closed":`, "ErrTrailClosed",
	} {
		if !strings.Contains(mock, want) {
			t.Errorf("mock missing sentinel dispatch %q\n--- mock ---\n%s", want, mock)
		}
	}
	// Happy path returns a synthetic fixture, not real data.
	if !strings.Contains(mock, `Trail{ID: "mock-id"`) {
		t.Errorf("mock missing synthetic happy-path fixture\n--- mock ---\n%s", mock)
	}
}

func TestMockCompiles(t *testing.T) {
	goBin, err := exec.LookPath("go")
	if err != nil {
		t.Skip("go toolchain not available")
	}
	mock, err := GenerateMock("trail_service.go", []byte(trailsContract))
	if err != nil {
		t.Fatalf("GenerateMock: %v", err)
	}

	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "trails_mock.go"), []byte(mock), 0o644); err != nil {
		t.Fatalf("write mock: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "go.mod"), []byte("module mocktest\n\ngo 1.23\n"), 0o644); err != nil {
		t.Fatalf("write go.mod: %v", err)
	}

	cmd := exec.Command(goBin, "build", "./...")
	cmd.Dir = dir
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("generated mock did not compile: %v\n%s\n--- mock ---\n%s", err, out, mock)
	}
}

// The mock, once compiled, must actually return each sentinel error for its
// magic input. We build a tiny program that imports the mock package logic
// inline (same package) and checks the behavior at runtime.
func TestMockReturnsSentinelErrorsAtRuntime(t *testing.T) {
	goBin, err := exec.LookPath("go")
	if err != nil {
		t.Skip("go toolchain not available")
	}
	mock, err := GenerateMock("trail_service.go", []byte(trailsContract))
	if err != nil {
		t.Fatalf("GenerateMock: %v", err)
	}

	// Put the mock in package main and add a main() that exercises it.
	mockMain := strings.Replace(mock, "package trails", "package main", 1)
	driver := `
func main() {
	if _, err := GetTrailByID("trail-not-found"); err != ErrTrailNotFound {
		panic("expected ErrTrailNotFound")
	}
	if _, err := GetTrailByID("trail-closed"); err != ErrTrailClosed {
		panic("expected ErrTrailClosed")
	}
	tr, err := GetTrailByID("anything-else")
	if err != nil || tr == nil || tr.ID != "mock-id" {
		panic("expected synthetic happy-path trail")
	}
	println("ok")
}
`
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "main.go"), []byte(mockMain+"\n"+driver), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "go.mod"), []byte("module mockrun\n\ngo 1.23\n"), 0o644); err != nil {
		t.Fatalf("write go.mod: %v", err)
	}
	cmd := exec.Command(goBin, "run", ".")
	cmd.Dir = dir
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("mock runtime behavior wrong: %v\n%s", err, out)
	}
	if !strings.Contains(string(out), "ok") {
		t.Fatalf("unexpected output: %s", out)
	}
}
