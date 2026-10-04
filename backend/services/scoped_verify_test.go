package services

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/FeaturePlus/backend/contracts"
	"github.com/FeaturePlus/backend/models"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// TestScopedContractsProject52 is an end-to-end verification against the real
// backend/test.db and the real Task Tracker Go checkout. It proves the three
// access tiers resolve for the "developer" (user 4) on project 52 and that the
// project-aware source reader now serves project 52's code from D:\TaskTrackerGo
// (not the FeaturePlus repo). It skips unless both the DB and that repo exist,
// so it never runs in an unrelated environment.
func TestScopedContractsProject52(t *testing.T) {
	const (
		projectID   = 52
		developerID = 4 // developer@mail.com
		taskRepo    = `D:\TaskTrackerGo`
	)

	dbPath := filepath.Join("..", "test.db")
	if _, err := os.Stat(dbPath); err != nil {
		t.Skipf("real test.db not present (%v)", err)
	}
	if _, err := os.Stat(taskRepo); err != nil {
		t.Skipf("Task Tracker Go repo not present (%v)", err)
	}

	db, err := gorm.Open(sqlite.Open(dbPath), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Silent),
	})
	if err != nil {
		t.Fatalf("open real db: %v", err)
	}

	access := NewAccessService(db)

	// --- Tier resolution for user 4 on project 52 ---------------------------
	cases := []struct {
		path string
		want models.FeatureAccessLevel
		why  string
	}{
		{"handlers/task.go", models.AccessContract, "194 Task Management is a dependency of owned 196"},
		{"models/task.go", models.AccessContract, "194 dependency file"},
		{"handlers/auth.go", models.AccessNone, "192 User Auth is not a dependency of 196 -> invisible"},
		{"models/user.go", models.AccessNone, "192 file -> invisible"},
	}
	for _, tc := range cases {
		fa, err := access.ResolveFileAccess(developerID, projectID, tc.path)
		if err != nil {
			t.Fatalf("ResolveFileAccess(%s): %v", tc.path, err)
		}
		if fa.Level != tc.want {
			t.Errorf("tier for %s = %q, want %q (%s)", tc.path, fa.Level, tc.want, tc.why)
		} else {
			t.Logf("OK  %-18s -> %-8s  (%s)", tc.path, fa.Level, tc.why)
		}
	}

	// User 4 owns feature 196 outright.
	if lvl, err := access.EffectiveFeatureAccess(developerID, projectID, 196); err != nil {
		t.Fatalf("EffectiveFeatureAccess(196): %v", err)
	} else if lvl != models.AccessOwner {
		t.Errorf("feature 196 access = %q, want owner", lvl)
	} else {
		t.Logf("OK  feature 196      -> owner    (developer owns Task Comments)")
	}

	// --- Project-aware source reader: 52 reads from D:\TaskTrackerGo --------
	repoRoot, _ := filepath.Abs(filepath.Join("..", ".."))
	reader := ProjectSourceReader{
		Roots:   map[int]string{projectID: taskRepo},
		Default: repoRoot,
	}

	src, err := reader.ReadSource(projectID, "handlers/task.go")
	if err != nil {
		t.Fatalf("read project 52 source: %v", err)
	}
	if !strings.Contains(string(src), "package handlers") ||
		!strings.Contains(string(src), "func NewTaskHandler") {
		t.Fatalf("project 52 source did not come from Task Tracker Go; got:\n%.200s", src)
	}
	t.Logf("OK  source reader     -> %d bytes read from %s", len(src), taskRepo)

	// An unmapped project falls back to Default (the FeaturePlus repo), and the
	// same relative path must NOT resolve to Task Tracker Go's file.
	if def, err := reader.ReadSource(999, "handlers/task.go"); err == nil &&
		strings.Contains(string(def), "func NewTaskHandler") {
		t.Errorf("unmapped project should not read Task Tracker Go source")
	}

	// --- Stripped contract for the dependency file --------------------------
	contract, err := contracts.ExtractGoContract("handlers/task.go", src)
	if err != nil {
		t.Fatalf("extract contract: %v", err)
	}
	if !strings.Contains(contract, "TaskHandler") {
		t.Errorf("contract should keep exported TaskHandler type")
	}
	if strings.Contains(contract, "ownsProject") {
		t.Errorf("contract leaked unexported method ownsProject")
	}
	if strings.Contains(contract, "c.ShouldBindJSON") || strings.Contains(contract, "c.JSON") {
		t.Errorf("contract leaked implementation body from handler")
	}
	t.Logf("OK  contract stripped -> exported symbols kept, bodies + unexported removed")
}
