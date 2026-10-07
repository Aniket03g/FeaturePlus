package v1

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"testing"

	"github.com/FeaturePlus/backend/api"
	"github.com/FeaturePlus/backend/models"
	"github.com/FeaturePlus/backend/repositories"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// writeCatalogue puts a templates.json in a temporary directory and returns a
// repository over it.
func writeCatalogue(t *testing.T, body string) *repositories.TemplateRepository {
	t.Helper()

	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "templates.json"), []byte(body), 0o600); err != nil {
		t.Fatalf("write catalogue: %v", err)
	}

	repo, err := repositories.NewTemplateRepository(dir)
	if err != nil {
		t.Fatalf("open catalogue: %v", err)
	}
	return repo
}

const sampleCatalogue = `{
  "templates": [
    {
      "id": "go-api",
      "name": "Go API",
      "stack": "backend",
      "tech_stack": "Go",
      "description": "A JSON API in Go",
      "feature_categories": ["api", "storage"],
      "task_types": ["api", "storage"],
      "features": [
        {"name": "Routing", "category": "api", "description": "HTTP routes"},
        {"name": "Persistence", "category": "storage", "description": "The database"}
      ],
      "tasks": [
        {"name": "Add the router", "type": "api", "description": "", "priority": "high"},
        {"name": "Add migrations", "type": "storage", "description": "", "priority": "medium"},
        {"name": "Write the readme", "type": "docs", "description": "", "priority": "low"}
      ],
      "dependencies": ["gin", "gorm"],
      "setup_steps": ["go mod tidy"],
      "environment_variables": ["PORT"]
    },
    {
      "id": "react-spa",
      "name": "React SPA",
      "stack": "frontend",
      "tech_stack": "React",
      "description": "A single page app",
      "features": [{"name": "Shell", "category": "ui", "description": ""}],
      "tasks": []
    }
  ],
  "default_template": {"id": "go-api", "name": "Go API"}
}`

func templateRouter(t *testing.T, db *gorm.DB, userID int, role string, repo *repositories.TemplateRepository) *gin.Engine {
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

	NewTemplatesHandler(db, repo).Register(g)
	return r
}

func decodeTemplates(t *testing.T, w *httptest.ResponseRecorder) []TemplateSummaryDTO {
	t.Helper()

	var out struct {
		Data []TemplateSummaryDTO `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode: %v (%s)", err, w.Body.String())
	}
	return out.Data
}

func decodeApplyResult(t *testing.T, w *httptest.ResponseRecorder) ApplyTemplateResultDTO {
	t.Helper()

	var out struct {
		Data ApplyTemplateResultDTO `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode: %v (%s)", err, w.Body.String())
	}
	return out.Data
}

func TestListAndFilterTemplates(t *testing.T) {
	db := newTestDB(t)
	owner, _, _ := seed(t, db)
	r := templateRouter(t, db, owner.ID, "developer", writeCatalogue(t, sampleCatalogue))

	items := decodeTemplates(t, do(r, http.MethodGet, "/api/v1/templates", ""))
	if len(items) != 2 {
		t.Fatalf("listed %d templates, want 2", len(items))
	}

	// The list carries the counts, so a picker can say what a template holds
	// without fetching each one.
	for _, item := range items {
		if item.ID == "go-api" && (item.FeatureCount != 2 || item.TaskCount != 3) {
			t.Fatalf("go-api counts %+v, want 2 features / 3 tasks", item)
		}
	}

	if items := decodeTemplates(t, do(r, http.MethodGet, "/api/v1/templates?q=react", "")); len(items) != 1 {
		t.Fatalf("search returned %d, want 1", len(items))
	}
	if items := decodeTemplates(t, do(r, http.MethodGet, "/api/v1/templates?stack=backend", "")); len(items) != 1 {
		t.Fatalf("stack filter returned %d, want 1", len(items))
	}
}

func TestGetTemplateIsForgivingAboutTheId(t *testing.T) {
	db := newTestDB(t)
	owner, _, _ := seed(t, db)
	r := templateRouter(t, db, owner.ID, "developer", writeCatalogue(t, sampleCatalogue))

	// Ids in the catalogue are hand-written, so casing varies and people refer
	// to templates by name — which means the segment can contain a space.
	for _, id := range []string{"go-api", "GO-API", "Go API"} {
		w := do(r, http.MethodGet, "/api/v1/templates/"+url.PathEscape(id), "")
		if w.Code != http.StatusOK {
			t.Fatalf("%q: status %d, want 200: %s", id, w.Code, w.Body.String())
		}
	}

	// An unknown id must be a 404 and not the default template. Through
	// repositories.GetTemplateByID it is the default, silently — which on the
	// apply route would write another template's features into the project.
	w := do(r, http.MethodGet, "/api/v1/templates/nothing", "")
	if w.Code != http.StatusNotFound {
		t.Fatalf("status %d, want 404: %s", w.Code, w.Body.String())
	}
}

