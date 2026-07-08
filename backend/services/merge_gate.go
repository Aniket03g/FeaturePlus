package services

import (
	"time"

	"github.com/FeaturePlus/backend/models"
	"gorm.io/gorm"
)

// MergeGate decides whether a pull request from a scoped collaborator may be
// merged. It enforces the Scoped Contracts rule that a dev's branch NEVER
// auto-merges: a merge requires BOTH a passing trusted-integration check AND a
// human approval from someone with full repo access. The integration run is
// only a gate, not a merge trigger.
type MergeGate struct {
	db *gorm.DB
}

// NewMergeGate constructs a MergeGate.
func NewMergeGate(db *gorm.DB) *MergeGate {
	return &MergeGate{db: db}
}

// RecordIntegrationCheck persists the (already redacted) outcome of an
// integration run for a PR. Recording a pass does NOT merge anything — it only
// satisfies one of the two required gates.
func (g *MergeGate) RecordIntegrationCheck(prID uint, redacted RedactedResult, commit string) error {
	check := models.IntegrationCheck{
		PullRequestID: prID,
		Passed:        redacted.Passed,
		Summary:       redacted.Summary,
		CommitHash:    commit,
		CreatedAt:     time.Now(),
	}
	return g.db.Create(&check).Error
}

// MergeDecision is the result of evaluating the merge gate for a PR.
type MergeDecision struct {
	Allowed           bool     `json:"allowed"`
	IntegrationPassed bool     `json:"integration_passed"`
	HumanApproved     bool     `json:"human_approved"`
	Reasons           []string `json:"reasons"`
}

// Evaluate reports whether a PR satisfies both merge gates. Allowed=true means a
// human MAY now merge it — it is never an instruction to merge automatically.
func (g *MergeGate) Evaluate(prID uint) (MergeDecision, error) {
	d := MergeDecision{}

	// Gate 1: the latest integration check must have passed.
	var latest models.IntegrationCheck
	err := g.db.Where("pull_request_id = ?", prID).
		Order("created_at desc").First(&latest).Error
	switch {
	case err == gorm.ErrRecordNotFound:
		d.Reasons = append(d.Reasons, "No integration check has run yet.")
	case err != nil:
		return d, err
	default:
		d.IntegrationPassed = latest.Passed
		if !latest.Passed {
			d.Reasons = append(d.Reasons, "Integration check failed against the real dependency.")
		}
	}

	// Gate 2: at least one human approval must exist.
	var approvals int64
	if err := g.db.Model(&models.ApprovedPR{}).
		Where("pull_request_id = ?", prID).Count(&approvals).Error; err != nil {
		return d, err
	}
	d.HumanApproved = approvals > 0
	if !d.HumanApproved {
		d.Reasons = append(d.Reasons, "Awaiting human review by someone with full repo access.")
	}

	d.Allowed = d.IntegrationPassed && d.HumanApproved
	if d.Allowed {
		d.Reasons = append(d.Reasons, "Ready to merge: integration passed and a human approved. Merge is still a manual action.")
	}
	return d, nil
}
