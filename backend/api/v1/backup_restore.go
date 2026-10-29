package v1

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/FeaturePlus/backend/api"
	"github.com/FeaturePlus/backend/internal/log"
	"github.com/FeaturePlus/backend/models"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// Restoring a backup always makes a new project, owned by whoever restores
// it; nothing already in the database is touched. Everything gets new ids,
// and every link is rewritten to match, including the feature and release
// keys inside saved versions and copies, so Compare and Merge keep working.
// It is written in one transaction, attached files included: a restore that
// fails partway leaves nothing behind.
//
// People are matched by email. Someone with an account here gets back what
// was theirs: their role in the project, their assignments, their access to
// features. Someone without one is skipped; what they wrote (comments, tasks,
// saved versions, copies) is credited to the person restoring, and the
// restore says how much.
//
// A backup is checked before anything is written, and the same check is what
// POST /backups/check answers with, so a person sees what they are about to
// restore and why a file cannot be used.

// MaxBackupSize is the largest backup that can be restored.
const MaxBackupSize = 200 << 20

// maxUnpackedBackup bounds what a backup may unpack to. A zip can claim to
// hold far more than its size, and a file that would fill the memory of the
// server is refused rather than read.
const maxUnpackedBackup = 2 * MaxBackupSize

// openedBackup is a backup that has passed every check.
type openedBackup struct {
	info  BackupInfo
	data  ProjectBackup
	files map[string][]byte
}

// backupProblem is the answer for a file that cannot be restored.
func backupProblem(message string) error {
	return api.Validation(message).WithField("file", message)
}

func damagedBackup(what string) error {
	return backupProblem("This backup is damaged or was changed after it was made (" + what + ")")
}

// readBackup opens a backup and checks it can be restored as it is.
func readBackup(raw []byte) (*openedBackup, error) {
	if len(raw) > MaxBackupSize {
		return nil, backupProblem("That backup is larger than " + humanSize(MaxBackupSize))
	}
	zr, err := zip.NewReader(bytes.NewReader(raw), int64(len(raw)))
	if err != nil {
		return nil, backupProblem("That is not a FeaturePlus backup: it is not a .zip file")
	}
	entries := map[string]*zip.File{}
	for _, f := range zr.File {
		entries[f.Name] = f
	}

	budget := int64(maxUnpackedBackup)
	read := func(name string) ([]byte, error) {
		f, ok := entries[name]
		if !ok {
			return nil, nil
		}
		rc, err := f.Open()
		if err != nil {
			return nil, damagedBackup(name + " cannot be read")
		}
		defer rc.Close()
		data, err := io.ReadAll(io.LimitReader(rc, budget+1))
		if err != nil {
			return nil, damagedBackup(name + " cannot be read")
		}
		if int64(len(data)) > budget {
			return nil, backupProblem("That backup unpacks to more than " + humanSize(maxUnpackedBackup))
		}
		budget -= int64(len(data))
		return data, nil
	}

	infoData, err := read("backup-info.json")
	if err != nil {
		return nil, err
	}
	projectData, err := read("project.json")
	if err != nil {
		return nil, err
	}
	if infoData == nil || projectData == nil {
		return nil, backupProblem("That is not a FeaturePlus backup: backup-info.json or project.json is missing")
	}

	var info BackupInfo
	if err := json.Unmarshal(infoData, &info); err != nil || info.BackupFormat < 1 {
		return nil, backupProblem("That is not a FeaturePlus backup: backup-info.json cannot be read")
	}
	if info.BackupFormat > backupFormat {
		return nil, backupProblem("This backup was made by a newer FeaturePlus. Update FeaturePlus here to restore it")
	}
	sum := sha256.Sum256(projectData)
	if info.Checksum != "sha256:"+hex.EncodeToString(sum[:]) {
		return nil, damagedBackup("project.json does not match its checksum")
	}

	var data ProjectBackup
	if err := json.Unmarshal(projectData, &data); err != nil {
		return nil, damagedBackup("project.json cannot be read")
	}
	if err := checkBackupLinks(&data); err != nil {
		return nil, err
	}

	files := map[string][]byte{}
	for _, a := range allAttachments(data) {
		if a.File == "" {
			continue
		}
		if !strings.HasPrefix(a.File, "files/") {
			return nil, damagedBackup("an attached file is stored outside files/")
		}
		body, err := read(a.File)
		if err != nil {
			return nil, err
		}
		fileSum := sha256.Sum256(body)
		if body == nil || hex.EncodeToString(fileSum[:]) != a.SHA256 {
			return nil, damagedBackup(a.File + " is missing or has changed")
		}
		files[a.File] = body
	}

	return &openedBackup{info: info, data: data, files: files}, nil
}

