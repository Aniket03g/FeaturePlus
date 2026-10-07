package v1

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"github.com/FeaturePlus/backend/api"
	"github.com/FeaturePlus/backend/models"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func playgroundRouter(t *testing.T, db *gorm.DB, userID int, role string) *gin.Engine {
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

	NewPlaygroundHandler(db).Register(g)
	return r
}

func decodeImport(t *testing.T, w *httptest.ResponseRecorder) PlaygroundImportResult {
	t.Helper()

	var out struct {
		Data PlaygroundImportResult `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode: %v (%s)", err, w.Body.String())
	}
	return out.Data
}

func featuresOf(t *testing.T, db *gorm.DB, projectID int) map[string]models.Feature {
	t.Helper()

	var features []models.Feature
	if err := db.Where("project_id = ?", projectID).Find(&features).Error; err != nil {
		t.Fatalf("load features: %v", err)
	}
	byTitle := map[string]models.Feature{}
	for _, f := range features {
		byTitle[f.Title] = f
	}
	return byTitle
}

// The list is given child-first on purpose: a parent later in the list must
// still be written before the row that points at it.
const nestedList = `"features":[
	{"key":"c","title":"Card payment","parent_key":"p"},
	{"key":"p","title":"Payment"},
	{"key":"r","title":"Receipts"}
]`

func TestPlaygroundImportIntoExistingProject(t *testing.T) {
	db := newTestDB(t)
	owner, _, project := seed(t, db)
	r := playgroundRouter(t, db, owner.ID, "developer")

	w := do(r, http.MethodPost, "/api/v1/playground/import",
		`{"project_id":`+strconv.Itoa(project.ID)+`,`+nestedList+`}`)
	if w.Code != http.StatusCreated {
		t.Fatalf("status %d, want 201: %s", w.Code, w.Body.String())
	}

	result := decodeImport(t, w)
	if result.Created != 3 || result.Existing != 0 {
		t.Fatalf("created %d, existing %d; want 3 and 0", result.Created, result.Existing)
	}

	got := featuresOf(t, db, project.ID)
	card, payment := got["Card payment"], got["Payment"]
	if card.ParentFeatureID == nil || *card.ParentFeatureID != payment.ID {
		t.Errorf("Card payment is not inside Payment: parent %v, Payment %d", card.ParentFeatureID, payment.ID)
	}
	if got["Receipts"].ParentFeatureID != nil {
		t.Error("Receipts should be at the top level")
	}
	if card.Status != models.StatusTodo {
		t.Errorf("status = %q, want todo when none is given", card.Status)
	}
}

func TestPlaygroundImportReusesNamesTheProjectHas(t *testing.T) {
	db := newTestDB(t)
	owner, _, project := seed(t, db)
	already := models.Feature{ProjectID: project.ID, Title: "Payment", Status: models.StatusDone, Priority: models.PriorityHigh, Category: "general"}
	if err := db.Create(&already).Error; err != nil {
		t.Fatalf("create feature: %v", err)
	}
	r := playgroundRouter(t, db, owner.ID, "developer")

	// Different case and spacing still count as the same name.
	body := `{"project_id":` + strconv.Itoa(project.ID) + `,"features":[
		{"key":"p","title":"  payment "},
		{"key":"c","title":"Card payment","parent_key":"p"}
	]}`

	result := decodeImport(t, do(r, http.MethodPost, "/api/v1/playground/import", body))
	if result.Created != 1 || result.Existing != 1 {
		t.Fatalf("created %d, existing %d; want 1 and 1", result.Created, result.Existing)
	}

	got := featuresOf(t, db, project.ID)
	if len(got) != 2 {
		t.Fatalf("project has %d features, want 2 — the existing one must not be duplicated", len(got))
	}
	if card := got["Card payment"]; card.ParentFeatureID == nil || *card.ParentFeatureID != already.ID {
		t.Error("a new row under an existing name should land inside the existing feature")
	}
	if got["Payment"].Status != models.StatusDone {
		t.Error("the existing feature must be left as it was")
	}

	// A second import of the same list changes nothing.
	again := decodeImport(t, do(r, http.MethodPost, "/api/v1/playground/import", body))
	if again.Created != 0 || again.Existing != 2 {
		t.Errorf("repeat import created %d, existing %d; want 0 and 2", again.Created, again.Existing)
	}
}

func TestPlaygroundDryRunWritesNothing(t *testing.T) {
	db := newTestDB(t)
	owner, _, project := seed(t, db)
	r := playgroundRouter(t, db, owner.ID, "developer")

	w := do(r, http.MethodPost, "/api/v1/playground/import",
		`{"project_id":`+strconv.Itoa(project.ID)+`,"dry_run":true,`+nestedList+`}`)
	if w.Code != http.StatusOK {
		t.Fatalf("status %d, want 200: %s", w.Code, w.Body.String())
	}
	if result := decodeImport(t, w); result.Created != 3 || !result.DryRun {
		t.Errorf("dry run reported %+v", result)
	}
	if got := featuresOf(t, db, project.ID); len(got) != 0 {
		t.Errorf("dry run wrote %d features", len(got))
	}
}

func TestPlaygroundImportIntoNewProject(t *testing.T) {
	db := newTestDB(t)
	owner, _, _ := seed(t, db)
	r := playgroundRouter(t, db, owner.ID, "developer")

	w := do(r, http.MethodPost, "/api/v1/playground/import",
		`{"new_project":{"name":"Store","description":"From a scan"},`+nestedList+`}`)
	if w.Code != http.StatusCreated {
		t.Fatalf("status %d, want 201: %s", w.Code, w.Body.String())
	}

	result := decodeImport(t, w)
	var project models.Project
	if err := db.First(&project, result.ProjectID).Error; err != nil {
		t.Fatalf("new project not found: %v", err)
	}
	if project.Name != "Store" || project.OwnerID != owner.ID {
		t.Errorf("project = %q owned by %d", project.Name, project.OwnerID)
	}
	if got := featuresOf(t, db, project.ID); len(got) != 3 {
		t.Errorf("new project has %d features, want 3", len(got))
	}
}

func TestPlaygroundImportIsAllOrNothing(t *testing.T) {
	db := newTestDB(t)
	owner, _, project := seed(t, db)
	r := playgroundRouter(t, db, owner.ID, "developer")

	cases := map[string]string{
		"duplicate name":  `[{"key":"a","title":"Cart"},{"key":"b","title":"cart"}]`,
		"missing parent":  `[{"key":"a","title":"Cart","parent_key":"zz"}]`,
		"inside itself":   `[{"key":"a","title":"Cart","parent_key":"b"},{"key":"b","title":"Pay","parent_key":"a"}]`,
		"empty name":      `[{"key":"a","title":"   "}]`,
		"nothing to send": `[]`,
	}
	for name, features := range cases {
		w := do(r, http.MethodPost, "/api/v1/playground/import",
			`{"project_id":`+strconv.Itoa(project.ID)+`,"features":`+features+`}`)
		if w.Code != http.StatusUnprocessableEntity && w.Code != http.StatusBadRequest {
			t.Errorf("%s: status %d, want a validation failure: %s", name, w.Code, w.Body.String())
		}
	}
	if got := featuresOf(t, db, project.ID); len(got) != 0 {
		t.Errorf("a rejected import wrote %d features", len(got))
	}
}

func TestPlaygroundImportNeedsEditAccess(t *testing.T) {
	db := newTestDB(t)
	_, other, project := seed(t, db)
	body := `{"project_id":` + strconv.Itoa(project.ID) + `,` + nestedList + `}`
	r := playgroundRouter(t, db, other.ID, "manager")

	if w := do(r, http.MethodPost, "/api/v1/playground/import", body); w.Code != http.StatusNotFound {
		t.Errorf("not shared, even as a manager: status %d, want 404", w.Code)
	}
	share(t, db, project.ID, other.ID, models.RoleViewer)
	if w := do(r, http.MethodPost, "/api/v1/playground/import", body); w.Code != http.StatusForbidden {
		t.Errorf("a viewer: status %d, want 403", w.Code)
	}
	db.Model(&models.ProjectMember{}).Where("user_id = ?", other.ID).Update("role", models.RoleEditor)
	if w := do(r, http.MethodPost, "/api/v1/playground/import", body); w.Code != http.StatusCreated {
		t.Errorf("an editor: status %d, want 201: %s", w.Code, w.Body.String())
	}
}

// dependencyPairs lists a project's dependencies as "needed > waiting" by title.
func dependencyPairs(t *testing.T, db *gorm.DB, projectID int) map[string]bool {
	t.Helper()

	titles := map[uint]string{}
	for _, f := range featuresOf(t, db, projectID) {
		titles[f.ID] = f.Title
	}
	var rows []models.Dependency
	if err := db.Find(&rows).Error; err != nil {
		t.Fatalf("load dependencies: %v", err)
	}
	pairs := map[string]bool{}
	for _, d := range rows {
		if titles[d.ParentID] != "" && titles[d.ChildID] != "" {
			pairs[titles[d.ParentID]+" > "+titles[d.ChildID]] = true
		}
	}
	return pairs
}

func TestPlaygroundImportCreatesDependencies(t *testing.T) {
	db := newTestDB(t)
	owner, _, project := seed(t, db)
	already := models.Feature{ProjectID: project.ID, Title: "Accounts", Status: models.StatusDone, Priority: models.PriorityHigh, Category: "general"}
	if err := db.Create(&already).Error; err != nil {
		t.Fatalf("create feature: %v", err)
	}
	r := playgroundRouter(t, db, owner.ID, "developer")

	// Cart needs Accounts, which the project already has; Payment needs Cart,
	// which is new. A need can point further down the list than the row.
	body := `{"project_id":` + strconv.Itoa(project.ID) + `,"features":[
		{"key":"p","title":"Payment","needs":["c"]},
		{"key":"c","title":"Cart","needs":["a"]},
		{"key":"a","title":"accounts"}
	]}`

	preview := decodeImport(t, do(r, http.MethodPost, "/api/v1/playground/import",
		strings.Replace(body, `{"project_id"`, `{"dry_run":true,"project_id"`, 1)))
	if preview.DependenciesCreated != 2 {
		t.Errorf("dry run counted %d dependencies, want 2", preview.DependenciesCreated)
	}
	if got := dependencyPairs(t, db, project.ID); len(got) != 0 {
		t.Fatalf("dry run wrote dependencies: %v", got)
	}

	w := do(r, http.MethodPost, "/api/v1/playground/import", body)
	if w.Code != http.StatusCreated {
		t.Fatalf("status %d, want 201: %s", w.Code, w.Body.String())
	}
	if result := decodeImport(t, w); result.DependenciesCreated != 2 {
		t.Errorf("created %d dependencies, want 2", result.DependenciesCreated)
	}
	got := dependencyPairs(t, db, project.ID)
	for _, want := range []string{"Cart > Payment", "Accounts > Cart"} {
		if !got[want] {
			t.Errorf("missing %q in %v", want, got)
		}
	}

	// The same list again adds nothing, and says the dependencies were there.
	again := decodeImport(t, do(r, http.MethodPost, "/api/v1/playground/import", body))
	if again.DependenciesCreated != 0 || again.DependenciesExisting != 2 {
		t.Errorf("repeat import: created %d, existing %d; want 0 and 2", again.DependenciesCreated, again.DependenciesExisting)
	}
	if n := len(dependencyPairs(t, db, project.ID)); n != 2 {
		t.Errorf("project has %d dependencies after a repeat, want 2", n)
	}
}

func TestPlaygroundImportRefusesBadNeeds(t *testing.T) {
	db := newTestDB(t)
	owner, _, project := seed(t, db)
	r := playgroundRouter(t, db, owner.ID, "developer")

	for name, features := range map[string]string{
		"needs itself":        `[{"key":"a","title":"Cart","needs":["a"]}]`,
		"needs a missing row": `[{"key":"a","title":"Cart","needs":["zz"]}]`,
	} {
		w := do(r, http.MethodPost, "/api/v1/playground/import",
			`{"project_id":`+strconv.Itoa(project.ID)+`,"features":`+features+`}`)
		if w.Code != http.StatusUnprocessableEntity && w.Code != http.StatusBadRequest {
			t.Errorf("%s: status %d, want a validation failure: %s", name, w.Code, w.Body.String())
		}
	}
}

func TestPlaygroundDraftAnswersWithAList(t *testing.T) {
	db := newTestDB(t)
	owner, _, _ := seed(t, db)
	r := playgroundRouter(t, db, owner.ID, "developer")

	w := do(r, http.MethodPost, "/api/v1/playground/draft",
		`{"prompt":"a hiking app with trails and offline maps","features":[]}`)
	if w.Code != http.StatusOK {
		t.Fatalf("status %d, want 200: %s", w.Code, w.Body.String())
	}
	var out struct {
		Data PlaygroundDraftResult `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if out.Data.Drafter != "stand-in" {
		t.Errorf("drafter %q, want the stand-in labelled as such", out.Data.Drafter)
	}
	if len(out.Data.Features) < 3 || out.Data.Title != "Hiking app" {
		t.Errorf("draft = %+v", out.Data)
	}
	for _, f := range out.Data.Features {
		if f.Needs == nil {
			t.Errorf("%q has needs null, want a list", f.Title)
		}
	}

	if w := do(r, http.MethodPost, "/api/v1/playground/draft", `{"prompt":"   "}`); w.Code == http.StatusOK {
		t.Error("an empty prompt should be refused")
	}
	if w := do(playgroundRouter(t, db, 0, ""), http.MethodPost, "/api/v1/playground/draft", `{"prompt":"x"}`); w.Code != http.StatusUnauthorized {
		t.Errorf("signed out: status %d, want 401", w.Code)
	}
}
