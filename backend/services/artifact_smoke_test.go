package services

import (
	"testing"

	"os"
	"path/filepath"
	"strings"

	"github.com/FeaturePlus/backend/models"
)

func TestArtifactUpsertAndFetch(t *testing.T) {
	db := newTestDB(t)
	if err := db.AutoMigrate(&models.ContractArtifact{}); err != nil {
		t.Fatalf("migrate artifacts: %v", err)
	}
	svc := NewContractService(db)

	a := &models.ContractArtifact{ProjectID: 1, FeatureID: 10, FilePath: "a.go", CommitHash: "abc", Language: "go", Contract: "v1"}
	if err := svc.SaveArtifact(a); err != nil {
		t.Fatalf("save v1: %v", err)
	}
	// Same commit -> update in place.
	a2 := &models.ContractArtifact{ProjectID: 1, FeatureID: 10, FilePath: "a.go", CommitHash: "abc", Language: "go", Contract: "v1-updated"}
	if err := svc.SaveArtifact(a2); err != nil {
		t.Fatalf("save v1 update: %v", err)
	}
	// New commit -> new version.
	a3 := &models.ContractArtifact{ProjectID: 1, FeatureID: 10, FilePath: "a.go", CommitHash: "def", Language: "go", Contract: "v2"}
	if err := svc.SaveArtifact(a3); err != nil {
		t.Fatalf("save v2: %v", err)
	}

	var count int64
	db.Model(&models.ContractArtifact{}).Where("file_path = ?", "a.go").Count(&count)
	if count != 2 {
		t.Fatalf("want 2 versions (abc updated, def new), got %d", count)
	}

	atCommit, err := svc.ArtifactAtCommit(1, "a.go", "abc")
	if err != nil || atCommit.Contract != "v1-updated" {
		t.Fatalf("at abc: want v1-updated, got %v err %v", atCommit, err)
	}
	latest, err := svc.LatestArtifact(1, "a.go")
	if err != nil || latest.Contract != "v2" {
		t.Fatalf("latest: want v2, got %v err %v", latest, err)
	}
}

// fakeReader serves canned source for a file path.
type fakeReader struct{ src map[string][]byte }

func (f fakeReader) ReadSource(_ int, path string) ([]byte, error) {
	if b, ok := f.src[path]; ok {
		return b, nil
	}
	return nil, ErrSourceUnavailable
}

func TestContractForStripsBodyAndPersists(t *testing.T) {
	db := newTestDB(t)
	if err := db.AutoMigrate(&models.ContractArtifact{}); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	svc := NewContractService(db)
	src := `package trails

type Trail struct {
	ID     string
	secret string
}

// GetTrailByID looks up a trail.
func GetTrailByID(id string) (*Trail, error) {
	panic("SECRET IMPLEMENTATION DETAIL")
}
`
	svc.SetSourceReader(fakeReader{src: map[string][]byte{"trails/trail.go": []byte(src)}})

	art, err := svc.ContractFor(1, 7, "trails/trail.go", "commit1")
	if err != nil {
		t.Fatalf("ContractFor: %v", err)
	}
	// The contract must contain the signature but NOT the body or unexported field.
	if !strings.Contains(art.Contract, "func GetTrailByID(id string) (*Trail, error)") {
		t.Errorf("contract missing signature:\n%s", art.Contract)
	}
	if strings.Contains(art.Contract, "SECRET IMPLEMENTATION DETAIL") {
		t.Errorf("LEAK: contract contains implementation body:\n%s", art.Contract)
	}
	if strings.Contains(art.Contract, "secret") {
		t.Errorf("LEAK: contract contains unexported field:\n%s", art.Contract)
	}
	// Persisted for reuse.
	if _, err := svc.ArtifactAtCommit(1, "trails/trail.go", "commit1"); err != nil {
		t.Errorf("artifact not persisted: %v", err)
	}
}

func TestFSSourceReaderConfinesToBaseDir(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "ok.go"), []byte("package p"), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}
	r := FSSourceReader{BaseDir: dir}

	// In-tree read works.
	if b, err := r.ReadSource(1, "ok.go"); err != nil || string(b) != "package p" {
		t.Fatalf("in-tree read: got %q err %v", b, err)
	}
	// Path traversal is rejected.
	for _, bad := range []string{"../../../etc/passwd", `..\..\secret`, "/etc/passwd"} {
		if _, err := r.ReadSource(1, bad); err == nil {
			t.Errorf("traversal %q should be rejected", bad)
		}
	}
}