// checkBackupLinks makes sure every id in project.json points at something
// that is in it, so a restore cannot be half-linked.
func checkBackupLinks(b *ProjectBackup) error {
	if strings.TrimSpace(b.Project.Name) == "" {
		return damagedBackup("the project has no name")
	}
	unique := func(what string, ids []uint) (map[uint]bool, error) {
		set := make(map[uint]bool, len(ids))
		for _, id := range ids {
			if set[id] {
				return nil, damagedBackup("two " + what + " have the same id")
			}
			set[id] = true
		}
		return set, nil
	}

	featureIDs := make([]uint, 0, len(b.Features))
	for _, f := range b.Features {
		featureIDs = append(featureIDs, f.ID)
	}
	features, err := unique("features", featureIDs)
	if err != nil {
		return err
	}
	releaseIDs := make([]uint, 0, len(b.Releases))
	for _, r := range b.Releases {
		releaseIDs = append(releaseIDs, r.ID)
	}
	releases, err := unique("releases", releaseIDs)
	if err != nil {
		return err
	}
	taskIDs := make([]uint, 0, len(b.Tasks))
	for _, t := range b.Tasks {
		taskIDs = append(taskIDs, t.ID)
	}
	tasks, err := unique("tasks", taskIDs)
	if err != nil {
		return err
	}
	prIDs := make([]uint, 0, len(b.PullRequests))
	for _, p := range b.PullRequests {
		prIDs = append(prIDs, p.ID)
	}
	prs, err := unique("pull requests", prIDs)
	if err != nil {
		return err
	}
	attachmentIDs := make([]uint, 0, len(b.Attachments))
	for _, a := range b.Attachments {
		attachmentIDs = append(attachmentIDs, a.ID)
	}
	attachments, err := unique("attached files", attachmentIDs)
	if err != nil {
		return err
	}
	featureAttachmentIDs := make([]uint, 0, len(b.FeatureAttachments))
	for _, a := range b.FeatureAttachments {
		featureAttachmentIDs = append(featureAttachmentIDs, a.ID)
	}
	if _, err := unique("files attached to features", featureAttachmentIDs); err != nil {
		return err
	}
	versionIDs := make([]uint, 0, len(b.Versions))
	for _, v := range b.Versions {
		versionIDs = append(versionIDs, v.ID)
	}
	versions, err := unique("versions", versionIDs)
	if err != nil {
		return err
	}
	subIDs := make([]uint, 0, len(b.SubFeatures))
	for _, s := range b.SubFeatures {
		subIDs = append(subIDs, uint(s.ID))
	}
	subFeatures, err := unique("sub-features", subIDs)
	if err != nil {
		return err
	}

	for _, f := range b.Features {
		if f.ParentID != nil && !features[*f.ParentID] {
			return damagedBackup(`"` + f.Title + `" sits inside a feature that is not in the backup`)
		}
		if f.ReleaseID != nil && !releases[*f.ReleaseID] {
			return damagedBackup(`"` + f.Title + `" is planned into a release that is not in the backup`)
		}
	}
	for _, s := range b.SubFeatures {
		if !features[uint(s.FeatureID)] {
			return damagedBackup("a sub-feature belongs to a feature that is not in the backup")
		}
	}
	for _, t := range b.Tasks {
		if !features[t.FeatureID] {
			return damagedBackup(`task "` + t.Name + `" belongs to a feature that is not in the backup`)
		}
		if t.SubFeatureID != 0 && !subFeatures[t.SubFeatureID] {
			return damagedBackup(`task "` + t.Name + `" belongs to a sub-feature that is not in the backup`)
		}
	}
	for _, list := range [][]uint{tagFeatures(b), fileFeatures(b), commitFeatures(b), contractFeatures(b), accessFeatures(b)} {
		for _, id := range list {
			if !features[id] {
				return damagedBackup("something refers to a feature that is not in the backup")
			}
		}
	}
	for _, a := range b.Attachments {
		if !tasks[a.TaskID] {
			return damagedBackup("an attached file belongs to a task that is not in the backup")
		}
	}
	for _, a := range b.FeatureAttachments {
		if !features[a.FeatureID] {
			return damagedBackup("an attached file belongs to a feature that is not in the backup")
		}
	}
	for _, c := range b.Comments {
		if !tasks[c.TaskID] || (c.AttachmentID != nil && !attachments[*c.AttachmentID]) {
			return damagedBackup("a comment refers to something that is not in the backup")
		}
	}
	for _, p := range b.PullRequests {
		if (p.FeatureID != 0 && !features[p.FeatureID]) || (p.TaskID != 0 && !tasks[p.TaskID]) {
			return damagedBackup("a pull request refers to something that is not in the backup")
		}
	}
	for _, r := range b.Releases {
		for _, id := range r.PullRequestIDs {
			if !prs[id] {
				return damagedBackup(`release "` + r.Tag + `" lists a pull request that is not in the backup`)
			}
		}
	}
	for _, a := range b.Approvals {
		if !prs[a.PullRequestID] {
			return damagedBackup("an approval is for a pull request that is not in the backup")
		}
	}
	for _, ch := range b.IntegrationChecks {
		if !prs[ch.PullRequestID] {
			return damagedBackup("a check is for a pull request that is not in the backup")
		}
	}
	ends := map[string]map[uint]bool{
		string(models.EntityTypeFeature): features,
		string(models.EntityTypeTask):    tasks,
		string(models.EntityTypePR):      prs,
	}
	for _, d := range b.Dependencies {
		parent, child := ends[d.ParentType], ends[d.ChildType]
		if parent == nil || child == nil || !parent[d.ParentID] || !child[d.ChildID] {
			return damagedBackup("a dependency refers to something that is not in the backup")
		}
	}
	for _, v := range b.Versions {
		if !json.Valid(v.Snapshot) {
			return damagedBackup("version " + strconv.Itoa(v.Number) + " cannot be read")
		}
	}
	for _, c := range b.Copies {
		if !versions[c.BaseVersionID] || (c.MergedVersionID != nil && !versions[*c.MergedVersionID]) {
			return damagedBackup("copy " + strconv.Itoa(c.Number) + " refers to a version that is not in the backup")
		}
		if !json.Valid(c.Snapshot) {
			return damagedBackup("copy " + strconv.Itoa(c.Number) + " cannot be read")
		}
	}
	for _, m := range b.Members {
		if !models.ProjectRole(m.Role).IsShareable() {
			return damagedBackup(m.Email + ` has the role "` + m.Role + `", which cannot be given`)
		}
	}
	for _, a := range b.FeatureAccess {
		if !models.FeatureAccessLevel(a.Level).IsValid() {
			return damagedBackup(`feature access "` + a.Level + `" is not a known level`)
		}
	}
	return nil
}

