package v1

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/FeaturePlus/backend/api"
	"github.com/FeaturePlus/backend/models"
	"github.com/gin-gonic/gin"
	"github.com/jilio/sqlitefs"
	"gorm.io/gorm"
)

// backupRouter mounts the backup routes over a real file store, so attached
// files' bytes go into the backup the way they would on a server.
func backupRouter(t *testing.T, db *gorm.DB, files *sqlitefs.SQLiteFS, userID int, role string) *gin.Engine {
	t.Helper()
	gin.SetMode(gin.TestMode)
	r := gin.New()
	g := r.Group("/api/v1")
	g.Use(func(c *gin.Context) {
		if userID > 0 {
			c.Set(api.ContextUserID, uint(userID))
			c.Set(api.ContextUserRole, role)
		}
		c.Next()
	})
	NewBackupsHandler(db, files).Register(g)
	return r
}

func newFileStore(t *testing.T, db *gorm.DB) *sqlitefs.SQLiteFS {
	t.Helper()
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatalf("sql db: %v", err)
	}
	files, err := sqlitefs.NewSQLiteFS(sqlDB)
	if err != nil {
		t.Fatalf("file store: %v", err)
	}
	return files
}

func mustCreate(t *testing.T, db *gorm.DB, value any) {
	t.Helper()
	if err := db.Create(value).Error; err != nil {
		t.Fatalf("create %T: %v", value, err)
	}
}

// backupFixture is a project with one of everything a backup holds, plus a
// second project and a deleted feature that must stay out of it.
type backupFixture struct {
	owner, other models.User
	project      models.Project
	parent       models.Feature
	child        models.Feature
	task         models.Task
	attachment   models.TaskAttachment
	fileBytes    []byte
	// featureFileBytes is the picture attached to parent, which its
	// description links to.
	featureFileBytes []byte
}

