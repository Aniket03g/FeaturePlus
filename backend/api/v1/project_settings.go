package v1

import (
	"encoding/json"
	"strconv"
	"strings"
	"time"

	"github.com/FeaturePlus/backend/api"
	"github.com/FeaturePlus/backend/models"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// A project's settings: its conventions, colour meanings and architecture.
// Anyone who can see the project reads them; the owner and publishers change
// them, as they set the project's rules. See models.ProjectSettings.

// featureColors are the colours a feature can have, as the screens name them.
var featureColors = []string{"red", "orange", "yellow", "green", "teal", "blue", "purple", "pink"}

const (
	maxColorMeaning = 80
	maxSettingsText = 20000
	defaultVersions = "- Work in the **Feature List** (the working version). Every edit is kept as you make it.\n- When a piece of work is done, **Save** it as a version (v1.1, v1.2…) with a note saying what changed.\n- To work from an older version, open it with **View** on the Versions page. Save or discard your changes first.\n- Write a note on the working version so others know what is being worked on."
	defaultPublish  = "- Publish when a saved version is ready for everyone to read; the newest save becomes the next whole number (v1.3 → v2).\n- Only the owner and publishers publish. Editors save versions and ask a publisher.\n- Give every publish a note that says what it is for, e.g. \"Ready for client review\".\n- Changes since the last publish are marked on the Feature List; check them before publishing."
)

// projectModule is one row of the modules table the settings briefly had,
// read only to turn old rows into text.
type projectModule struct {
	Name    string `json:"name"`
	Path    string `json:"path"`
	Purpose string `json:"purpose"`
}

// modulesText is the stored modules as markdown. A JSON list from before
// modules were text is turned into a bullet list.
func modulesText(stored string) string {
	if !strings.HasPrefix(strings.TrimSpace(stored), "[") {
		return stored
	}
	var rows []projectModule
	if json.Unmarshal([]byte(stored), &rows) != nil {
		return stored
	}
	var b strings.Builder
	for _, m := range rows {
		b.WriteString("- **" + m.Name + "**")
		if m.Path != "" {
			b.WriteString(" `" + m.Path + "`")
		}
		if m.Purpose != "" {
			b.WriteString(": " + m.Purpose)
		}
		b.WriteString("\n")
	}
	return strings.TrimRight(b.String(), "\n")
}

// ProjectSettingsDTO is a project's settings. A convention never written
// comes back as starting text, with its Default flag set.
type ProjectSettingsDTO struct {
	VersionsConvention string            `json:"versions_convention"`
	VersionsDefault    bool              `json:"versions_default"`
	PublishConvention  string            `json:"publish_convention"`
	PublishDefault     bool              `json:"publish_default"`
	ColorMeanings      map[string]string `json:"color_meanings"`
	Architecture       string            `json:"architecture"`
	Modules            string            `json:"modules"`
	UpdatedBy          string            `json:"updated_by"`
	UpdatedAt          *time.Time        `json:"updated_at"`
}

// UpdateProjectSettingsRequest changes the fields present.
type UpdateProjectSettingsRequest struct {
	VersionsConvention *string            `json:"versions_convention"`
	PublishConvention  *string            `json:"publish_convention"`
	ColorMeanings      *map[string]string `json:"color_meanings"`
	Architecture       *string            `json:"architecture"`
	Modules            *string            `json:"modules"`
}

func registerProjectSettingsRoutes(g *gin.RouterGroup, db *gorm.DB) {
	g.GET("/projects/:id/settings", getProjectSettingsHandler(db))
	g.PATCH("/projects/:id/settings", updateProjectSettingsHandler(db))
}

func loadProjectSettings(db *gorm.DB, projectID int) (models.ProjectSettings, error) {
	var s models.ProjectSettings
	err := db.Where("project_id = ?", projectID).Limit(1).Find(&s).Error
	s.ProjectID = projectID
	return s, err
}

func projectSettingsDTO(db *gorm.DB, s models.ProjectSettings) ProjectSettingsDTO {
	out := ProjectSettingsDTO{
		VersionsConvention: s.VersionsConvention, PublishConvention: s.PublishConvention,
		Architecture: s.Architecture, ColorMeanings: map[string]string{}, Modules: modulesText(s.Modules),
	}
	if out.VersionsConvention == "" {
		out.VersionsConvention, out.VersionsDefault = defaultVersions, true
	}
	if out.PublishConvention == "" {
		out.PublishConvention, out.PublishDefault = defaultPublish, true
	}
	if s.ColorMeanings != "" {
		_ = json.Unmarshal([]byte(s.ColorMeanings), &out.ColorMeanings)
	}
	if s.UpdatedByID != 0 {
		var u models.User
		if db.Select("id", "name", "username").Limit(1).Find(&u, s.UpdatedByID).Error == nil {
			out.UpdatedBy = u.Name
			if out.UpdatedBy == "" {
				out.UpdatedBy = u.Username
			}
		}
		at := s.UpdatedAt
		out.UpdatedAt = &at
	}
	return out
}

// getProjectSettingsHandler returns a project's settings.
//
// GET /api/v1/projects/:id/settings
func getProjectSettingsHandler(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		projectID, err := api.IDParam(c, "id")
		if err != nil {
			api.Fail(c, err)
			return
		}
		if _, err := requireProject(c, db, projectID, canView); err != nil {
			api.Fail(c, err)
			return
		}
		s, err := loadProjectSettings(db, projectID)
		if err != nil {
			api.Fail(c, api.Internal(err))
			return
		}
		api.OK(c, projectSettingsDTO(db, s))
	}
}