func tagFeatures(b *ProjectBackup) []uint {
	out := make([]uint, 0, len(b.Tags))
	for _, t := range b.Tags {
		out = append(out, t.FeatureID)
	}
	return out
}

func fileFeatures(b *ProjectBackup) []uint {
	out := make([]uint, 0, len(b.FeatureFiles))
	for _, f := range b.FeatureFiles {
		out = append(out, f.FeatureID)
	}
	return out
}

func commitFeatures(b *ProjectBackup) []uint {
	out := make([]uint, 0, len(b.FeatureCommits))
	for _, f := range b.FeatureCommits {
		out = append(out, f.FeatureID)
	}
	return out
}

func contractFeatures(b *ProjectBackup) []uint {
	out := make([]uint, 0, len(b.Contracts))
	for _, c := range b.Contracts {
		out = append(out, c.FeatureID)
	}
	return out
}

func accessFeatures(b *ProjectBackup) []uint {
	out := make([]uint, 0, len(b.FeatureAccess))
	for _, a := range b.FeatureAccess {
		out = append(out, a.FeatureID)
	}
	return out
}

// BackupCheckDTO is what a backup holds and what restoring it here would do.
type BackupCheckDTO struct {
	ProjectName string       `json:"project_name"`
	MadeOn      time.Time    `json:"made_on"`
	Counts      BackupCounts `json:"counts"`
	// RestoreAs is the name the new project will get.
	RestoreAs string `json:"restore_as"`
	// People are those the project was shared with, and whether each has an
	// account here and so gets their role back.
	People []BackupPersonDTO `json:"people"`
	// Missing is everyone named in the backup who has no account here.
	Missing []string `json:"missing"`
	// CreditedToYou counts what someone in Missing wrote, which will show as
	// written by the person restoring.
	CreditedToYou int `json:"credited_to_you"`
	// FilesMissing counts attached files whose bytes were already missing
	// when the backup was made; they cannot come back.
	FilesMissing int `json:"files_missing"`
}

// BackupPersonDTO is one person the project was shared with.
type BackupPersonDTO struct {
	Email string `json:"email"`
	Role  string `json:"role"`
	Found bool   `json:"found"`
}

// RestoreResultDTO is the new project a restore made, and what it did.
type RestoreResultDTO struct {
	ProjectID   int            `json:"project_id"`
	ProjectName string         `json:"project_name"`
	Report      BackupCheckDTO `json:"report"`
}

// restorePeople maps the emails in a backup to accounts here.
type restorePeople struct {
	restorer int
	byEmail  map[string]int
	missing  map[string]bool
	credited int
}

