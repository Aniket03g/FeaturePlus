package v1

import (
	"sort"
	"strconv"
	"strings"

	"github.com/FeaturePlus/backend/api"
	"github.com/FeaturePlus/backend/internal/log"
	"github.com/FeaturePlus/backend/models"
	"github.com/FeaturePlus/backend/repositories"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// ReleasesHandler serves /api/v1 release routes.
//
// A release is a plan with two halves that the data model keeps separate. The
// features going into it are named by features.release_id, so a feature is in
// at most one release. The pull requests delivering it are named by the
// release_prs join table, so a pull request can appear in more than one. Both
// halves are shown together because a person planning a release is asking one
// question — is this ready to go out — and the answer needs both.
//
// Publishing here records the decision that the release is done. When the
// project is linked to a GitHub repository it also tags the repository and
// makes a GitHub Release (see github.go); it never branches or cherry-picks,
// which the older /api/releases/:id/finalize route still owns.
type ReleasesHandler struct {
	projectRepo *repositories.ProjectRepository
	db          *gorm.DB
	// github makes the tag and GitHub Release when a release is published in
	// a project linked to a repository.
	github *githubPublisher
}

// NewReleasesHandler builds the handler.
func NewReleasesHandler(db *gorm.DB) *ReleasesHandler {
	return &ReleasesHandler{
		projectRepo: repositories.NewProjectRepository(db),
		db:          db,
		github:      &githubPublisher{db: db, accounts: newGitHubAccounts(db)},
	}
}

// Register mounts the release routes onto an authenticated group.
func (h *ReleasesHandler) Register(g *gin.RouterGroup) {
	g.GET("/projects/:id/releases", h.ListForProject)
	g.POST("/projects/:id/releases", h.Create)

	releases := g.Group("/releases")
	{
		releases.GET("/:releaseId", h.Get)
		releases.PATCH("/:releaseId", h.Update)
		releases.DELETE("/:releaseId", h.Delete)
		releases.POST("/:releaseId/publish", h.Publish)

		releases.POST("/:releaseId/features", h.AssignFeatures)
		releases.DELETE("/:releaseId/features/:featureId", h.UnassignFeature)

		releases.POST("/:releaseId/pull-requests", h.LinkPullRequests)
		releases.DELETE("/:releaseId/pull-requests/:prId", h.UnlinkPullRequest)
	}
}

// ListForProject returns a project's releases, newest first.
//
// GET /api/v1/projects/:id/releases?status=&q=
func (h *ReleasesHandler) ListForProject(c *gin.Context) {
	projectID, err := api.IDParam(c, "id")
	if err != nil {
		api.Fail(c, err)
		return
	}

	if _, dbErr := h.projectRepo.GetProjectByID(projectID); dbErr != nil {
		api.Fail(c, api.FromDB(dbErr, "Project"))
		return
	}

	var releases []models.Release
	if dbErr := h.db.Where("project_id = ?", projectID).Find(&releases).Error; dbErr != nil {
		api.Fail(c, api.Internal(dbErr))
		return
	}

	filtered := filterReleases(releases, lowerSet(c.QueryArray("status")), strings.ToLower(c.Query("q")))

	// Newest first: a release list is read from the top, and the one being
	// planned right now is the one just created.
	sort.SliceStable(filtered, func(i, j int) bool { return filtered[i].ID > filtered[j].ID })

	page := api.ParsePage(c)
	total := int64(len(filtered))
	items := api.Slice(filtered, page)

	ids := releaseIDs(items)
	api.List(c, NewReleaseDTOs(items, h.featureCounts(ids), h.pullRequestCounts(ids)), page.Meta(total))
}

// Get returns one release with its planned features, its linked pull requests,
// and whether it is ready to publish.
//
// GET /api/v1/releases/:releaseId
func (h *ReleasesHandler) Get(c *gin.Context) {
	release, err := h.load(c)
	if err != nil {
		api.Fail(c, err)
		return
	}

	features, dbErr := h.plannedFeatures(release.ID)
	if dbErr != nil {
		api.Fail(c, api.Internal(dbErr))
		return
	}

	prs, dbErr := h.linkedPullRequests(release.ID)
	if dbErr != nil {
		api.Fail(c, api.Internal(dbErr))
		return
	}

	ids := []uint{release.ID}
	dto := NewReleaseDTO(*release, h.featureCounts(ids)[release.ID], h.pullRequestCounts(ids)[release.ID])

	featureIDList := featureIDs(features)
	dto.PlannedFeatures = NewFeatureDTOs(
		features,
		h.tagsByFeature(featureIDList),
		map[uint]*FeatureTaskCounts{},
	)
	dto.LinkedPullRequests = h.decoratePullRequests(prs)

	readiness := releaseReadiness(*release, features, prs)
	dto.Readiness = &readiness
	dto.GitHubURL = h.github.releaseURL(release.ID)

	api.OK(c, dto)
}

// Create plans a new draft release.
//
// POST /api/v1/projects/:id/releases
func (h *ReleasesHandler) Create(c *gin.Context) {
	projectID, err := api.IDParam(c, "id")
	if err != nil {
		api.Fail(c, err)
		return
	}

	project, dbErr := h.projectRepo.GetProjectByID(projectID)
	if dbErr != nil {
		api.Fail(c, api.FromDB(dbErr, "Project"))
		return
	}

	var req CreateReleaseRequest
	if bindErr := api.Bind(c, &req); bindErr != nil {
		api.Fail(c, bindErr)
		return
	}

	if err := h.authoriseWrite(c, project); err != nil {
		api.Fail(c, err)
		return
	}

	tag := strings.TrimSpace(req.Tag)
	if tag == "" {
		api.Fail(c, api.Validation("The tag is empty").WithField("tag", "This field is required"))
		return
	}

	// The unique index on (project_id, tag) would catch this, but only as a
	// driver-specific constraint error. Asking first turns it into a message
	// that names the tag.
	var existing int64
	if dbErr := h.db.Model(&models.Release{}).
		Where("project_id = ? AND tag = ?", projectID, tag).
		Count(&existing).Error; dbErr != nil {
		api.Fail(c, api.Internal(dbErr))
		return
	}
	if existing > 0 {
		api.Fail(c, api.Conflict("This project already has a release tagged "+tag))
		return
	}

	release := models.Release{
		ProjectID: projectID,
		Tag:       tag,
		Notes:     req.Notes,
		Status:    models.ReleaseStatusDraft,
	}

	// Omit the associations: models.Release carries a Project value and a PRs
	// slice, and letting GORM save those would have an empty release write an
	// empty project row alongside it.
	if dbErr := h.db.Omit("Project", "PRs").Create(&release).Error; dbErr != nil {
		api.Fail(c, api.FromDB(dbErr, "Release"))
		return
	}

	if len(req.FeatureIDs) > 0 {
		if err := h.assignFeatures(&release, req.FeatureIDs); err != nil {
			api.Fail(c, err)
			return
		}
	}
	if len(req.PullRequestIDs) > 0 {
		if err := h.linkPullRequests(&release, req.PullRequestIDs); err != nil {
			api.Fail(c, err)
			return
		}
	}

	ids := []uint{release.ID}
	api.Created(c, NewReleaseDTO(release, h.featureCounts(ids)[release.ID], h.pullRequestCounts(ids)[release.ID]))
}

// Update changes a release's tag or notes.
//
// PATCH /api/v1/releases/:releaseId
func (h *ReleasesHandler) Update(c *gin.Context) {
	release, err := h.loadForWrite(c)
	if err != nil {
		api.Fail(c, err)
		return
	}

	var req UpdateReleaseRequest
	if bindErr := api.Bind(c, &req); bindErr != nil {
		api.Fail(c, bindErr)
		return
	}

	// Once a release has left draft, its tag is what was announced. The notes
	// can still be corrected after the fact; the tag cannot.
	if req.Tag != nil && release.Status != models.ReleaseStatusDraft {
		api.Fail(c, api.Conflict("Only a draft release can be re-tagged"))
		return
	}

	if req.Tag != nil {
		tag := strings.TrimSpace(*req.Tag)
		if tag == "" {
			api.Fail(c, api.Validation("The tag is empty").WithField("tag", "This field is required"))
			return
		}

		var clash int64
		if dbErr := h.db.Model(&models.Release{}).
			Where("project_id = ? AND tag = ? AND id <> ?", release.ProjectID, tag, release.ID).
			Count(&clash).Error; dbErr != nil {
			api.Fail(c, api.Internal(dbErr))
			return
		}
		if clash > 0 {
			api.Fail(c, api.Conflict("This project already has a release tagged "+tag))
			return
		}
	}

	req.Apply(release)

	if dbErr := h.db.Model(release).Omit("Project", "PRs").
		Updates(map[string]any{"tag": release.Tag, "notes": release.Notes}).Error; dbErr != nil {
		api.Fail(c, api.FromDB(dbErr, "Release"))
		return
	}

	ids := []uint{release.ID}
	api.OK(c, NewReleaseDTO(*release, h.featureCounts(ids)[release.ID], h.pullRequestCounts(ids)[release.ID]))
}

// Delete removes a draft release.
//
// DELETE /api/v1/releases/:releaseId
//
// A plan that is abandoned takes nothing with it: the features it named are
// unassigned and the pull request links dropped, but neither the features nor
// the pull requests are touched otherwise.
//
// Only a published release is undeletable, because it is a record of something
// that actually went out. A draft, or one the older Git finalize flow left as
// "failed", is just a plan that came to nothing and can be cleared away.
func (h *ReleasesHandler) Delete(c *gin.Context) {
	release, err := h.loadForWrite(c)
	if err != nil {
		api.Fail(c, err)
		return
	}

	if release.Status == models.ReleaseStatusPublished {
		api.Fail(c, api.Conflict("A published release cannot be deleted"))
		return
	}

	if dbErr := h.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&models.Feature{}).
			Where("release_id = ?", release.ID).
			Update("release_id", nil).Error; err != nil {
			return err
		}
		if err := tx.Exec("DELETE FROM release_prs WHERE release_id = ?", release.ID).Error; err != nil {
			return err
		}
		return tx.Delete(&models.Release{}, release.ID).Error
	}); dbErr != nil {
		api.Fail(c, api.Internal(dbErr))
		return
	}

	api.NoContent(c)
}

