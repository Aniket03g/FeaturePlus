package v1

import (
	"errors"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/FeaturePlus/backend/api"
	"github.com/FeaturePlus/backend/models"
	"github.com/FeaturePlus/backend/repositories"
	"github.com/FeaturePlus/backend/services"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// PlanFilePath is where a project's plan is written in its linked repository.
const PlanFilePath = ".featureplus/plan.md"

// GitHubHandler links a project to a GitHub repository and copies its plan
// there: one markdown file listing every feature by release, committed when
// someone asks for a sync. Publishing a release (in ReleasesHandler) also
// makes a tag and a GitHub Release, through the same publisher.
//
// Nothing is read back from GitHub. The database is the source of truth and
// the file is a copy of it.
//
// Everything written to GitHub is written as the person who asked, through
// their own connection (github_account.go), so it only reaches repositories
// they chose for FeaturePlus.
type GitHubHandler struct {
	projectRepo *repositories.ProjectRepository
	db          *gorm.DB
	publisher   *githubPublisher
}

// NewGitHubHandler builds the handler with the GitHub App read from the
// environment.
func NewGitHubHandler(db *gorm.DB) *GitHubHandler {
	return newGitHubHandler(db, &githubPublisher{db: db, accounts: newGitHubAccounts(db)})
}

func newGitHubHandler(db *gorm.DB, publisher *githubPublisher) *GitHubHandler {
	return &GitHubHandler{projectRepo: repositories.NewProjectRepository(db), db: db, publisher: publisher}
}

// Register mounts the routes onto an authenticated group.
func (h *GitHubHandler) Register(g *gin.RouterGroup) {
	h.publisher.accounts.register(g)

	g.GET("/projects/:id/github", h.Get)
	g.PUT("/projects/:id/github", h.Link)
	g.DELETE("/projects/:id/github", h.Unlink)
	g.POST("/projects/:id/github/sync", h.Sync)
	g.GET("/projects/:id/github/plan", h.Preview)
	g.POST("/releases/:releaseId/github", h.PublishRelease)
}

// GitHubLinkDTO describes a project's link, or the lack of one.
type GitHubLinkDTO struct {
	// Linked is false when the project has no repository; the fields below
	// are then empty.
	Linked bool `json:"linked"`
	// AppConfigured says whether the server has its GitHub App settings. With
	// none, no one can connect, and the screen says so up front.
	AppConfigured bool `json:"app_configured"`

	Owner         string     `json:"owner,omitempty"`
	Repo          string     `json:"repo,omitempty"`
	Branch        string     `json:"branch,omitempty"`
	RepoURL       string     `json:"repo_url,omitempty"`
	PlanURL       string     `json:"plan_url,omitempty"`
	LastSyncedAt  *time.Time `json:"last_synced_at,omitempty"`
	LastCommitSHA string     `json:"last_commit_sha,omitempty"`
}

// LinkGitHubRequest names the repository, one the caller chose for FeaturePlus
// on GitHub. Repo takes "owner/name" or any github.com URL for it. Branch is
// optional and defaults to the repository's default branch.
type LinkGitHubRequest struct {
	Repo   string `json:"repo" binding:"required,max=300"`
	Branch string `json:"branch" binding:"max=255"`
}

// GitHubSyncDTO is the receipt for a sync.
type GitHubSyncDTO struct {
	// Changed is false when the file on GitHub already matched, in which case
	// no commit was made.
	Changed   bool          `json:"changed"`
	CommitSHA string        `json:"commit_sha,omitempty"`
	Link      GitHubLinkDTO `json:"link"`
}

// Get returns the project's link.
//
// GET /api/v1/projects/:id/github
func (h *GitHubHandler) Get(c *gin.Context) {
	project, err := h.project(c, canView)
	if err != nil {
		api.Fail(c, err)
		return
	}

	link, dbErr := h.publisher.link(project.ID)
	if dbErr != nil {
		api.Fail(c, api.Internal(dbErr))
		return
	}
	api.OK(c, h.publisher.linkDTO(link))
}

// Link connects the project to a repository, replacing any earlier link. It
// checks the repository exists and the token can push to it before saving,
// so a typo is caught here rather than on the first sync.
//
// PUT /api/v1/projects/:id/github
func (h *GitHubHandler) Link(c *gin.Context) {
	// Choosing where a project is published is the owner's call, like sharing.
	project, err := h.project(c, ownerOnly)
	if err != nil {
		api.Fail(c, err)
		return
	}

	var req LinkGitHubRequest
	if bindErr := api.Bind(c, &req); bindErr != nil {
		api.Fail(c, bindErr)
		return
	}

	owner, repo, ok := parseGitHubRepo(req.Repo)
	if !ok {
		api.Fail(c, api.Validation("That is not a GitHub repository").
			WithField("repo", "Use owner/name, or the repository's github.com address"))
		return
	}

	client, clientErr := h.publisher.clientFor(c)
	if clientErr != nil {
		api.Fail(c, clientErr)
		return
	}

	found, ghErr := client.GetRepo(owner, repo)
	if ghErr != nil {
		api.Fail(c, githubFailure(ghErr, owner+"/"+repo))
		return
	}
	if !found.Permissions.Push {
		api.Fail(c, api.Forbidden("You can read "+found.FullName+" on GitHub but cannot write to it"))
		return
	}

	// GitHub answers with the repository's real spelling, which is what the
	// link keeps.
	if parts := strings.SplitN(found.FullName, "/", 2); len(parts) == 2 {
		owner, repo = parts[0], parts[1]
	}

	branch := strings.TrimSpace(req.Branch)
	if branch == "" {
		branch = found.DefaultBranch
	}
	if branch == "" {
		branch = "main"
	}

	link, dbErr := h.publisher.link(project.ID)
	if dbErr != nil {
		api.Fail(c, api.Internal(dbErr))
		return
	}
	if link == nil {
		link = &models.ProjectGitHub{ProjectID: project.ID}
	}
	if link.Owner != owner || link.Repo != repo || link.Branch != branch {
		// A different repository has not been synced to yet.
		link.LastSyncedAt = nil
		link.LastCommitSHA = ""
	}
	link.Owner, link.Repo, link.Branch = owner, repo, branch

	if dbErr := h.db.Save(link).Error; dbErr != nil {
		api.Fail(c, api.Internal(dbErr))
		return
	}
	api.OK(c, h.publisher.linkDTO(link))
}

// Unlink forgets the repository. Nothing on GitHub is touched: the plan file
// and any releases already made stay where they are.
//
// DELETE /api/v1/projects/:id/github
func (h *GitHubHandler) Unlink(c *gin.Context) {
	project, err := h.project(c, ownerOnly)
	if err != nil {
		api.Fail(c, err)
		return
	}
	if dbErr := h.db.Where("project_id = ?", project.ID).Delete(&models.ProjectGitHub{}).Error; dbErr != nil {
		api.Fail(c, api.Internal(dbErr))
		return
	}
	api.NoContent(c)
}

// Sync writes the plan file to the linked repository, as one commit. When the
// file already says the same thing, nothing is committed.
//
// POST /api/v1/projects/:id/github/sync
func (h *GitHubHandler) Sync(c *gin.Context) {
	project, err := h.project(c, canEdit)
	if err != nil {
		api.Fail(c, err)
		return
	}

	link, dbErr := h.publisher.link(project.ID)
	if dbErr != nil {
		api.Fail(c, api.Internal(dbErr))
		return
	}
	if link == nil {
		api.Fail(c, api.Conflict("This project is not linked to a GitHub repository yet"))
		return
	}

	client, clientErr := h.publisher.clientFor(c)
	if clientErr != nil {
		api.Fail(c, clientErr)
		return
	}

	changed, sha, syncErr := h.publisher.syncPlan(client, project, link)
	if syncErr != nil {
		api.Fail(c, syncErr)
		return
	}
	api.OK(c, GitHubSyncDTO{Changed: changed, CommitSHA: sha, Link: h.publisher.linkDTO(link)})
}

// Preview returns the plan file as it would be written, without writing it.
// It works whether or not the project is linked.
//
// GET /api/v1/projects/:id/github/plan
func (h *GitHubHandler) Preview(c *gin.Context) {
	project, err := h.project(c, canView)
	if err != nil {
		api.Fail(c, err)
		return
	}
	text, dbErr := h.publisher.planMarkdown(project)
	if dbErr != nil {
		api.Fail(c, api.Internal(dbErr))
		return
	}
	api.OK(c, gin.H{"path": PlanFilePath, "markdown": text})
}

// PublishRelease makes the GitHub Release for a release that is already
// published. Publishing does this itself; this route is the retry when that
// step failed, and for releases published before the project was linked.
//
// POST /api/v1/releases/:releaseId/github
func (h *GitHubHandler) PublishRelease(c *gin.Context) {
	id, err := api.IDParam(c, "releaseId")
	if err != nil {
		api.Fail(c, err)
		return
	}

	var release models.Release
	if dbErr := h.db.First(&release, id).Error; dbErr != nil {
		api.Fail(c, api.FromDB(dbErr, "Release"))
		return
	}

	if _, err := requireProject(c, h.db, release.ProjectID, canEdit); err != nil {
		api.Fail(c, asHidden(err, "Release"))
		return
	}
	project, dbErr := h.projectRepo.GetProjectByID(release.ProjectID)
	if dbErr != nil {
		api.Fail(c, api.FromDB(dbErr, "Project"))
		return
	}

	if release.Status != models.ReleaseStatusPublished {
		api.Fail(c, api.Conflict("Only a published release goes to GitHub"))
		return
	}

	client, clientErr := h.publisher.clientFor(c)
	if clientErr != nil {
		api.Fail(c, clientErr)
		return
	}

	url, pubErr := h.publisher.publishRelease(client, project, &release)
	if pubErr != nil {
		api.Fail(c, pubErr)
		return
	}
	api.OK(c, gin.H{"github_url": url})
}

// project loads the project in the path, checking the caller has at least
// the role `need` in it.
func (h *GitHubHandler) project(c *gin.Context, need models.ProjectRole) (*models.Project, error) {
	id, err := api.IDParam(c, "id")
	if err != nil {
		return nil, err
	}
	if _, err := requireProject(c, h.db, id, need); err != nil {
		return nil, err
	}
	project, dbErr := h.projectRepo.GetProjectByID(id)
	if dbErr != nil {
		return nil, api.FromDB(dbErr, "Project")
	}
	return project, nil
}

// ---------- the publisher ----------

// githubPublisher does the writing to GitHub for both handlers.
type githubPublisher struct {
	db       *gorm.DB
	accounts *githubAccounts
}

// clientFor returns a GitHub client acting as the person making the request.
func (p *githubPublisher) clientFor(c *gin.Context) (*services.GitHubClient, error) {
	userID, err := api.UserID(c)
	if err != nil {
		return nil, err
	}
	return p.accounts.clientFor(userID)
}

// link returns the project's link, or nil when it has none.
func (p *githubPublisher) link(projectID int) (*models.ProjectGitHub, error) {
	var link models.ProjectGitHub
	err := p.db.Where("project_id = ?", projectID).First(&link).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &link, nil
}

func (p *githubPublisher) linkDTO(link *models.ProjectGitHub) GitHubLinkDTO {
	dto := GitHubLinkDTO{AppConfigured: p.accounts.app.Configured()}
	if link == nil {
		return dto
	}
	repoURL := "https://github.com/" + link.Owner + "/" + link.Repo
	dto.Linked = true
	dto.Owner, dto.Repo, dto.Branch = link.Owner, link.Repo, link.Branch
	dto.RepoURL = repoURL
	dto.PlanURL = repoURL + "/blob/" + link.Branch + "/" + PlanFilePath
	dto.LastSyncedAt = link.LastSyncedAt
	dto.LastCommitSHA = link.LastCommitSHA
	return dto
}

// syncPlan writes the plan file and reports whether a commit was made.
func (p *githubPublisher) syncPlan(client *services.GitHubClient, project *models.Project, link *models.ProjectGitHub) (bool, string, error) {
	text, err := p.planMarkdown(project)
	if err != nil {
		return false, "", api.Internal(err)
	}

	current, sha, getErr := client.GetFile(link.Owner, link.Repo, PlanFilePath, link.Branch)
	if getErr != nil && !errors.Is(getErr, services.ErrGitHubNotFound) {
		return false, "", githubFailure(getErr, link.Owner+"/"+link.Repo)
	}
	if getErr == nil && current == text {
		return false, "", nil
	}

	commit, putErr := client.PutFile(link.Owner, link.Repo, PlanFilePath, link.Branch, text,
		"FeaturePlus: update plan", sha)
	if putErr != nil {
		return false, "", githubFailure(putErr, link.Owner+"/"+link.Repo)
	}

	now := time.Now()
	link.LastSyncedAt = &now
	link.LastCommitSHA = commit
	if err := p.db.Model(link).Updates(map[string]any{
		"last_synced_at": now, "last_commit_sha": commit,
	}).Error; err != nil {
		return true, commit, api.Internal(err)
	}
	return true, commit, nil
}

// publishRelease syncs the plan, so the tag includes the release marked as
// published, then makes the GitHub Release. A release already on GitHub is
// returned as it is rather than made twice.
func (p *githubPublisher) publishRelease(client *services.GitHubClient, project *models.Project, release *models.Release) (string, error) {
	var existing models.ReleaseGitHub
	if err := p.db.Where("release_id = ?", release.ID).First(&existing).Error; err == nil {
		return existing.URL, nil
	}

	link, err := p.link(project.ID)
	if err != nil {
		return "", api.Internal(err)
	}
	if link == nil {
		return "", api.Conflict("This project is not linked to a GitHub repository")
	}

	if _, _, syncErr := p.syncPlan(client, project, link); syncErr != nil {
		return "", syncErr
	}

	var features []models.Feature
	if err := p.db.Where("project_id = ?", project.ID).Order("id").Find(&features).Error; err != nil {
		return "", api.Internal(err)
	}
	notes := releaseNotesMarkdown(*release, features)

	url, ghErr := client.CreateRelease(link.Owner, link.Repo, release.Tag, link.Branch, release.Tag, notes)
	if ghErr != nil {
		// A release made on GitHub by hand, or by an earlier attempt that
		// failed after GitHub accepted it, is adopted rather than refused.
		var apiErr *services.GitHubError
		if errors.As(ghErr, &apiErr) && apiErr.Status == 422 && strings.Contains(apiErr.Message, "already_exists") {
			found, findErr := client.GetReleaseByTag(link.Owner, link.Repo, release.Tag)
			if findErr != nil {
				return "", githubFailure(findErr, link.Owner+"/"+link.Repo)
			}
			url = found
		} else {
			return "", githubFailure(ghErr, link.Owner+"/"+link.Repo)
		}
	}

	if err := p.db.Create(&models.ReleaseGitHub{ReleaseID: release.ID, URL: url}).Error; err != nil {
		return url, api.Internal(err)
	}
	return url, nil
}

// releaseURL returns the GitHub Release recorded for a release, if any.
func (p *githubPublisher) releaseURL(releaseID uint) string {
	var row models.ReleaseGitHub
	if err := p.db.Where("release_id = ?", releaseID).First(&row).Error; err != nil {
		return ""
	}
	return row.URL
}

// githubFailure turns a GitHub error into something a person can act on.
func githubFailure(err error, repo string) error {
	if errors.Is(err, services.ErrGitHubNotFound) {
		return api.NotFound("GitHub repository " + repo + " (or FeaturePlus has not been given access to it)")
	}
	var apiErr *services.GitHubError
	if errors.As(err, &apiErr) {
		switch apiErr.Status {
		case 401:
			return errGitHubNotConnected("GitHub no longer accepts your connection. Connect GitHub again")
		case 403:
			return api.Forbidden("GitHub would not allow this: " + apiErr.Message)
		case 409:
			return api.Conflict("GitHub reported a conflict on " + repo + ": " + apiErr.Message)
		}
		return api.Unavailable("GitHub said: " + apiErr.Message)
	}
	return api.Unavailable(err.Error())
}

// ---------- reading a repository name ----------

var repoNamePattern = regexp.MustCompile(`^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})/[A-Za-z0-9._-]{1,100}$`)

// parseGitHubRepo reads "owner/name", https://github.com/owner/name (with or
// without .git, a trailing slash or a deeper path) or git@github.com:owner/name.git.
func parseGitHubRepo(input string) (owner, repo string, ok bool) {
	s := strings.TrimSpace(input)
	s = strings.TrimPrefix(s, "git@github.com:")
	for _, prefix := range []string{"https://", "http://"} {
		s = strings.TrimPrefix(s, prefix)
	}
	s = strings.TrimPrefix(s, "www.")
	s = strings.TrimPrefix(s, "github.com/")

	parts := strings.Split(strings.Trim(s, "/"), "/")
	if len(parts) < 2 {
		return "", "", false
	}
	owner, repo = parts[0], strings.TrimSuffix(parts[1], ".git")
	if !repoNamePattern.MatchString(owner+"/"+repo) || repo == "." || repo == ".." {
		return "", "", false
	}
	return owner, repo, true
}

// ---------- writing the plan ----------

// planMarkdown writes the project's plan: one section per release, first
// planned first, then what is not planned. It holds no timestamp, so syncing
// an unchanged plan changes nothing.
func (p *githubPublisher) planMarkdown(project *models.Project) (string, error) {
	var features []models.Feature
	if err := p.db.Where("project_id = ?", project.ID).Order("id").Find(&features).Error; err != nil {
		return "", err
	}
	var releases []models.Release
	if err := p.db.Where("project_id = ?", project.ID).Order("id").Find(&releases).Error; err != nil {
		return "", err
	}
	return buildPlanMarkdown(project.Name, releases, features), nil
}

func buildPlanMarkdown(projectName string, releases []models.Release, features []models.Feature) string {
	var b strings.Builder
	b.WriteString("# " + oneLine(projectName) + " — plan\n\n")
	b.WriteString("> Written by FeaturePlus. Edits made to this file are replaced on the next sync.\n\n")

	ordered := treeOrder(features)
	known := map[uint]bool{}
	for _, r := range releases {
		known[r.ID] = true
	}

	for _, release := range releases {
		inRelease := func(f models.Feature) bool { return f.ReleaseID != nil && *f.ReleaseID == release.ID }
		b.WriteString("## " + oneLine(release.Tag) + " — " + releaseStatusWord(release.Status) + "\n\n")
		if notes := strings.TrimSpace(release.Notes); notes != "" {
			b.WriteString(notes + "\n\n")
		}
		writeSection(&b, ordered, inRelease, "Nothing planned into this release yet.")
	}

	notPlanned := func(f models.Feature) bool { return f.ReleaseID == nil || !known[*f.ReleaseID] }
	heading := "## Not planned"
	if len(releases) == 0 {
		heading = "## Features"
	}
	b.WriteString(heading + "\n\n")
	writeSection(&b, ordered, notPlanned, "Everything is planned into a release.")

	return b.String()
}

// releaseNotesMarkdown is the text of a GitHub Release: the release's own
// notes, then the features it ships.
func releaseNotesMarkdown(release models.Release, features []models.Feature) string {
	var b strings.Builder
	if notes := strings.TrimSpace(release.Notes); notes != "" {
		b.WriteString(notes + "\n\n")
	}
	b.WriteString("## Features in this release\n\n")
	writeSection(&b, treeOrder(features), func(f models.Feature) bool {
		return f.ReleaseID != nil && *f.ReleaseID == release.ID
	}, "No features were planned into this release.")
	b.WriteString("_Published from FeaturePlus. The full plan is in `" + PlanFilePath + "`._\n")
	return b.String()
}

// planRow is a feature in reading order, with its ancestors.
type planRow struct {
	feature   models.Feature
	ancestors []models.Feature // outermost first
}

// treeOrder lists features parent first, then its children, siblings by id.
// A feature whose parent is missing is taken as top level.
func treeOrder(features []models.Feature) []planRow {
	byID := map[uint]models.Feature{}
	for _, f := range features {
		byID[f.ID] = f
	}
	children := map[uint][]models.Feature{}
	var roots []models.Feature
	for _, f := range features {
		if f.ParentFeatureID != nil {
			if _, ok := byID[*f.ParentFeatureID]; ok && *f.ParentFeatureID != f.ID {
				children[*f.ParentFeatureID] = append(children[*f.ParentFeatureID], f)
				continue
			}
		}
		roots = append(roots, f)
	}
	sortByID := func(list []models.Feature) {
		sort.SliceStable(list, func(i, j int) bool { return list[i].ID < list[j].ID })
	}
	sortByID(roots)

	var out []planRow
	seen := map[uint]bool{}
	var walk func(f models.Feature, ancestors []models.Feature)
	walk = func(f models.Feature, ancestors []models.Feature) {
		if seen[f.ID] {
			return
		}
		seen[f.ID] = true
		out = append(out, planRow{feature: f, ancestors: ancestors})
		kids := children[f.ID]
		sortByID(kids)
		next := append(append([]models.Feature{}, ancestors...), f)
		for _, kid := range kids {
			walk(kid, next)
		}
	}
	for _, root := range roots {
		walk(root, nil)
	}
	return out
}

// writeSection writes the rows `in` accepts as a checklist. A row sits indented
// under its parent when the parent is in the same section; otherwise it names
// the features it sits inside, as "Dashboard › Kanban views".
func writeSection(b *strings.Builder, rows []planRow, in func(models.Feature) bool, empty string) {
	wrote := false
	for _, row := range rows {
		if !in(row.feature) {
			continue
		}
		depth := 0
		for i := len(row.ancestors) - 1; i >= 0 && in(row.ancestors[i]); i-- {
			depth++
		}
		var path []string
		for _, a := range row.ancestors[:len(row.ancestors)-depth] {
			path = append(path, oneLine(a.Title))
		}
		title := oneLine(row.feature.Title)
		if len(path) > 0 {
			title = strings.Join(path, " › ") + " › " + title
		}
		box := "[ ]"
		if isFeatureDone(row.feature.Status) {
			box = "[x]"
		}
		b.WriteString(strings.Repeat("  ", depth) + "- " + box + " " + title + "\n")
		wrote = true
	}
	if !wrote {
		b.WriteString("_" + empty + "_\n")
	}
	b.WriteString("\n")
}

func releaseStatusWord(status models.ReleaseStatus) string {
	switch status {
	case models.ReleaseStatusPublished:
		return "published"
	case models.ReleaseStatusDraft:
		return "planned"
	default:
		return string(status)
	}
}

// oneLine keeps a title on its line, so a stray newline cannot break the list.
func oneLine(s string) string {
	s = strings.Join(strings.Fields(s), " ")
	if s == "" {
		return "Untitled"
	}
	return s
}