func findPeople(db *gorm.DB, b *ProjectBackup, restorer int) (*restorePeople, error) {
	emails := map[string]bool{}
	for _, e := range backupEmails(b) {
		if e != "" {
			emails[strings.ToLower(e)] = true
		}
	}
	p := &restorePeople{restorer: restorer, byEmail: map[string]int{}, missing: map[string]bool{}}
	if len(emails) > 0 {
		list := make([]string, 0, len(emails))
		for e := range emails {
			list = append(list, e)
		}
		var users []models.User
		if err := db.Select("id, email").Where("LOWER(email) IN ?", list).Find(&users).Error; err != nil {
			return nil, err
		}
		for _, u := range users {
			p.byEmail[strings.ToLower(u.Email)] = u.ID
		}
		for e := range emails {
			if _, ok := p.byEmail[e]; !ok {
				p.missing[e] = true
			}
		}
	}
	return p, nil
}

// found is the account for an email here, or 0.
func (p *restorePeople) found(email string) int {
	return p.byEmail[strings.ToLower(email)]
}

// author is who wrote something: its author if they have an account here,
// otherwise the person restoring. Nobody stays nobody.
func (p *restorePeople) author(email string) int {
	if email == "" {
		return 0
	}
	if id := p.found(email); id != 0 {
		return id
	}
	p.credited++
	return p.restorer
}

// backupEmails is every person named in a backup.
func backupEmails(b *ProjectBackup) []string {
	out := []string{b.Project.Owner}
	for _, f := range b.Features {
		out = append(out, f.Assignee)
	}
	for _, s := range b.SubFeatures {
		out = append(out, s.Assignee)
	}
	for _, t := range b.Tasks {
		out = append(out, t.CreatedBy)
	}
	for _, t := range b.Tags {
		out = append(out, t.CreatedBy)
	}
	for _, d := range b.Dependencies {
		out = append(out, d.CreatedBy)
	}
	for _, c := range b.Comments {
		out = append(out, c.Author)
	}
	for _, a := range b.Approvals {
		out = append(out, a.User)
	}
	for _, v := range b.Versions {
		out = append(out, v.SavedBy)
	}
	for _, c := range b.Copies {
		out = append(out, c.Owner, c.MergedBy)
	}
	for _, m := range b.Members {
		out = append(out, m.Email)
	}
	for _, a := range b.FeatureAccess {
		out = append(out, a.User, a.GrantedBy)
	}
	return out
}

// restoredName is what the new project is called.
func restoredName(name string, now time.Time) string {
	suffix := " (restored " + now.Format("2 Jan") + ")"
	if max := 255 - len(suffix); len(name) > max {
		name = strings.TrimSpace(name[:max])
	}
	return name + suffix
}

// checkReport describes what restoring would do, before anything is written.
func checkReport(opened *openedBackup, people *restorePeople, now time.Time) BackupCheckDTO {
	b := &opened.data
	report := BackupCheckDTO{
		ProjectName: b.Project.Name, MadeOn: opened.info.MadeOn, Counts: backupCounts(*b),
		RestoreAs: restoredName(b.Project.Name, now), People: []BackupPersonDTO{}, Missing: []string{},
	}
	for _, m := range b.Members {
		report.People = append(report.People, BackupPersonDTO{Email: m.Email, Role: m.Role, Found: people.found(m.Email) != 0})
	}
	for e := range people.missing {
		report.Missing = append(report.Missing, e)
	}
	sort.Strings(report.Missing)
	for _, a := range allAttachments(*b) {
		if a.File == "" {
			report.FilesMissing++
		}
	}
	// What would be credited is counted by running the same rule the restore
	// uses over a throwaway copy of the people.
	dry := *people
	dry.credited = 0
	creditAll(b, &dry)
	report.CreditedToYou = dry.credited
	return report
}

// creditAll asks for the author of everything restoreBackup credits, which is how
// the check counts what would be credited to the person restoring.
func creditAll(b *ProjectBackup, p *restorePeople) {
	for _, t := range b.Tasks {
		p.author(t.CreatedBy)
	}
	for _, c := range b.Comments {
		p.author(c.Author)
	}
	for _, v := range b.Versions {
		p.author(v.SavedBy)
	}
	for _, c := range b.Copies {
		p.author(c.Owner)
	}
	for _, a := range b.Approvals {
		p.author(a.User)
	}
}

