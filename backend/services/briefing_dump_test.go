package services

import (
	"os"
	"path/filepath"
	"testing"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// TestDumpBriefing writes the developer's briefing for project 52 to
// reports/briefing-52-dev.md so the rendered document can be read and reviewed
// by eye. It is a reporting aid, not an assertion; run it explicitly with
// -run TestDumpBriefing.
func TestDumpBriefing(t *testing.T) {
	if os.Getenv("FP_DUMP_BRIEFING") == "" {
		t.Skip("set FP_DUMP_BRIEFING=1 to write the briefing document")
	}
	const (
		projectID   = 52
		developerID = 4
		taskRepo    = `D:\TaskTrackerGo`
	)
	db, err := gorm.Open(sqlite.Open(filepath.Join("..", "test.db")), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Silent),
	})
	if err != nil {
		t.Fatalf("open db: %v", err)
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
	out := filepath.Join("..", "..", "reports", "briefing-52-dev.md")
	if err := os.WriteFile(out, []byte(brief.Markdown()), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}
	t.Logf("wrote %s", out)
}
