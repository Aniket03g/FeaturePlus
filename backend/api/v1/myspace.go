package v1

import (
	"encoding/json"
	"sort"
	"time"

	"github.com/FeaturePlus/backend/api"
	"github.com/FeaturePlus/backend/models"
	"github.com/gin-gonic/gin"
)

// The My Space dashboard: the projects someone is on, where each stands, and
// what was published in them since they last looked.

// SpaceProject is one project on the My Space dashboard.
type SpaceProject struct {
	ID       int                `json:"id"`
	Name     string             `json:"name"`
	Role     models.ProjectRole `json:"role"`
	Features int                `json:"features"`
	Done     int                `json:"done"`
	// Latest is the latest publish, nil when nothing is published yet.
	Latest *SpacePublish `json:"latest"`
	// Unpublished is how many features the working list has added, removed
	// or changed since the latest publish; with nothing published, all of them.
	Unpublished int `json:"unpublished"`
}

// SpacePublish is one publish, named with its project.
type SpacePublish struct {
	ProjectID     int       `json:"project_id"`
	ProjectName   string    `json:"project_name"`
	VersionID     uint      `json:"version_id"`
	PublishNumber int       `json:"publish_number"`
	Notes         string    `json:"notes"`
	By            string    `json:"by"`
	ByID          int       `json:"by_id"`
	At            time.Time `json:"at"`
}

// SpaceSummary is the whole dashboard.
type SpaceSummary struct {
	// SeenAt is when the person last marked the dashboard seen; nil the first time.
	SeenAt   *time.Time     `json:"seen_at"`
	Projects []SpaceProject `json:"projects"`
	// New lists publishes by other people since SeenAt, newest first. Empty
	// the first time, when there is nothing to compare against.
	New []SpacePublish `json:"new"`
}

// Space returns the signed-in person's My Space dashboard. Reading it changes
// nothing; SpaceSeen records the visit.
//
// GET /api/v1/me/space
func (h *VersionsHandler) Space(c *gin.Context) {
	userID, err := api.UserID(c)
	if err != nil {
		api.Fail(c, err)
		return
	}

	var me models.User
	if err := h.db.Select("id", "space_seen_at").First(&me, userID).Error; err != nil {
		api.Fail(c, api.FromDB(err, "User"))
		return
	}

	// Their own projects and the ones shared with them, as the project list has them.
	var projects []models.Project
	if err := h.db.Where("owner_id = ? OR id IN (?)", userID,
		h.db.Model(&models.ProjectMember{}).Select("project_id").Where("user_id = ?", userID)).
		Order("name").Find(&projects).Error; err != nil {
		api.Fail(c, api.Internal(err))
		return
	}

	out := SpaceSummary{SeenAt: me.SpaceSeenAt, Projects: []SpaceProject{}, New: []SpacePublish{}}
	latestOf := map[int]models.FeatureVersion{}
	var since []models.FeatureVersion
	for i := range projects {
		project := &projects[i]
		role, err := projectRole(h.db, project, userID)
		if err != nil {
			api.Fail(c, api.Internal(err))
			return
		}

		opened, err := openProject(h.db, project, true)
		if err != nil {
			api.Fail(c, api.Internal(err))
			return
		}
		row := SpaceProject{ID: project.ID, Name: project.Name, Role: role, Features: len(opened.Features)}
		for _, f := range opened.Features {
			if f.Status == string(models.StatusDone) {
				row.Done++
			}
		}

		latest, found, err := latestPublished(h.db, project.ID)
		if err != nil {
			api.Fail(c, api.Internal(err))
			return
		}
		if found {
			published, err := readSnapshot(latest.Snapshot)
			if err != nil {
				api.Fail(c, api.Internal(err))
				return
			}
			diff := compareLists(published.OpenedProject, opened)
			row.Unpublished = diff.Added + diff.Removed + diff.Changed
			latestOf[project.ID] = latest
		} else {
			row.Unpublished = len(opened.Features)
		}
		out.Projects = append(out.Projects, row)

		if me.SpaceSeenAt != nil {
			var found []models.FeatureVersion
			if err := h.db.Omit("snapshot").
				Where("project_id = ? AND publish_number > 0 AND published_at > ? AND saved_by_id <> ?",
					project.ID, *me.SpaceSeenAt, userID).
				Find(&found).Error; err != nil {
				api.Fail(c, api.Internal(err))
				return
			}
			since = append(since, found...)
		}
	}

	everyone := append([]models.FeatureVersion{}, since...)
	for _, v := range latestOf {
		everyone = append(everyone, v)
	}
	names, err := h.saverNames(everyone)
	if err != nil {
		api.Fail(c, api.Internal(err))
		return
	}
	projectNames := map[int]string{}
	for _, p := range projects {
		projectNames[p.ID] = p.Name
	}
	describe := func(v models.FeatureVersion) SpacePublish {
		at := v.CreatedAt
		if v.PublishedAt != nil {
			at = *v.PublishedAt
		}
		return SpacePublish{
			ProjectID: v.ProjectID, ProjectName: projectNames[v.ProjectID], VersionID: v.ID,
			PublishNumber: v.PublishNumber, Notes: v.Notes, By: names[v.SavedByID], ByID: v.SavedByID, At: at,
		}
	}

	for i := range out.Projects {
		if v, ok := latestOf[out.Projects[i].ID]; ok {
			p := describe(v)
			out.Projects[i].Latest = &p
		}
	}
	for _, v := range since {
		out.New = append(out.New, describe(v))
	}
	sort.Slice(out.New, func(i, j int) bool { return out.New[i].At.After(out.New[j].At) })

	api.OK(c, out)
}

// SpaceSeen records that the signed-in person has looked at their My Space
// dashboard, so the next look shows only what was published after now.
//
// POST /api/v1/me/space/seen
func (h *VersionsHandler) SpaceSeen(c *gin.Context) {
	userID, err := api.UserID(c)
	if err != nil {
		api.Fail(c, err)
		return
	}
	// UpdateColumn skips the user hooks, which are about passwords.
	if err := h.db.Model(&models.User{}).Where("id = ?", userID).
		UpdateColumn("space_seen_at", time.Now()).Error; err != nil {
		api.Fail(c, api.Internal(err))
		return
	}
	api.OK(c, json.RawMessage(`{}`))
}