// restoreBackup writes a checked backup as a new project owned by restorer.
func restoreBackup(tx *gorm.DB, opened *openedBackup, people *restorePeople, withFiles bool, now time.Time) (*models.Project, error) {
	b := &opened.data
	omit := func() *gorm.DB { return tx.Omit(clause.Associations) }

	config := models.JSONB{}
	for k, v := range b.Project.Config {
		config[k] = v
	}
	project := models.Project{
		Name: restoredName(b.Project.Name, now), Description: b.Project.Description, Brief: b.Project.Brief,
		OwnerID: people.restorer, Config: config,
	}
	if err := omit().Create(&project).Error; err != nil {
		return nil, err
	}

	releases := map[uint]uint{}
	for _, r := range b.Releases {
		row := models.Release{ProjectID: project.ID, Tag: r.Tag, Status: models.ReleaseStatus(r.Status), Notes: r.Notes,
			CreatedAt: r.CreatedAt, UpdatedAt: r.UpdatedAt}
		if err := omit().Create(&row).Error; err != nil {
			return nil, err
		}
		releases[r.ID] = row.ID
	}

	// Features go in first with no parent, then get their parent and place,
	// since a parent can come after its children in id order.
	features := map[uint]uint{}
	for _, f := range b.Features {
		row := models.Feature{
			ProjectID: project.ID, Title: f.Title, Description: f.Description, Notes: f.Notes, Category: f.Category,
			Status: models.FeatureStatus(f.Status), Priority: models.FeaturePriority(f.Priority), Color: f.Color,
			AssigneeID: uint(people.found(f.Assignee)), Position: f.Position, CreatedAt: f.CreatedAt, UpdatedAt: f.UpdatedAt,
		}
		if row.Category == "" {
			row.Category = "general"
		}
		if f.ReleaseID != nil {
			id := releases[*f.ReleaseID]
			row.ReleaseID = &id
		}
		if err := omit().Create(&row).Error; err != nil {
			return nil, err
		}
		features[f.ID] = row.ID
	}
	for _, f := range b.Features {
		updates := map[string]any{"position": f.Position}
		if f.ParentID != nil {
			updates["parent_feature_id"] = features[*f.ParentID]
		}
		if err := tx.Model(&models.Feature{}).Where("id = ?", features[f.ID]).UpdateColumns(updates).Error; err != nil {
			return nil, err
		}
	}

	// A feature's files keep their names, which is what its description links
	// to, so the links work again without being rewritten.
	if withFiles {
		for _, a := range b.FeatureAttachments {
			if a.File == "" {
				continue
			}
			name := cleanAttachmentName(a.Name)
			stored := storedFeatureAttachmentName(features[a.FeatureID], name)
			body := opened.files[a.File]
			if err := storeFileTx(tx, stored, body); err != nil {
				return nil, err
			}
			row := models.FeatureAttachment{FeatureID: features[a.FeatureID], Name: name, FileName: stored,
				FileSize: int64(len(body)), MimeType: a.MimeType, CreatedAt: a.CreatedAt, UpdatedAt: a.UpdatedAt}
			if err := omit().Create(&row).Error; err != nil {
				return nil, err
			}
		}
	}

	subFeatures := map[uint]uint{}
	for _, s := range b.SubFeatures {
		row := models.SubFeature{FeatureID: int(features[uint(s.FeatureID)]), Title: s.Title, Description: s.Description,
			Status: s.Status, Priority: s.Priority, AssigneeID: people.found(s.Assignee), CreatedAt: s.CreatedAt, UpdatedAt: s.UpdatedAt}
		if err := omit().Create(&row).Error; err != nil {
			return nil, err
		}
		subFeatures[uint(s.ID)] = uint(row.ID)
	}

	tasks := map[uint]uint{}
	for _, t := range b.Tasks {
		row := models.Task{TaskType: t.Type, TaskName: t.Name, Description: t.Description,
			FeatureID: features[t.FeatureID], SubFeatureID: subFeatures[t.SubFeatureID], CreatedByUser: uint(people.author(t.CreatedBy))}
		row.CreatedAt, row.UpdatedAt = t.CreatedAt, t.UpdatedAt
		if err := omit().Create(&row).Error; err != nil {
			return nil, err
		}
		tasks[t.ID] = row.ID
	}

	for _, t := range b.Tags {
		row := models.FeatureTag{TagName: t.Name, FeatureID: features[t.FeatureID], CreatedByUser: uint(people.found(t.CreatedBy))}
		if err := omit().Create(&row).Error; err != nil {
			return nil, err
		}
	}
	for _, f := range b.FeatureFiles {
		if err := omit().Create(&models.FeatureFile{FeatureID: features[f.FeatureID], FilePath: f.Path}).Error; err != nil {
			return nil, err
		}
	}
	for _, f := range b.FeatureCommits {
		if err := omit().Create(&models.FeatureCommit{FeatureID: features[f.FeatureID], CommitHash: f.CommitHash}).Error; err != nil {
			return nil, err
		}
	}
	for _, ct := range b.Contracts {
		row := models.ContractArtifact{ProjectID: project.ID, FeatureID: features[ct.FeatureID], FilePath: ct.FilePath,
			CommitHash: ct.CommitHash, Language: ct.Language, Contract: ct.Contract, BehaviorNote: ct.BehaviorNote,
			CreatedAt: ct.CreatedAt, UpdatedAt: ct.UpdatedAt}
		if err := omit().Create(&row).Error; err != nil {
			return nil, err
		}
	}

	// An attached file whose bytes are not in the backup cannot come back;
	// its row would only be a broken download, so it is left out.
	attachments := map[uint]uint{}
	if withFiles {
		for _, a := range b.Attachments {
			if a.File == "" {
				continue
			}
			stored := storedAttachmentName(tasks[a.TaskID], a.Name)
			body := opened.files[a.File]
			if err := storeFileTx(tx, stored, body); err != nil {
				return nil, err
			}
			row := models.TaskAttachment{TaskID: tasks[a.TaskID], FileName: stored, FileSize: int64(len(body)),
				MimeType: a.MimeType, CreatedAt: a.CreatedAt, UpdatedAt: a.UpdatedAt}
			if err := omit().Create(&row).Error; err != nil {
				return nil, err
			}
			attachments[a.ID] = row.ID
		}
	}
	for _, c := range b.Comments {
		row := models.Comment{TaskID: tasks[c.TaskID], UserID: uint(people.author(c.Author)), Content: c.Content,
			CreatedAt: c.CreatedAt, UpdatedAt: c.UpdatedAt}
		if c.AttachmentID != nil {
			if id, ok := attachments[*c.AttachmentID]; ok {
				row.AttachmentID = &id
			}
		}
		if err := omit().Create(&row).Error; err != nil {
			return nil, err
		}
	}

	prs := map[uint]uint{}
	for _, p := range b.PullRequests {
		row := models.PullRequest{TaskID: tasks[p.TaskID], FeatureID: features[p.FeatureID], URL: p.URL, Title: p.Title,
			Branch: p.Branch, Description: p.Description, Status: p.Status, Tested: p.Tested, Version: p.Version,
			CreatedAt: p.CreatedAt, UpdatedAt: p.UpdatedAt}
		if err := omit().Create(&row).Error; err != nil {
			return nil, err
		}
		prs[p.ID] = row.ID
	}
	for _, r := range b.Releases {
		for _, id := range r.PullRequestIDs {
			if err := tx.Exec("INSERT INTO release_prs (release_id, pull_request_id) VALUES (?, ?)", releases[r.ID], prs[id]).Error; err != nil {
				return nil, err
			}
		}
	}
	for _, a := range b.Approvals {
		row := models.ApprovedPR{PullRequestID: prs[a.PullRequestID], UserID: people.author(a.User), ApprovedAt: a.ApprovedAt, Version: a.Version}
		if err := omit().Create(&row).Error; err != nil {
			return nil, err
		}
	}
	for _, ch := range b.IntegrationChecks {
		row := models.IntegrationCheck{PullRequestID: prs[ch.PullRequestID], Passed: ch.Passed, Summary: ch.Summary,
			CommitHash: ch.CommitHash, CreatedAt: ch.CreatedAt}
		if err := omit().Create(&row).Error; err != nil {
			return nil, err
		}
	}

	ids := map[string]map[uint]uint{
		string(models.EntityTypeFeature): features,
		string(models.EntityTypeTask):    tasks,
		string(models.EntityTypePR):      prs,
	}
	for _, d := range b.Dependencies {
		row := models.Dependency{ParentID: ids[d.ParentType][d.ParentID], ParentType: models.EntityType(d.ParentType),
			ChildID: ids[d.ChildType][d.ChildID], ChildType: models.EntityType(d.ChildType),
			Description: d.Description, CreatedByID: uint(people.found(d.CreatedBy)), CreatedAt: d.CreatedAt}
		if err := omit().Create(&row).Error; err != nil {
			return nil, err
		}
	}

	keys := &snapshotKeys{features: features, releases: releases, projectID: project.ID, stale: map[string]string{}}
	versions := map[uint]uint{}
	for _, v := range b.Versions {
		snap, err := keys.rewrite(v.Snapshot)
		if err != nil {
			return nil, fmt.Errorf("version %d: %w", v.Number, err)
		}
		row := models.FeatureVersion{ProjectID: project.ID, Number: v.Number, Tag: v.Tag, Notes: v.Notes,
			SavedByID: people.author(v.SavedBy), Auto: v.Auto, PublishNumber: v.PublishNumber, PublishedAt: v.PublishedAt,
			FeatureCount: v.FeatureCount, Snapshot: snap, CreatedAt: v.CreatedAt}
		if err := omit().Create(&row).Error; err != nil {
			return nil, err
		}
		versions[v.ID] = row.ID
	}
	for _, c := range b.Copies {
		snap, err := keys.rewrite(c.Snapshot)
		if err != nil {
			return nil, fmt.Errorf("copy %d: %w", c.Number, err)
		}
		row := models.FeatureCopy{ProjectID: project.ID, Number: c.Number, BaseVersionID: versions[c.BaseVersionID],
			OwnerID: people.author(c.Owner), Revision: c.Revision, Name: c.Name, Source: c.Source, FeatureCount: c.FeatureCount, Snapshot: snap,
			PublishedAt: c.PublishedAt, MergedAt: c.MergedAt, CreatedAt: c.CreatedAt, UpdatedAt: c.UpdatedAt}
		if c.MergedVersionID != nil {
			id := versions[*c.MergedVersionID]
			row.MergedVersionID = &id
		}
		if id := people.found(c.MergedBy); id != 0 {
			row.MergedByID = &id
		}
		if err := omit().Create(&row).Error; err != nil {
			return nil, err
		}
	}

	// Shared with the same people, where they have an account here. The
	// person restoring is the owner, so they are never also a member; the
	// original owner, if it is someone else, can still edit.
	roles := map[int]models.ProjectRole{}
	order := []int{}
	give := func(userID int, role models.ProjectRole) {
		if userID == 0 || userID == people.restorer {
			return
		}
		if _, ok := roles[userID]; !ok {
			order = append(order, userID)
		}
		if role.Rank() > roles[userID].Rank() {
			roles[userID] = role
		}
	}
	give(people.found(b.Project.Owner), models.RoleEditor)
	for _, m := range b.Members {
		give(people.found(m.Email), models.ProjectRole(m.Role))
	}
	for _, userID := range order {
		row := models.ProjectMember{ProjectID: project.ID, UserID: userID, Role: roles[userID], AddedBy: people.restorer}
		if err := omit().Create(&row).Error; err != nil {
			return nil, err
		}
	}

	for _, a := range b.FeatureAccess {
		userID := people.found(a.User)
		if userID == 0 {
			continue
		}
		grantedBy := people.found(a.GrantedBy)
		if grantedBy == 0 {
			grantedBy = people.restorer
		}
		row := models.FeatureScope{ProjectID: project.ID, FeatureID: features[a.FeatureID], UserID: userID,
			AccessLevel: models.FeatureAccessLevel(a.Level), GrantedByID: grantedBy}
		if err := omit().Create(&row).Error; err != nil {
			return nil, err
		}
	}

	return &project, nil
}