// Publish marks a release as shipped.
//
// POST /api/v1/releases/:releaseId/publish
//
// It refuses while a blocker stands, and says what: an empty release, or a
// linked pull request that is not both tested and approved. Unfinished
// features only warn; the screen asks before publishing over them.
func (h *ReleasesHandler) Publish(c *gin.Context) {
	release, err := h.loadForWrite(c)
	if err != nil {
		api.Fail(c, err)
		return
	}

	if release.Status != models.ReleaseStatusDraft {
		api.Fail(c, api.Conflict(notDraftReason(release.Status)))
		return
	}

	features, dbErr := h.plannedFeatures(release.ID)
	if dbErr != nil {
		api.Fail(c, api.Internal(dbErr))
		return
	}

	prs, dbErr := h.linkedPullRequests(release.ID)
	if dbErr != nil {
		api.Fail(c, api.Internal(dbErr))
		return
	}

	readiness := releaseReadiness(*release, features, prs)
	if !readiness.Ready {
		failure := api.Conflict("This release is not ready to publish")
		for i, blocker := range readiness.Blockers {
			failure.WithField("blocker_"+strconv.Itoa(i+1), blocker)
		}
		api.Fail(c, failure)
		return
	}

	if dbErr := h.db.Model(&models.Release{}).Where("id = ?", release.ID).
		Update("status", models.ReleaseStatusPublished).Error; dbErr != nil {
		api.Fail(c, api.FromDB(dbErr, "Release"))
		return
	}
	release.Status = models.ReleaseStatusPublished

	ids := []uint{release.ID}
	dto := NewReleaseDTO(*release, h.featureCounts(ids)[release.ID], h.pullRequestCounts(ids)[release.ID])
	dto.Readiness = &readiness

	// In a project linked to GitHub, publishing also tags the repository and
	// makes a GitHub Release. The release is published either way: a GitHub
	// failure is reported alongside it and can be retried, rather than undoing
	// a decision that was already made.
	if link, linkErr := h.github.link(release.ProjectID); linkErr == nil && link != nil {
		if project, dbErr := h.projectRepo.GetProjectByID(release.ProjectID); dbErr == nil {
			client, clientErr := h.github.clientFor(c)
			if clientErr != nil {
				dto.GitHubError = api.AsError(clientErr).Message
			} else {
				url, pubErr := h.github.publishRelease(client, project, release)
				dto.GitHubURL = url
				if pubErr != nil {
					dto.GitHubError = api.AsError(pubErr).Message
				}
			}
		}
	}

	api.OK(c, dto)
}

