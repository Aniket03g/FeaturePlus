package v1

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"

	"github.com/FeaturePlus/backend/api"
	"github.com/FeaturePlus/backend/models"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func depRouter(t *testing.T, db *gorm.DB, userID int, role string) *gin.Engine {
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

	NewDependenciesHandler(db).Register(g)
	return r
}

func decodeGraph(t *testing.T, w *httptest.ResponseRecorder) DependencyGraph {
	t.Helper()

	var out struct {
		Data DependencyGraph `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode: %v (%s)", err, w.Body.String())
	}
	return out.Data
}

// edge builds a GraphEdge for the algorithm tests.
func edge(id, parent, child uint) GraphEdge {
	return GraphEdge{ID: id, ParentID: parent, ChildID: child}
}

// --- The cycle finder, tested directly -------------------------------------

func TestFindCyclesOnAcyclicGraph(t *testing.T) {
	// 1 -> 2 -> 3, and 1 -> 3: a diamond is not a cycle.
	nodes := []uint{1, 2, 3}
	edges := []GraphEdge{edge(10, 1, 2), edge(11, 2, 3), edge(12, 1, 3)}

	if cycles := findCycles(nodes, edges); len(cycles) != 0 {
		t.Errorf("found %d cycles in an acyclic graph: %+v", len(cycles), cycles)
	}
}

func TestFindCyclesSimpleLoop(t *testing.T) {
	// 1 -> 2 -> 3 -> 1
	nodes := []uint{1, 2, 3}
	edges := []GraphEdge{edge(10, 1, 2), edge(11, 2, 3), edge(12, 3, 1)}

	cycles := findCycles(nodes, edges)
	if len(cycles) != 1 {
		t.Fatalf("found %d cycles, want exactly 1: %+v", len(cycles), cycles)
	}
	if len(cycles[0].NodeIDs) != 3 {
		t.Errorf("cycle has %d nodes, want 3: %+v", len(cycles[0].NodeIDs), cycles[0])
	}
	if len(cycles[0].EdgeIDs) != 3 {
		t.Errorf("cycle has %d edges, want 3: %+v", len(cycles[0].EdgeIDs), cycles[0])
	}
}

func TestFindCyclesTwoNodeLoop(t *testing.T) {
	// The tightest real loop: A blocks B and B blocks A.
	nodes := []uint{1, 2}
	edges := []GraphEdge{edge(10, 1, 2), edge(11, 2, 1)}

	cycles := findCycles(nodes, edges)
	if len(cycles) != 1 {
		t.Fatalf("found %d cycles, want 1: %+v", len(cycles), cycles)
	}
}

// TestFindCyclesReportsEachLoopOnce guards the de-duplication: the same loop
// is reachable from every node on it, so a naive walk reports it repeatedly.
func TestFindCyclesReportsEachLoopOnce(t *testing.T) {
	nodes := []uint{1, 2, 3, 4}
	edges := []GraphEdge{
		edge(10, 1, 2), edge(11, 2, 3), edge(12, 3, 1), // one loop
		edge(13, 4, 1), // an approach into it from outside
	}

	if cycles := findCycles(nodes, edges); len(cycles) != 1 {
		t.Errorf("found %d cycles, want 1: %+v", len(cycles), cycles)
	}
}

func TestFindCyclesTwoSeparateLoops(t *testing.T) {
	// Two disconnected loops must both be reported.
	nodes := []uint{1, 2, 3, 4}
	edges := []GraphEdge{
		edge(10, 1, 2), edge(11, 2, 1),
		edge(12, 3, 4), edge(13, 4, 3),
	}

	if cycles := findCycles(nodes, edges); len(cycles) != 2 {
		t.Errorf("found %d cycles, want 2: %+v", len(cycles), cycles)
	}
}

func TestFindCyclesSelfLoop(t *testing.T) {
	// The API refuses to create one, but old data may hold it.
	nodes := []uint{1}
	edges := []GraphEdge{edge(10, 1, 1)}

	if cycles := findCycles(nodes, edges); len(cycles) != 1 {
		t.Errorf("found %d cycles, want 1: %+v", len(cycles), cycles)
	}
}

// TestFindCyclesOnLongChain checks the iterative walk holds up on a chain deep
// enough that a recursive version would be a stack risk.
func TestFindCyclesOnLongChain(t *testing.T) {
	const n = 5000

	nodes := make([]uint, 0, n)
	edges := make([]GraphEdge, 0, n)
	for i := uint(1); i <= n; i++ {
		nodes = append(nodes, i)
		if i > 1 {
			edges = append(edges, edge(i, i-1, i))
		}
	}

	if cycles := findCycles(nodes, edges); len(cycles) != 0 {
		t.Errorf("found %d cycles in a straight chain", len(cycles))
	}

	// Close the chain into one enormous loop.
	edges = append(edges, edge(n+1, n, 1))
	if cycles := findCycles(nodes, edges); len(cycles) != 1 {
		t.Errorf("found %d cycles after closing the chain, want 1", len(cycles))
	}
}

func TestFindCyclesEmptyGraph(t *testing.T) {
	if cycles := findCycles(nil, nil); len(cycles) != 0 {
		t.Errorf("found %d cycles in an empty graph", len(cycles))
	}
}

// --- Depth ranking ---------------------------------------------------------

func TestComputeDepths(t *testing.T) {
	// 1 -> 2 -> 4, 1 -> 3 -> 4: node 4 sits at the longest path, not the first.
	nodes := []uint{1, 2, 3, 4}
	edges := []GraphEdge{edge(10, 1, 2), edge(11, 2, 4), edge(12, 1, 3), edge(13, 3, 4)}

	depths := computeDepths(nodes, edges)
	want := map[uint]int{1: 0, 2: 1, 3: 1, 4: 2}
	for id, expected := range want {
		if depths[id] != expected {
			t.Errorf("depth[%d] = %d, want %d", id, depths[id], expected)
		}
	}
}

func TestComputeDepthsPrefersTheLongestPath(t *testing.T) {
	// 1 -> 2 -> 3 and 1 -> 3: node 3 must rank behind 2, not beside it, or the
	// layout would draw an edge going backwards.
	nodes := []uint{1, 2, 3}
	edges := []GraphEdge{edge(10, 1, 2), edge(11, 2, 3), edge(12, 1, 3)}

	if depths := computeDepths(nodes, edges); depths[3] != 2 {
		t.Errorf("depth[3] = %d, want 2 (the longer path)", depths[3])
	}
}

// TestComputeDepthsSurvivesACycle checks the ranking terminates on a graph a
// topological walk cannot finish.
func TestComputeDepthsSurvivesACycle(t *testing.T) {
	nodes := []uint{1, 2, 3}
	edges := []GraphEdge{edge(10, 1, 2), edge(11, 2, 3), edge(12, 3, 1)}

	depths := computeDepths(nodes, edges)
	if len(depths) != 3 {
		t.Errorf("got %d depths, want one per node", len(depths))
	}
}

// --- The endpoints ---------------------------------------------------------

// seedGraph builds three features and makes the first block the second.
func seedGraph(t *testing.T, db *gorm.DB, projectID int, userID int) []models.Feature {
	t.Helper()

	features := seedFeatures(t, db, projectID, userID)

	dep := models.Dependency{
		ParentID: features[0].ID, ParentType: models.EntityTypeFeature,
		ChildID: features[1].ID, ChildType: models.EntityTypeFeature,
		CreatedByID: uint(userID),
	}
	if err := db.Create(&dep).Error; err != nil {
		t.Fatalf("create dependency: %v", err)
	}

	return features
}

func TestGraphReturnsNodesAndEdges(t *testing.T) {
	db := newTestDB(t)
	owner, _, project := seed(t, db)
	features := seedGraph(t, db, project.ID, owner.ID)

	r := depRouter(t, db, owner.ID, "developer")
	w := do(r, http.MethodGet, "/api/v1/projects/"+strconv.Itoa(project.ID)+"/dependency-graph", "")
	if w.Code != http.StatusOK {
		t.Fatalf("status %d, want 200: %s", w.Code, w.Body.String())
	}

	graph := decodeGraph(t, w)
	if len(graph.Nodes) != 3 {
		t.Errorf("got %d nodes, want 3", len(graph.Nodes))
	}
	if len(graph.Edges) != 1 {
		t.Fatalf("got %d edges, want 1", len(graph.Edges))
	}
	if graph.Edges[0].ParentID != features[0].ID || graph.Edges[0].ChildID != features[1].ID {
		t.Errorf("edge = %+v, want %d -> %d", graph.Edges[0], features[0].ID, features[1].ID)
	}
	if len(graph.Cycles) != 0 {
		t.Errorf("got %d cycles, want none", len(graph.Cycles))
	}
}

// TestGraphExcludesOtherProjects checks the graph is bounded by the project,
// so an edge cannot point at a node the canvas never draws.
func TestGraphExcludesOtherProjects(t *testing.T) {
	db := newTestDB(t)
	owner, _, project := seed(t, db)
	features := seedGraph(t, db, project.ID, owner.ID)

	other := models.Project{Name: "Elsewhere", OwnerID: owner.ID}
	if err := db.Create(&other).Error; err != nil {
		t.Fatal(err)
	}
	outsider := models.Feature{ProjectID: other.ID, Title: "Far away"}
	if err := db.Create(&outsider).Error; err != nil {
		t.Fatal(err)
	}

	cross := models.Dependency{
		ParentID: features[0].ID, ParentType: models.EntityTypeFeature,
		ChildID: outsider.ID, ChildType: models.EntityTypeFeature,
	}
	if err := db.Create(&cross).Error; err != nil {
		t.Fatal(err)
	}

	r := depRouter(t, db, owner.ID, "developer")
	w := do(r, http.MethodGet, "/api/v1/projects/"+strconv.Itoa(project.ID)+"/dependency-graph", "")
	graph := decodeGraph(t, w)

	if len(graph.Edges) != 1 {
		t.Errorf("got %d edges, want only the in-project one", len(graph.Edges))
	}
	for _, node := range graph.Nodes {
		if node.ID == outsider.ID {
			t.Error("a feature from another project appeared as a node")
		}
	}
}

func TestGraphMarksCycleEdges(t *testing.T) {
	db := newTestDB(t)
	owner, _, project := seed(t, db)
	features := seedGraph(t, db, project.ID, owner.ID)

	// Close the loop: the second feature now blocks the first.
	back := models.Dependency{
		ParentID: features[1].ID, ParentType: models.EntityTypeFeature,
		ChildID: features[0].ID, ChildType: models.EntityTypeFeature,
	}
	if err := db.Create(&back).Error; err != nil {
		t.Fatal(err)
	}

	r := depRouter(t, db, owner.ID, "developer")
	w := do(r, http.MethodGet, "/api/v1/projects/"+strconv.Itoa(project.ID)+"/dependency-graph", "")
	graph := decodeGraph(t, w)

	if len(graph.Cycles) != 1 {
		t.Fatalf("got %d cycles, want 1", len(graph.Cycles))
	}
	for _, e := range graph.Edges {
		if !e.InCycle {
			t.Errorf("edge %d should be marked as part of the cycle", e.ID)
		}
	}
}

func TestCreateDependency(t *testing.T) {
	db := newTestDB(t)
	owner, _, project := seed(t, db)
	features := seedFeatures(t, db, project.ID, owner.ID)

	r := depRouter(t, db, owner.ID, "developer")
	body := `{"parent_id":` + strconv.Itoa(int(features[0].ID)) +
		`,"child_id":` + strconv.Itoa(int(features[2].ID)) + `}`

	w := do(r, http.MethodPost, "/api/v1/projects/"+strconv.Itoa(project.ID)+"/dependencies", body)
	if w.Code != http.StatusCreated {
		t.Fatalf("status %d, want 201: %s", w.Code, w.Body.String())
	}

	var out struct {
		Data DependencyDTO `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	if out.Data.CreatesCycle {
		t.Error("a fresh edge between unconnected features should not be a cycle")
	}
}

func TestCreateDependencyRejectsSelfReference(t *testing.T) {
	db := newTestDB(t)
	owner, _, project := seed(t, db)
	features := seedFeatures(t, db, project.ID, owner.ID)

	r := depRouter(t, db, owner.ID, "developer")
	id := strconv.Itoa(int(features[0].ID))
	body := `{"parent_id":` + id + `,"child_id":` + id + `}`

	w := do(r, http.MethodPost, "/api/v1/projects/"+strconv.Itoa(project.ID)+"/dependencies", body)
	if w.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status %d, want 422: %s", w.Code, w.Body.String())
	}
}

