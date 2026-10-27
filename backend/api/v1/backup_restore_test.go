package v1

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"regexp"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/FeaturePlus/backend/models"
	"github.com/jilio/sqlitefs"
	"gorm.io/gorm"
)

// downloadBackup takes a project's backup as its owner.
func downloadBackup(t *testing.T, db *gorm.DB, files *sqlitefs.SQLiteFS, ownerID, projectID int) []byte {
	t.Helper()
	w := do(backupRouter(t, db, files, ownerID, "developer"), http.MethodGet,
		"/api/v1/projects/"+strconv.Itoa(projectID)+"/backup", "")
	if w.Code != http.StatusOK {
		t.Fatalf("backup: status %d: %s", w.Code, w.Body.String())
	}
	return w.Body.Bytes()
}

// postBackup uploads a backup to the check or restore route.
func postBackup(t *testing.T, db *gorm.DB, files *sqlitefs.SQLiteFS, userID int, route string, body []byte) *httptest.ResponseRecorder {
	t.Helper()
	return upload(backupRouter(t, db, files, userID, "developer"), "/api/v1/backups/"+route, "backup.zip", "application/zip", body)
}

func restored(t *testing.T, w *httptest.ResponseRecorder) RestoreResultDTO {
	t.Helper()
	if w.Code != http.StatusCreated {
		t.Fatalf("restore: status %d: %s", w.Code, w.Body.String())
	}
	var out struct {
		Data RestoreResultDTO `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode: %v", err)
	}
	return out.Data
}

func projectJSON(t *testing.T, zipped []byte) ProjectBackup {
	t.Helper()
	var b ProjectBackup
	if err := json.Unmarshal(readZip(t, zipped)["project.json"], &b); err != nil {
		t.Fatalf("project.json: %v", err)
	}
	return b
}

// normalized is a backup with every id swapped for its place in its list,
// so two backups of the same project made in different databases compare
// equal. A snapshot key that matches no feature becomes "gone" and a count,
// in the order first seen.
func normalized(t *testing.T, b ProjectBackup) ProjectBackup {
	t.Helper()
	place := func(ids []uint) map[uint]uint {
		out := map[uint]uint{0: 0}
		for i, id := range ids {
			out[id] = uint(i + 1)
		}
		return out
	}
	var fs, rs, ts, ps, as, fas, vs, ss []uint
	for _, f := range b.Features {
		fs = append(fs, f.ID)
	}
	for _, r := range b.Releases {
		rs = append(rs, r.ID)
	}
	for _, x := range b.Tasks {
		ts = append(ts, x.ID)
	}
	for _, p := range b.PullRequests {
		ps = append(ps, p.ID)
	}
	for _, a := range b.Attachments {
		as = append(as, a.ID)
	}
	for _, a := range b.FeatureAttachments {
		fas = append(fas, a.ID)
	}
	for _, v := range b.Versions {
		vs = append(vs, v.ID)
	}
	for _, s := range b.SubFeatures {
		ss = append(ss, uint(s.ID))
	}
	F, R, T, P, A, FA, V, S := place(fs), place(rs), place(ts), place(ps), place(as), place(fas), place(vs), place(ss)
	ptr := func(m map[uint]uint, id *uint) *uint {
		if id == nil {
			return nil
		}
		v := m[*id]
		return &v
	}

	b.Project.ID, b.Project.Name = 0, ""
	b.Project.CreatedAt, b.Project.UpdatedAt = time.Time{}, time.Time{}
	for i := range b.Features {
		f := &b.Features[i]
		f.ID, f.ParentID, f.ReleaseID = F[f.ID], ptr(F, f.ParentID), ptr(R, f.ReleaseID)
	}
	for i := range b.SubFeatures {
		s := &b.SubFeatures[i]
		s.ID, s.FeatureID = int(S[uint(s.ID)]), int(F[uint(s.FeatureID)])
	}
	for i := range b.Tasks {
		x := &b.Tasks[i]
		x.ID, x.FeatureID, x.SubFeatureID = T[x.ID], F[x.FeatureID], S[x.SubFeatureID]
	}
	for i := range b.Tags {
		b.Tags[i].FeatureID = F[b.Tags[i].FeatureID]
	}
	byType := map[string]map[uint]uint{"feature": F, "task": T, "pr": P}
	for i := range b.Dependencies {
		d := &b.Dependencies[i]
		d.ParentID, d.ChildID = byType[d.ParentType][d.ParentID], byType[d.ChildType][d.ChildID]
	}
	for i := range b.Attachments {
		a := &b.Attachments[i]
		a.ID, a.TaskID, a.File = A[a.ID], T[a.TaskID], ""
	}
	for i := range b.FeatureAttachments {
		a := &b.FeatureAttachments[i]
		a.ID, a.FeatureID, a.File = FA[a.ID], F[a.FeatureID], ""
	}
	for i := range b.Comments {
		c := &b.Comments[i]
		c.ID, c.TaskID, c.AttachmentID = 0, T[c.TaskID], ptr(A, c.AttachmentID)
	}
	for i := range b.Releases {
		r := &b.Releases[i]
		r.ID = R[r.ID]
		for j := range r.PullRequestIDs {
			r.PullRequestIDs[j] = P[r.PullRequestIDs[j]]
		}
	}
	for i := range b.PullRequests {
		p := &b.PullRequests[i]
		p.ID, p.TaskID, p.FeatureID = P[p.ID], T[p.TaskID], F[p.FeatureID]
	}
	for i := range b.Approvals {
		b.Approvals[i].PullRequestID = P[b.Approvals[i].PullRequestID]
	}
	for i := range b.IntegrationChecks {
		b.IntegrationChecks[i].PullRequestID = P[b.IntegrationChecks[i].PullRequestID]
	}
	for i := range b.FeatureFiles {
		b.FeatureFiles[i].FeatureID = F[b.FeatureFiles[i].FeatureID]
	}
	for i := range b.FeatureCommits {
		b.FeatureCommits[i].FeatureID = F[b.FeatureCommits[i].FeatureID]
	}
	for i := range b.Contracts {
		b.Contracts[i].FeatureID = F[b.Contracts[i].FeatureID]
	}
	for i := range b.FeatureAccess {
		b.FeatureAccess[i].FeatureID = F[b.FeatureAccess[i].FeatureID]
	}

	gone := map[string]string{}
	keys := &snapshotKeys{features: F, releases: R, stale: map[string]string{}}
	snapshot := func(raw json.RawMessage) json.RawMessage {
		out, err := keys.rewrite(raw)
		if err != nil {
			t.Fatalf("snapshot: %v", err)
		}
		// Keys that matched nothing were given random names, here or by the
		// restore; number them in the order they appear.
		out = freshKey.ReplaceAllStringFunc(out, func(key string) string {
			if _, ok := gone[key]; !ok {
				gone[key] = `"gone` + strconv.Itoa(len(gone)+1) + `"`
			}
			return gone[key]
		})
		return json.RawMessage(out)
	}
	for i := range b.Versions {
		v := &b.Versions[i]
		v.ID, v.Snapshot = V[v.ID], snapshot(v.Snapshot)
	}
	for i := range b.Copies {
		c := &b.Copies[i]
		c.ID, c.BaseVersionID, c.MergedVersionID, c.Snapshot = 0, V[c.BaseVersionID], ptr(V, c.MergedVersionID), snapshot(c.Snapshot)
	}
	return b
}

var freshKey = regexp.MustCompile(`"n[0-9a-f]{12}"`)

func TestRestoreGivesBackTheSameProject(t *testing.T) {
	db := newTestDB(t)
	files := newFileStore(t, db)
	fx := seedBackupProject(t, db, files)

	first := downloadBackup(t, db, files, fx.owner.ID, fx.project.ID)
	result := restored(t, postBackup(t, db, files, fx.owner.ID, "restore", first))

	wantName := "Hiking App (restored " + time.Now().Format("2 Jan") + ")"
	if result.ProjectName != wantName || result.ProjectID == fx.project.ID {
		t.Fatalf("restored as %d %q, want a new project called %q", result.ProjectID, result.ProjectName, wantName)
	}
	var project models.Project
	if err := db.First(&project, result.ProjectID).Error; err != nil {
		t.Fatalf("load: %v", err)
	}
	if project.OwnerID != fx.owner.ID {
		t.Errorf("owner %d, want %d", project.OwnerID, fx.owner.ID)
	}

	second := downloadBackup(t, db, files, fx.owner.ID, result.ProjectID)
	before, after := normalized(t, projectJSON(t, first)), normalized(t, projectJSON(t, second))
	if !reflect.DeepEqual(before, after) {
		a, _ := json.MarshalIndent(before, "", " ")
		b, _ := json.MarshalIndent(after, "", " ")
		t.Fatalf("the restored project differs from the original\nbefore:\n%s\nafter:\n%s", a, b)
	}

	// The attached file came back, byte for byte, and downloads from the new task.
	restoredBackup := projectJSON(t, second)
	if got := readZip(t, second)[restoredBackup.Attachments[0].File]; !bytes.Equal(got, fx.fileBytes) {
		t.Errorf("attached file came back as %q", got)
	}
	// So did the feature's picture, under the name its description links to.
	if len(restoredBackup.FeatureAttachments) != 1 || restoredBackup.FeatureAttachments[0].Name != "flow.png" {
		t.Fatalf("feature files came back as %+v", restoredBackup.FeatureAttachments)
	}
	if got := readZip(t, second)[restoredBackup.FeatureAttachments[0].File]; !bytes.Equal(got, fx.featureFileBytes) {
		t.Errorf("feature file came back as %q", got)
	}
	if restoredBackup.Features[0].Notes != "Ask finance about refunds" {
		t.Errorf("notes came back as %q", restoredBackup.Features[0].Notes)
	}
	// The original is untouched.
	var count int64
	db.Model(&models.Feature{}).Where("project_id = ?", fx.project.ID).Count(&count)
	if count != 3 {
		t.Errorf("original project now has %d features", count)
	}
}

func TestRestoredVersionsStillCompare(t *testing.T) {
	db := newTestDB(t)
	files := newFileStore(t, db)
	fx := seedBackupProject(t, db, files)
	result := restored(t, postBackup(t, db, files, fx.owner.ID, "restore",
		downloadBackup(t, db, files, fx.owner.ID, fx.project.ID)))

	compare := func(projectID int) []string {
		var version models.FeatureVersion
		if err := db.Where("project_id = ? AND number = 1", projectID).First(&version).Error; err != nil {
			t.Fatalf("version: %v", err)
		}
		w := do(versionsRouterAs(t, db, fx.owner.ID), http.MethodGet, "/api/v1/projects/"+strconv.Itoa(projectID)+
			"/versions/compare?from="+strconv.Itoa(int(version.ID))+"&to=current", "")
		if w.Code != http.StatusOK {
			t.Fatalf("compare: status %d: %s", w.Code, w.Body.String())
		}
		var out struct {
			Data struct {
				Changes []struct{ Kind, Title string } `json:"changes"`
			} `json:"data"`
		}
		if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
			t.Fatalf("decode: %v", err)
		}
		var changes []string
		for _, ch := range out.Data.Changes {
			changes = append(changes, ch.Kind+" "+ch.Title)
		}
		return changes
	}

	original, after := compare(fx.project.ID), compare(result.ProjectID)
	want := []string{"added Added later", "removed Dropped later"}
	if !reflect.DeepEqual(original, want) {
		t.Fatalf("original compare: %v, want %v", original, want)
	}
	if !reflect.DeepEqual(after, original) {
		t.Errorf("restored compare: %v, want %v", after, original)
	}
}

func TestSnapshotKeysOfRemovedFeaturesNeverMatchANewOne(t *testing.T) {
	// Feature 5 becomes 9. Feature 9 was removed before the backup, so its old
	// key "f9" must not turn into the restored feature 9.
	keys := &snapshotKeys{features: map[uint]uint{5: 9}, releases: map[uint]uint{}, stale: map[string]string{}}
	if got := keys.key("f5"); got != "f9" {
		t.Errorf("f5 became %q, want f9", got)
	}
	gone := keys.key("f9")
	if gone == "f9" || !strings.HasPrefix(gone, "n") {
		t.Errorf("a removed feature's key became %q", gone)
	}
	if again := keys.key("f9"); again != gone {
		t.Errorf("the same removed feature got two keys: %q and %q", gone, again)
	}
	if got := keys.key("n0123abcd"); got != "n0123abcd" {
		t.Errorf("a copy's own key changed to %q", got)
	}
}

func TestRestoreOnAnotherServerMatchesPeopleByEmail(t *testing.T) {
	db := newTestDB(t)
	files := newFileStore(t, db)
	fx := seedBackupProject(t, db, files)
	backup := downloadBackup(t, db, files, fx.owner.ID, fx.project.ID)

	// Another server: the editor has an account (with another number), the
	// owner does not, and someone new restores.
	there := newTestDB(t)
	thereFiles := newFileStore(t, there)
	if err := there.AutoMigrate(&models.SubFeature{}, &models.IntegrationCheck{}); err != nil {
		t.Fatal(err)
	}
	newcomer := models.User{Username: "newcomer", Email: "newcomer@example.com", Password: "x", Role: "developer"}
	mustCreate(t, there, &newcomer)
	editor := models.User{Username: "editor-here", Email: "Other@Example.com", Password: "x", Role: "developer"}
	mustCreate(t, there, &editor)

	w := postBackup(t, there, thereFiles, newcomer.ID, "check", backup)
	if w.Code != http.StatusOK {
		t.Fatalf("check: status %d: %s", w.Code, w.Body.String())
	}
	var check struct {
		Data BackupCheckDTO `json:"data"`
	}
	json.Unmarshal(w.Body.Bytes(), &check)
	if !reflect.DeepEqual(check.Data.Missing, []string{"owner@example.com"}) {
		t.Errorf("missing %v", check.Data.Missing)
	}
	if len(check.Data.People) != 1 || !check.Data.People[0].Found || check.Data.People[0].Role != "editor" {
		t.Errorf("people %+v", check.Data.People)
	}
	// The task and the saved version were the owner's.
	if check.Data.CreditedToYou != 2 {
		t.Errorf("credited %d, want 2", check.Data.CreditedToYou)
	}
	var projects int64
	there.Model(&models.Project{}).Count(&projects)
	if projects != 0 {
		t.Fatalf("the check saved %d projects", projects)
	}

	result := restored(t, postBackup(t, there, thereFiles, newcomer.ID, "restore", backup))
	if result.Report.CreditedToYou != 2 {
		t.Errorf("report credited %d", result.Report.CreditedToYou)
	}
	var project models.Project
	there.First(&project, result.ProjectID)
	if project.OwnerID != newcomer.ID {
		t.Errorf("owner %d, want the person restoring (%d)", project.OwnerID, newcomer.ID)
	}
	var members []models.ProjectMember
	there.Where("project_id = ?", project.ID).Find(&members)
	if len(members) != 1 || members[0].UserID != editor.ID || members[0].Role != models.RoleEditor {
		t.Errorf("members %+v", members)
	}
	var feature models.Feature
	there.Where("project_id = ? AND title = ?", project.ID, "Payments").First(&feature)
	if feature.AssigneeID != uint(editor.ID) {
		t.Errorf("assignee %d, want %d", feature.AssigneeID, editor.ID)
	}
	var task models.Task
	there.Where("task_name = ?", "Card form").First(&task)
	if task.CreatedByUser != uint(newcomer.ID) {
		t.Errorf("task credited to %d, want %d", task.CreatedByUser, newcomer.ID)
	}
	var comment models.Comment
	there.First(&comment)
	if comment.UserID != uint(editor.ID) || comment.AttachmentID == nil {
		t.Errorf("comment %+v", comment)
	}
	var scope models.FeatureScope
	if err := there.Where("project_id = ?", project.ID).First(&scope).Error; err != nil || scope.UserID != editor.ID {
		t.Errorf("feature access %+v (%v)", scope, err)
	}

	// The file downloads through the store, as the attachment route reads it.
	var attachment models.TaskAttachment
	there.Where("task_id = ?", task.ID).First(&attachment)
	data, err := readStoredFile(thereFiles, attachment.FileName)
	if err != nil || !bytes.Equal(data, fx.fileBytes) || originalAttachmentName(attachment.FileName) != "mockup.png" {
		t.Errorf("file %q (%v), name %q", data, err, attachment.FileName)
	}
	// Nothing of GitHub came along.
	var links int64
	there.Model(&models.ProjectGitHub{}).Count(&links)
	if links != 0 {
		t.Errorf("%d GitHub links restored", links)
	}
}

// rezip rebuilds a backup with one entry changed, or removed when change
// returns nil.
func rezip(t *testing.T, original []byte, name string, change func([]byte) []byte) []byte {
	t.Helper()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for entry, data := range readZip(t, original) {
		if entry == name {
			data = change(data)
			if data == nil {
				continue
			}
		}
		f, _ := zw.Create(entry)
		f.Write(data)
	}
	zw.Close()
	return buf.Bytes()
}

func TestRestoreRefusesFilesItCannotUse(t *testing.T) {
	db := newTestDB(t)
	files := newFileStore(t, db)
	fx := seedBackupProject(t, db, files)
	good := downloadBackup(t, db, files, fx.owner.ID, fx.project.ID)
	attachment := projectJSON(t, good).Attachments[0].File

	var before int64
	db.Model(&models.Project{}).Count(&before)

	cases := []struct {
		name string
		body []byte
		want string
	}{
		{"not a zip", []byte("hello"), "not a .zip"},
		{"no project.json", rezip(t, good, "project.json", func([]byte) []byte { return nil }), "project.json is missing"},
		{"made by a newer FeaturePlus", rezip(t, good, "backup-info.json", func(b []byte) []byte {
			return bytes.Replace(b, []byte(`"backup_format": `+strconv.Itoa(backupFormat)), []byte(`"backup_format": 99`), 1)
		}), "newer FeaturePlus"},
		{"project.json edited", rezip(t, good, "project.json", func(b []byte) []byte {
			return bytes.Replace(b, []byte("Payments"), []byte("Paymints"), 1)
		}), "checksum"},
		{"attached file changed", rezip(t, good, attachment, func([]byte) []byte { return []byte("other bytes") }), "missing or has changed"},
		{"attached file removed", rezip(t, good, attachment, func([]byte) []byte { return nil }), "missing or has changed"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			for _, route := range []string{"check", "restore"} {
				w := postBackup(t, db, files, fx.owner.ID, route, tc.body)
				if w.Code != http.StatusUnprocessableEntity || !strings.Contains(w.Body.String(), tc.want) {
					t.Errorf("%s: status %d, want 422 mentioning %q: %s", route, w.Code, tc.want, w.Body.String())
				}
			}
		})
	}

	var after int64
	db.Model(&models.Project{}).Count(&after)
	if after != before {
		t.Errorf("refused backups made %d projects", after-before)
	}
}

func TestRestoreThatFailsPartwayLeavesNothing(t *testing.T) {
	db := newTestDB(t)
	files := newFileStore(t, db)
	fx := seedBackupProject(t, db, files)
	backup := downloadBackup(t, db, files, fx.owner.ID, fx.project.ID)

	count := func() (projects, features, stored int64) {
		db.Model(&models.Project{}).Count(&projects)
		db.Model(&models.Feature{}).Count(&features)
		db.Raw("SELECT COUNT(*) FROM file_metadata").Scan(&stored)
		return
	}
	p0, f0, s0 := count()

	// Pull requests are written after the features and the attached file, so
	// taking their table away makes the restore fail late.
	if err := db.Exec("ALTER TABLE integration_checks RENAME TO integration_checks_away").Error; err != nil {
		t.Fatal(err)
	}
	w := postBackup(t, db, files, fx.owner.ID, "restore", backup)
	if w.Code != http.StatusInternalServerError {
		t.Fatalf("status %d, want 500: %s", w.Code, w.Body.String())
	}
	if p, f, s := count(); p != p0 || f != f0 || s != s0 {
		t.Errorf("a failed restore left projects %d→%d, features %d→%d, files %d→%d", p0, p, f0, f, s0, s)
	}
}

func TestRestoreRefusesABackupOverTheLimit(t *testing.T) {
	db := newTestDB(t)
	files := newFileStore(t, db)
	fx := seedBackupProject(t, db, files)

	big := make([]byte, MaxBackupSize+2<<20)
	w := postBackup(t, db, files, fx.owner.ID, "check", big)
	if w.Code != http.StatusUnprocessableEntity || !strings.Contains(w.Body.String(), "larger than") {
		t.Errorf("status %d: %s", w.Code, w.Body.String())
	}
}