// AssignFeatures plans features into a release.
//
// POST /api/v1/releases/:releaseId/features
func (h *ReleasesHandler) AssignFeatures(c *gin.Context) {
	release, err := h.loadForWrite(c)
	if err != nil {
		api.Fail(c, err)
		return
	}

	var req AssignFeaturesRequest
	if bindErr := api.Bind(c, &req); bindErr != nil {
		api.Fail(c, bindErr)
		return
	}

	if err := h.assignFeatures(release, req.FeatureIDs); err != nil {
		api.Fail(c, err)
		return
	}

	h.respondWithDetail(c, release)
}

// UnassignFeature takes a feature back out of a release.
//
// DELETE /api/v1/releases/:releaseId/features/:featureId
func (h *ReleasesHandler) UnassignFeature(c *gin.Context) {
	release, err := h.loadForWrite(c)
	if err != nil {
		api.Fail(c, err)
		return
	}

	featureID, err := api.IDParam(c, "featureId")
	if err != nil {
		api.Fail(c, err)
		return
	}

	if release.Status != models.ReleaseStatusDraft {
		api.Fail(c, api.Conflict("Only a draft release can be re-planned"))
		return
	}

	result := h.db.Model(&models.Feature{}).
		Where("id = ? AND release_id = ?", featureID, release.ID).
		Update("release_id", nil)
	if result.Error != nil {
		api.Fail(c, api.Internal(result.Error))
		return
	}
	if result.RowsAffected == 0 {
		api.Fail(c, api.NotFound("Feature in this release"))
		return
	}

	api.NoContent(c)
}