func TestCreateDependencyRejectsCrossProject(t *testing.T) {
	db := newTestDB(t)
	owner, _, project := seed(t, db)
	features := seedFeatures(t, db, project.ID, owner.ID)

	other := models.Project{Name: "Elsewhere", OwnerID: owner.ID}
	if err := db.Create(&other).Error; err != nil {
		t.Fatal(err)
	}
	outsider := models.Feature{ProjectID: other.ID, Title: "Far away"}
	if err := db.Create(&outsider).Error; err != nil {
		t.Fatal(err)
	}

	r := depRouter(t, db, owner.ID, "developer")
	body := `{"parent_id":` + strconv.Itoa(int(features[0].ID)) +
		`,"child_id":` + strconv.Itoa(int(outsider.ID)) + `}`

	w := do(r, http.MethodPost, "/api/v1/projects/"+strconv.Itoa(project.ID)+"/dependencies", body)
	if w.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status %d, want 422: %s", w.Code, w.Body.String())
	}
}

func TestCreateDependencyRejectsDuplicate(t *testing.T) {
	db := newTestDB(t)
	owner, _, project := seed(t, db)
	features := seedGraph(t, db, project.ID, owner.ID)

	r := depRouter(t, db, owner.ID, "developer")
	body := `{"parent_id":` + strconv.Itoa(int(features[0].ID)) +
		`,"child_id":` + strconv.Itoa(int(features[1].ID)) + `}`

	w := do(r, http.MethodPost, "/api/v1/projects/"+strconv.Itoa(project.ID)+"/dependencies", body)
	if w.Code != http.StatusConflict {
		t.Fatalf("status %d, want 409: %s", w.Code, w.Body.String())
	}
}

