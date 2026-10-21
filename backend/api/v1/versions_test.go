package v1

import (
	"encoding/json"
	"net/http"
	"strconv"
	"testing"

	"github.com/FeaturePlus/backend/api"
	"github.com/FeaturePlus/backend/models"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// versionsRouterAs mounts the version routes with a stubbed signed-in user.
func versionsRouterAs(t *testing.T, db *gorm.DB, userID int) *gin.Engine {
	t.Helper()

	gin.SetMode(gin.TestMode)
	r := gin.New()
	g := r.Group("/api/v1")
	g.Use(func(c *gin.Context) {
		c.Set(api.ContextUserID, uint(userID))
		c.Set(api.ContextUserRole, "developer")
		c.Next()
	})
	NewVersionsHandler(db).Register(g)
	return r
}

func decodeVersion(t *testing.T, body []byte) VersionDetailDTO {
	t.Helper()
	var env struct {
		Data VersionDetailDTO `json:"data"`
	}
	if err := json.Unmarshal(body, &env); err != nil {
		t.Fatalf("decode version: %v: %s", err, body)
	}
	return env.Data
}

func decodeVersions(t *testing.T, body []byte) []VersionDTO {
	t.Helper()
	var env struct {
		Data []VersionDTO `json:"data"`
	}
	if err := json.Unmarshal(body, &env); err != nil {
		t.Fatalf("decode versions: %v: %s", err, body)
	}
	return env.Data
}

func decodeSnapshot(t *testing.T, raw json.RawMessage) versionSnapshot {
	t.Helper()
	var snap versionSnapshot
	if err := json.Unmarshal(raw, &snap); err != nil {
		t.Fatalf("decode snapshot: %v: %s", err, raw)
	}
	return snap
}

func TestSaveVersionKeepsTheListAsItWas(t *testing.T) {
	db := newTestDB(t)
	owner, _, project := seed(t, db)

	parent := models.Feature{ProjectID: project.ID, Title: "Payment", Description: "Card only", Status: models.StatusInProgress, Priority: models.PriorityHigh}
	db.Create(&parent)
	child := models.Feature{ProjectID: project.ID, Title: "Refunds", ParentFeatureID: &parent.ID}
	db.Create(&child)
	db.Create(&models.Dependency{
		ParentID: parent.ID, ParentType: models.EntityTypeFeature,
		ChildID: child.ID, ChildType: models.EntityTypeFeature, CreatedByID: uint(owner.ID),
	})

	r := versionsRouterAs(t, db, owner.ID)
	base := "/api/v1/projects/" + strconv.Itoa(project.ID) + "/versions"

	w := do(r, http.MethodPost, base, `{"tag":"Agreed with client","notes":"  after the call  "}`)
	if w.Code != http.StatusCreated {
		t.Fatalf("save: status %d, want 201: %s", w.Code, w.Body.String())
	}
	first := decodeVersion(t, w.Body.Bytes())
	if first.Number != 1 || first.Tag != "Agreed with client" || first.Notes != "after the call" ||
		first.FeatureCount != 2 || first.SavedBy.Name != "owner" {
		t.Fatalf("first version = %+v", first.VersionDTO)
	}

	// Change the live list; the saved version must not follow.
	db.Model(&parent).Update("description", "Card and UPI")
	db.Create(&models.Feature{ProjectID: project.ID, Title: "Track order"})

	w = do(r, http.MethodPost, base, `{"tag":"v2"}`)
	if w.Code != http.StatusCreated {
		t.Fatalf("second save: status %d: %s", w.Code, w.Body.String())
	}
	if second := decodeVersion(t, w.Body.Bytes()); second.Number != 2 || second.FeatureCount != 3 {
		t.Fatalf("second version = %+v", second.VersionDTO)
	}

	list := decodeVersions(t, do(r, http.MethodGet, base, "").Body.Bytes())
	if len(list) != 2 || list[0].Number != 2 || list[1].Number != 1 {
		t.Fatalf("list = %+v, want newest first", list)
	}

	w = do(r, http.MethodGet, base+"/"+strconv.Itoa(int(first.ID)), "")
	if w.Code != http.StatusOK {
		t.Fatalf("get: status %d: %s", w.Code, w.Body.String())
	}
	snap := decodeSnapshot(t, decodeVersion(t, w.Body.Bytes()).Snapshot)
	if snap.Format != snapshotFormat || snap.Project.Name != "Hiking App" || len(snap.Features) != 2 {
		t.Fatalf("snapshot = %+v", snap)
	}
	got := snap.Features[0]
	if got.Title != "Payment" || got.Description != "Card only" || got.Status != "in_progress" || got.Priority != "high" {
		t.Errorf("parent row = %+v", got)
	}
	if kid := snap.Features[1]; kid.Title != "Refunds" || kid.ParentKey != got.Key ||
		len(kid.Needs) != 1 || kid.Needs[0] != got.Key {
		t.Errorf("child row = %+v, want under and needing %s", kid, got.Key)
	}
}

func TestSaveVersionRefusals(t *testing.T) {
	db := newTestDB(t)
	owner, _, project := seed(t, db)
	r := versionsRouterAs(t, db, owner.ID)
	base := "/api/v1/projects/" + strconv.Itoa(project.ID) + "/versions"

	if w := do(r, http.MethodPost, base, `{"tag":"Release one"}`); w.Code != http.StatusCreated {
		t.Fatalf("save: status %d: %s", w.Code, w.Body.String())
	}

	cases := []struct {
		name, body string
		status     int
	}{
		{"same tag in another case", `{"tag":"release ONE"}`, http.StatusConflict},
		{"blank tag", `{"tag":"   "}`, http.StatusUnprocessableEntity},
		{"no tag", `{}`, http.StatusUnprocessableEntity},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			w := do(r, http.MethodPost, base, tc.body)
			if w.Code != tc.status && !(tc.status == http.StatusUnprocessableEntity && w.Code == http.StatusBadRequest) {
				t.Fatalf("status %d, want %d: %s", w.Code, tc.status, w.Body.String())
			}
			assertFieldError(t, w.Body.Bytes(), "tag")
		})
	}

	if list := decodeVersions(t, do(r, http.MethodGet, base, "").Body.Bytes()); len(list) != 1 {
		t.Errorf("refusals saved something: %d versions", len(list))
	}
}