// LinkPullRequests attaches pull requests to a release.
//
// POST /api/v1/releases/:releaseId/pull-requests
func (h *ReleasesHandler) LinkPullRequests(c *gin.Context) {
	release, err := h.loadForWrite(c)
	if err != nil {
		api.Fail(c, err)
		return
	}

	var req LinkPullRequestsRequest
	if bindErr := api.Bind(c, &req); bindErr != nil {
		api.Fail(c, bindErr)
		return
	}

	if err := h.linkPullRequests(release, req.PullRequestIDs); err != nil {
		api.Fail(c, err)
		return
	}

	h.respondWithDetail(c, release)
}

// UnlinkPullRequest detaches a pull request from a release.
//
// DELETE /api/v1/releases/:releaseId/pull-requests/:prId
func (h *ReleasesHandler) UnlinkPullRequest(c *gin.Context) {
	release, err := h.loadForWrite(c)
	if err != nil {
		api.Fail(c, err)
		return
	}

	prID, err := api.IDParam(c, "prId")
	if err != nil {
		api.Fail(c, err)
		return
	}

	if release.Status != models.ReleaseStatusDraft {
		api.Fail(c, api.Conflict("Only a draft release can be re-planned"))
		return
	}

	result := h.db.Exec(
		"DELETE FROM release_prs WHERE release_id = ? AND pull_request_id = ?", release.ID, prID)
	if result.Error != nil {
		api.Fail(c, api.Internal(result.Error))
		return
	}
	if result.RowsAffected == 0 {
		api.Fail(c, api.NotFound("Pull request in this release"))
		return
	}

	api.NoContent(c)
}

