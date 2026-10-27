package v1

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/FeaturePlus/backend/api"
	"github.com/FeaturePlus/backend/internal/log"
	"github.com/FeaturePlus/backend/models"
	"github.com/gin-gonic/gin"
	"github.com/jilio/sqlitefs"
	"gorm.io/gorm"
)

// A backup is everything in one project, written to a .zip a person keeps
// outside FeaturePlus and can restore as a new project, here or on another
// server. It holds:
//
//	backup-info.json  what the file is: format, date, counts, checksum
//	project.json      all of the project's data
//	plan.md           the feature list, for a person to read; restore ignores it
//	files/            the attached files, as they were uploaded
//
// The ids in project.json only tie its parts together ("this task belongs to
// feature 101"). Restoring gives everything new ids, so a backup never clashes
// with what is already in a database. People are written as email addresses,
// since account numbers differ between servers. Nothing secret is written: no
// passwords, and no GitHub connection, which is reconnected after a restore.
// Deleted things are left out.

// backupFormat goes up whenever the layout of a backup changes, so a newer
// FeaturePlus can still read old backups and an older one can refuse a newer
// backup instead of reading it wrong.
//
// 2 added feature notes and files attached to features.
const backupFormat = 2

// BackupInfo is backup-info.json.
type BackupInfo struct {
	BackupFormat int          `json:"backup_format"`
	MadeBy       string       `json:"made_by"`
	MadeOn       time.Time    `json:"made_on"`
	ProjectName  string       `json:"project_name"`
	Counts       BackupCounts `json:"counts"`
	// Checksum is the SHA-256 of project.json. project.json holds each
	// attached file's own SHA-256, so this one value covers the whole backup.
	Checksum string `json:"checksum"`
}

// BackupCounts is what a backup holds, shown before anyone restores it.
type BackupCounts struct {
	Features     int `json:"features"`
	Tasks        int `json:"tasks"`
	Comments     int `json:"comments"`
	Files        int `json:"files"`
	Versions     int `json:"versions"`
	Copies       int `json:"copies"`
	Releases     int `json:"releases"`
	PullRequests int `json:"pull_requests"`
	People       int `json:"people"`
}

// ProjectBackup is project.json. People are email addresses; an empty one is
// nobody, or an account that no longer exists.
type ProjectBackup struct {
	Project           BackupProject            `json:"project"`
	Features          []BackupFeature          `json:"features"`
	SubFeatures       []BackupSubFeature       `json:"sub_features"`
	Tasks             []BackupTask             `json:"tasks"`
	Tags              []BackupTag              `json:"tags"`
	Dependencies      []BackupDependency       `json:"dependencies"`
	Comments          []BackupComment          `json:"comments"`
	Attachments       []BackupAttachment       `json:"attachments"`
	// FeatureAttachments are files attached to a feature rather than a task;
	// their FeatureID is set and their TaskID is not.
	FeatureAttachments []BackupAttachment `json:"feature_attachments"`
	Releases          []BackupRelease          `json:"releases"`
	PullRequests      []BackupPullRequest      `json:"pull_requests"`
	Approvals         []BackupApproval         `json:"approvals"`
	IntegrationChecks []BackupIntegrationCheck `json:"integration_checks"`
	FeatureFiles      []BackupFeatureFile      `json:"feature_files"`
	FeatureCommits    []BackupFeatureCommit    `json:"feature_commits"`
	Contracts         []BackupContract         `json:"contracts"`
	Versions          []BackupVersion          `json:"versions"`
	Copies            []BackupCopy             `json:"copies"`
	Members           []BackupMember           `json:"members"`
	FeatureAccess     []BackupFeatureAccess    `json:"feature_access"`
}

type BackupProject struct {
	ID          int            `json:"id"`
	Name        string         `json:"name"`
	Description string         `json:"description"`
	Brief       string         `json:"brief"`
	Owner       string         `json:"owner"`
	Config      map[string]any `json:"config"`
	CreatedAt   time.Time      `json:"created_at"`
	UpdatedAt   time.Time      `json:"updated_at"`
}

