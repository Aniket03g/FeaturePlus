package v1

import (
	"encoding/json"
	"errors"
	"io"
	"strconv"
	"strings"

	"github.com/FeaturePlus/backend/api"
	"github.com/FeaturePlus/backend/models"
	"github.com/FeaturePlus/backend/repositories"
	"github.com/FeaturePlus/backend/services"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// PlaygroundHandler turns a list of feature names drafted in the playground
// into real features, in a project that exists or one made for the purpose.
//
// It is names, nesting and releases. A name the project already has is not
// created a second time: that feature is used instead, so anything nested under
// it in the list lands inside it. That is what makes importing the same list
// twice harmless, and it is the only kind of merge this does.
//
// Releases merge the same way, by tag: a release the project already has is
// used, and the features the list plans into it are moved there. A feature the
// list leaves unplanned keeps whatever release it had.
//
// Dependencies go in with the features: a row names the rows it needs, and
// each becomes a dependency unless the project already has it.
//
// It also drafts: a prompt in plain words comes back as a revised list, from
// whichever drafter the handler has. Drafting writes nothing.
type PlaygroundHandler struct {
	projectRepo *repositories.ProjectRepository
	db          *gorm.DB
	drafter     services.Drafter
}

// NewPlaygroundHandler builds the handler. It drafts with Claude when
// ANTHROPIC_API_KEY is set and with the stand-in otherwise.
func NewPlaygroundHandler(db *gorm.DB) *PlaygroundHandler {
	return &PlaygroundHandler{
		projectRepo: repositories.NewProjectRepository(db),
		db:          db,
		drafter:     services.NewDrafterFromEnv(),
	}
}

// Register mounts the playground routes onto an authenticated group.
func (h *PlaygroundHandler) Register(g *gin.RouterGroup) {
	g.POST("/playground/import", h.Import)
	g.POST("/playground/draft", h.Draft)
	g.GET("/playground/ai", h.AI)
	g.GET("/playground/saved", h.Saved)
	g.PUT("/playground/saved", h.Save)
	g.GET("/playground/projects/:id", h.OpenProject)
}

// AI says which drafter answers prompts, so the page can label it before the
// first one is sent.
//
// GET /api/v1/playground/ai
func (h *PlaygroundHandler) AI(c *gin.Context) {
	name := h.drafter.Name()
	api.OK(c, gin.H{"drafter": name, "connected": name != services.StandInDrafter{}.Name()})
}

// maxSavedDraft bounds one person's saved playground. A thousand features with
// their releases and a conversation is well under this.
const maxSavedDraft = 2 << 20

// Saved returns the caller's saved playground, or null when there is none.
//
// GET /api/v1/playground/saved
func (h *PlaygroundHandler) Saved(c *gin.Context) {
	userID, err := api.UserID(c)
	if err != nil {
		api.Fail(c, err)
		return
	}
	var draft models.PlaygroundDraft
	if dbErr := h.db.Where("user_id = ?", userID).First(&draft).Error; dbErr != nil {
		if dbErr == gorm.ErrRecordNotFound {
			api.OK(c, gin.H{"draft": nil})
			return
		}
		api.Fail(c, api.Internal(dbErr))
		return
	}
	api.OK(c, gin.H{"draft": json.RawMessage(draft.Data), "updated_at": draft.UpdatedAt})
}

// Save keeps the caller's playground. The body is the page's own JSON, kept
// as sent: it has to be an object, and not too large, and that is all the
// server checks, because nothing reads it but the page.
//
// PUT /api/v1/playground/saved
func (h *PlaygroundHandler) Save(c *gin.Context) {
	userID, err := api.UserID(c)
	if err != nil {
		api.Fail(c, err)
		return
	}
	body, readErr := io.ReadAll(io.LimitReader(c.Request.Body, maxSavedDraft+1))
	if readErr != nil {
		api.Fail(c, api.BadRequest("Could not read the draft"))
		return
	}
	if len(body) > maxSavedDraft {
		api.Fail(c, api.Validation("The playground is too large to save; import or clear part of it"))
		return
	}
	var probe map[string]json.RawMessage
	if json.Unmarshal(body, &probe) != nil {
		api.Fail(c, api.BadRequest("The draft is not a JSON object"))
		return
	}

	draft := models.PlaygroundDraft{UserID: uint(userID), Data: string(body)}
	if dbErr := h.db.Where("user_id = ?", userID).
		Assign(models.PlaygroundDraft{Data: string(body)}).
		FirstOrCreate(&draft).Error; dbErr != nil {
		api.Fail(c, api.Internal(dbErr))
		return
	}
	api.OK(c, gin.H{"updated_at": draft.UpdatedAt})
}

// OpenedFeature is one feature of a project, shaped as a playground row. Its
// key is "f" and the feature id, and so are the keys its parent and needs use.
type OpenedFeature struct {
	Key        string   `json:"key"`
	Title      string   `json:"title"`
	ParentKey  string   `json:"parent_key"`
	Needs      []string `json:"needs"`
	ReleaseKey string   `json:"release_key"`
	FeatureID  uint     `json:"feature_id"`
}

// OpenedRelease is one of the project's releases, keyed "r" and its id.
type OpenedRelease struct {
	Key       string `json:"key"`
	Name      string `json:"name"`
	Published bool   `json:"published"`
}

// OpenProject returns a project as a playground list: its features with their
// nesting, the dependencies between them, and its releases. The page puts this
// in place of its draft, and an import back into the same project then renames
// and moves those same features rather than adding new ones.
//
// Reading follows the rest of the API: any signed-in person can read a
// project's features. Writing them back is the import, which needs the right
// to edit the project.
//
// GET /api/v1/playground/projects/:id
func (h *PlaygroundHandler) OpenProject(c *gin.Context) {
	projectID, err := api.IDParam(c, "id")
	if err != nil {
		api.Fail(c, err)
		return
	}
	project, err := requireProject(c, h.db, projectID, canView)
	if err != nil {
		api.Fail(c, err)
		return
	}

	var features []models.Feature
	if err := h.db.Where("project_id = ?", projectID).Order("id").Find(&features).Error; err != nil {
		api.Fail(c, api.Internal(err))
		return
	}
	var releases []models.Release
	if err := h.db.Where("project_id = ?", projectID).Order("id").Find(&releases).Error; err != nil {
		api.Fail(c, api.Internal(err))
		return
	}

	key := func(id uint) string { return "f" + strconv.FormatUint(uint64(id), 10) }
	releaseKey := func(id uint) string { return "r" + strconv.FormatUint(uint64(id), 10) }

	ids := make([]uint, 0, len(features))
	known := map[uint]bool{}
	for _, f := range features {
		ids = append(ids, f.ID)
		known[f.ID] = true
	}
	needs := map[uint][]string{}
	if len(ids) > 0 {
		var deps []models.Dependency
		if err := h.db.Where("parent_type = ? AND child_type = ? AND child_id IN ?",
			models.EntityTypeFeature, models.EntityTypeFeature, ids).Order("id").Find(&deps).Error; err != nil {
			api.Fail(c, api.Internal(err))
			return
		}
		for _, d := range deps {
			if known[d.ParentID] {
				needs[d.ChildID] = append(needs[d.ChildID], key(d.ParentID))
			}
		}
	}

	opened := []OpenedRelease{}
	knownRelease := map[uint]bool{}
	for _, r := range releases {
		knownRelease[r.ID] = true
		opened = append(opened, OpenedRelease{
			Key: releaseKey(r.ID), Name: r.Tag, Published: r.Status != models.ReleaseStatusDraft,
		})
	}

	// Parents first, each followed by what is inside it, the order the
	// playground keeps. A parent outside the project is treated as none.
	children := map[uint][]models.Feature{}
	for _, f := range features {
		parent := uint(0)
		if f.ParentFeatureID != nil && known[*f.ParentFeatureID] {
			parent = *f.ParentFeatureID
		}
		children[parent] = append(children[parent], f)
	}
	rows := make([]OpenedFeature, 0, len(features))
	seen := map[uint]bool{}
	var walk func(parent uint)
	walk = func(parent uint) {
		for _, f := range children[parent] {
			if seen[f.ID] {
				continue
			}
			seen[f.ID] = true
			row := OpenedFeature{Key: key(f.ID), Title: f.Title, Needs: needs[f.ID], FeatureID: f.ID}
			if row.Needs == nil {
				row.Needs = []string{}
			}
			if parent != 0 {
				row.ParentKey = key(parent)
			}
			if f.ReleaseID != nil && knownRelease[*f.ReleaseID] {
				row.ReleaseKey = releaseKey(*f.ReleaseID)
			}
			rows = append(rows, row)
			walk(f.ID)
		}
	}
	walk(0)
	// Features caught in a nesting loop never hang from the top; list them at
	// the top level rather than lose them.
	for _, f := range features {
		if !seen[f.ID] {
			seen[f.ID] = true
			rows = append(rows, OpenedFeature{Key: key(f.ID), Title: f.Title, Needs: append([]string{}, needs[f.ID]...), FeatureID: f.ID})
		}
	}

	api.OK(c, gin.H{
		"project":  gin.H{"id": project.ID, "name": project.Name},
		"features": rows,
		"releases": opened,
	})
}

// maxImportFeatures bounds one import. A scanned repository gives tens of
// features; a list in the thousands is a mistake, not a project.
const maxImportFeatures = 1000

// PlaygroundFeature is one row of the list. Key is the list's own identifier,
// which is how a row names its parent: the database has no id for it yet.
type PlaygroundFeature struct {
	Key         string `json:"key" binding:"required,max=64"`
	Title       string `json:"title" binding:"required,max=255"`
	ParentKey   string `json:"parent_key" binding:"max=64"`
	Description string `json:"description" binding:"max=20000"`
	Status      string `json:"status" binding:"omitempty,oneof=todo in_progress done"`
	// ReleaseKey names a release in the request's Releases list. Empty means
	// the list does not plan this feature.
	ReleaseKey string `json:"release_key" binding:"max=64"`
	// Needs names the rows this one cannot start before, by key.
	Needs []string `json:"needs" binding:"max=100,dive,max=64"`
	// FeatureID is set on a row that was opened from a project: it is that
	// feature. Importing into the same project renames it to Title, and moves
	// it under ParentKey when Moved says the list moved it. Into any other
	// project the id is ignored and the row is matched by name like any other.
	FeatureID uint `json:"feature_id"`
	Moved     bool `json:"moved"`
}

// PlaygroundRelease is one release drafted in the playground. The list is in
// shipping order, and new releases are created in that order.
type PlaygroundRelease struct {
	Key  string `json:"key" binding:"required,max=64"`
	Name string `json:"name" binding:"required,max=50"`
}

// PlaygroundImportRequest names exactly one destination: ProjectID for a
// project that exists, or NewProject to create one in the same transaction.
type PlaygroundImportRequest struct {
	ProjectID  int                   `json:"project_id"`
	NewProject *CreateProjectRequest `json:"new_project"`
	Features   []PlaygroundFeature   `json:"features" binding:"required,dive"`
	Releases   []PlaygroundRelease   `json:"releases" binding:"dive"`
	// DryRun reports what would happen and writes nothing, so the list can
	// show which names the project already has before anything is committed.
	DryRun bool `json:"dry_run"`
}

// PlaygroundOutcome says what happened to one row.
type PlaygroundOutcome struct {
	Key   string `json:"key"`
	Title string `json:"title"`
	// Outcome is "created" or "existing".
	Outcome string `json:"outcome"`
	// FeatureID is the feature the row became. It is 0 for a row a dry run
	// would create, because nothing was written.
	FeatureID uint `json:"feature_id"`
}

// PlaygroundImportResult is the receipt for an import or a dry run.
type PlaygroundImportResult struct {
	ProjectID int  `json:"project_id"`
	DryRun    bool `json:"dry_run"`
	Created   int  `json:"created"`
	Existing  int  `json:"existing"`
	// Updated counts features the list was opened from that it renamed or moved.
	Updated int                 `json:"updated"`
	Items   []PlaygroundOutcome `json:"items"`

	// ReleasesCreated and ReleasesExisting count the releases, the same way
	// Created and Existing count features. Planned counts features put into a
	// release; Skipped names releases that were not changed because they are
	// no longer drafts.
	ReleasesCreated  int      `json:"releases_created"`
	ReleasesExisting int      `json:"releases_existing"`
	Planned          int      `json:"planned"`
	Skipped          []string `json:"skipped_releases"`

	// DependenciesCreated and DependenciesExisting count the needs the same
	// way: new ones, and ones the project already had.
	DependenciesCreated  int `json:"dependencies_created"`
	DependenciesExisting int `json:"dependencies_existing"`
}

// Import writes the list into the project in one transaction: every row goes
// in, or none does.
//
// POST /api/v1/playground/import
func (h *PlaygroundHandler) Import(c *gin.Context) {
	userID, err := api.UserID(c)
	if err != nil {
		api.Fail(c, err)
		return
	}

	var req PlaygroundImportRequest
	if bindErr := api.Bind(c, &req); bindErr != nil {
		api.Fail(c, bindErr)
		return
	}

	ordered, planErr := orderPlaygroundFeatures(req.Features)
	if planErr != nil {
		api.Fail(c, planErr)
		return
	}
	if relErr := checkPlaygroundReleases(req.Releases, req.Features); relErr != nil {
		api.Fail(c, relErr)
		return
	}

	var project *models.Project
	switch {
	case req.ProjectID > 0 && req.NewProject != nil:
		api.Fail(c, api.Validation("Choose a project or a new project, not both"))
		return
	case req.ProjectID > 0:
		found, err := requireProject(c, h.db, req.ProjectID, canEdit)
		if err != nil {
			api.Fail(c, err)
			return
		}
		project = found
	case req.NewProject != nil:
		name := strings.TrimSpace(req.NewProject.Name)
		if name == "" {
			api.Fail(c, api.Validation("The new project needs a name").WithField("name", "is required"))
			return
		}
		project = &models.Project{Name: name, Description: req.NewProject.Description, OwnerID: userID}
	default:
		api.Fail(c, api.Validation("Choose a project to import into"))
		return
	}

	result := PlaygroundImportResult{
		ProjectID: project.ID, DryRun: req.DryRun, Items: []PlaygroundOutcome{}, Skipped: []string{},
	}

	run := func(tx *gorm.DB) error {
		if project.ID == 0 && !req.DryRun {
			if err := tx.Create(project).Error; err != nil {
				return err
			}
			result.ProjectID = project.ID
		}

		// Existing names, matched ignoring case and surrounding spaces. A
		// project that already holds the same name twice matches the older.
		existing := map[string]uint{}
		inProject := map[uint]models.Feature{}
		if project.ID > 0 {
			var features []models.Feature
			if err := tx.Where("project_id = ?", project.ID).Order("id").Find(&features).Error; err != nil {
				return err
			}
			for _, f := range features {
				inProject[f.ID] = f
			}
			// A row that names its feature by id is matched by that, not by
			// name, and its old name is free for the list to reuse.
			linked := map[uint]bool{}
			for _, row := range ordered {
				if _, ok := inProject[row.FeatureID]; ok {
					linked[row.FeatureID] = true
				}
			}
			for _, f := range features {
				name := matchName(f.Title)
				if _, seen := existing[name]; !seen && !linked[f.ID] {
					existing[name] = f.ID
				}
			}
		}

		ids := map[string]uint{}
		for _, row := range ordered {
			if feature, linked := inProject[row.FeatureID]; linked {
				outcome, err := updateLinkedFeature(tx, req.DryRun, feature, row, ids, existing, inProject)
				if err != nil {
					return err
				}
				ids[row.Key] = feature.ID
				if outcome == "updated" {
					result.Updated++
				} else {
					result.Existing++
				}
				result.Items = append(result.Items, PlaygroundOutcome{
					Key: row.Key, Title: row.Title, Outcome: outcome, FeatureID: feature.ID,
				})
				continue
			}

			if id, found := existing[matchName(row.Title)]; found {
				ids[row.Key] = id
				result.Existing++
				result.Items = append(result.Items, PlaygroundOutcome{
					Key: row.Key, Title: row.Title, Outcome: "existing", FeatureID: id,
				})
				continue
			}

			result.Created++
			if req.DryRun {
				result.Items = append(result.Items, PlaygroundOutcome{Key: row.Key, Title: row.Title, Outcome: "created"})
				continue
			}

			feature := models.Feature{
				ProjectID:   project.ID,
				Title:       strings.TrimSpace(row.Title),
				Description: row.Description,
				Category:    "general",
				Status:      models.FeatureStatus(orDefault(row.Status, string(models.StatusTodo))),
				Priority:    models.PriorityMedium,
			}
			if row.ParentKey != "" {
				parent := ids[row.ParentKey]
				feature.ParentFeatureID = &parent
			}
			if err := tx.Create(&feature).Error; err != nil {
				return err
			}

			ids[row.Key] = feature.ID
			result.Items = append(result.Items, PlaygroundOutcome{
				Key: row.Key, Title: feature.Title, Outcome: "created", FeatureID: feature.ID,
			})
		}

		if err := importPlaygroundDependencies(tx, req, ids, uint(userID), &result); err != nil {
			return err
		}
		return importPlaygroundReleases(tx, project.ID, req, ids, &result)
	}

	if req.DryRun {
		// Reads only, so no transaction is needed.
		err = run(h.db)
	} else {
		err = h.db.Transaction(run)
	}
	if err != nil {
		// A refusal raised inside the transaction is already worded for the
		// person; anything else is a database fault.
		var refused *api.Error
		if errors.As(err, &refused) {
			api.Fail(c, refused)
		} else {
			api.Fail(c, api.FromDB(err, "Feature"))
		}
		return
	}

	if req.DryRun {
		api.OK(c, result)
		return
	}
	api.Created(c, result)
}

// matchName is how two names are compared: case and outer spaces do not count.
func matchName(title string) string {
	return strings.ToLower(strings.TrimSpace(title))
}

// orderPlaygroundFeatures checks the list hangs together and returns it with
// every parent ahead of its children, so a child always has an id to point at.
// Rows keep their list order otherwise.
func orderPlaygroundFeatures(rows []PlaygroundFeature) ([]PlaygroundFeature, error) {
	if len(rows) == 0 {
		return nil, api.Validation("There are no features to import")
	}
	if len(rows) > maxImportFeatures {
		return nil, api.Validation("That is more features than one import takes; split the list")
	}

	byKey := map[string]PlaygroundFeature{}
	names := map[string]string{}
	for _, row := range rows {
		if strings.TrimSpace(row.Title) == "" {
			return nil, api.Validation("Every feature needs a name")
		}
		if _, dup := byKey[row.Key]; dup {
			return nil, api.Validation("Two rows share the key \"" + row.Key + "\"")
		}
		if first, dup := names[matchName(row.Title)]; dup {
			return nil, api.Validation("\"" + first + "\" is in the list twice; names have to be unique")
		}
		byKey[row.Key] = row
		names[matchName(row.Title)] = row.Title
	}

	for _, row := range rows {
		for _, need := range row.Needs {
			if need == row.Key {
				return nil, api.Validation("\"" + row.Title + "\" cannot depend on itself")
			}
			if _, found := byKey[need]; !found {
				return nil, api.Validation("\"" + row.Title + "\" depends on a row that is not in the list")
			}
		}
		if row.ParentKey == "" {
			continue
		}
		if _, found := byKey[row.ParentKey]; !found {
			return nil, api.Validation("\"" + row.Title + "\" is inside a row that is not in the list")
		}
	}

	ordered := make([]PlaygroundFeature, 0, len(rows))
	placed := map[string]bool{}
	visiting := map[string]bool{}

	var place func(row PlaygroundFeature) error
	place = func(row PlaygroundFeature) error {
		if placed[row.Key] {
			return nil
		}
		if visiting[row.Key] {
			return api.Validation("\"" + row.Title + "\" ends up inside itself")
		}
		visiting[row.Key] = true
		if row.ParentKey != "" {
			if err := place(byKey[row.ParentKey]); err != nil {
				return err
			}
		}
		visiting[row.Key] = false
		placed[row.Key] = true
		ordered = append(ordered, row)
		return nil
	}

	for _, row := range rows {
		if err := place(row); err != nil {
			return nil, err
		}
	}
	return ordered, nil
}

// updateLinkedFeature brings a feature the row was opened from in line with
// the row: a new name, and — when the row says it was moved — a new parent.
// Nothing else about the feature changes. It answers "updated" when either
// changed and "existing" when neither did, and on a dry run only says which.
//
// A rename onto a name another feature of the project already has is refused,
// since the project would then hold the same name twice. A move that would put
// a feature inside its own part is refused for the same reason the canvas
// refuses it.
func updateLinkedFeature(
	tx *gorm.DB,
	dryRun bool,
	feature models.Feature,
	row PlaygroundFeature,
	ids map[string]uint,
	existing map[string]uint,
	inProject map[uint]models.Feature,
) (string, error) {
	updates := map[string]any{}

	title := strings.TrimSpace(row.Title)
	if title != feature.Title {
		if other, taken := existing[matchName(title)]; taken && other != feature.ID {
			return "", api.Validation("\"" + title + "\" is already the name of another feature in the project")
		}
		updates["title"] = title
	}

	// A dry run has no id for a parent the import would create; moving under
	// one is a change all the same, and a new feature cannot be inside this one.
	movesUnderNew := false
	if row.Moved {
		var parent *uint
		if row.ParentKey != "" {
			if id := ids[row.ParentKey]; id != 0 {
				parent = &id
			} else {
				movesUnderNew = true
			}
		}
		if parent != nil {
			for p := *parent; ; {
				if p == feature.ID {
					return "", api.Validation("\"" + title + "\" cannot go inside its own part")
				}
				// A parent this import just created is not in the map yet.
				above, known := inProject[p]
				if !known {
					if err := tx.Select("id", "parent_feature_id").First(&above, p).Error; err != nil {
						break
					}
				}
				if above.ParentFeatureID == nil {
					break
				}
				p = *above.ParentFeatureID
			}
		}
		same := (parent == nil && feature.ParentFeatureID == nil) ||
			(parent != nil && feature.ParentFeatureID != nil && *parent == *feature.ParentFeatureID)
		if !same && !movesUnderNew {
			updates["parent_feature_id"] = parent
			// Later rows check their moves against this one's new place.
			feature.ParentFeatureID = parent
			inProject[feature.ID] = feature
		}
	}

	if len(updates) == 0 && !movesUnderNew {
		return "existing", nil
	}
	if !dryRun {
		if err := tx.Model(&models.Feature{}).Where("id = ?", feature.ID).Updates(updates).Error; err != nil {
			return "", err
		}
	}
	return "updated", nil
}

// importPlaygroundDependencies turns each row's needs into dependencies. The
// needed feature is the dependency's parent and the one waiting is its child,
// the same way round the canvas draws them. A pair the project already has is
// counted and left alone, so importing the same list twice adds nothing. Two
// rows that matched the same existing feature are skipped rather than made to
// depend on themselves.
//
// A loop is not refused, the same as adding a dependency by hand: the canvas
// shows it, and the person who drew it decides which edge goes.
func importPlaygroundDependencies(
	tx *gorm.DB,
	req PlaygroundImportRequest,
	featureIDs map[string]uint,
	userID uint,
	result *PlaygroundImportResult,
) error {
	for _, row := range req.Features {
		for _, need := range row.Needs {
			childID, parentID := featureIDs[row.Key], featureIDs[need]
			if childID != 0 && childID == parentID {
				continue
			}
			// Both ends known means both already exist (or, on a real run,
			// were just made), so the project may have the pair already.
			if childID != 0 && parentID != 0 {
				var count int64
				if err := tx.Model(&models.Dependency{}).
					Where("parent_id = ? AND child_id = ? AND parent_type = ? AND child_type = ?",
						parentID, childID, models.EntityTypeFeature, models.EntityTypeFeature).
					Count(&count).Error; err != nil {
					return err
				}
				if count > 0 {
					result.DependenciesExisting++
					continue
				}
			}

			result.DependenciesCreated++
			if req.DryRun {
				continue
			}
			dependency := models.Dependency{
				ParentID:    parentID,
				ParentType:  models.EntityTypeFeature,
				ChildID:     childID,
				ChildType:   models.EntityTypeFeature,
				Description: "From the playground",
				CreatedByID: userID,
			}
			if err := tx.Create(&dependency).Error; err != nil {
				return err
			}
		}
	}
	return nil
}

// PlaygroundDraftRequest is a prompt and the list as it stands, which may be empty.
type PlaygroundDraftRequest struct {
	Prompt   string                  `json:"prompt" binding:"required,max=4000"`
	Features []services.DraftFeature `json:"features" binding:"max=1000"`
}

// PlaygroundDraftResult is the revised list. Drafter names what wrote it, so
// a stand-in answer is labelled as one.
type PlaygroundDraftResult struct {
	Drafter  string                  `json:"drafter"`
	Title    string                  `json:"title"`
	Message  string                  `json:"message"`
	Features []services.DraftFeature `json:"features"`
}

// Draft asks the drafter for a revised list. Nothing is written: the answer
// goes into the playground and is looked over like any other list.
//
// POST /api/v1/playground/draft
func (h *PlaygroundHandler) Draft(c *gin.Context) {
	if _, err := api.UserID(c); err != nil {
		api.Fail(c, err)
		return
	}

	var req PlaygroundDraftRequest
	if bindErr := api.Bind(c, &req); bindErr != nil {
		api.Fail(c, bindErr)
		return
	}
	prompt := strings.TrimSpace(req.Prompt)
	if prompt == "" {
		api.Fail(c, api.Validation("Say what to draft").WithField("prompt", "is required"))
		return
	}

	reply, err := h.drafter.Draft(c.Request.Context(), services.DraftRequest{
		Prompt:  prompt,
		Current: services.CleanDraft(req.Features),
	})
	if err != nil {
		api.Fail(c, api.Internal(err))
		return
	}

	api.OK(c, PlaygroundDraftResult{
		Drafter:  h.drafter.Name(),
		Title:    strings.TrimSpace(reply.Title),
		Message:  reply.Message,
		Features: services.CleanDraft(reply.Features),
	})
}

// checkPlaygroundReleases checks the releases hang together: unique keys and
// tags, and every feature's release named in the list.
func checkPlaygroundReleases(releases []PlaygroundRelease, features []PlaygroundFeature) error {
	keys := map[string]bool{}
	tags := map[string]bool{}
	for _, r := range releases {
		tag := strings.TrimSpace(r.Name)
		if tag == "" {
			return api.Validation("Every release needs a name")
		}
		if keys[r.Key] {
			return api.Validation("Two releases share the key \"" + r.Key + "\"")
		}
		if tags[matchName(tag)] {
			return api.Validation("\"" + tag + "\" is a release twice; release names have to be unique")
		}
		keys[r.Key] = true
		tags[matchName(tag)] = true
	}
	for _, f := range features {
		if f.ReleaseKey != "" && !keys[f.ReleaseKey] {
			return api.Validation("\"" + f.Title + "\" is planned into a release that is not in the list")
		}
	}
	return nil
}

// importPlaygroundReleases creates the list's releases the project lacks, in
// list order, and plans features into them. It runs inside the import's
// transaction, and on a dry run only counts.
func importPlaygroundReleases(
	tx *gorm.DB,
	projectID int,
	req PlaygroundImportRequest,
	featureIDs map[string]uint,
	result *PlaygroundImportResult,
) error {
	if len(req.Releases) == 0 {
		return nil
	}

	var existing []models.Release
	if projectID > 0 {
		if err := tx.Where("project_id = ?", projectID).Find(&existing).Error; err != nil {
			return err
		}
	}
	byTag := map[string]models.Release{}
	var shippedIDs []uint
	for _, r := range existing {
		byTag[matchName(r.Tag)] = r
		if r.Status != models.ReleaseStatusDraft {
			shippedIDs = append(shippedIDs, r.ID)
		}
	}

	releaseIDs := map[string]uint{}
	frozen := map[string]bool{}
	for _, r := range req.Releases {
		tag := strings.TrimSpace(r.Name)
		if found, ok := byTag[matchName(tag)]; ok {
			result.ReleasesExisting++
			releaseIDs[r.Key] = found.ID
			if found.Status != models.ReleaseStatusDraft {
				// A published release is a record of what went out; the list
				// cannot re-plan it.
				frozen[r.Key] = true
				result.Skipped = append(result.Skipped, found.Tag)
			}
			continue
		}

		result.ReleasesCreated++
		if req.DryRun {
			continue
		}
		release := models.Release{ProjectID: projectID, Tag: tag, Status: models.ReleaseStatusDraft}
		if err := tx.Omit("Project", "PRs").Create(&release).Error; err != nil {
			return err
		}
		releaseIDs[r.Key] = release.ID
	}

	for _, f := range req.Features {
		if f.ReleaseKey == "" || frozen[f.ReleaseKey] {
			continue
		}
		result.Planned++
		if req.DryRun {
			continue
		}
		featureID, releaseID := featureIDs[f.Key], releaseIDs[f.ReleaseKey]
		if featureID == 0 || releaseID == 0 {
			continue
		}
		// A feature already in a published release stays there: moving it out
		// would rewrite what that release shipped.
		query := tx.Model(&models.Feature{}).Where("id = ?", featureID)
		if len(shippedIDs) > 0 {
			query = query.Where("release_id IS NULL OR release_id NOT IN ?", shippedIDs)
		}
		if err := query.Update("release_id", releaseID).Error; err != nil {
			return err
		}
	}
	return nil
}