// assignFeatures moves features into a release, checking each belongs to the
// same project first. A feature already planned into another release moves
// here: features.release_id holds one value, so that is what assignment means.
func (h *ReleasesHandler) assignFeatures(release *models.Release, ids []uint) error {
	if release.Status != models.ReleaseStatusDraft {
		return api.Conflict("Only a draft release can be re-planned")
	}

	var features []models.Feature
	if err := h.db.Where("id IN ?", ids).Find(&features).Error; err != nil {
		return api.Internal(err)
	}

	if len(features) != len(ids) {
		return api.Validation("One or more of those features does not exist").
			WithField("feature_ids", "Every id must name an existing feature")
	}

	for _, feature := range features {
		if feature.ProjectID != release.ProjectID {
			return api.Validation("A release can only contain features from its own project").
				WithField("feature_ids", feature.Title+" belongs to a different project")
		}
	}

	if err := h.db.Model(&models.Feature{}).Where("id IN ?", ids).
		Update("release_id", release.ID).Error; err != nil {
		return api.Internal(err)
	}

	return nil
}

// linkPullRequests attaches pull requests to a release, checking each reaches
// the same project through its feature. Re-linking one already attached is not
// an error; the join row is simply left alone.
func (h *ReleasesHandler) linkPullRequests(release *models.Release, ids []uint) error {
	if release.Status != models.ReleaseStatusDraft {
		return api.Conflict("Only a draft release can be re-planned")
	}

	var prs []models.PullRequest
	if err := h.db.Where("id IN ? AND deleted_at IS NULL", ids).Find(&prs).Error; err != nil {
		return api.Internal(err)
	}

	if len(prs) != len(ids) {
		return api.Validation("One or more of those pull requests does not exist").
			WithField("pull_request_ids", "Every id must name an existing pull request")
	}

	// A pull request reaches a project only through its feature, so that is the
	// check: without it a release could gather work from anywhere.
	projectOf, err := pullRequestProjects(h.db, prs)
	if err != nil {
		return api.Internal(err)
	}

	for _, pr := range prs {
		if projectOf[pr.ID] != release.ProjectID {
			return api.Validation("A release can only contain pull requests from its own project").
				WithField("pull_request_ids", pr.Title+" belongs to a different project")
		}
	}

	return h.db.Transaction(func(tx *gorm.DB) error {
		for _, pr := range prs {
			if err := tx.Exec(
				"INSERT INTO release_prs (release_id, pull_request_id) SELECT ?, ? "+
					"WHERE NOT EXISTS (SELECT 1 FROM release_prs WHERE release_id = ? AND pull_request_id = ?)",
				release.ID, pr.ID, release.ID, pr.ID).Error; err != nil {
				return err
			}
		}
		return nil
	})
}

// respondWithDetail re-reads a release and answers with the full detail shape,
// so a client that just changed the plan sees the result without a follow-up
// request — including whether the change made the release publishable.
func (h *ReleasesHandler) respondWithDetail(c *gin.Context, release *models.Release) {
	features, dbErr := h.plannedFeatures(release.ID)
	if dbErr != nil {
		api.Fail(c, api.Internal(dbErr))
		return
	}

	prs, dbErr := h.linkedPullRequests(release.ID)
	if dbErr != nil {
		api.Fail(c, api.Internal(dbErr))
		return
	}

	ids := []uint{release.ID}
	dto := NewReleaseDTO(*release, h.featureCounts(ids)[release.ID], h.pullRequestCounts(ids)[release.ID])
	dto.PlannedFeatures = NewFeatureDTOs(features, h.tagsByFeature(featureIDs(features)), map[uint]*FeatureTaskCounts{})
	dto.LinkedPullRequests = h.decoratePullRequests(prs)

	readiness := releaseReadiness(*release, features, prs)
	dto.Readiness = &readiness

	api.OK(c, dto)
}

// load fetches the release named in the path.
func (h *ReleasesHandler) load(c *gin.Context) (*models.Release, error) {
	id, err := api.IDParam(c, "releaseId")
	if err != nil {
		return nil, err
	}

	var release models.Release
	if dbErr := h.db.First(&release, id).Error; dbErr != nil {
		return nil, api.FromDB(dbErr, "Release")
	}

	return &release, nil
}