func TestVersionAccess(t *testing.T) {
	db := newTestDB(t)
	owner, other, project := seed(t, db)
	base := "/api/v1/projects/" + strconv.Itoa(project.ID) + "/versions"

	w := do(versionsRouterAs(t, db, owner.ID), http.MethodPost, base, `{"tag":"v1"}`)
	saved := decodeVersion(t, w.Body.Bytes())
	one := base + "/" + strconv.Itoa(int(saved.ID))

	// Not shared: the project and its versions do not exist for them.
	stranger := versionsRouterAs(t, db, other.ID)
	if w := do(stranger, http.MethodGet, base, ""); w.Code != http.StatusNotFound {
		t.Errorf("stranger list: status %d, want 404", w.Code)
	}
	if w := do(stranger, http.MethodGet, one, ""); w.Code != http.StatusNotFound {
		t.Errorf("stranger get: status %d, want 404", w.Code)
	}

	// A viewer can see and fetch versions, but not save one.
	share(t, db, project.ID, other.ID, models.RoleViewer)
	viewer := versionsRouterAs(t, db, other.ID)
	if w := do(viewer, http.MethodGet, base, ""); w.Code != http.StatusOK {
		t.Errorf("viewer list: status %d, want 200", w.Code)
	}
	if w := do(viewer, http.MethodGet, one, ""); w.Code != http.StatusOK {
		t.Errorf("viewer get: status %d, want 200", w.Code)
	}
	if w := do(viewer, http.MethodPost, base, `{"tag":"viewer's"}`); w.Code != http.StatusForbidden {
		t.Errorf("viewer save: status %d, want 403", w.Code)
	}

	// An editor can save.
	db.Model(&models.ProjectMember{}).Where("user_id = ?", other.ID).Update("role", models.RoleEditor)
	if w := do(viewer, http.MethodPost, base, `{"tag":"editor's"}`); w.Code != http.StatusCreated {
		t.Errorf("editor save: status %d, want 201: %s", w.Code, w.Body.String())
	}

	// A version is only reachable through its own project.
	theirs := models.Project{Name: "Other", OwnerID: owner.ID}
	db.Create(&theirs)
	wrong := "/api/v1/projects/" + strconv.Itoa(theirs.ID) + "/versions/" + strconv.Itoa(int(saved.ID))
	if w := do(versionsRouterAs(t, db, owner.ID), http.MethodGet, wrong, ""); w.Code != http.StatusNotFound {
		t.Errorf("version through another project: status %d, want 404", w.Code)
	}
}