func seedBackupProject(t *testing.T, db *gorm.DB, files *sqlitefs.SQLiteFS) backupFixture {
	t.Helper()
	if err := db.AutoMigrate(&models.SubFeature{}, &models.IntegrationCheck{}); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	owner, other, project := seed(t, db)
	fx := backupFixture{owner: owner, other: other, project: project}

	release := models.Release{ProjectID: project.ID, Tag: "v1.0", Status: models.ReleaseStatusPublished, Notes: "First"}
	mustCreate(t, db, &release)

	fx.parent = models.Feature{ProjectID: project.ID, Title: "Payments", Description: "Take money. ![flow](attachment:flow.png)",
		Notes: "Ask finance about refunds",
		Status: models.StatusInProgress, Priority: models.PriorityHigh, AssigneeID: uint(other.ID), ReleaseID: &release.ID}
	mustCreate(t, db, &fx.parent)
	fx.child = models.Feature{ProjectID: project.ID, Title: "Pay by card", ParentFeatureID: &fx.parent.ID}
	mustCreate(t, db, &fx.child)
	gone := models.Feature{ProjectID: project.ID, Title: "Deleted feature"}
	mustCreate(t, db, &gone)
	if err := db.Delete(&gone).Error; err != nil {
		t.Fatalf("delete: %v", err)
	}

	mustCreate(t, db, &models.Dependency{ParentID: fx.parent.ID, ParentType: models.EntityTypeFeature,
		ChildID: fx.child.ID, ChildType: models.EntityTypeFeature, CreatedByID: uint(owner.ID)})
	mustCreate(t, db, &models.FeatureTag{TagName: "money", FeatureID: fx.parent.ID, CreatedByUser: uint(owner.ID)})
	mustCreate(t, db, &models.SubFeature{FeatureID: int(fx.parent.ID), Title: "Old-style sub-feature"})

	fx.task = models.Task{TaskType: "Dev", TaskName: "Card form", FeatureID: fx.child.ID, CreatedByUser: uint(owner.ID)}
	mustCreate(t, db, &fx.task)

	fx.fileBytes = []byte("\x89PNG pretend picture")
	stored := storedAttachmentName(fx.task.ID, "mockup.png")
	w := files.NewWriter(stored)
	if _, err := w.Write(fx.fileBytes); err != nil {
		t.Fatalf("write file: %v", err)
	}
	if err := w.Close(); err != nil {
		t.Fatalf("close file: %v", err)
	}
	fx.attachment = models.TaskAttachment{TaskID: fx.task.ID, FileName: stored, FileSize: int64(len(fx.fileBytes)), MimeType: "image/png"}
	mustCreate(t, db, &fx.attachment)
	mustCreate(t, db, &models.Comment{TaskID: fx.task.ID, AttachmentID: &fx.attachment.ID, UserID: uint(other.ID), Content: "Looks good"})

	fx.featureFileBytes = []byte("pretend flow chart")
	featureStored := storedFeatureAttachmentName(fx.parent.ID, "flow.png")
	fw := files.NewWriter(featureStored)
	if _, err := fw.Write(fx.featureFileBytes); err != nil {
		t.Fatalf("write file: %v", err)
	}
	if err := fw.Close(); err != nil {
		t.Fatalf("close file: %v", err)
	}
	mustCreate(t, db, &models.FeatureAttachment{FeatureID: fx.parent.ID, Name: "flow.png", FileName: featureStored,
		FileSize: int64(len(fx.featureFileBytes)), MimeType: "image/png"})

	pr := models.PullRequest{TaskID: fx.task.ID, FeatureID: fx.child.ID, URL: "https://github.com/x/y/pull/1", Title: "Card form", Branch: "card"}
	mustCreate(t, db, &pr)
	if err := db.Exec("INSERT INTO release_prs (release_id, pull_request_id) VALUES (?, ?)", release.ID, pr.ID).Error; err != nil {
		t.Fatalf("link release: %v", err)
	}
	mustCreate(t, db, &models.ApprovedPR{PullRequestID: pr.ID, UserID: other.ID, ApprovedAt: 1700000000000})
	mustCreate(t, db, &models.IntegrationCheck{PullRequestID: pr.ID, Passed: true, Summary: "ok"})

	mustCreate(t, db, &models.FeatureFile{FeatureID: fx.child.ID, FilePath: "web/pay.go"})
	mustCreate(t, db, &models.FeatureCommit{FeatureID: fx.child.ID, CommitHash: "abc123"})
	mustCreate(t, db, &models.ContractArtifact{ProjectID: project.ID, FeatureID: fx.parent.ID, FilePath: "pay/api.go", CommitHash: "abc123", Contract: "func Pay()"})
	mustCreate(t, db, &models.FeatureScope{ProjectID: project.ID, FeatureID: fx.child.ID, UserID: other.ID, GrantedByID: owner.ID})

	// A version saved before one feature was dropped and another added, so
	// comparing it with the list has something to show.
	dropped := models.Feature{ProjectID: project.ID, Title: "Dropped later"}
	mustCreate(t, db, &dropped)
	opened, err := openProject(db, &project, true)
	if err != nil {
		t.Fatalf("open project: %v", err)
	}
	raw, _ := json.Marshal(versionSnapshot{Format: snapshotFormat, OpenedProject: opened})
	snapshot := string(raw)
	if err := db.Unscoped().Delete(&dropped).Error; err != nil {
		t.Fatalf("drop: %v", err)
	}
	mustCreate(t, db, &models.Feature{ProjectID: project.ID, Title: "Added later"})
	version := models.FeatureVersion{ProjectID: project.ID, Number: 1, Tag: "v1", SavedByID: owner.ID, FeatureCount: len(opened.Features), Snapshot: snapshot}
	mustCreate(t, db, &version)
	mustCreate(t, db, &models.FeatureCopy{ProjectID: project.ID, Number: 1, BaseVersionID: version.ID, OwnerID: other.ID,
		Revision: 1, Name: "Checkout rework", FeatureCount: 1, Snapshot: snapshot})

	share(t, db, project.ID, other.ID, models.RoleEditor)

	// Someone else's project, which must not leak into this backup.
	elsewhere := models.Project{Name: "Other project", OwnerID: other.ID}
	mustCreate(t, db, &elsewhere)
	mustCreate(t, db, &models.Feature{ProjectID: elsewhere.ID, Title: "Not mine"})

	// A GitHub connection, whose secrets must not reach the backup.
	mustCreate(t, db, &models.ProjectGitHub{ProjectID: project.ID, Owner: "x", Repo: "y", Branch: "main"})
	mustCreate(t, db, &models.UserGitHub{UserID: owner.ID, Login: "owner", AccessToken: "SECRET-TOKEN"})

	return fx
}