// storeFileTx writes a file into the attachment store inside the restore's
// transaction, so the files come and go with the rest of it. It writes the
// tables the store reads exactly as the store's own writer does: one row
// naming the file, then its bytes in 16 KB pieces, at least one.
func storeFileTx(tx *gorm.DB, path string, body []byte) error {
	mimeType := mime.TypeByExtension(filepath.Ext(path))
	if mimeType == "" {
		mimeType = "application/octet-stream"
	}
	if err := tx.Exec("INSERT INTO file_metadata (path, type) VALUES (?, ?)", path, mimeType).Error; err != nil {
		return err
	}
	var fileID int64
	if err := tx.Raw("SELECT id FROM file_metadata WHERE path = ?", path).Scan(&fileID).Error; err != nil {
		return err
	}
	const fragment = 16 * 1024
	for index, start := 0, 0; index == 0 || start < len(body); index, start = index+1, start+fragment {
		end := min(start+fragment, len(body))
		if err := tx.Exec("INSERT INTO file_fragments (file_id, fragment_index, fragment) VALUES (?, ?, ?)",
			fileID, index, body[start:end]).Error; err != nil {
			return err
		}
	}
	return nil
}

// snapshotKeys rewrites the ids inside a saved version or copy for the
// restored project. A feature is keyed "f" and its id, a release "r" and its
// id. A key whose feature is not in the backup (removed since the version was
// saved) gets a fresh key of its own, the same one in every snapshot, so it
// can never be mistaken for a restored feature that happens to get its old id.
type snapshotKeys struct {
	features  map[uint]uint
	releases  map[uint]uint
	projectID int
	stale     map[string]string
}

