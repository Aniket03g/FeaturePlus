package app

import (
	"path/filepath"
	"testing"
)

// A brand-new database must open more than once: the first start creates the
// schema, and every later start must accept the schema the first one made.
func TestOpenDatabaseTwiceOnFreshFile(t *testing.T) {
	cfg := Config{DBPath: filepath.Join(t.TempDir(), "fresh.db")}

	for start := 1; start <= 2; start++ {
		db, err := openDatabase(cfg)
		if err != nil {
			t.Fatalf("start %d: %v", start, err)
		}
		sqlDB, _ := db.DB.DB()
		_ = sqlDB.Close()
	}
}
