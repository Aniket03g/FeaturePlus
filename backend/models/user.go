package models

import (
	"fmt"
	"time"

	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
)

type User struct {
	ID       int    `gorm:"primaryKey" json:"id"` // ✅ Changed to int
	Email    string `gorm:"unique;not null" json:"email"`
	Username string `gorm:"unique;not null" json:"username"`
	// Password holds the bcrypt hash and must never be serialised. It was
	// json:"password,omitempty", but a stored hash is never empty, so every
	// endpoint returning a User — or a Project with its Owner preloaded —
	// handed out the hash. Requests that legitimately carry a password bind it
	// through their own request struct, not through this model.
	Password  string    `gorm:"not null" json:"-"`
	Role      string    `gorm:"not null" json:"role"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
	// Add project association
	Projects []Project `gorm:"foreignKey:OwnerID" json:"projects,omitempty"`
	Name     string    `json:"name"`
	// SpaceSeenAt is when they last looked at their My Space dashboard, so it
	// can show what was published since. Nil until the first look.
	SpaceSeenAt *time.Time `json:"-"`
}

// BeforeUpdate cleans password field before update operations if it's empty
func (u *User) BeforeUpdate(tx *gorm.DB) (err error) {
	// Skip password update if it's empty
	if u.Password == "" {
		tx.Statement.Omit("Password")
	}
	return
}

// HashPassword hashes a password and stores it in the User.Password field
func (u *User) HashPassword(password string) error {
	if password == "" {
		return fmt.Errorf("password cannot be empty")
	}

	// Use a reasonable cost (12-14 is recommended)
	cost := 12
	bytes, err := bcrypt.GenerateFromPassword([]byte(password), cost)
	if err != nil {
		return fmt.Errorf("failed to hash password: %w", err)
	}

	// Set the hashed password to the user model
	u.Password = string(bytes)
	return nil
}

// CheckPassword verifies if the provided password matches the stored hash
func (u *User) CheckPassword(password string) bool {
	if u.Password == "" || password == "" {
		return false
	}

	err := bcrypt.CompareHashAndPassword([]byte(u.Password), []byte(password))
	return err == nil
}