func (k *snapshotKeys) key(old string) string {
	if len(old) < 2 {
		return old
	}
	ids := map[byte]map[uint]uint{'f': k.features, 'r': k.releases}[old[0]]
	if ids == nil {
		return old
	}
	n, err := strconv.ParseUint(old[1:], 10, 64)
	if err != nil {
		return old
	}
	if id, ok := ids[uint(n)]; ok {
		return string(old[0]) + strconv.FormatUint(uint64(id), 10)
	}
	if fresh, ok := k.stale[old]; ok {
		return fresh
	}
	fresh := freshCopyKey()
	k.stale[old] = fresh
	return fresh
}

// rewrite works on the snapshot as plain JSON, so anything in it this code
// does not know about is kept as it was.
func (k *snapshotKeys) rewrite(raw json.RawMessage) (string, error) {
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	var snap map[string]any
	if err := dec.Decode(&snap); err != nil {
		return "", err
	}
	if p, ok := snap["project"].(map[string]any); ok {
		p["id"] = k.projectID
	}
	str := func(m map[string]any, field string) {
		if s, ok := m[field].(string); ok {
			m[field] = k.key(s)
		}
	}
	if list, ok := snap["features"].([]any); ok {
		for _, item := range list {
			f, ok := item.(map[string]any)
			if !ok {
				continue
			}
			str(f, "key")
			str(f, "parent_key")
			str(f, "release_key")
			if needs, ok := f["needs"].([]any); ok {
				for i, n := range needs {
					if s, ok := n.(string); ok {
						needs[i] = k.key(s)
					}
				}
			}
			if n, ok := f["feature_id"].(json.Number); ok {
				old, _ := strconv.ParseUint(n.String(), 10, 64)
				f["feature_id"] = k.features[uint(old)]
			}
		}
	}
	if list, ok := snap["releases"].([]any); ok {
		for _, item := range list {
			if r, ok := item.(map[string]any); ok {
				str(r, "key")
			}
		}
	}
	out, err := json.Marshal(snap)
	return string(out), err
}

