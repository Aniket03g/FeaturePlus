package database

import (
	"github.com/FeaturePlus/backend/models"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

type Database struct {
	DB *gorm.DB
}

func InitDB() (*Database, error) {
	db, err := gorm.Open(sqlite.Open("test.db"), &gorm.Config{})
	if err != nil {
		return nil, err
	}

	// Auto-migrate updated models
	db.AutoMigrate(&models.Project{}, &models.Feature{})

	return &Database{DB: db}, nil
}

func (d *Database) Migrate(models ...interface{}) error {
	return d.DB.AutoMigrate(models...)
}