// loadForWrite fetches the release and checks the caller may change it.
// Permission follows the release's project, as it does for every other
// resource hanging off one.
func (h *ReleasesHandler) loadForWrite(c *gin.Context) (*models.Release, error) {
	release, err := h.load(c)
	if err != nil {
		return nil, err
	}

	project, dbErr := h.projectRepo.GetProjectByID(release.ProjectID)
	if dbErr != nil {
		return nil, api.FromDB(dbErr, "Project")
	}

	if err := h.authoriseWrite(c, project); err != nil {
		return nil, err
	}

	return release, nil
}

// authoriseWrite permits changes by the project's owner, or a manager.
func (h *ReleasesHandler) authoriseWrite(c *gin.Context, project *models.Project) error {
	userID, err := api.UserID(c)
	if err != nil {
		return err
	}

	if project.OwnerID == userID || api.IsManager(c) {
		return nil
	}

	return api.Forbidden("Only the project owner or a manager can change this project's releases")
}

// plannedFeatures loads the features assigned to a release.
func (h *ReleasesHandler) plannedFeatures(releaseID uint) ([]models.Feature, error) {
	var features []models.Feature
	err := h.db.Where("release_id = ?", releaseID).Order("id").Find(&features).Error
	return features, err
}

// linkedPullRequests loads the pull requests attached to a release.
func (h *ReleasesHandler) linkedPullRequests(releaseID uint) ([]models.PullRequest, error) {
	var prs []models.PullRequest
	err := h.db.
		Joins("JOIN release_prs ON release_prs.pull_request_id = pull_requests.id").
		Where("release_prs.release_id = ? AND pull_requests.deleted_at IS NULL", releaseID).
		Order("pull_requests.id DESC").
		Find(&prs).Error
	return prs, err
}

// decoratePullRequests names what each pull request in a release delivers.
func (h *ReleasesHandler) decoratePullRequests(prs []models.PullRequest) []PullRequestDTO {
	return pullRequestDTOsWithContext(h.db, prs, 0)
}

// featureCounts reports, for many releases at once, how many features each
// holds and how many are done.
func (h *ReleasesHandler) featureCounts(ids []uint) map[uint]ReleaseCounts {
	counts := map[uint]ReleaseCounts{}
	if len(ids) == 0 {
		return counts
	}

	type row struct {
		ReleaseID uint
		Total     int
		Done      int
	}
	var rows []row

	if err := h.db.Model(&models.Feature{}).
		Select("release_id, count(*) as total, "+
			"sum(case when lower(status) in ('done','completed') then 1 else 0 end) as done").
		Where("release_id IN ? AND deleted_at IS NULL", ids).
		Group("release_id").
		Scan(&rows).Error; err != nil {
		log.WithError(err).Warn("could not load release feature counts")
		return counts
	}

	for _, r := range rows {
		counts[r.ReleaseID] = ReleaseCounts{Total: r.Total, Done: r.Done}
	}
	return counts
}

// pullRequestCounts reports, for many releases at once, how many pull requests
// each holds and how many are finished — tested and approved, the same rule a
// task's completion uses.
func (h *ReleasesHandler) pullRequestCounts(ids []uint) map[uint]ReleaseCounts {
	counts := map[uint]ReleaseCounts{}
	if len(ids) == 0 {
		return counts
	}

	type row struct {
		ReleaseID uint
		Total     int
		Done      int
	}
	var rows []row

	if err := h.db.Table("release_prs").
		Select("release_prs.release_id as release_id, count(*) as total, "+
			"sum(case when pull_requests.tested = 1 and lower(pull_requests.status) = 'approved' "+
			"then 1 else 0 end) as done").
		Joins("JOIN pull_requests ON pull_requests.id = release_prs.pull_request_id").
		Where("release_prs.release_id IN ? AND pull_requests.deleted_at IS NULL", ids).
		Group("release_prs.release_id").
		Scan(&rows).Error; err != nil {
		log.WithError(err).Warn("could not load release pull request counts")
		return counts
	}

	for _, r := range rows {
		counts[r.ReleaseID] = ReleaseCounts{Total: r.Total, Done: r.Done}
	}
	return counts
}

