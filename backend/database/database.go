package database

import (
	"fmt"
	"os"
	"path/filepath"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

type Database struct {
	DB *gorm.DB
}

// InitDB opens the database at the path given by FP_DB_PATH, falling back to
// test.db in the working directory.
//
// Prefer InitDBAt where the caller knows the path: it does not depend on the
// working directory, which is not a safe assumption for a desktop executable
// that may be launched from anywhere.
func InitDB() (*Database, error) {
	dbPath := os.Getenv("FP_DB_PATH")
	if dbPath == "" {
		dbPath = "test.db"
	}

	return InitDBAt(dbPath)
}

// InitDBAt opens the SQLite database at an explicit path, creating the parent
// directory if it does not exist yet — a fresh desktop install has no data
// directory until the first run creates one.
func InitDBAt(dbPath string) (*Database, error) {
	if dir := filepath.Dir(dbPath); dir != "" && dir != "." {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return nil, fmt.Errorf("failed to create database directory %s: %w", dir, err)
		}
	}

	db, err := gorm.Open(sqlite.Open(dbPath), &gorm.Config{})
	if err != nil {
		return nil, err
	}

	return &Database{DB: db}, nil
}

func (d *Database) Migrate(models ...interface{}) error {
	return d.DB.AutoMigrate(models...)
}

// MigrateReleasesToProjectScoped ensures the releases table has project-scoped unique tags
// by adding project_id and replacing the global UNIQUE(tag) with UNIQUE(project_id, tag).
// For SQLite, removing an inline UNIQUE constraint requires table rebuild.
func (d *Database) MigrateReleasesToProjectScoped() error {
	// Check if releases table exists
	var count int
	if err := d.DB.Raw("SELECT count(*) FROM sqlite_master WHERE type='table' AND name='releases'").Scan(&count).Error; err != nil {
		return err
	}
	if count == 0 {
		return nil
	}

	// Check if project_id column already exists
	var colCount int
	if err := d.DB.Raw("SELECT count(*) FROM pragma_table_info('releases') WHERE name = 'project_id'").Scan(&colCount).Error; err != nil {
		return err
	}
	if colCount > 0 {
		// Column exists; backfill NULLs to avoid NOT NULL failures during AutoMigrate
		// Derive from linked PRs -> features where possible
		backfillSQL := `
UPDATE releases
SET project_id = (
    SELECT f.project_id
    FROM release_prs rp
    JOIN pull_requests p ON rp.pull_request_id = p.id
    JOIN features f ON p.feature_id = f.id
    WHERE rp.release_id = releases.id
    LIMIT 1
)
WHERE project_id IS NULL;
`
		if err := d.DB.Exec(backfillSQL).Error; err != nil {
			return fmt.Errorf("failed to backfill releases.project_id: %w", err)
		}

		// Any remaining NULLs -> set to 0
		if err := d.DB.Exec("UPDATE releases SET project_id = 0 WHERE project_id IS NULL;").Error; err != nil {
			return fmt.Errorf("failed to default project_id to 0: %w", err)
		}

		// Ensure composite unique index exists
		if err := d.DB.Exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_release_project_tag ON releases(project_id, tag);").Error; err != nil {
			return fmt.Errorf("failed to create composite unique index: %w", err)
		}

		return nil
	}

	// Rebuild the releases table with the new schema and composite unique index
	// Disable foreign keys during migration
	if err := d.DB.Exec("PRAGMA foreign_keys = OFF;").Error; err != nil {
		return err
	}

	// Create the new table
	createSQL := `
CREATE TABLE IF NOT EXISTS releases_new (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	project_id INTEGER NOT NULL,
	tag VARCHAR(50) NOT NULL,
	status VARCHAR(20) NOT NULL DEFAULT 'draft',
	notes TEXT,
	created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
	updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
	UNIQUE(project_id, tag)
);
`
	if err := d.DB.Exec(createSQL).Error; err != nil {
		_ = d.DB.Exec("PRAGMA foreign_keys = ON;")
		return fmt.Errorf("failed to create releases_new: %w", err)
	}

	// Copy data from old table, deriving project_id from linked PRs -> features
	copySQL := `
INSERT INTO releases_new (id, project_id, tag, status, notes, created_at, updated_at)
SELECT r.id,
	COALESCE((
		SELECT f.project_id
		FROM release_prs rp
		JOIN pull_requests p ON rp.pull_request_id = p.id
		JOIN features f ON p.feature_id = f.id
		WHERE rp.release_id = r.id
		LIMIT 1
	), 0) AS project_id,
	r.tag, r.status, r.notes, r.created_at, r.updated_at
FROM releases r;
`
	if err := d.DB.Exec(copySQL).Error; err != nil {
		_ = d.DB.Exec("PRAGMA foreign_keys = ON;")
		return fmt.Errorf("failed to copy release data: %w", err)
	}

	// Drop old table and replace
	if err := d.DB.Exec("ALTER TABLE releases RENAME TO releases_old;").Error; err != nil {
		_ = d.DB.Exec("PRAGMA foreign_keys = ON;")
		return fmt.Errorf("failed to rename old releases: %w", err)
	}
	if err := d.DB.Exec("ALTER TABLE releases_new RENAME TO releases;").Error; err != nil {
		_ = d.DB.Exec("PRAGMA foreign_keys = ON;")
		return fmt.Errorf("failed to rename new releases: %w", err)
	}

	// Recreate index on status
	if err := d.DB.Exec("CREATE INDEX IF NOT EXISTS idx_releases_status ON releases(status);").Error; err != nil {
		_ = d.DB.Exec("PRAGMA foreign_keys = ON;")
		return fmt.Errorf("failed to create status index: %w", err)
	}

	// Drop old table
	if err := d.DB.Exec("DROP TABLE IF EXISTS releases_old;").Error; err != nil {
		_ = d.DB.Exec("PRAGMA foreign_keys = ON;")
		return fmt.Errorf("failed to drop old releases table: %w", err)
	}

	// Re-enable foreign keys
	if err := d.DB.Exec("PRAGMA foreign_keys = ON;").Error; err != nil {
		return err
	}

	return nil
}
