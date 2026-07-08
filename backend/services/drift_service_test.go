package services

import (
	"testing"

	"github.com/FeaturePlus/backend/models"
)

// fakeCommits returns a scripted current commit per file path.
type fakeCommits struct {
	commit map[string]string
}

func (f fakeCommits) CurrentCommit(path string) (string, error) {
	return f.commit[path], nil
}

func driftDB(t *testing.T) *ContractService {
	t.Helper()
	db := newTestDB(t)
	if err := db.AutoMigrate(&models.ContractArtifact{}); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	return NewContractService(db)
}

func TestNoDriftWhenCommitsMatch(t *testing.T) {
	svc := driftDB(t)
	svc.SetCommitResolver(fakeCommits{commit: map[string]string{"a.go": "c1"}})
	svc.SaveArtifact(&models.ContractArtifact{ProjectID: 1, FeatureID: 5, FilePath: "a.go", CommitHash: "c1", Contract: "x"})

	d, err := svc.CheckDrift(1, "a.go")
	if err != nil {
		t.Fatalf("CheckDrift: %v", err)
	}
	if !d.HasArtifact || d.Drifted {
		t.Errorf("expected up-to-date, got %+v", d)
	}
}

func TestDriftWhenSourceMovedAhead(t *testing.T) {
	svc := driftDB(t)
	// Artifact generated at c1, but the file's current commit is c2.
	svc.SetCommitResolver(fakeCommits{commit: map[string]string{"a.go": "c2"}})
	svc.SaveArtifact(&models.ContractArtifact{ProjectID: 1, FeatureID: 5, FilePath: "a.go", CommitHash: "c1", Contract: "x"})

	d, err := svc.CheckDrift(1, "a.go")
	if err != nil {
		t.Fatalf("CheckDrift: %v", err)
	}
	if !d.Drifted {
		t.Errorf("expected drift (c1 vs c2), got %+v", d)
	}
}

func TestNoDriftReportedWhenNoArtifact(t *testing.T) {
	svc := driftDB(t)
	svc.SetCommitResolver(fakeCommits{commit: map[string]string{"a.go": "c2"}})
	d, err := svc.CheckDrift(1, "missing.go")
	if err != nil {
		t.Fatalf("CheckDrift: %v", err)
	}
	if d.HasArtifact || d.Drifted {
		t.Errorf("expected no artifact / no drift, got %+v", d)
	}
}

func TestUnrelatedCommitDoesNotDrift(t *testing.T) {
	svc := driftDB(t)
	// b.go changed (c9) but a.go's own commit is unchanged (c1) — a.go must not drift.
	svc.SetCommitResolver(fakeCommits{commit: map[string]string{"a.go": "c1", "b.go": "c9"}})
	svc.SaveArtifact(&models.ContractArtifact{ProjectID: 1, FeatureID: 5, FilePath: "a.go", CommitHash: "c1", Contract: "x"})

	d, _ := svc.CheckDrift(1, "a.go")
	if d.Drifted {
		t.Errorf("a.go should not drift when only b.go changed, got %+v", d)
	}
}

func TestRegenerateIfDriftedRefreshesArtifact(t *testing.T) {
	svc := driftDB(t)
	svc.SetCommitResolver(fakeCommits{commit: map[string]string{"a.go": "c2"}})
	svc.SetSourceReader(fakeReader{src: map[string][]byte{
		"a.go": []byte("package p\n\n// F does a thing.\nfunc F() error { return nil }\n"),
	}})
	// Stale artifact at c1.
	svc.SaveArtifact(&models.ContractArtifact{ProjectID: 1, FeatureID: 5, FilePath: "a.go", CommitHash: "c1", Contract: "old"})

	res, err := svc.RegenerateIfDrifted(1, 5, "a.go")
	if err != nil {
		t.Fatalf("RegenerateIfDrifted: %v", err)
	}
	if !res.Regenerated {
		t.Fatalf("expected regeneration on drift")
	}
	// The fresh artifact is at the current commit and reflects the new source.
	latest, err := svc.ArtifactAtCommit(1, "a.go", "c2")
	if err != nil {
		t.Fatalf("fresh artifact missing: %v", err)
	}
	if latest.Contract == "old" {
		t.Errorf("artifact was not refreshed")
	}

	// A second call is a no-op now that it's up to date.
	res2, _ := svc.RegenerateIfDrifted(1, 5, "a.go")
	if res2.Regenerated {
		t.Errorf("expected no regeneration when up to date")
	}
}