// tagsByFeature loads tag names for many features in one query. It mirrors the
// features handler's helper of the same shape; a release detail needs the same
// tags on the features it lists.
func (h *ReleasesHandler) tagsByFeature(ids []uint) map[uint][]string {
	tags := map[uint][]string{}
	if len(ids) == 0 {
		return tags
	}

	var rows []models.FeatureTag
	if err := h.db.Where("feature_id IN ?", ids).Order("tag_name").Find(&rows).Error; err != nil {
		log.WithError(err).Warn("could not load feature tags for a release")
		return tags
	}

	for _, row := range rows {
		tags[row.FeatureID] = append(tags[row.FeatureID], row.TagName)
	}
	return tags
}

// releaseReadiness decides whether a release can go out, and explains itself.
//
// The rules are the ones the rest of the API already applies, gathered here so
// the release screen and the publish route cannot disagree about them:
//   - an empty release has nothing to publish
//   - every linked pull request must be tested and approved
//
// Unfinished features are a warning, not a blocker: a release can be planned
// from features alone and published before all of them are marked done.
func releaseReadiness(release models.Release, features []models.Feature, prs []models.PullRequest) ReleaseReadiness {
	readiness := ReleaseReadiness{Blockers: []string{}, Warnings: []string{}}

	if release.Status != models.ReleaseStatusDraft {
		readiness.Ready = false
		readiness.Blockers = append(readiness.Blockers, notDraftReason(release.Status))
		return readiness
	}

	if len(features) == 0 && len(prs) == 0 {
		readiness.Blockers = append(readiness.Blockers,
			"Nothing is planned into this release yet.")
		return readiness
	}

	outstandingFeatures := 0
	for _, feature := range features {
		if !isFeatureDone(feature.Status) {
			outstandingFeatures++
		}
	}
	if outstandingFeatures > 0 {
		readiness.Warnings = append(readiness.Warnings,
			plural(outstandingFeatures, "planned feature")+" not finished yet.")
	}

	outstandingPRs := 0
	for _, pr := range prs {
		if !pr.Tested || !IsApproved(pr.Status) {
			outstandingPRs++
		}
	}
	if outstandingPRs > 0 {
		readiness.Blockers = append(readiness.Blockers,
			plural(outstandingPRs, "pull request")+" still waiting on testing or approval.")
	}

	readiness.Ready = len(readiness.Blockers) == 0
	return readiness
}

// notDraftReason explains why a release cannot be published, naming the status
// it actually holds.
//
// "Already published" is only true of a published one. Real data also holds
// "failed" and "in_progress" — statuses the model never declared but the older
// Git finalize flow writes — and telling someone their failed release already
// shipped is worse than saying nothing.
func notDraftReason(status models.ReleaseStatus) string {
	if status == models.ReleaseStatusPublished {
		return "This release has already been published."
	}
	return "This release is " + string(status) + ", and only a draft can be published."
}

// isFeatureDone reads a feature's status. Existing data holds both "done" and
// "completed", so both count.
func isFeatureDone(status models.FeatureStatus) bool {
	switch strings.ToLower(string(status)) {
	case "done", "completed":
		return true
	default:
		return false
	}
}

// filterReleases applies ?status= and the ?q= search across tag and notes.
func filterReleases(releases []models.Release, statuses map[string]bool, query string) []models.Release {
	out := make([]models.Release, 0, len(releases))

	for _, release := range releases {
		if len(statuses) > 0 && !statuses[strings.ToLower(string(release.Status))] {
			continue
		}
		if query != "" &&
			!contains(lower(release.Tag), query) &&
			!contains(lower(release.Notes), query) {
			continue
		}
		out = append(out, release)
	}

	return out
}

func releaseIDs(releases []models.Release) []uint {
	ids := make([]uint, 0, len(releases))
	for _, r := range releases {
		ids = append(ids, r.ID)
	}
	return ids
}