type BackupFeature struct {
	ID          uint      `json:"id"`
	ParentID    *uint     `json:"parent_id"`
	ReleaseID   *uint     `json:"release_id"`
	Title       string    `json:"title"`
	Description string    `json:"description"`
	Notes       string    `json:"notes"`
	Category    string    `json:"category"`
	Status      string    `json:"status"`
	Priority    string    `json:"priority"`
	Assignee    string    `json:"assignee"`
	Position    int       `json:"position"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

type BackupSubFeature struct {
	ID          int       `json:"id"`
	FeatureID   int       `json:"feature_id"`
	Title       string    `json:"title"`
	Description string    `json:"description"`
	Status      string    `json:"status"`
	Priority    string    `json:"priority"`
	Assignee    string    `json:"assignee"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

type BackupTask struct {
	ID           uint      `json:"id"`
	FeatureID    uint      `json:"feature_id"`
	SubFeatureID uint      `json:"sub_feature_id"`
	Type         string    `json:"type"`
	Name         string    `json:"name"`
	Description  string    `json:"description"`
	CreatedBy    string    `json:"created_by"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

type BackupTag struct {
	FeatureID uint   `json:"feature_id"`
	Name      string `json:"name"`
	CreatedBy string `json:"created_by"`
}

// BackupDependency says Child needs Parent. Either end is a feature, a task or
// a pull request, named by Type.
type BackupDependency struct {
	ParentType  string    `json:"parent_type"`
	ParentID    uint      `json:"parent_id"`
	ChildType   string    `json:"child_type"`
	ChildID     uint      `json:"child_id"`
	Description string    `json:"description"`
	CreatedBy   string    `json:"created_by"`
	CreatedAt   time.Time `json:"created_at"`
}

type BackupComment struct {
	ID           uint      `json:"id"`
	TaskID       uint      `json:"task_id"`
	AttachmentID *uint     `json:"attachment_id"`
	Author       string    `json:"author"`
	Content      string    `json:"content"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

// BackupAttachment is a file attached to a task. File is where its bytes are
// inside the backup; it is empty when the bytes were missing on the server the
// backup was made on, in which case the file cannot come back.
type BackupAttachment struct {
	ID        uint      `json:"id"`
	TaskID    uint      `json:"task_id"`
	FeatureID uint      `json:"feature_id,omitempty"`
	Name      string    `json:"name"`
	File      string    `json:"file"`
	Size      int64     `json:"size"`
	MimeType  string    `json:"mime_type"`
	SHA256    string    `json:"sha256"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type BackupRelease struct {
	ID             uint      `json:"id"`
	Tag            string    `json:"tag"`
	Status         string    `json:"status"`
	Notes          string    `json:"notes"`
	PullRequestIDs []uint    `json:"pull_request_ids"`
	CreatedAt      time.Time `json:"created_at"`
	UpdatedAt      time.Time `json:"updated_at"`
}

// BackupPullRequest keeps its times as milliseconds, as they are stored.
type BackupPullRequest struct {
	ID          uint   `json:"id"`
	TaskID      uint   `json:"task_id"`
	FeatureID   uint   `json:"feature_id"`
	URL         string `json:"url"`
	Title       string `json:"title"`
	Branch      string `json:"branch"`
	Description string `json:"description"`
	Status      string `json:"status"`
	Tested      bool   `json:"tested"`
	Version     string `json:"version"`
	CreatedAt   int64  `json:"created_at"`
	UpdatedAt   int64  `json:"updated_at"`
}

type BackupApproval struct {
	PullRequestID uint   `json:"pull_request_id"`
	User          string `json:"user"`
	ApprovedAt    int64  `json:"approved_at"`
	Version       string `json:"version"`
}

type BackupIntegrationCheck struct {
	PullRequestID uint      `json:"pull_request_id"`
	Passed        bool      `json:"passed"`
	Summary       string    `json:"summary"`
	CommitHash    string    `json:"commit_hash"`
	CreatedAt     time.Time `json:"created_at"`
}

type BackupFeatureFile struct {
	FeatureID uint   `json:"feature_id"`
	Path      string `json:"path"`
}

type BackupFeatureCommit struct {
	FeatureID  uint   `json:"feature_id"`
	CommitHash string `json:"commit_hash"`
}

type BackupContract struct {
	FeatureID    uint      `json:"feature_id"`
	FilePath     string    `json:"file_path"`
	CommitHash   string    `json:"commit_hash"`
	Language     string    `json:"language"`
	Contract     string    `json:"contract"`
	BehaviorNote string    `json:"behavior_note"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

// BackupVersion is a saved version. Its snapshot is kept as it was saved:
// feature keys "f" and an id, release keys "r" and an id, from this backup's
// ids. A feature removed since keeps the key it had, which matches nothing.
type BackupVersion struct {
	ID           uint            `json:"id"`
	Number       int             `json:"number"`
	Tag          string          `json:"tag"`
	Notes        string          `json:"notes"`
	SavedBy      string          `json:"saved_by"`
	Auto         bool            `json:"auto"`
	FeatureCount int             `json:"feature_count"`
	Snapshot     json.RawMessage `json:"snapshot"`
	CreatedAt    time.Time       `json:"created_at"`
}

type BackupCopy struct {
	ID              uint            `json:"id"`
	Number          int             `json:"number"`
	BaseVersionID   uint            `json:"base_version_id"`
	Owner           string          `json:"owner"`
	Revision        int             `json:"revision"`
	Name            string          `json:"name"`
	FeatureCount    int             `json:"feature_count"`
	Snapshot        json.RawMessage `json:"snapshot"`
	PublishedAt     *time.Time      `json:"published_at"`
	MergedAt        *time.Time      `json:"merged_at"`
	MergedBy        string          `json:"merged_by"`
	MergedVersionID *uint           `json:"merged_version_id"`
	CreatedAt       time.Time       `json:"created_at"`
	UpdatedAt       time.Time       `json:"updated_at"`
}

type BackupMember struct {
	Email string `json:"email"`
	Role  string `json:"role"`
}

type BackupFeatureAccess struct {
	FeatureID uint   `json:"feature_id"`
	User      string `json:"user"`
	Level     string `json:"level"`
	GrantedBy string `json:"granted_by"`
}

// backupFile is an attached file's bytes, read for the zip.
type backupFile struct {
	path string
	data []byte
}

// collectBackup reads everything in a project. The bytes of attached files are
// read from files, which may be nil when attachments are turned off; their
// rows are then kept with no file.
func collectBackup(db *gorm.DB, files *sqlitefs.SQLiteFS, project *models.Project) (ProjectBackup, []backupFile, error) {
	out := ProjectBackup{}
	people := newPeople()

	out.Project = BackupProject{
		ID: project.ID, Name: project.Name, Description: project.Description, Brief: project.Brief,
		Owner: people.ref(project.OwnerID), Config: map[string]any(project.Config),
		CreatedAt: project.CreatedAt, UpdatedAt: project.UpdatedAt,
	}

	var features []models.Feature
	if err := db.Where("project_id = ?", project.ID).Order("position, id").Find(&features).Error; err != nil {
		return out, nil, err
	}
	featureIDs := make([]uint, 0, len(features))
	for _, f := range features {
		featureIDs = append(featureIDs, f.ID)
	}

	var releases []models.Release
	if err := db.Where("project_id = ?", project.ID).Order("id").Find(&releases).Error; err != nil {
		return out, nil, err
	}
	releaseIDs := map[uint]bool{}
	for _, r := range releases {
		releaseIDs[r.ID] = true
	}

	knownFeature := idSet(featureIDs)
	for _, f := range features {
		row := BackupFeature{
			ID: f.ID, Title: f.Title, Description: f.Description, Notes: f.Notes, Category: f.Category,
			Status: string(f.Status), Priority: string(f.Priority), Assignee: people.ref(int(f.AssigneeID)),
			Position: f.Position, CreatedAt: f.CreatedAt, UpdatedAt: f.UpdatedAt,
		}
		// A parent or release outside the project is treated as none, as the
		// list does.
		if f.ParentFeatureID != nil && knownFeature[*f.ParentFeatureID] {
			row.ParentID = f.ParentFeatureID
		}
		if f.ReleaseID != nil && releaseIDs[*f.ReleaseID] {
			row.ReleaseID = f.ReleaseID
		}
		out.Features = append(out.Features, row)
	}

	var subFeatures []models.SubFeature
	var tasks []models.Task
	var tags []models.FeatureTag
	var featureFiles []models.FeatureFile
	var featureCommits []models.FeatureCommit
	var scopes []models.FeatureScope
	if len(featureIDs) > 0 {
		if err := db.Where("feature_id IN ?", featureIDs).Order("id").Find(&subFeatures).Error; err != nil {
			return out, nil, err
		}
		if err := db.Where("feature_id IN ?", featureIDs).Order("id").Find(&tasks).Error; err != nil {
			return out, nil, err
		}
		if err := db.Where("feature_id IN ?", featureIDs).Order("feature_id, tag_name").Find(&tags).Error; err != nil {
			return out, nil, err
		}
		if err := db.Where("feature_id IN ?", featureIDs).Order("id").Find(&featureFiles).Error; err != nil {
			return out, nil, err
		}
		if err := db.Where("feature_id IN ?", featureIDs).Order("id").Find(&featureCommits).Error; err != nil {
			return out, nil, err
		}
		if err := db.Where("project_id = ? AND feature_id IN ?", project.ID, featureIDs).Order("id").Find(&scopes).Error; err != nil {
			return out, nil, err
		}
	}
	for _, s := range subFeatures {
		out.SubFeatures = append(out.SubFeatures, BackupSubFeature{
			ID: s.ID, FeatureID: s.FeatureID, Title: s.Title, Description: s.Description,
			Status: s.Status, Priority: s.Priority, Assignee: people.ref(s.AssigneeID),
			CreatedAt: s.CreatedAt, UpdatedAt: s.UpdatedAt,
		})
	}
	taskIDs := make([]uint, 0, len(tasks))
	for _, t := range tasks {
		taskIDs = append(taskIDs, t.ID)
		out.Tasks = append(out.Tasks, BackupTask{
			ID: t.ID, FeatureID: t.FeatureID, SubFeatureID: t.SubFeatureID, Type: t.TaskType, Name: t.TaskName,
			Description: t.Description, CreatedBy: people.ref(int(t.CreatedByUser)),
			CreatedAt: t.CreatedAt, UpdatedAt: t.UpdatedAt,
		})
	}
	for _, t := range tags {
		out.Tags = append(out.Tags, BackupTag{FeatureID: t.FeatureID, Name: t.TagName, CreatedBy: people.ref(int(t.CreatedByUser))})
	}
	for _, f := range featureFiles {
		out.FeatureFiles = append(out.FeatureFiles, BackupFeatureFile{FeatureID: f.FeatureID, Path: f.FilePath})
	}
	for _, f := range featureCommits {
		out.FeatureCommits = append(out.FeatureCommits, BackupFeatureCommit{FeatureID: f.FeatureID, CommitHash: f.CommitHash})
	}
	for _, s := range scopes {
		out.FeatureAccess = append(out.FeatureAccess, BackupFeatureAccess{
			FeatureID: s.FeatureID, User: people.ref(s.UserID), Level: string(s.AccessLevel), GrantedBy: people.ref(s.GrantedByID),
		})
	}

	var attachments []models.TaskAttachment
	var comments []models.Comment
	if len(taskIDs) > 0 {
		if err := db.Where("task_id IN ?", taskIDs).Order("id").Find(&attachments).Error; err != nil {
			return out, nil, err
		}
		if err := db.Where("task_id IN ?", taskIDs).Order("id").Find(&comments).Error; err != nil {
			return out, nil, err
		}
	}
	var blobs []backupFile
	knownAttachment := map[uint]bool{}
	for _, a := range attachments {
		knownAttachment[a.ID] = true
		row := BackupAttachment{
			ID: a.ID, TaskID: a.TaskID, Name: originalAttachmentName(a.FileName), Size: a.FileSize,
			MimeType: a.MimeType, CreatedAt: a.CreatedAt, UpdatedAt: a.UpdatedAt,
		}
		data, err := readStoredFile(files, a.FileName)
		if err != nil {
			// One broken file should not stop the rest of the project being
			// kept safe. Its row stays, with no file.
			log.WithError(err).WithField("attachment", a.ID).Warn("backup: attached file is missing; kept without its bytes")
		} else {
			sum := sha256.Sum256(data)
			row.File = "files/" + fmt.Sprint(a.ID) + "_" + safeZipName(row.Name)
			row.Size = int64(len(data))
			row.SHA256 = hex.EncodeToString(sum[:])
			blobs = append(blobs, backupFile{path: row.File, data: data})
		}
		out.Attachments = append(out.Attachments, row)
	}

	var featureAttachments []models.FeatureAttachment
	if len(featureIDs) > 0 {
		if err := db.Where("feature_id IN ?", featureIDs).Order("id").Find(&featureAttachments).Error; err != nil {
			return out, nil, err
		}
	}
	for _, a := range featureAttachments {
		row := BackupAttachment{
			ID: a.ID, FeatureID: a.FeatureID, Name: a.Name, Size: a.FileSize,
			MimeType: a.MimeType, CreatedAt: a.CreatedAt, UpdatedAt: a.UpdatedAt,
		}
		data, err := readStoredFile(files, a.FileName)
		if err != nil {
			log.WithError(err).WithField("feature_attachment", a.ID).Warn("backup: attached file is missing; kept without its bytes")
		} else {
			sum := sha256.Sum256(data)
			row.File = "files/feature_" + fmt.Sprint(a.ID) + "_" + safeZipName(row.Name)
			row.Size = int64(len(data))
			row.SHA256 = hex.EncodeToString(sum[:])
			blobs = append(blobs, backupFile{path: row.File, data: data})
		}
		out.FeatureAttachments = append(out.FeatureAttachments, row)
	}

	for _, cm := range comments {
		row := BackupComment{
			ID: cm.ID, TaskID: cm.TaskID, Author: people.ref(int(cm.UserID)), Content: cm.Content,
			CreatedAt: cm.CreatedAt, UpdatedAt: cm.UpdatedAt,
		}
		if cm.AttachmentID != nil && knownAttachment[*cm.AttachmentID] {
			row.AttachmentID = cm.AttachmentID
		}
		out.Comments = append(out.Comments, row)
	}

	// A pull request belongs to the project through its feature or its task.
	var prs []models.PullRequest
	if len(featureIDs) > 0 || len(taskIDs) > 0 {
		q := db.Where("feature_id IN ?", nonEmpty(featureIDs))
		if len(taskIDs) > 0 {
			q = q.Or("task_id IN ?", taskIDs)
		}
		if err := q.Order("id").Find(&prs).Error; err != nil {
			return out, nil, err
		}
	}
	prIDs := make([]uint, 0, len(prs))
	for _, p := range prs {
		prIDs = append(prIDs, p.ID)
		out.PullRequests = append(out.PullRequests, BackupPullRequest{
			ID: p.ID, TaskID: p.TaskID, FeatureID: p.FeatureID, URL: p.URL, Title: p.Title, Branch: p.Branch,
			Description: p.Description, Status: p.Status, Tested: p.Tested, Version: p.Version,
			CreatedAt: p.CreatedAt, UpdatedAt: p.UpdatedAt,
		})
	}
	knownPR := idSet(prIDs)

	releasePRs := map[uint][]uint{}
	if len(releases) > 0 && len(prIDs) > 0 {
		var links []struct {
			ReleaseID     uint
			PullRequestID uint
		}
		releaseList := make([]uint, 0, len(releases))
		for _, r := range releases {
			releaseList = append(releaseList, r.ID)
		}
		if err := db.Table("release_prs").Select("release_id, pull_request_id").
			Where("release_id IN ? AND pull_request_id IN ?", releaseList, prIDs).
			Order("release_id, pull_request_id").Scan(&links).Error; err != nil {
			return out, nil, err
		}
		for _, l := range links {
			releasePRs[l.ReleaseID] = append(releasePRs[l.ReleaseID], l.PullRequestID)
		}
	}
	for _, r := range releases {
		out.Releases = append(out.Releases, BackupRelease{
			ID: r.ID, Tag: r.Tag, Status: string(r.Status), Notes: r.Notes,
			PullRequestIDs: append([]uint{}, releasePRs[r.ID]...), CreatedAt: r.CreatedAt, UpdatedAt: r.UpdatedAt,
		})
	}

	if len(prIDs) > 0 {
		var approvals []models.ApprovedPR
		if err := db.Where("pull_request_id IN ?", prIDs).Order("id").Find(&approvals).Error; err != nil {
			return out, nil, err
		}
		for _, a := range approvals {
			out.Approvals = append(out.Approvals, BackupApproval{
				PullRequestID: a.PullRequestID, User: people.ref(a.UserID), ApprovedAt: a.ApprovedAt, Version: a.Version,
			})
		}
		var checks []models.IntegrationCheck
		if err := db.Where("pull_request_id IN ?", prIDs).Order("id").Find(&checks).Error; err != nil {
			return out, nil, err
		}
		for _, ch := range checks {
			out.IntegrationChecks = append(out.IntegrationChecks, BackupIntegrationCheck{
				PullRequestID: ch.PullRequestID, Passed: ch.Passed, Summary: ch.Summary,
				CommitHash: ch.CommitHash, CreatedAt: ch.CreatedAt,
			})
		}
	}

	// Dependencies are kept when both ends are in the project.
	knownTask := idSet(taskIDs)
	inProject := func(kind models.EntityType, id uint) bool {
		switch kind {
		case models.EntityTypeFeature:
			return knownFeature[id]
		case models.EntityTypeTask:
			return knownTask[id]
		case models.EntityTypePR:
			return knownPR[id]
		}
		return false
	}
	var deps []models.Dependency
	if err := db.Where("(child_type = ? AND child_id IN ?) OR (child_type = ? AND child_id IN ?) OR (child_type = ? AND child_id IN ?)",
		models.EntityTypeFeature, nonEmpty(featureIDs), models.EntityTypeTask, nonEmpty(taskIDs),
		models.EntityTypePR, nonEmpty(prIDs)).Order("id").Find(&deps).Error; err != nil {
		return out, nil, err
	}
	for _, d := range deps {
		if !inProject(d.ParentType, d.ParentID) || !inProject(d.ChildType, d.ChildID) {
			continue
		}
		out.Dependencies = append(out.Dependencies, BackupDependency{
			ParentType: string(d.ParentType), ParentID: d.ParentID, ChildType: string(d.ChildType), ChildID: d.ChildID,
			Description: d.Description, CreatedBy: people.ref(int(d.CreatedByID)), CreatedAt: d.CreatedAt,
		})
	}

	var contracts []models.ContractArtifact
	if err := db.Where("project_id = ?", project.ID).Order("id").Find(&contracts).Error; err != nil {
		return out, nil, err
	}
	for _, ct := range contracts {
		out.Contracts = append(out.Contracts, BackupContract{
			FeatureID: ct.FeatureID, FilePath: ct.FilePath, CommitHash: ct.CommitHash, Language: ct.Language,
			Contract: ct.Contract, BehaviorNote: ct.BehaviorNote, CreatedAt: ct.CreatedAt, UpdatedAt: ct.UpdatedAt,
		})
	}

	var versions []models.FeatureVersion
	if err := db.Where("project_id = ?", project.ID).Order("number").Find(&versions).Error; err != nil {
		return out, nil, err
	}
	for _, v := range versions {
		snap, err := snapshotJSON(v.Snapshot)
		if err != nil {
			return out, nil, fmt.Errorf("version %d: %w", v.Number, err)
		}
		out.Versions = append(out.Versions, BackupVersion{
			ID: v.ID, Number: v.Number, Tag: v.Tag, Notes: v.Notes, SavedBy: people.ref(v.SavedByID),
			Auto: v.Auto, FeatureCount: v.FeatureCount, Snapshot: snap, CreatedAt: v.CreatedAt,
		})
	}

	var copies []models.FeatureCopy
	if err := db.Where("project_id = ?", project.ID).Order("number").Find(&copies).Error; err != nil {
		return out, nil, err
	}
	for _, cp := range copies {
		snap, err := snapshotJSON(cp.Snapshot)
		if err != nil {
			return out, nil, fmt.Errorf("copy %d: %w", cp.Number, err)
		}
		row := BackupCopy{
			ID: cp.ID, Number: cp.Number, BaseVersionID: cp.BaseVersionID, Owner: people.ref(cp.OwnerID),
			Revision: cp.Revision, Name: cp.Name, FeatureCount: cp.FeatureCount, Snapshot: snap,
			PublishedAt: cp.PublishedAt, MergedAt: cp.MergedAt, MergedVersionID: cp.MergedVersionID,
			CreatedAt: cp.CreatedAt, UpdatedAt: cp.UpdatedAt,
		}
		if cp.MergedByID != nil {
			row.MergedBy = people.ref(*cp.MergedByID)
		}
		out.Copies = append(out.Copies, row)
	}

	var members []models.ProjectMember
	if err := db.Where("project_id = ?", project.ID).Order("id").Find(&members).Error; err != nil {
		return out, nil, err
	}
	for _, m := range members {
		out.Members = append(out.Members, BackupMember{Email: people.ref(m.UserID), Role: string(m.Role)})
	}

	// Every person was written as a placeholder; now that all of them are
	// known, they are looked up in one go and swapped for their emails.
	if err := people.resolve(db, &out); err != nil {
		return out, nil, err
	}
	// Members whose account is gone have nobody to restore.
	kept := out.Members[:0]
	for _, m := range out.Members {
		if m.Email != "" {
			kept = append(kept, m)
		}
	}
	out.Members = kept

	return out, blobs, nil
}

// backupCounts sums up a backup for backup-info.json.
func backupCounts(b ProjectBackup) BackupCounts {
	files := 0
	for _, a := range allAttachments(b) {
		if a.File != "" {
			files++
		}
	}
	return BackupCounts{
		Features: len(b.Features), Tasks: len(b.Tasks), Comments: len(b.Comments), Files: files,
		Versions: len(b.Versions), Copies: len(b.Copies), Releases: len(b.Releases),
		PullRequests: len(b.PullRequests), People: len(b.Members),
	}
}

// allAttachments is every attached file in a backup, the tasks' then the
// features'.
func allAttachments(b ProjectBackup) []BackupAttachment {
	return append(append([]BackupAttachment{}, b.Attachments...), b.FeatureAttachments...)
}

// writeBackup writes a project's backup as a zip.
func writeBackup(w io.Writer, db *gorm.DB, files *sqlitefs.SQLiteFS, project *models.Project, now time.Time) error {
	backup, blobs, err := collectBackup(db, files, project)
	if err != nil {
		return err
	}
	data, err := json.MarshalIndent(backup, "", "  ")
	if err != nil {
		return err
	}
	sum := sha256.Sum256(data)
	info := BackupInfo{
		BackupFormat: backupFormat, MadeBy: "FeaturePlus", MadeOn: now.UTC(), ProjectName: project.Name,
		Counts: backupCounts(backup), Checksum: "sha256:" + hex.EncodeToString(sum[:]),
	}
	infoData, err := json.MarshalIndent(info, "", "  ")
	if err != nil {
		return err
	}

	plan, err := backupPlanMarkdown(db, project)
	if err != nil {
		return err
	}

	zw := zip.NewWriter(w)
	write := func(name string, body []byte) error {
		f, err := zw.CreateHeader(&zip.FileHeader{Name: name, Method: zip.Deflate, Modified: now})
		if err != nil {
			return err
		}
		_, err = f.Write(body)
		return err
	}
	if err := write("backup-info.json", infoData); err != nil {
		return err
	}
	if err := write("project.json", data); err != nil {
		return err
	}
	if err := write("plan.md", []byte(plan)); err != nil {
		return err
	}
	for _, b := range blobs {
		if err := write(b.path, b.data); err != nil {
			return err
		}
	}
	return zw.Close()
}

// backupPlanMarkdown is the feature list as GitHub gets it, labelled as part
// of a backup rather than as a synced file.
func backupPlanMarkdown(db *gorm.DB, project *models.Project) (string, error) {
	var features []models.Feature
	if err := db.Where("project_id = ?", project.ID).Order("position, id").Find(&features).Error; err != nil {
		return "", err
	}
	var releases []models.Release
	if err := db.Where("project_id = ?", project.ID).Order("id").Find(&releases).Error; err != nil {
		return "", err
	}
	plan := buildPlanMarkdown(project.Name, releases, features)
	return strings.Replace(plan,
		"> Written by FeaturePlus. Edits made to this file are replaced on the next sync.",
		"> Part of a FeaturePlus backup, for reading. Restoring the backup does not read this file.", 1), nil
}

// backupFileName is what a downloaded backup is called, e.g.
// food-delivery-app_backup_2026-10-26.zip.
func backupFileName(projectName string, now time.Time) string {
	slug := strings.Trim(nonSlug.ReplaceAllString(strings.ToLower(projectName), "-"), "-")
	if slug == "" {
		slug = "project"
	}
	return slug + "_backup_" + now.Format("2006-01-02") + ".zip"
}

var nonSlug = regexp.MustCompile(`[^a-z0-9]+`)

// safeZipName keeps a file's name readable inside the zip without letting it
// reach outside files/.
func safeZipName(name string) string {
	name = strings.Map(func(r rune) rune {
		if r == '/' || r == '\\' || r == ':' || r < 32 {
			return '_'
		}
		return r
	}, name)
	name = strings.TrimLeft(name, ".")
	if name == "" {
		name = "file"
	}
	return name
}

// readStoredFile reads an attached file's bytes from the file store.
func readStoredFile(files *sqlitefs.SQLiteFS, name string) ([]byte, error) {
	if files == nil {
		return nil, fmt.Errorf("attachment storage is not configured")
	}
	f, err := files.Open(name)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	return io.ReadAll(f)
}

// snapshotJSON passes a stored snapshot through as JSON, refusing one that is
// not, since it could not be written into project.json as it is.
func snapshotJSON(raw string) (json.RawMessage, error) {
	if !json.Valid([]byte(raw)) {
		return nil, fmt.Errorf("the saved snapshot is not valid JSON")
	}
	return json.RawMessage(raw), nil
}

func idSet(ids []uint) map[uint]bool {
	out := make(map[uint]bool, len(ids))
	for _, id := range ids {
		out[id] = true
	}
	return out
}

// nonEmpty stands in for an empty id list, which SQL "IN ()" cannot take; no
// row has id 0.
func nonEmpty(ids []uint) []uint {
	if len(ids) == 0 {
		return []uint{0}
	}
	return ids
}

// people turns account numbers into email addresses. While a backup is being
// collected each person is written as a placeholder; resolve then looks them
// all up at once and swaps each placeholder for the email.
type people struct {
	ids map[int]bool
}

func newPeople() *people { return &people{ids: map[int]bool{}} }

const personPrefix = "\x00user:"

func (p *people) ref(id int) string {
	if id <= 0 {
		return ""
	}
	p.ids[id] = true
	return personPrefix + fmt.Sprint(id)
}

func (p *people) resolve(db *gorm.DB, b *ProjectBackup) error {
	emails := map[string]string{}
	if len(p.ids) > 0 {
		ids := make([]int, 0, len(p.ids))
		for id := range p.ids {
			ids = append(ids, id)
		}
		var users []models.User
		if err := db.Select("id, email").Where("id IN ?", ids).Find(&users).Error; err != nil {
			return err
		}
		for _, u := range users {
			emails[personPrefix+fmt.Sprint(u.ID)] = u.Email
		}
	}
	// An account that has since been removed becomes nobody.
	swap := func(s *string) { *s = emails[*s] }

	swap(&b.Project.Owner)
	for i := range b.Features {
		swap(&b.Features[i].Assignee)
	}
	for i := range b.SubFeatures {
		swap(&b.SubFeatures[i].Assignee)
	}
	for i := range b.Tasks {
		swap(&b.Tasks[i].CreatedBy)
	}
	for i := range b.Tags {
		swap(&b.Tags[i].CreatedBy)
	}
	for i := range b.Dependencies {
		swap(&b.Dependencies[i].CreatedBy)
	}
	for i := range b.Comments {
		swap(&b.Comments[i].Author)
	}
	for i := range b.Approvals {
		swap(&b.Approvals[i].User)
	}
	for i := range b.Versions {
		swap(&b.Versions[i].SavedBy)
	}
	for i := range b.Copies {
		swap(&b.Copies[i].Owner)
		swap(&b.Copies[i].MergedBy)
	}
	for i := range b.Members {
		swap(&b.Members[i].Email)
	}
	for i := range b.FeatureAccess {
		swap(&b.FeatureAccess[i].User)
		swap(&b.FeatureAccess[i].GrantedBy)
	}
	return nil
}

// BackupsHandler serves project backups.
type BackupsHandler struct {
	db    *gorm.DB
	files *sqlitefs.SQLiteFS
}

// NewBackupsHandler builds the handler. A nil files store makes backups
// without attached files' bytes.
func NewBackupsHandler(db *gorm.DB, files *sqlitefs.SQLiteFS) *BackupsHandler {
	return &BackupsHandler{db: db, files: files}
}

// Register mounts the backup routes.
func (h *BackupsHandler) Register(g *gin.RouterGroup) {
	g.GET("/projects/:id/backup", h.Download)
	g.POST("/backups/check", h.Check)
	g.POST("/backups/restore", h.Restore)
}

// Download sends a project's backup as a .zip. Only the owner can, since the
// file holds everything in the project; unlike elsewhere, an admin's powers do
// not stretch to taking a copy of someone else's project.
//
// GET /api/v1/projects/:id/backup
func (h *BackupsHandler) Download(c *gin.Context) {
	projectID, err := api.IDParam(c, "id")
	if err != nil {
		api.Fail(c, err)
		return
	}
	project, role, err := requireProjectRole(c, h.db, projectID, canView)
	if err != nil {
		api.Fail(c, err)
		return
	}
	if role != models.RoleOwner {
		api.Fail(c, api.Forbidden("Only the project's owner can download a backup"))
		return
	}

	// Written to memory first, so a failure halfway is an error response
	// rather than a broken file the person thinks is their backup.
	now := time.Now()
	var buf bytes.Buffer
	if err := writeBackup(&buf, h.db, h.files, project, now); err != nil {
		api.Fail(c, api.Internal(err))
		return
	}

	c.Header("Content-Disposition", `attachment; filename="`+backupFileName(project.Name, now)+`"`)
	c.Data(http.StatusOK, "application/zip", buf.Bytes())
	log.WithField("project", project.ID).Info("backup downloaded")
}
