package models

import "time"

// ProjectGitHub links a project to the GitHub repository its plan is copied
// into. A project has at most one. Without a row, nothing about the project
// ever leaves FeaturePlus.
//
// The copy goes one way: FeaturePlus writes the plan file and the releases,
// and never reads them back. An edit made to the file on GitHub is overwritten
// by the next sync.
type ProjectGitHub struct {
	ID        uint `gorm:"primaryKey" json:"id"`
	ProjectID int  `gorm:"uniqueIndex;not null" json:"project_id"`

	// Owner and Repo name the repository, as in github.com/<owner>/<repo>.
	Owner string `gorm:"size:100;not null" json:"owner"`
	Repo  string `gorm:"size:100;not null" json:"repo"`

	// Branch is where the plan file is committed and what a release tag points
	// at. It is the repository's default branch when the link is made.
	Branch string `gorm:"size:255;not null" json:"branch"`

	// LastSyncedAt and LastCommitSHA record the last sync that wrote a commit.
	LastSyncedAt  *time.Time `json:"last_synced_at"`
	LastCommitSHA string     `gorm:"size:64" json:"last_commit_sha"`

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// ReleaseGitHub records the GitHub Release made when a release was published,
// so the release screen can link to it and a failed attempt can be retried
// without making a second one.
type ReleaseGitHub struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	ReleaseID uint      `gorm:"uniqueIndex;not null" json:"release_id"`
	URL       string    `gorm:"size:500;not null" json:"url"`
	CreatedAt time.Time `json:"created_at"`
}

// UserGitHub is one FeaturePlus user's connection to GitHub, made through the
// FeaturePlus GitHub App. Its token acts as that user, and only on the
// repositories they installed the app on, so commits and releases show up as
// theirs.
//
// Both tokens are stored encrypted. The access token lasts eight hours and is
// renewed with the refresh token, which lasts six months; after that the user
// connects again.
type UserGitHub struct {
	ID     uint `gorm:"primaryKey" json:"id"`
	UserID int  `gorm:"uniqueIndex;not null" json:"user_id"`

	Login string `gorm:"size:100;not null" json:"login"`

	AccessToken      string     `gorm:"type:text;not null" json:"-"`
	AccessExpiresAt  *time.Time `json:"-"`
	RefreshToken     string     `gorm:"type:text" json:"-"`
	RefreshExpiresAt *time.Time `json:"-"`

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}
