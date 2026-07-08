package services

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/FeaturePlus/backend/models"
)

// --- Redaction correctness (the security-critical property) ---

func TestRedactPassedHidesEverything(t *testing.T) {
	raw := RunResult{
		Passed:    true,
		RawOutput: "ok  github.com/secret/internal  0.5s\nSECRET IMPLEMENTATION LOG",
	}
	red := Redact(raw, []string{"github.com/secret/internal"})
	if !red.Passed {
		t.Fatal("should be passed")
	}
	if strings.Contains(red.Summary, "SECRET") || len(red.Hints) != 0 {
		t.Errorf("passed result leaked detail: %+v", red)
	}
}

func TestRedactFailedDoesNotLeakRealPathsOrInternals(t *testing.T) {
	repoRoot := `D:\FeaturePlus_Code_MAPPING\FeaturePlus`
	realFile := "trails/trail_service.go"
	raw := RunResult{
		Passed:       false,
		ExitCode:     1,
		SwappedFiles: []string{realFile},
		RawOutput: strings.Join([]string{
			"--- FAIL: TestReviewFlow (0.01s)",
			`    ` + repoRoot + `\trails\trail_service.go:42: internal cache miss for secretKey`,
			"    review_test.go:10: expected ErrTrailClosed, got nil",
			"FAIL github.com/company/app/trails 0.02s",
			"panic: runtime error at " + repoRoot + `\internal\secrets.go:7`,
		}, "\n"),
	}
	red := Redact(raw, []string{repoRoot, realFile, "secretKey"})

	if red.Passed {
		t.Fatal("should be failed")
	}
	joined := red.Summary + " " + strings.Join(red.Hints, " ")

	// None of these secrets may appear anywhere in the redacted output.
	for _, secret := range []string{
		repoRoot, "trail_service.go", "secretKey", "secrets.go",
		"internal cache miss", `\trails\`, "github.com/company",
	} {
		if strings.Contains(joined, secret) {
			t.Errorf("LEAK: redacted output contains %q\n--- output ---\n%s", secret, joined)
		}
	}
	// The contract-level assertion should still be surfaced (sanitized).
	if !strings.Contains(joined, "expected ErrTrailClosed, got nil") {
		t.Errorf("expected sanitized assertion hint to survive, got: %s", joined)
	}
}

func TestRedactDropsHintStillContainingSecret(t *testing.T) {
	// A line where the secret is fused into a token that survives path stripping.
	raw := RunResult{
		Passed:    false,
		RawOutput: "--- FAIL: TestX\n expected SUPERSECRET got value",
	}
	red := Redact(raw, []string{"SUPERSECRET"})
	for _, h := range red.Hints {
		if strings.Contains(h, "SUPERSECRET") {
			t.Errorf("hint leaked secret: %q", h)
		}
	}
}

// --- Integration runner (swap mock for real dependency) ---

// fakeCmd records the last invocation and returns a scripted result.
type fakeCmd struct {
	dir, name string
	args      []string
	output    string
	code      int
}

func (f *fakeCmd) Run(dir, name string, args ...string) (string, int) {
	f.dir, f.name, f.args = dir, name, args
	return f.output, f.code
}

func TestRunIntegrationSwapsMocksForRealSource(t *testing.T) {
	dir := t.TempDir()
	// The collaborator's checkout has a MOCK in place.
	mockPath := filepath.Join(dir, "trails", "trail_service.go")
	os.MkdirAll(filepath.Dir(mockPath), 0o755)
	os.WriteFile(mockPath, []byte("package trails // MOCK"), 0o644)

	fc := &fakeCmd{output: "ok", code: 0}
	r := NewIntegrationRunner()
	r.SetRunner(fc)

	real := map[string]string{"trails/trail_service.go": "package trails // REAL IMPLEMENTATION"}
	res, err := r.RunIntegration(dir, real, []string{"go", "test", "./..."})
	if err != nil {
		t.Fatalf("RunIntegration: %v", err)
	}
	if !res.Passed {
		t.Errorf("want pass, got %+v", res)
	}
	// The mock must have been overwritten with the real source.
	got, _ := os.ReadFile(mockPath)
	if !strings.Contains(string(got), "REAL IMPLEMENTATION") {
		t.Errorf("mock was not swapped for real source, file is: %s", got)
	}
	if fc.name != "go" || len(fc.args) == 0 {
		t.Errorf("test command not invoked correctly: %s %v", fc.name, fc.args)
	}
}

func TestRunIntegrationFailPropagatesExitCode(t *testing.T) {
	dir := t.TempDir()
	fc := &fakeCmd{output: "--- FAIL: TestX", code: 1}
	r := NewIntegrationRunner()
	r.SetRunner(fc)
	res, _ := r.RunIntegration(dir, nil, []string{"go", "test", "./..."})
	if res.Passed || res.ExitCode != 1 {
		t.Errorf("expected failure with exit 1, got %+v", res)
	}
}

// --- Merge gate (never auto-merges; requires both gates) ---

func mergeGateDB(t *testing.T) *MergeGate {
	t.Helper()
	db := newTestDB(t)
	if err := db.AutoMigrate(&models.IntegrationCheck{}, &models.ApprovedPR{}, &models.PullRequest{}); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	return NewMergeGate(db)
}

func TestMergeBlockedWithoutIntegrationCheck(t *testing.T) {
	g := mergeGateDB(t)
	d, err := g.Evaluate(1)
	if err != nil {
		t.Fatalf("Evaluate: %v", err)
	}
	if d.Allowed {
		t.Errorf("must not allow merge without integration check: %+v", d)
	}
}

func TestMergeBlockedWhenIntegrationFailed(t *testing.T) {
	g := mergeGateDB(t)
	g.RecordIntegrationCheck(1, RedactedResult{Passed: false, Summary: "failed"}, "c1")
	// even with a human approval, a failed check blocks
	g.db.Create(&models.ApprovedPR{PullRequestID: 1, UserID: 9, ApprovedAt: time.Now().Unix()})
	d, _ := g.Evaluate(1)
	if d.Allowed {
		t.Errorf("failed integration must block merge: %+v", d)
	}
}

func TestMergeBlockedWithoutHumanApproval(t *testing.T) {
	g := mergeGateDB(t)
	g.RecordIntegrationCheck(1, RedactedResult{Passed: true, Summary: "passed"}, "c1")
	d, _ := g.Evaluate(1)
	if d.Allowed {
		t.Errorf("passing integration alone must not allow merge: %+v", d)
	}
	if !d.IntegrationPassed || d.HumanApproved {
		t.Errorf("unexpected decision state: %+v", d)
	}
}

func TestMergeAllowedWithBothGates(t *testing.T) {
	g := mergeGateDB(t)
	g.RecordIntegrationCheck(1, RedactedResult{Passed: true, Summary: "passed"}, "c1")
	g.db.Create(&models.ApprovedPR{PullRequestID: 1, UserID: 9, ApprovedAt: time.Now().Unix()})
	d, _ := g.Evaluate(1)
	if !d.Allowed || !d.IntegrationPassed || !d.HumanApproved {
		t.Errorf("both gates satisfied should allow (manual) merge: %+v", d)
	}
}

// The latest check wins: a later passing run after a failed one unblocks gate 1.
func TestMergeUsesLatestIntegrationCheck(t *testing.T) {
	g := mergeGateDB(t)
	g.RecordIntegrationCheck(1, RedactedResult{Passed: false, Summary: "failed"}, "c1")
	time.Sleep(5 * time.Millisecond)
	g.RecordIntegrationCheck(1, RedactedResult{Passed: true, Summary: "passed"}, "c2")
	g.db.Create(&models.ApprovedPR{PullRequestID: 1, UserID: 9, ApprovedAt: time.Now().Unix()})
	d, _ := g.Evaluate(1)
	if !d.Allowed {
		t.Errorf("latest passing check should count: %+v", d)
	}
}
