package services

import (
	"os/exec"
	"strings"

	"gorm.io/gorm"
)

// CommitResolver returns the current commit hash for a source file path. It is
// an interface so git can be swapped for a fake in tests.
type CommitResolver interface {
	CurrentCommit(filePath string) (string, error)
}

// GitCommitResolver resolves the commit that last modified a file using git in
// a repository directory.
type GitCommitResolver struct {
	RepoDir string
}

// CurrentCommit runs `git log -1 --format=%H -- <path>` and returns the commit
// that last touched the file. An empty string means the file has no history
// (untracked or missing).
func (g GitCommitResolver) CurrentCommit(filePath string) (string, error) {
	cmd := exec.Command("git", "log", "-1", "--format=%H", "--", filePath)
	cmd.Dir = g.RepoDir
	out, err := cmd.Output()
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(out)), nil
}

// SetCommitResolver attaches a commit resolver used for drift detection.
func (s *ContractService) SetCommitResolver(r CommitResolver) {
	s.commits = r
}

// DriftStatus describes whether a file's persisted contract is stale relative to
// the current source.
type DriftStatus struct {
	FilePath       string `json:"file_path"`
	HasArtifact    bool   `json:"has_artifact"`
	ArtifactCommit string `json:"artifact_commit"`
	CurrentCommit  string `json:"current_commit"`
	Drifted        bool   `json:"drifted"`
}

// CheckDrift reports whether the latest persisted contract for a file was
// generated from an older commit than the file's current commit. A contract
// with no recorded commit, or with no resolver available, is treated as
// non-drifted (we can't prove staleness) except that a missing artifact is
// reported so callers can generate one.
func (s *ContractService) CheckDrift(projectID int, filePath string) (DriftStatus, error) {
	status := DriftStatus{FilePath: filePath}

	artifact, err := s.LatestArtifact(projectID, filePath)
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			return status, nil // HasArtifact stays false
		}
		return status, err
	}
	status.HasArtifact = true
	status.ArtifactCommit = artifact.CommitHash

	if s.commits == nil {
		return status, nil // cannot determine current commit
	}
	current, err := s.commits.CurrentCommit(filePath)
	if err != nil {
		return status, nil // treat unknown as non-drifted, don't fail the read
	}
	status.CurrentCommit = current

	// Drifted when we know both commits and they differ. An artifact generated
	// with an empty commit (unknown provenance) is considered drifted once we
	// have a real current commit, so it gets refreshed.
	if current != "" && current != artifact.CommitHash {
		status.Drifted = true
	}
	return status, nil
}
