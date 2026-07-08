package services

import (
	"strings"
	"testing"

	"github.com/FeaturePlus/backend/models"
)

// countingGen is a fake NoteGenerator that records how many times it was called.
type countingGen struct {
	calls int
	reply string
}

func (g *countingGen) GenerateNote(string) (string, error) {
	g.calls++
	return g.reply, nil
}

func newNoteTestDB(t *testing.T) *countingGen {
	t.Helper()
	return &countingGen{reply: "Call before creating a review. Treat ErrTrailClosed as a user-facing message, not a 500."}
}

func TestEnsureNoteGeneratesOnceAndCaches(t *testing.T) {
	db := newTestDB(t)
	if err := db.AutoMigrate(&models.ContractArtifact{}); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	gen := newNoteTestDB(t)
	svc := NewBehaviorNoteService(db)
	svc.SetGenerator(gen)

	art := &models.ContractArtifact{ProjectID: 1, FeatureID: 5, FilePath: "a.go", CommitHash: "c1", Contract: "func F()"}
	if err := db.Create(art).Error; err != nil {
		t.Fatalf("create artifact: %v", err)
	}

	// First call generates.
	note, err := svc.EnsureNote(art.ID, "Reviews feature", "attach review", false)
	if err != nil {
		t.Fatalf("EnsureNote: %v", err)
	}
	if gen.calls != 1 {
		t.Fatalf("want 1 LLM call, got %d", gen.calls)
	}
	if !strings.Contains(note, "// BEHAVIOR NOTE (auto-generated):") {
		t.Errorf("note not formatted as comment block:\n%s", note)
	}

	// Second call on the same (unchanged) artifact returns cache, no new call.
	if _, err := svc.EnsureNote(art.ID, "Reviews feature", "attach review", false); err != nil {
		t.Fatalf("EnsureNote cached: %v", err)
	}
	if gen.calls != 1 {
		t.Errorf("cached call should not hit LLM again; got %d calls", gen.calls)
	}

	// Persisted on the artifact.
	var reloaded models.ContractArtifact
	db.First(&reloaded, art.ID)
	if reloaded.BehaviorNote == "" {
		t.Error("note was not persisted on the artifact")
	}
}

func TestDriftProducesNewArtifactRegeneratesNote(t *testing.T) {
	db := newTestDB(t)
	if err := db.AutoMigrate(&models.ContractArtifact{}); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	gen := newNoteTestDB(t)
	svc := NewBehaviorNoteService(db)
	svc.SetGenerator(gen)

	// v1 at commit c1.
	v1 := &models.ContractArtifact{ProjectID: 1, FeatureID: 5, FilePath: "a.go", CommitHash: "c1", Contract: "func F()"}
	db.Create(v1)
	svc.EnsureNote(v1.ID, "f", "t", false)

	// Source drifted -> a new artifact at commit c2 with an empty note.
	v2 := &models.ContractArtifact{ProjectID: 1, FeatureID: 5, FilePath: "a.go", CommitHash: "c2", Contract: "func F(x int)"}
	db.Create(v2)
	if _, err := svc.EnsureNote(v2.ID, "f", "t", false); err != nil {
		t.Fatalf("EnsureNote v2: %v", err)
	}
	// One call for v1, one for v2 = 2 total (drift regenerated).
	if gen.calls != 2 {
		t.Errorf("drift should regenerate: want 2 calls, got %d", gen.calls)
	}
}

func TestForceRegenerates(t *testing.T) {
	db := newTestDB(t)
	if err := db.AutoMigrate(&models.ContractArtifact{}); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	gen := newNoteTestDB(t)
	svc := NewBehaviorNoteService(db)
	svc.SetGenerator(gen)

	art := &models.ContractArtifact{ProjectID: 1, FeatureID: 5, FilePath: "a.go", CommitHash: "c1", Contract: "func F()"}
	db.Create(art)
	svc.EnsureNote(art.ID, "f", "t", false) // 1
	svc.EnsureNote(art.ID, "f", "t", true)  // force -> 2
	if gen.calls != 2 {
		t.Errorf("force should regenerate: want 2 calls, got %d", gen.calls)
	}
}

func TestContractWithNoteAppends(t *testing.T) {
	a := &models.ContractArtifact{Contract: "func F()", BehaviorNote: "// BEHAVIOR NOTE (auto-generated):\n// Be careful."}
	got := ContractWithNote(a)
	if !strings.Contains(got, "func F()") || !strings.Contains(got, "// Be careful.") {
		t.Errorf("combined output missing parts:\n%s", got)
	}
	// No note -> unchanged.
	b := &models.ContractArtifact{Contract: "func G()"}
	if ContractWithNote(b) != "func G()" {
		t.Errorf("no-note case should be unchanged, got %q", ContractWithNote(b))
	}
}