func decodeComparison(t *testing.T, body []byte) VersionComparison {
	t.Helper()
	var env struct {
		Data VersionComparison `json:"data"`
	}
	if err := json.Unmarshal(body, &env); err != nil {
		t.Fatalf("decode comparison: %v: %s", err, body)
	}
	return env.Data
}

func TestCompareVersionsMatchesFeaturesByID(t *testing.T) {
	db := newTestDB(t)
	owner, _, project := seed(t, db)

	accounts := models.Feature{ProjectID: project.ID, Title: "Accounts"}
	db.Create(&accounts)
	login := models.Feature{ProjectID: project.ID, Title: "Log in", ParentFeatureID: &accounts.ID}
	db.Create(&login)
	payment := models.Feature{ProjectID: project.ID, Title: "Payment", Description: "Card only"}
	db.Create(&payment)
	menu := models.Feature{ProjectID: project.ID, Title: "Menu"}
	db.Create(&menu)
	gone := models.Feature{ProjectID: project.ID, Title: "Fax support"}
	db.Create(&gone)

	r := versionsRouterAs(t, db, owner.ID)
	base := "/api/v1/projects/" + strconv.Itoa(project.ID) + "/versions"
	v1 := decodeVersion(t, do(r, http.MethodPost, base, `{"tag":"v1"}`).Body.Bytes())

	// Between the two saves: rename the parent (its child does not move),
	// change a description, move a feature, add a dependency, add one, delete one.
	db.Model(&accounts).Update("title", "User accounts")
	db.Model(&payment).Update("description", "Card and UPI")
	db.Model(&menu).Update("parent_feature_id", payment.ID)
	db.Create(&models.Dependency{
		ParentID: payment.ID, ParentType: models.EntityTypeFeature,
		ChildID: login.ID, ChildType: models.EntityTypeFeature, CreatedByID: uint(owner.ID),
	})
	db.Create(&models.Feature{ProjectID: project.ID, Title: "Track order"})
	db.Delete(&gone)

	v2 := decodeVersion(t, do(r, http.MethodPost, base, `{"tag":"v2"}`).Body.Bytes())

	w := do(r, http.MethodGet, base+"/compare?from="+strconv.Itoa(int(v1.ID))+"&to="+strconv.Itoa(int(v2.ID)), "")
	if w.Code != http.StatusOK {
		t.Fatalf("compare: status %d: %s", w.Code, w.Body.String())
	}
	got := decodeComparison(t, w.Body.Bytes())
	if got.Added != 1 || got.Removed != 1 || got.Changed != 4 {
		t.Fatalf("counts added=%d removed=%d changed=%d, want 1/1/4: %+v", got.Added, got.Removed, got.Changed, got.Changes)
	}
	if got.From.Number != 1 || got.To.Number != 2 || got.From.Current || got.To.Current {
		t.Errorf("sides = %+v -> %+v", got.From, got.To)
	}

	byTitle := map[string]FeatureChange{}
	for _, ch := range got.Changes {
		byTitle[ch.Title] = ch
	}
	fieldsOf := func(title string) map[string]FieldChange {
		out := map[string]FieldChange{}
		for _, f := range byTitle[title].Fields {
			out[f.Field] = f
		}
		return out
	}

	if f := fieldsOf("User accounts"); len(f) != 1 || f["title"].From != "Accounts" {
		t.Errorf("renamed parent fields = %+v, want only a title change", f)
	}
	if f := fieldsOf("Log in"); len(f) != 1 || f["needs"].To == nil {
		t.Errorf("Log in fields = %+v, want only needs (its parent was renamed, not changed)", f)
	}
	if f := fieldsOf("Payment"); f["description"].From != "Card only" || f["description"].To != "Card and UPI" {
		t.Errorf("Payment fields = %+v", f)
	}
	if f := fieldsOf("Menu"); f["parent"].From != "" || f["parent"].To != "Payment" {
		t.Errorf("Menu fields = %+v, want moved from top level to Payment", f)
	}
	if byTitle["Track order"].Kind != "added" || byTitle["Fax support"].Kind != "removed" {
		t.Errorf("added/removed = %+v / %+v", byTitle["Track order"], byTitle["Fax support"])
	}
	if last := got.Changes[len(got.Changes)-1]; last.Kind != "removed" {
		t.Errorf("removed features should come last, got %+v", last)
	}

	// Against the current list: one more change since v2.
	db.Model(&payment).Update("status", models.StatusDone)
	w = do(r, http.MethodGet, base+"/compare?from="+strconv.Itoa(int(v2.ID))+"&to=current", "")
	now := decodeComparison(t, w.Body.Bytes())
	if !now.To.Current || now.Changed != 1 || now.Added != 0 || now.Removed != 0 {
		t.Fatalf("v2 -> current = %+v", now)
	}
	if f := now.Changes[0].Fields; len(f) != 1 || f[0].Field != "status" || f[0].To != "done" {
		t.Errorf("v2 -> current fields = %+v", f)
	}

	// A version against itself has nothing to report.
	same := decodeComparison(t, do(r, http.MethodGet, base+"/compare?from="+strconv.Itoa(int(v1.ID))+"&to="+strconv.Itoa(int(v1.ID)), "").Body.Bytes())
	if len(same.Changes) != 0 {
		t.Errorf("v1 vs v1 = %+v", same.Changes)
	}
}