// readZip opens a downloaded backup.
func readZip(t *testing.T, body []byte) map[string][]byte {
	t.Helper()
	zr, err := zip.NewReader(bytes.NewReader(body), int64(len(body)))
	if err != nil {
		t.Fatalf("not a zip: %v", err)
	}
	out := map[string][]byte{}
	for _, f := range zr.File {
		rc, err := f.Open()
		if err != nil {
			t.Fatalf("open %s: %v", f.Name, err)
		}
		data, _ := io.ReadAll(rc)
		rc.Close()
		out[f.Name] = data
	}
	return out
}

func TestBackupHoldsEverythingInTheProject(t *testing.T) {
	db := newTestDB(t)
	files := newFileStore(t, db)
	fx := seedBackupProject(t, db, files)
	r := backupRouter(t, db, files, fx.owner.ID, "developer")

	w := do(r, http.MethodGet, "/api/v1/projects/"+strconv.Itoa(fx.project.ID)+"/backup", "")
	if w.Code != http.StatusOK {
		t.Fatalf("status %d: %s", w.Code, w.Body.String())
	}
	want := "hiking-app_backup_" + time.Now().Format("2006-01-02") + ".zip"
	if got := w.Header().Get("Content-Disposition"); !strings.Contains(got, want) {
		t.Errorf("file name: %q, want %q", got, want)
	}

	zipped := readZip(t, w.Body.Bytes())
	for _, name := range []string{"backup-info.json", "project.json", "plan.md"} {
		if _, ok := zipped[name]; !ok {
			t.Fatalf("missing %s; have %v", name, keysOf(zipped))
		}
	}

	var info BackupInfo
	if err := json.Unmarshal(zipped["backup-info.json"], &info); err != nil {
		t.Fatalf("info: %v", err)
	}
	sum := sha256.Sum256(zipped["project.json"])
	if info.Checksum != "sha256:"+hex.EncodeToString(sum[:]) {
		t.Errorf("checksum %q does not match project.json", info.Checksum)
	}
	if info.BackupFormat != backupFormat || info.ProjectName != "Hiking App" {
		t.Errorf("info: %+v", info)
	}
	wantCounts := BackupCounts{Features: 3, Tasks: 1, Comments: 1, Files: 2, Versions: 1, Copies: 1, Releases: 1, PullRequests: 1, People: 1}
	if info.Counts != wantCounts {
		t.Errorf("counts %+v, want %+v", info.Counts, wantCounts)
	}

	var b ProjectBackup
	if err := json.Unmarshal(zipped["project.json"], &b); err != nil {
		t.Fatalf("project.json: %v", err)
	}
	if b.Project.Owner != "owner@example.com" {
		t.Errorf("owner %q", b.Project.Owner)
	}
	for _, f := range b.Features {
		if f.Title == "Deleted feature" || f.Title == "Not mine" {
			t.Errorf("%q should not be in the backup", f.Title)
		}
	}
	if b.Features[0].Assignee != "other@example.com" || b.Features[0].ReleaseID == nil {
		t.Errorf("parent feature: %+v", b.Features[0])
	}
	if b.Features[1].ParentID == nil || *b.Features[1].ParentID != fx.parent.ID {
		t.Errorf("child feature lost its parent: %+v", b.Features[1])
	}
	if len(b.Dependencies) != 1 || len(b.Tags) != 1 || len(b.SubFeatures) != 1 {
		t.Errorf("dependencies %d, tags %d, sub-features %d", len(b.Dependencies), len(b.Tags), len(b.SubFeatures))
	}
	if len(b.Comments) != 1 || b.Comments[0].Author != "other@example.com" || b.Comments[0].AttachmentID == nil {
		t.Errorf("comments: %+v", b.Comments)
	}
	if len(b.Releases) != 1 || len(b.Releases[0].PullRequestIDs) != 1 {
		t.Errorf("release lost its pull request: %+v", b.Releases)
	}
	if len(b.Approvals) != 1 || b.Approvals[0].User != "other@example.com" || len(b.IntegrationChecks) != 1 {
		t.Errorf("approvals %+v, checks %+v", b.Approvals, b.IntegrationChecks)
	}
	if len(b.FeatureFiles) != 1 || len(b.FeatureCommits) != 1 || len(b.Contracts) != 1 {
		t.Errorf("files %d, commits %d, contracts %d", len(b.FeatureFiles), len(b.FeatureCommits), len(b.Contracts))
	}
	if len(b.FeatureAccess) != 1 || b.FeatureAccess[0].User != "other@example.com" || b.FeatureAccess[0].GrantedBy != "owner@example.com" {
		t.Errorf("feature access: %+v", b.FeatureAccess)
	}
	if len(b.Members) != 1 || b.Members[0] != (BackupMember{Email: "other@example.com", Role: "editor"}) {
		t.Errorf("members: %+v", b.Members)
	}
	if b.Versions[0].SavedBy != "owner@example.com" || !json.Valid(b.Versions[0].Snapshot) {
		t.Errorf("version: %+v", b.Versions[0])
	}
	if b.Copies[0].Owner != "other@example.com" || b.Copies[0].BaseVersionID != b.Versions[0].ID {
		t.Errorf("copy: %+v", b.Copies[0])
	}

	// The attached file is there, unchanged, under the name its row gives.
	if len(b.Attachments) != 1 {
		t.Fatalf("attachments: %+v", b.Attachments)
	}
	a := b.Attachments[0]
	if a.Name != "mockup.png" || a.File == "" || !bytes.Equal(zipped[a.File], fx.fileBytes) {
		t.Errorf("attachment %+v; bytes in zip %q", a, zipped[a.File])
	}
	fileSum := sha256.Sum256(fx.fileBytes)
	if a.SHA256 != hex.EncodeToString(fileSum[:]) {
		t.Errorf("file checksum %q", a.SHA256)
	}

	// No secrets and no account numbers in disguise.
	all := string(zipped["project.json"])
	for _, leak := range []string{"SECRET-TOKEN", "$2a$", personPrefix} {
		if strings.Contains(all, leak) {
			t.Errorf("project.json contains %q", leak)
		}
	}

	if plan := string(zipped["plan.md"]); !strings.Contains(plan, "Payments") || !strings.Contains(plan, "Part of a FeaturePlus backup") {
		t.Errorf("plan.md:\n%s", plan)
	}
}