func TestApplyingAnUnknownTemplateChangesNothing(t *testing.T) {
	db := newTestDB(t)
	owner, _, project := seed(t, db)
	r := templateRouter(t, db, owner.ID, "developer", writeCatalogue(t, sampleCatalogue))

	w := do(r, http.MethodPost, "/api/v1/projects/"+strconv.Itoa(project.ID)+"/template",
		`{"template_id":"does-not-exist"}`)
	if w.Code != http.StatusNotFound {
		t.Fatalf("status %d, want 404: %s", w.Code, w.Body.String())
	}

	var features int64
	if err := db.Model(&models.Feature{}).Where("project_id = ?", project.ID).
		Count(&features).Error; err != nil {
		t.Fatalf("count: %v", err)
	}
	if features != 0 {
		t.Fatalf("%d features were created from a template that does not exist", features)
	}
}

func TestApplyTemplateCreatesFeaturesAndTasks(t *testing.T) {
	db := newTestDB(t)
	owner, _, project := seed(t, db)
	r := templateRouter(t, db, owner.ID, "developer", writeCatalogue(t, sampleCatalogue))

	w := do(r, http.MethodPost, "/api/v1/projects/"+strconv.Itoa(project.ID)+"/template",
		`{"template_id":"go-api"}`)
	if w.Code != http.StatusOK {
		t.Fatalf("status %d, want 200: %s", w.Code, w.Body.String())
	}

	result := decodeApplyResult(t, w)
	if result.FeaturesCreated != 2 || result.TasksCreated != 3 {
		t.Fatalf("result %+v, want 2 features / 3 tasks", result)
	}

	var features []models.Feature
	if err := db.Where("project_id = ?", project.ID).Find(&features).Error; err != nil {
		t.Fatalf("load features: %v", err)
	}
	if len(features) != 2 {
		t.Fatalf("%d features in the project, want 2", len(features))
	}

	byTitle := map[string]models.Feature{}
	for _, f := range features {
		byTitle[f.Title] = f
		if f.Status != models.StatusTodo {
			t.Fatalf("feature %q created with status %q, want todo", f.Title, f.Status)
		}
	}

	// A task goes to the feature whose category matches its type; the one with
	// no match lands on the first feature rather than nowhere.
	var tasks []models.Task
	if err := db.Find(&tasks).Error; err != nil {
		t.Fatalf("load tasks: %v", err)
	}
	for _, task := range tasks {
		switch task.TaskName {
		case "Add the router":
			if task.FeatureID != byTitle["Routing"].ID {
				t.Fatalf("api task filed under feature %d, want Routing", task.FeatureID)
			}
		case "Add migrations":
			if task.FeatureID != byTitle["Persistence"].ID {
				t.Fatalf("storage task filed under feature %d, want Persistence", task.FeatureID)
			}
		case "Write the readme":
			if task.FeatureID == 0 {
				t.Fatal("the unmatched task was left with no feature")
			}
		}
	}

	// The project's vocabulary comes from the template.
	var updated models.Project
	if err := db.First(&updated, project.ID).Error; err != nil {
		t.Fatalf("reload project: %v", err)
	}
	if updated.Config["tech_stack"] != "Go" {
		t.Fatalf("config %v did not take the template's tech stack", updated.Config)
	}
}

func TestApplyTemplateCreatesNoDependencies(t *testing.T) {
	db := newTestDB(t)
	owner, _, project := seed(t, db)
	r := templateRouter(t, db, owner.ID, "developer", writeCatalogue(t, sampleCatalogue))

	if w := do(r, http.MethodPost, "/api/v1/projects/"+strconv.Itoa(project.ID)+"/template",
		`{"template_id":"go-api"}`); w.Code != http.StatusOK {
		t.Fatalf("status %d: %s", w.Code, w.Body.String())
	}

	// The template's "dependencies" are package names — gin, gorm — not
	// feature relationships. The old code turned each into an edge between the
	// first two features it created, which put invented constraints on the
	// dependency canvas.
	var edges int64
	if err := db.Model(&models.Dependency{}).Count(&edges).Error; err != nil {
		t.Fatalf("count dependencies: %v", err)
	}
	if edges != 0 {
		t.Fatalf("%d dependency edges invented from package names", edges)
	}
}