func TestCompareVersionsRefusals(t *testing.T) {
	db := newTestDB(t)
	owner, other, project := seed(t, db)
	r := versionsRouterAs(t, db, owner.ID)
	base := "/api/v1/projects/" + strconv.Itoa(project.ID) + "/versions"
	v1 := decodeVersion(t, do(r, http.MethodPost, base, `{"tag":"v1"}`).Body.Bytes())
	ok := strconv.Itoa(int(v1.ID))

	cases := []struct {
		name, query string
		status      int
	}{
		{"missing from", "?to=current", http.StatusUnprocessableEntity},
		{"nonsense to", "?from=" + ok + "&to=yesterday", http.StatusUnprocessableEntity},
		{"unknown version", "?from=" + ok + "&to=9999", http.StatusNotFound},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			w := do(r, http.MethodGet, base+"/compare"+tc.query, "")
			if w.Code != tc.status && !(tc.status == http.StatusUnprocessableEntity && w.Code == http.StatusBadRequest) {
				t.Errorf("status %d, want %d: %s", w.Code, tc.status, w.Body.String())
			}
		})
	}

	// Someone the project is not shared with cannot compare its versions.
	if w := do(versionsRouterAs(t, db, other.ID), http.MethodGet, base+"/compare?from="+ok+"&to=current", ""); w.Code != http.StatusNotFound {
		t.Errorf("stranger: status %d, want 404", w.Code)
	}
	// The fixed /compare segment does not swallow fetching a version by id.
	if w := do(r, http.MethodGet, base+"/"+ok, ""); w.Code != http.StatusOK {
		t.Errorf("get by id: status %d, want 200", w.Code)
	}
}

func TestCompareSendsBothListsWhenAskedFor(t *testing.T) {
	db := newTestDB(t)
	owner, _, project := seed(t, db)
	db.Create(&models.Feature{ProjectID: project.ID, Title: "Payment", Status: models.StatusTodo})
	r := versionsRouterAs(t, db, owner.ID)
	base := "/api/v1/projects/" + strconv.Itoa(project.ID) + "/versions"
	saved := decodeVersion(t, do(r, http.MethodPost, base, `{"tag":"v1"}`).Body.Bytes())
	db.Create(&models.Feature{ProjectID: project.ID, Title: "Refunds"})

	var env struct {
		Data VersionComparison `json:"data"`
	}
	path := base + "/compare?from=" + strconv.Itoa(int(saved.ID)) + "&to=current"
	json.Unmarshal(do(r, http.MethodGet, path, "").Body.Bytes(), &env)
	if env.Data.FromList != nil || env.Data.ToList != nil {
		t.Errorf("lists sent without full=1")
	}
	json.Unmarshal(do(r, http.MethodGet, path+"&full=1", "").Body.Bytes(), &env)
	if env.Data.FromList == nil || env.Data.ToList == nil || len(env.Data.FromList.Features) != 1 || len(env.Data.ToList.Features) != 2 {
		t.Fatalf("lists = %+v / %+v", env.Data.FromList, env.Data.ToList)
	}
	if env.Data.ToList.Features[0].Status != "todo" {
		t.Errorf("the list now should carry details: %+v", env.Data.ToList.Features[0])
	}
}
