package v1

import (
	"encoding/json"
	"net/http"
	"strconv"
	"testing"

	"github.com/FeaturePlus/backend/api"
	"github.com/FeaturePlus/backend/models"
	"github.com/FeaturePlus/backend/repositories"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func settingsRouterAs(t *testing.T, db *gorm.DB, userID int) *gin.Engine {
	t.Helper()
	gin.SetMode(gin.TestMode)
	r := gin.New()
	g := r.Group("/api/v1")
	g.Use(func(c *gin.Context) {
		c.Set(api.ContextUserID, uint(userID))
		c.Set(api.ContextUserRole, "developer")
		c.Next()
	})
	registerProjectSettingsRoutes(g, db)
	NewProjectsHandler(repositories.NewProjectRepository(db), db).Register(g)
	return r
}

func decodeSettings(t *testing.T, body []byte) ProjectSettingsDTO {
	t.Helper()
	var out struct {
		Data ProjectSettingsDTO `json:"data"`
	}
	if err := json.Unmarshal(body, &out); err != nil {
		t.Fatal(err)
	}
	return out.Data
}

func TestProjectSettingsDefaultsAndEditing(t *testing.T) {
	db := newTestDB(t)
	owner, other, project := seed(t, db)
	path := "/api/v1/projects/" + strconv.Itoa(project.ID) + "/settings"
	r := settingsRouterAs(t, db, owner.ID)

	// Never written: the starting conventions, no prompts, nothing else.
	got := decodeSettings(t, do(r, http.MethodGet, path, "").Body.Bytes())
	if !got.ConventionsDefault || len(got.Conventions) != 2 || len(got.Prompts) != 0 ||
		len(got.ColorMeanings) != 0 || len(got.Modules) != 0 {
		t.Fatalf("defaults = %+v", got)
	}
	if got.Conventions[0].Title == "" || got.Conventions[0].Body == "" {
		t.Errorf("starting conventions have no title or body: %+v", got.Conventions)
	}

	w := do(r, http.MethodPatch, path, `{
		"prompts": [
			{"title": " UI standards ", "body": " Use the design tokens. "},
			{"title": "", "body": ""}
		],
		"conventions": [
			{"title": " Working on versions ", "body": " Save at the end of each day "},
			{"title": "", "body": ""}
		],
		"color_meanings": {"red": " Blocked ", "green": "Ready", "blue": ""},
		"architecture": "Go API and a React app.",
		"modules": "- **Backend** in backend/: the API"
	}`)
	if w.Code != http.StatusOK {
		t.Fatalf("patch: status %d: %s", w.Code, w.Body.String())
	}
	got = decodeSettings(t, do(r, http.MethodGet, path, "").Body.Bytes())
	if got.ConventionsDefault || len(got.Conventions) != 1 ||
		got.Conventions[0].Title != "Working on versions" || got.Conventions[0].Body != "Save at the end of each day" {
		t.Errorf("conventions = %+v", got.Conventions)
	}
	if len(got.Prompts) != 1 || got.Prompts[0].Title != "UI standards" || got.Prompts[0].Body != "Use the design tokens." {
		t.Errorf("prompts = %+v", got.Prompts)
	}
	if len(got.ColorMeanings) != 2 || got.ColorMeanings["red"] != "Blocked" || got.ColorMeanings["green"] != "Ready" {
		t.Errorf("colour meanings = %+v (an empty one should be dropped)", got.ColorMeanings)
	}
	if got.Modules != "- **Backend** in backend/: the API" || got.Architecture != "Go API and a React app." {
		t.Errorf("architecture = %q, modules = %q", got.Architecture, got.Modules)
	}
	if got.UpdatedBy != "owner" {
		t.Errorf("updated by %q, want owner", got.UpdatedBy)
	}

	// A field left out is left alone.
	do(r, http.MethodPatch, path, `{"prompts": [{"title":"Architecture","body":"Hexagonal."}]}`)
	if got = decodeSettings(t, do(r, http.MethodGet, path, "").Body.Bytes()); got.Architecture == "" ||
		len(got.Prompts) != 1 || got.Prompts[0].Title != "Architecture" || len(got.Conventions) != 1 {
		t.Errorf("after a partial patch = %+v", got)
	}

	// An entry with a body but no title is refused, so lists stay readable.
	if w := do(r, http.MethodPatch, path, `{"conventions": [{"title":" ","body":"No heading"}]}`); w.Code != http.StatusUnprocessableEntity {
		t.Errorf("untitled entry: status %d, want 422", w.Code)
	}
	// Refused: unknown colours.
	if w := do(r, http.MethodPatch, path, `{"color_meanings": {"brown": "x"}}`); w.Code != http.StatusUnprocessableEntity {
		t.Errorf("unknown colour: status %d, want 422", w.Code)
	}
	// Modules saved as a list before they were text come back as text.
	db.Model(&models.ProjectSettings{}).Where("project_id = ?", project.ID).
		Update("modules", `[{"name":"Web","path":"web/","purpose":"Pages"}]`)
	if got = decodeSettings(t, do(r, http.MethodGet, path, "").Body.Bytes()); got.Modules != "- **Web** `web/`: Pages" {
		t.Errorf("old list modules = %q", got.Modules)
	}
	// Conventions saved before they were a list come back as entries.
	db.Model(&models.ProjectSettings{}).Where("project_id = ?", project.ID).
		Updates(map[string]any{"conventions": "", "versions_convention": "Release daily"})
	if got = decodeSettings(t, do(r, http.MethodGet, path, "").Body.Bytes()); len(got.Conventions) != 1 ||
		got.Conventions[0].Title != "Working on versions" || got.Conventions[0].Body != "Release daily" || got.ConventionsDefault {
		t.Errorf("old conventions = %+v", got.Conventions)
	}

	// Editors and viewers read; publishers write; editors cannot rename the project.
	share(t, db, project.ID, other.ID, models.RoleEditor)
	as := settingsRouterAs(t, db, other.ID)
	if w := do(as, http.MethodGet, path, ""); w.Code != http.StatusOK {
		t.Errorf("editor read: status %d", w.Code)
	}
	if w := do(as, http.MethodPatch, path, `{"architecture":"x"}`); w.Code != http.StatusForbidden {
		t.Errorf("editor write: status %d, want 403", w.Code)
	}
	projectPath := "/api/v1/projects/" + strconv.Itoa(project.ID)
	if w := do(as, http.MethodPatch, projectPath, `{"name":"Renamed"}`); w.Code != http.StatusForbidden {
		t.Errorf("editor renames the project: status %d, want 403", w.Code)
	}
	// Project info is the owner's: publishers read it too.
	db.Model(&models.ProjectMember{}).Where("user_id = ?", other.ID).Update("role", models.RolePublisher)
	if w := do(as, http.MethodPatch, path, `{"architecture":"From the publisher"}`); w.Code != http.StatusForbidden {
		t.Errorf("publisher write: status %d, want 403", w.Code)
	}
	if w := do(as, http.MethodPatch, projectPath, `{"name":"Renamed"}`); w.Code != http.StatusForbidden {
		t.Errorf("publisher renames the project: status %d, want 403", w.Code)
	}
	db.Model(&models.ProjectMember{}).Where("user_id = ?", other.ID).Update("role", models.RoleViewer)
	if w := do(as, http.MethodPatch, path, `{"architecture":"x"}`); w.Code != http.StatusForbidden {
		t.Errorf("viewer write: status %d, want 403", w.Code)
	}
}

func TestProjectSettingsSurviveBackupAndRestore(t *testing.T) {
	db := newTestDB(t)
	files := newFileStore(t, db)
	fx := seedBackupProject(t, db, files)
	db.Create(&models.ProjectSettings{ProjectID: fx.project.ID, Architecture: "Monolith", UpdatedByID: fx.owner.ID,
		Prompts:       `[{"title":"UI standards","body":"Use the tokens."}]`,
		Conventions:   `[{"title":"Branches","body":"One feature per branch."}]`,
		ColorMeanings: `{"red":"Blocked"}`, Modules: `[{"name":"Web","path":"web/","purpose":"Pages"}]`})

	result := restored(t, postBackup(t, db, files, fx.owner.ID, "restore", downloadBackup(t, db, files, fx.owner.ID, fx.project.ID)))
	got, err := loadProjectSettings(db, result.ProjectID)
	if err != nil {
		t.Fatal(err)
	}
	dto := projectSettingsDTO(db, got)
	if dto.Architecture != "Monolith" || dto.ColorMeanings["red"] != "Blocked" || dto.Modules != "- **Web** `web/`: Pages" {
		t.Fatalf("restored settings = %+v", dto)
	}
	if len(dto.Prompts) != 1 || dto.Prompts[0].Title != "UI standards" || len(dto.Conventions) != 1 || dto.Conventions[0].Title != "Branches" {
		t.Fatalf("restored prompts/conventions = %+v", dto)
	}
}