// updateProjectSettingsHandler changes a project's settings. Owner only.
//
// PATCH /api/v1/projects/:id/settings
func updateProjectSettingsHandler(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		projectID, err := api.IDParam(c, "id")
		if err != nil {
			api.Fail(c, err)
			return
		}
		if _, err := requireProject(c, db, projectID, ownerOnly); err != nil {
			api.Fail(c, err)
			return
		}
		userID, err := api.UserID(c)
		if err != nil {
			api.Fail(c, err)
			return
		}
		var req UpdateProjectSettingsRequest
		if err := api.Bind(c, &req); err != nil {
			api.Fail(c, err)
			return
		}

		s, err := loadProjectSettings(db, projectID)
		if err != nil {
			api.Fail(c, api.Internal(err))
			return
		}

		invalid := api.Validation("Check the highlighted fields")
		bad := false
		text := func(field string, value *string, into *string) {
			if value == nil {
				return
			}
			v := strings.TrimSpace(*value)
			if len(v) > maxSettingsText {
				invalid = invalid.WithField(field, "Too long: keep it under "+strconv.Itoa(maxSettingsText)+" characters")
				bad = true
				return
			}
			*into = v
		}
		text("versions_convention", req.VersionsConvention, &s.VersionsConvention)
		text("publish_convention", req.PublishConvention, &s.PublishConvention)
		text("architecture", req.Architecture, &s.Architecture)
		text("modules", req.Modules, &s.Modules)

		if req.ColorMeanings != nil {
			known := map[string]bool{}
			for _, name := range featureColors {
				known[name] = true
			}
			meanings := map[string]string{}
			for color, meaning := range *req.ColorMeanings {
				meaning = strings.TrimSpace(meaning)
				switch {
				case !known[color]:
					invalid = invalid.WithField("color_meanings", "Unknown colour \""+color+"\"")
					bad = true
				case len(meaning) > maxColorMeaning:
					invalid = invalid.WithField("color_meanings", "Keep each meaning under "+strconv.Itoa(maxColorMeaning)+" characters")
					bad = true
				case meaning != "":
					meanings[color] = meaning
				}
			}
			raw, _ := json.Marshal(meanings)
			s.ColorMeanings = string(raw)
		}

		if bad {
			api.Fail(c, invalid)
			return
		}

		s.UpdatedByID, s.UpdatedAt = userID, time.Now()
		if err := db.Clauses(clause.OnConflict{UpdateAll: true}).Create(&s).Error; err != nil {
			api.Fail(c, api.Internal(err))
			return
		}
		api.OK(c, projectSettingsDTO(db, s))
	}
}
