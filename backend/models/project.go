package models

import (
	"database/sql/driver"
	"encoding/json"
	"fmt"
	"time"

	"gorm.io/gorm"
)

type JSONB map[string]interface{}

func (j *JSONB) Scan(value interface{}) error {
	bytes, ok := value.([]byte)
	if !ok {
		str, ok := value.(string)
		if !ok {
			return fmt.Errorf("Failed to unmarshal JSONB value: %v", value)
		}
		bytes = []byte(str)
	}
	return json.Unmarshal(bytes, j)
}

func (j JSONB) Value() (driver.Value, error) {
	if j == nil {
		return nil, nil
	}
	return json.Marshal(j)
}

type Project struct {
	ID          int       `gorm:"primaryKey" json:"id"`
	Name        string    `gorm:"size:255;not null" json:"name"`
	Description string    `gorm:"type:text" json:"description"`
	OwnerID     int       `gorm:"not null;index" json:"owner_id"` // Foreign key
	CreatedAt   time.Time `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt   time.Time `gorm:"autoUpdateTime" json:"updated_at"`

	// Association to User model (already in your models package)
	Owner User `gorm:"foreignKey:OwnerID" json:"owner"`

	Features []Feature `gorm:"foreignKey:ProjectID" json:"features,omitempty"`

	Config JSONB `gorm:"type:TEXT" json:"config"`
}

func (p *Project) BeforeCreate(tx *gorm.DB) (err error) {
	if p.Config == nil || len(p.Config) == 0 {
		p.Config = JSONB{
			"task_types":       []string{"UI", "Dev", "Db", "Backend"},
			"feature_category": []string{"Auth", "Payment", "Tags", "Tasks", "Features"},
		}
	}
	return nil
}