// TestCreateDependencyWarnsAboutCycles records the deliberate choice: closing
// a loop is reported, not refused. The data can be correct while the plan is
// not, and the person adding it is better placed to decide what should go.
func TestCreateDependencyWarnsAboutCycles(t *testing.T) {
	db := newTestDB(t)
	owner, _, project := seed(t, db)
	features := seedGraph(t, db, project.ID, owner.ID)

	r := depRouter(t, db, owner.ID, "developer")
	body := `{"parent_id":` + strconv.Itoa(int(features[1].ID)) +
		`,"child_id":` + strconv.Itoa(int(features[0].ID)) + `}`

	w := do(r, http.MethodPost, "/api/v1/projects/"+strconv.Itoa(project.ID)+"/dependencies", body)
	if w.Code != http.StatusCreated {
		t.Fatalf("status %d, want 201 — a cycle is a warning, not a refusal: %s", w.Code, w.Body.String())
	}

	var out struct {
		Data DependencyDTO `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	if !out.Data.CreatesCycle {
		t.Error("creates_cycle should be true for an edge that closes a loop")
	}
}

func TestCreateDependencyForbiddenForNonOwner(t *testing.T) {
	db := newTestDB(t)
	owner, other, project := seed(t, db)
	features := seedFeatures(t, db, project.ID, owner.ID)

	share(t, db, project.ID, other.ID, models.RoleViewer)
	r := depRouter(t, db, other.ID, "developer")
	body := `{"parent_id":` + strconv.Itoa(int(features[0].ID)) +
		`,"child_id":` + strconv.Itoa(int(features[1].ID)) + `}`

	w := do(r, http.MethodPost, "/api/v1/projects/"+strconv.Itoa(project.ID)+"/dependencies", body)
	if w.Code != http.StatusForbidden {
		t.Fatalf("status %d, want 403: %s", w.Code, w.Body.String())
	}
}

func TestDeleteDependency(t *testing.T) {
	db := newTestDB(t)
	owner, _, project := seed(t, db)
	seedGraph(t, db, project.ID, owner.ID)

	var dep models.Dependency
	if err := db.First(&dep).Error; err != nil {
		t.Fatal(err)
	}

	r := depRouter(t, db, owner.ID, "developer")
	w := do(r, http.MethodDelete, "/api/v1/dependencies/"+strconv.Itoa(int(dep.ID)), "")
	if w.Code != http.StatusNoContent {
		t.Fatalf("status %d, want 204: %s", w.Code, w.Body.String())
	}

	graphResp := do(r, http.MethodGet,
		"/api/v1/projects/"+strconv.Itoa(project.ID)+"/dependency-graph", "")
	if graph := decodeGraph(t, graphResp); len(graph.Edges) != 0 {
		t.Errorf("got %d edges after the delete, want 0", len(graph.Edges))
	}
}

func TestGraphNodesCarryDepth(t *testing.T) {
	db := newTestDB(t)
	owner, _, project := seed(t, db)
	features := seedGraph(t, db, project.ID, owner.ID)

	r := depRouter(t, db, owner.ID, "developer")
	w := do(r, http.MethodGet, "/api/v1/projects/"+strconv.Itoa(project.ID)+"/dependency-graph", "")
	graph := decodeGraph(t, w)

	depths := map[uint]int{}
	for _, node := range graph.Nodes {
		depths[node.ID] = node.Depth
	}
	if depths[features[0].ID] != 0 {
		t.Errorf("the blocking feature should sit at depth 0, got %d", depths[features[0].ID])
	}
	if depths[features[1].ID] != 1 {
		t.Errorf("the blocked feature should sit at depth 1, got %d", depths[features[1].ID])
	}
}

func TestGraphForMissingProjectIs404(t *testing.T) {
	db := newTestDB(t)
	owner, _, _ := seed(t, db)

	r := depRouter(t, db, owner.ID, "developer")
	w := do(r, http.MethodGet, "/api/v1/projects/9999/dependency-graph", "")

	if w.Code != http.StatusNotFound {
		t.Fatalf("status %d, want 404: %s", w.Code, w.Body.String())
	}
}

// TestCycleKeyIsOrderIndependent covers the de-duplication key directly.
func TestCycleKeyIsOrderIndependent(t *testing.T) {
	a := cycleKey([]uint{3, 1, 2})
	b := cycleKey([]uint{1, 2, 3})
	if a != b {
		t.Error("the same edge set produced different keys depending on order")
	}

	if cycleKey([]uint{1, 2}) == cycleKey([]uint{1, 2, 3}) {
		t.Error("different edge sets produced the same key")
	}
}

// TestCycleKeyDoesNotMutateItsInput matters because the slice it is handed is
// a cycle's real edge list, which is then sent to the client. Sorting it in
// place would silently reorder the loop as reported.
func TestCycleKeyDoesNotMutateItsInput(t *testing.T) {
	edgeIDs := []uint{3, 1, 2}
	_ = cycleKey(edgeIDs)

	want := []uint{3, 1, 2}
	for i, id := range want {
		if edgeIDs[i] != id {
			t.Fatalf("cycleKey reordered its input: got %v, want %v", edgeIDs, want)
		}
	}
}

func TestGraphNodesCarryTheirParent(t *testing.T) {
	db := newTestDB(t)
	owner, _, project := seed(t, db)
	features := seedFeatures(t, db, project.ID, owner.ID)

	// Make the second feature part of the first.
	if err := db.Model(&features[1]).Update("parent_feature_id", features[0].ID).Error; err != nil {
		t.Fatalf("set parent: %v", err)
	}

	r := depRouter(t, db, owner.ID, "developer")
	w := do(r, http.MethodGet, "/api/v1/projects/"+strconv.Itoa(project.ID)+"/dependency-graph", "")
	graph := decodeGraph(t, w)

	parents := map[uint]*uint{}
	for _, node := range graph.Nodes {
		parents[node.ID] = node.ParentID
	}

	child := parents[features[1].ID]
	if child == nil || *child != features[0].ID {
		t.Errorf("the nested feature should carry its parent, got %v", child)
	}
	if parents[features[0].ID] != nil {
		t.Errorf("a top-level feature should have no parent, got %v", parents[features[0].ID])
	}
}

func TestGraphDropsAParentOutsideTheProject(t *testing.T) {
	db := newTestDB(t)
	owner, _, project := seed(t, db)
	features := seedFeatures(t, db, project.ID, owner.ID)

	// A parent that is not in this project cannot be drawn as a boundary, so
	// the node comes back as top-level rather than pointing at nothing.
	if err := db.Model(&features[0]).Update("parent_feature_id", 9999).Error; err != nil {
		t.Fatalf("set parent: %v", err)
	}

	r := depRouter(t, db, owner.ID, "developer")
	w := do(r, http.MethodGet, "/api/v1/projects/"+strconv.Itoa(project.ID)+"/dependency-graph", "")
	graph := decodeGraph(t, w)

	for _, node := range graph.Nodes {
		if node.ID == features[0].ID && node.ParentID != nil {
			t.Errorf("a parent outside the project should be dropped, got %v", *node.ParentID)
		}
	}
}