func TestApplyTemplateAddsRatherThanReplaces(t *testing.T) {
	db := newTestDB(t)
	owner, _, project := seed(t, db)
	existing := seedFeatures(t, db, project.ID, owner.ID)
	r := templateRouter(t, db, owner.ID, "developer", writeCatalogue(t, sampleCatalogue))

	if w := do(r, http.MethodPost, "/api/v1/projects/"+strconv.Itoa(project.ID)+"/template",
		`{"template_id":"go-api"}`); w.Code != http.StatusOK {
		t.Fatalf("status %d: %s", w.Code, w.Body.String())
	}

	var count int64
	if err := db.Model(&models.Feature{}).Where("project_id = ?", project.ID).
		Count(&count).Error; err != nil {
		t.Fatalf("count: %v", err)
	}
	if want := int64(len(existing) + 2); count != want {
		t.Fatalf("%d features, want %d — applying a template must not wipe existing work", count, want)
	}
}

func TestApplyTemplateRequiresOwnerOrManager(t *testing.T) {
	db := newTestDB(t)
	owner, other, project := seed(t, db)
	_ = owner
	repo := writeCatalogue(t, sampleCatalogue)

	share(t, db, project.ID, other.ID, models.RoleViewer)
	r := templateRouter(t, db, other.ID, "developer", repo)
	if w := do(r, http.MethodPost, "/api/v1/projects/"+strconv.Itoa(project.ID)+"/template",
		`{"template_id":"go-api"}`); w.Code != http.StatusForbidden {
		t.Fatalf("status %d, want 403: %s", w.Code, w.Body.String())
	}

	db.Model(&models.ProjectMember{}).Where("user_id = ?", other.ID).Update("role", models.RoleEditor)
	if w := do(r, http.MethodPost, "/api/v1/projects/"+strconv.Itoa(project.ID)+"/template",
		`{"template_id":"go-api"}`); w.Code != http.StatusOK {
		t.Fatalf("editor status %d, want 200: %s", w.Code, w.Body.String())
	}
}

// TestNoCatalogueIsNotAFailure covers the deployment where the data directory
// is missing entirely: the routes answer with nothing rather than erroring, so
// one absent optional file cannot take the API down.
func TestNoCatalogueIsNotAFailure(t *testing.T) {
	db := newTestDB(t)
	owner, _, project := seed(t, db)
	r := templateRouter(t, db, owner.ID, "developer", nil)

	w := do(r, http.MethodGet, "/api/v1/templates", "")
	if w.Code != http.StatusOK {
		t.Fatalf("status %d, want 200: %s", w.Code, w.Body.String())
	}
	if items := decodeTemplates(t, w); len(items) != 0 {
		t.Fatalf("listed %d templates with no catalogue", len(items))
	}

	if w := do(r, http.MethodGet, "/api/v1/template-stacks", ""); w.Code != http.StatusOK {
		t.Fatalf("stacks status %d, want 200: %s", w.Code, w.Body.String())
	}
	if w := do(r, http.MethodPost, "/api/v1/projects/"+strconv.Itoa(project.ID)+"/template",
		`{"template_id":"go-api"}`); w.Code != http.StatusNotFound {
		t.Fatalf("apply status %d, want 404: %s", w.Code, w.Body.String())
	}
}

func TestContextFilteringPicksTheProjectsContext(t *testing.T) {
	db := newTestDB(t)
	owner, _, _ := seed(t, db)

	catalogue := fmt.Sprintf(`{"templates":[{
      "id":"ctx","name":"Contexts","tech_stack":"Go",
      "features":[
        {"name":"Dev feature","category":"api","context":"Development"},
        {"name":"Staging feature","category":"api","context":"Staging"}
      ],
      "tasks":[{"name":"Dev task","type":"api","context":"Development"}]
    }],"default_template":{"id":"ctx","name":"Contexts"}}`)

	staged := models.Project{
		Name: "Staged", OwnerID: owner.ID,
		Config: models.JSONB{"context": "Staging"},
	}
	if err := db.Create(&staged).Error; err != nil {
		t.Fatalf("create project: %v", err)
	}

	r := templateRouter(t, db, owner.ID, "developer", writeCatalogue(t, catalogue))
	w := do(r, http.MethodPost, "/api/v1/projects/"+strconv.Itoa(staged.ID)+"/template",
		`{"template_id":"ctx"}`)
	if w.Code != http.StatusOK {
		t.Fatalf("status %d: %s", w.Code, w.Body.String())
	}

	var features []models.Feature
	if err := db.Where("project_id = ?", staged.ID).Find(&features).Error; err != nil {
		t.Fatalf("load: %v", err)
	}
	if len(features) != 1 || features[0].Title != "Staging feature" {
		t.Fatalf("features %+v, want only the staging one", features)
	}

	// No task carries the Staging context, so it falls back to Development
	// rather than creating nothing.
	var tasks int64
	if err := db.Model(&models.Task{}).Count(&tasks).Error; err != nil {
		t.Fatalf("count tasks: %v", err)
	}
	if tasks != 1 {
		t.Fatalf("%d tasks created, want the Development fallback to give 1", tasks)
	}
}
