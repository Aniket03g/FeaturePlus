package services

import (
	"testing"

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