// readUploadedBackup reads the "file" field of an upload, refusing one over
// the size limit before reading it all.
func readUploadedBackup(c *gin.Context) ([]byte, error) {
	// Room for the form around the file.
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, MaxBackupSize+1<<20)
	file, _, err := c.Request.FormFile("file")
	if err != nil {
		var tooBig *http.MaxBytesError
		if errors.As(err, &tooBig) {
			return nil, backupProblem("That backup is larger than " + humanSize(MaxBackupSize))
		}
		return nil, backupProblem("Choose a backup file to upload")
	}
	defer file.Close()
	raw, err := io.ReadAll(io.LimitReader(file, MaxBackupSize+1))
	if err != nil {
		return nil, backupProblem("The backup could not be uploaded")
	}
	return raw, nil
}

// openUpload reads and checks an uploaded backup and matches its people.
func (h *BackupsHandler) openUpload(c *gin.Context) (*openedBackup, *restorePeople, error) {
	userID, err := api.UserID(c)
	if err != nil {
		return nil, nil, err
	}
	raw, err := readUploadedBackup(c)
	if err != nil {
		return nil, nil, err
	}
	opened, err := readBackup(raw)
	if err != nil {
		return nil, nil, err
	}
	people, err := findPeople(h.db, &opened.data, userID)
	if err != nil {
		return nil, nil, api.Internal(err)
	}
	return opened, people, nil
}

// Check reads a backup and says what restoring it would do. Nothing is saved.
//
// POST /api/v1/backups/check (multipart, field "file")
func (h *BackupsHandler) Check(c *gin.Context) {
	opened, people, err := h.openUpload(c)
	if err != nil {
		api.Fail(c, err)
		return
	}
	api.OK(c, checkReport(opened, people, time.Now()))
}

// Restore makes a new project from a backup. Anyone signed in can: the
// project is theirs, and nothing else changes.
//
// POST /api/v1/backups/restore (multipart, field "file")
func (h *BackupsHandler) Restore(c *gin.Context) {
	opened, people, err := h.openUpload(c)
	if err != nil {
		api.Fail(c, err)
		return
	}
	now := time.Now()
	report := checkReport(opened, people, now)

	// Without a file store the files have nowhere to go; the rest still comes
	// back, and the report counts them as missing.
	withFiles := h.files != nil
	if !withFiles {
		report.FilesMissing = len(allAttachments(opened.data))
	}

	var project *models.Project
	err = h.db.Transaction(func(tx *gorm.DB) error {
		var txErr error
		project, txErr = restoreBackup(tx, opened, people, withFiles, now)
		return txErr
	})
	if err != nil {
		api.Fail(c, api.Internal(err))
		return
	}

	log.WithField("project", project.ID).WithField("from", opened.data.Project.Name).Info("backup restored")
	api.Created(c, RestoreResultDTO{ProjectID: project.ID, ProjectName: project.Name, Report: report})
}