func TestBackupKeepsAFileWhoseBytesAreMissing(t *testing.T) {
	db := newTestDB(t)
	files := newFileStore(t, db)
	fx := seedBackupProject(t, db, files)
	broken := models.TaskAttachment{TaskID: fx.task.ID, FileName: storedAttachmentName(fx.task.ID, "lost.pdf"), MimeType: "application/pdf"}
	mustCreate(t, db, &broken)

	w := do(backupRouter(t, db, files, fx.owner.ID, "developer"), http.MethodGet,
		"/api/v1/projects/"+strconv.Itoa(fx.project.ID)+"/backup", "")
	if w.Code != http.StatusOK {
		t.Fatalf("status %d: %s", w.Code, w.Body.String())
	}
	var b ProjectBackup
	if err := json.Unmarshal(readZip(t, w.Body.Bytes())["project.json"], &b); err != nil {
		t.Fatal(err)
	}
	if len(b.Attachments) != 2 || b.Attachments[1].Name != "lost.pdf" || b.Attachments[1].File != "" {
		t.Errorf("attachments: %+v", b.Attachments)
	}
}

func TestOnlyTheOwnerCanDownloadABackup(t *testing.T) {
	db := newTestDB(t)
	files := newFileStore(t, db)
	fx := seedBackupProject(t, db, files)
	path := "/api/v1/projects/" + strconv.Itoa(fx.project.ID) + "/backup"

	viewer := models.User{Username: "viewer", Email: "viewer@example.com", Password: "x", Role: "developer"}
	stranger := models.User{Username: "stranger", Email: "stranger@example.com", Password: "x", Role: "developer"}
	admin := models.User{Username: "admin", Email: "admin@example.com", Password: "x", Role: "admin"}
	for _, u := range []*models.User{&viewer, &stranger, &admin} {
		mustCreate(t, db, u)
	}
	share(t, db, fx.project.ID, viewer.ID, models.RoleViewer)

	cases := []struct {
		name   string
		userID int
		role   string
		want   int
	}{
		{"editor", fx.other.ID, "developer", http.StatusForbidden},
		{"viewer", viewer.ID, "developer", http.StatusForbidden},
		{"admin who is not the owner", admin.ID, "admin", http.StatusForbidden},
		{"someone it is not shared with", stranger.ID, "developer", http.StatusNotFound},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			w := do(backupRouter(t, db, files, tc.userID, tc.role), http.MethodGet, path, "")
			if w.Code != tc.want {
				t.Errorf("status %d, want %d: %s", w.Code, tc.want, w.Body.String())
			}
		})
	}
}

func keysOf(m map[string][]byte) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}
