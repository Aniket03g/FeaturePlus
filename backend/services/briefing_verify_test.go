package services

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/FeaturePlus/backend/models"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// TestBriefingForDeveloperOnProject52 verifies the scoped onboarding briefing
// against the real backend/test.db and the real Task Tracker Go checkout, using
// the same fixture as TestScopedContractsProject52: user 4 owns feature 196
// (Task Comments), which depends on 194 (Task Management); 192 (User
// Authentication) is unrelated and must stay invisible.
//
// The point of the test is the last assertion: the briefing gathers project
// context and dependency contracts, and still contains no trace of the feature
// the developer has no scope for.
func TestBriefingForDeveloperOnProject52(t *testing.T) {
	const (
		projectID   = 52
		developerID = 4 // developer@mail.com
		ownerID     = 3 // test1@mail.com, owns project 52
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

	repoRoot, _ := filepath.Abs(filepath.Join("..", ".."))
	contract := NewContractService(db)
	contract.SetSourceReader(ProjectSourceReader{
		Roots:   map[int]string{projectID: taskRepo},
		Default: repoRoot,
	})

	brief, err := NewBriefingService(db, contract).BuildBriefing(developerID, projectID)
	if err != nil {
		t.Fatalf("BuildBriefing: %v", err)
	}

	// --- Project context: the gist a contract alone cannot convey ------------
	if brief.Project.Brief == "" {
		t.Error("briefing carries no project brief — the developer learns nothing about the app")
	}
	if brief.Project.TechStack == "" {
		t.Error("briefing carries no tech stack")
	}
	t.Logf("OK  project           -> %q (%s)", brief.Project.Name, brief.Project.TechStack)

	// --- Their own feature ---------------------------------------------------
	if len(brief.YourFeatures) != 1 || brief.YourFeatures[0].ID != 196 {
		t.Fatalf("expected exactly feature 196 as owned, got %+v", brief.YourFeatures)
	}
	t.Logf("OK  owned feature     -> %d %s", brief.YourFeatures[0].ID, brief.YourFeatures[0].Title)

	// --- The dependency, as contracts ---------------------------------------
	if len(brief.Dependencies) != 1 || brief.Dependencies[0].FeatureID != 194 {
		t.Fatalf("expected exactly feature 194 as dependency, got %+v", brief.Dependencies)
	}
	dep := brief.Dependencies[0]
	if len(dep.Files) != 2 {
		t.Errorf("expected 2 dependency files (handlers/task.go, models/task.go), got %d", len(dep.Files))
	}
	for _, f := range dep.Files {
		if f.Unavailable != "" {
			t.Errorf("%s unavailable: %s", f.Path, f.Unavailable)
			continue
		}
		if f.Contract == "" {
			t.Errorf("%s has empty contract", f.Path)
		}
		t.Logf("OK  dependency file   -> %-18s contract %d bytes, mock %d bytes",
			f.Path, len(f.Contract), len(f.Mock))
	}

	// --- The security property ----------------------------------------------
	// Nothing from the unrelated feature, and no implementation bodies from the
	// dependency, may appear anywhere in the assembled document.
	doc := brief.Markdown()
	leaks := []struct{ needle, why string }{
		{"handlers/auth.go", "file of unrelated feature 192"},
		{"models/user.go", "file of unrelated feature 192"},
		{"User Authentication", "title of unrelated feature 192"},
		{"ownsProject", "unexported method from the dependency's implementation"},
		{"c.ShouldBindJSON", "implementation body from the dependency"},
	}
	for _, l := range leaks {
		if strings.Contains(doc, l.needle) {
			t.Errorf("briefing leaked %q (%s)", l.needle, l.why)
		}
	}
	t.Logf("OK  no leaks          -> unrelated feature 192 and all bodies absent from %d-byte briefing", len(doc))

	// --- The project view agrees with the briefing ---------------------------
	// A feature list that still names every feature would contradict a briefing
	// claiming to be complete, so the list must narrow to owned + dependency.
	access := NewAccessService(db)
	var all []models.Feature
	if err := db.Where("project_id = ?", projectID).Order("id").Find(&all).Error; err != nil {
		t.Fatalf("load features: %v", err)
	}
	visible, err := access.FilterVisibleFeatures(developerID, projectID, all)
	if err != nil {
		t.Fatalf("FilterVisibleFeatures: %v", err)
	}
	gotIDs := make([]uint, 0, len(visible))
	for _, f := range visible {
		gotIDs = append(gotIDs, f.ID)
	}
	if len(gotIDs) != 2 || gotIDs[0] != 194 || gotIDs[1] != 196 {
		t.Errorf("developer should see exactly features [194 196], got %v (of %d total)", gotIDs, len(all))
	} else {
		t.Logf("OK  feature list      -> %v of %d (194 contract, 196 owner)", gotIDs, len(all))
	}

	// The project owner is unaffected by filtering.
	if ownerView, err := access.FilterVisibleFeatures(ownerID, projectID, all); err != nil {
		t.Fatalf("FilterVisibleFeatures(owner): %v", err)
	} else if len(ownerView) != len(all) {
		t.Errorf("project owner should see all %d features, got %d", len(all), len(ownerView))
	}

	// A user with no grant anywhere in the project keeps the legacy unfiltered
	// view, so adding scoping cannot blank out pre-Scoped-Contracts projects.
	if legacy, err := access.FilterVisibleFeatures(9999, projectID, all); err != nil {
		t.Fatalf("FilterVisibleFeatures(ungranted): %v", err)
	} else if len(legacy) != len(all) {
		t.Errorf("ungranted user should keep the unfiltered list, got %d of %d", len(legacy), len(all))
	}

	// --- A user with no grant gets nothing, not a partial briefing -----------
	if _, err := NewBriefingService(db, contract).BuildBriefing(ownerID, projectID); err != ErrNoScope {
		t.Errorf("project owner (no explicit grant) should get ErrNoScope, got %v", err)
	}
	if _, err := NewBriefingService(db, contract).BuildBriefing(9999, projectID); err != ErrNoScope {
		t.Errorf("ungranted user should get ErrNoScope, got %v", err)
	}
	t.Logf("OK  ungranted user    -> ErrNoScope (404, invisible)")
}
