package v1

import (
	"sort"

	"github.com/FeaturePlus/backend/api"
	"github.com/FeaturePlus/backend/models"
	"github.com/FeaturePlus/backend/repositories"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// DependenciesHandler serves the dependency graph for a project.
//
// The canvas needs the whole graph at once — nodes, edges, and which edges
// form cycles — so this returns it in a single response rather than making the
// client walk the tree with a request per node.
type DependenciesHandler struct {
	featureRepo *repositories.FeatureRepository
	projectRepo *repositories.ProjectRepository
	db          *gorm.DB
}

// NewDependenciesHandler builds the handler.
func NewDependenciesHandler(db *gorm.DB) *DependenciesHandler {
	return &DependenciesHandler{
		featureRepo: repositories.NewFeatureRepository(db),
		projectRepo: repositories.NewProjectRepository(db),
		db:          db,
	}
}

// Register mounts the dependency routes onto an authenticated group.
func (h *DependenciesHandler) Register(g *gin.RouterGroup) {
	g.GET("/projects/:id/dependency-graph", h.Graph)
	g.POST("/projects/:id/dependencies", h.Create)
	g.DELETE("/dependencies/:dependencyId", h.Delete)
}

// Graph returns a project's features and the dependencies between them.
//
// GET /api/v1/projects/:id/dependency-graph
//
// Only feature-to-feature edges are included. Tasks and pull requests can also
// carry dependencies, but drawing three entity types on one canvas produces a
// picture nobody can read; those belong on their own views.
func (h *DependenciesHandler) Graph(c *gin.Context) {
	projectID, err := api.IDParam(c, "id")
	if err != nil {
		api.Fail(c, err)
		return
	}

	if _, dbErr := h.projectRepo.GetProjectByID(projectID); dbErr != nil {
		api.Fail(c, api.FromDB(dbErr, "Project"))
		return
	}

	features, dbErr := h.featureRepo.GetFeaturesByProject(projectID)
	if dbErr != nil {
		api.Fail(c, api.Internal(dbErr))
		return
	}

	// The project's own features bound the graph: an edge is only drawn when
	// both ends belong here, so a dependency pointing at another project's
	// feature cannot produce a node with no title.
	inProject := make(map[uint]bool, len(features))
	ids := make([]uint, 0, len(features))
	for _, f := range features {
		inProject[f.ID] = true
		ids = append(ids, f.ID)
	}

	edges := h.featureEdges(ids, inProject)
	cycles := findCycles(ids, edges)

	// Mark the edges that take part in a cycle, so the canvas can draw them
	// differently rather than leaving the reader to spot the loop.
	inCycle := map[uint]bool{}
	for _, cycle := range cycles {
		for _, edgeID := range cycle.EdgeIDs {
			inCycle[edgeID] = true
		}
	}
	for i := range edges {
		edges[i].InCycle = inCycle[edges[i].ID]
	}

	tags := h.tagsByFeature(ids)
	nodes := make([]GraphNode, 0, len(features))
	for _, f := range features {
		nodes = append(nodes, GraphNode{
			ID:       f.ID,
			Title:    f.Title,
			Status:   string(f.Status),
			Priority: string(f.Priority),
			Category: f.Category,
			Tags:     emptyIfNil(tags[f.ID]),
		})
	}

	// Rank each node by how deep it sits, so the canvas can lay the graph out
	// in columns without recomputing the same walk in the browser.
	depths := computeDepths(ids, edges)
	for i := range nodes {
		nodes[i].Depth = depths[nodes[i].ID]
	}

	api.OK(c, DependencyGraph{
		ProjectID: projectID,
		Nodes:     nodes,
		Edges:     edges,
		Cycles:    cycles,
	})
}

// Create adds a dependency between two features of the same project.
//
// POST /api/v1/projects/:id/dependencies
func (h *DependenciesHandler) Create(c *gin.Context) {
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

	var req CreateDependencyRequest
	if bindErr := api.Bind(c, &req); bindErr != nil {
		api.Fail(c, bindErr)
		return
	}

	if err := h.authoriseProjectWrite(c, project); err != nil {
		api.Fail(c, err)
		return
	}

	// A feature depending on itself is never meaningful and would draw a loop
	// on the canvas that cannot be resolved.
	if req.ParentID == req.ChildID {
		api.Fail(c, api.Validation("A feature cannot depend on itself").
			WithField("child_id", "Choose a different feature"))
		return
	}

	// Both ends must exist and belong to this project, or the graph would gain
	// an edge to a node it never draws.
	for name, id := range map[string]uint{"parent_id": req.ParentID, "child_id": req.ChildID} {
		feature, err := h.featureRepo.GetFeatureByID(int(id))
		if err != nil {
			api.Fail(c, api.Validation("That feature does not exist").
				WithField(name, "No feature with this id"))
			return
		}
		if feature.ProjectID != projectID {
			api.Fail(c, api.Validation("That feature belongs to another project").
				WithField(name, "Both features must be in this project"))
			return
		}
	}

	var existing int64
	if err := h.db.Model(&models.Dependency{}).
		Where("parent_id = ? AND child_id = ? AND parent_type = ? AND child_type = ? AND deleted_at IS NULL",
			req.ParentID, req.ChildID, models.EntityTypeFeature, models.EntityTypeFeature).
		Count(&existing).Error; err != nil {
		api.Fail(c, api.Internal(err))
		return
	}
	if existing > 0 {
		api.Fail(c, api.Conflict("That dependency already exists"))
		return
	}

	userID, _ := api.UserID(c)
	dependency := models.Dependency{
		ParentID:    req.ParentID,
		ParentType:  models.EntityTypeFeature,
		ChildID:     req.ChildID,
		ChildType:   models.EntityTypeFeature,
		Description: req.Description,
		CreatedByID: uint(userID),
	}

	if dbErr := h.db.Create(&dependency).Error; dbErr != nil {
		api.Fail(c, api.FromDB(dbErr, "Dependency"))
		return
	}

	// A new edge may close a loop. That is reported rather than refused: the
	// data can be legitimate while the plan is not, and the person adding it
	// is better placed to decide which edge should go.
	api.Created(c, NewDependencyDTO(dependency, h.wouldCycle(projectID, dependency.ID)))
}

// Delete removes a dependency.
//
// DELETE /api/v1/dependencies/:dependencyId
func (h *DependenciesHandler) Delete(c *gin.Context) {
	id, err := api.IDParam(c, "dependencyId")
	if err != nil {
		api.Fail(c, err)
		return
	}

	var dependency models.Dependency
	if dbErr := h.db.First(&dependency, id).Error; dbErr != nil {
		api.Fail(c, api.FromDB(dbErr, "Dependency"))
		return
	}

	// Permission follows the project the parent feature belongs to.
	parent, dbErr := h.featureRepo.GetFeatureByID(int(dependency.ParentID))
	if dbErr != nil {
		api.Fail(c, api.FromDB(dbErr, "Feature"))
		return
	}
	project, dbErr := h.projectRepo.GetProjectByID(parent.ProjectID)
	if dbErr != nil {
		api.Fail(c, api.FromDB(dbErr, "Project"))
		return
	}
	if err := h.authoriseProjectWrite(c, project); err != nil {
		api.Fail(c, err)
		return
	}

	if dbErr := h.db.Delete(&models.Dependency{}, id).Error; dbErr != nil {
		api.Fail(c, api.Internal(dbErr))
		return
	}

	api.NoContent(c)
}

// featureEdges loads the feature-to-feature dependencies whose ends both sit
// inside the project.
func (h *DependenciesHandler) featureEdges(ids []uint, inProject map[uint]bool) []GraphEdge {
	if len(ids) == 0 {
		return []GraphEdge{}
	}

	var rows []models.Dependency
	if err := h.db.Where(
		"parent_type = ? AND child_type = ? AND (parent_id IN ? OR child_id IN ?) AND deleted_at IS NULL",
		models.EntityTypeFeature, models.EntityTypeFeature, ids, ids,
	).Find(&rows).Error; err != nil {
		return []GraphEdge{}
	}

	edges := make([]GraphEdge, 0, len(rows))
	for _, row := range rows {
		if !inProject[row.ParentID] || !inProject[row.ChildID] {
			continue
		}
		edges = append(edges, GraphEdge{
			ID:          row.ID,
			ParentID:    row.ParentID,
			ChildID:     row.ChildID,
			Description: row.Description,
		})
	}

	return edges
}

// wouldCycle reports whether the given edge takes part in a cycle.
func (h *DependenciesHandler) wouldCycle(projectID int, edgeID uint) bool {
	features, err := h.featureRepo.GetFeaturesByProject(projectID)
	if err != nil {
		return false
	}

	inProject := map[uint]bool{}
	ids := make([]uint, 0, len(features))
	for _, f := range features {
		inProject[f.ID] = true
		ids = append(ids, f.ID)
	}

	for _, cycle := range findCycles(ids, h.featureEdges(ids, inProject)) {
		for _, id := range cycle.EdgeIDs {
			if id == edgeID {
				return true
			}
		}
	}
	return false
}

// tagsByFeature loads tags for many features in one query.
func (h *DependenciesHandler) tagsByFeature(ids []uint) map[uint][]string {
	result := map[uint][]string{}
	if len(ids) == 0 {
		return result
	}

	var rows []models.FeatureTag
	if err := h.db.Where("feature_id IN ?", ids).Order("tag_name").Find(&rows).Error; err != nil {
		return result
	}

	for _, row := range rows {
		result[row.FeatureID] = append(result[row.FeatureID], row.TagName)
	}
	return result
}

// authoriseProjectWrite permits changes by the project's owner or a manager,
// the same rule the other handlers apply.
func (h *DependenciesHandler) authoriseProjectWrite(c *gin.Context, project *models.Project) error {
	userID, err := api.UserID(c)
	if err != nil {
		return err
	}

	if project.OwnerID == userID || api.IsManager(c) {
		return nil
	}

	return api.Forbidden("Only the project owner or a manager can change this project's dependencies")
}

// findCycles returns every cycle in the graph.
//
// This is an iterative depth-first search rather than the recursive form: a
// project with a long dependency chain would otherwise risk the stack, and the
// explicit stack makes the path — which is what names the cycle — easy to read
// off at the moment a back edge is found.
//
// Each cycle is reported once, keyed by its set of edges, since the same loop
// is reachable from every node on it.
func findCycles(nodeIDs []uint, edges []GraphEdge) []GraphCycle {
	type outgoing struct {
		to     uint
		edgeID uint
	}

	adjacency := map[uint][]outgoing{}
	for _, edge := range edges {
		adjacency[edge.ParentID] = append(adjacency[edge.ParentID], outgoing{to: edge.ChildID, edgeID: edge.ID})
	}

	const (
		unvisited = 0
		onStack   = 1
		done      = 2
	)
	state := map[uint]int{}

	seen := map[string]bool{}
	cycles := []GraphCycle{}

	// path holds the nodes currently on the stack, and pathEdges the edge that
	// led to each of them, so a back edge can be turned into the loop it closes.
	var path []uint
	var pathEdges []uint

	var walk func(start uint)
	walk = func(start uint) {
		type frame struct {
			node uint
			next int
		}
		stack := []frame{{node: start}}
		state[start] = onStack
		path = append(path, start)
		pathEdges = append(pathEdges, 0)

		for len(stack) > 0 {
			top := &stack[len(stack)-1]
			neighbours := adjacency[top.node]

			if top.next < len(neighbours) {
				edge := neighbours[top.next]
				top.next++

				switch state[edge.to] {
				case onStack:
					// A back edge: everything from edge.to onwards is the loop.
					cycle := extractCycle(path, pathEdges, edge.to, edge.edgeID)
					if key := cycleKey(cycle.EdgeIDs); !seen[key] {
						seen[key] = true
						cycles = append(cycles, cycle)
					}
				case unvisited:
					state[edge.to] = onStack
					path = append(path, edge.to)
					pathEdges = append(pathEdges, edge.edgeID)
					stack = append(stack, frame{node: edge.to})
				}
				continue
			}

			state[top.node] = done
			stack = stack[:len(stack)-1]
			path = path[:len(path)-1]
			pathEdges = pathEdges[:len(pathEdges)-1]
		}
	}

	for _, id := range nodeIDs {
		if state[id] == unvisited {
			walk(id)
		}
	}

	return cycles
}

// extractCycle turns the current path plus a closing edge into a cycle.
func extractCycle(path []uint, pathEdges []uint, from uint, closingEdge uint) GraphCycle {
	start := 0
	for i, node := range path {
		if node == from {
			start = i
			break
		}
	}

	nodes := append([]uint{}, path[start:]...)
	edgeIDs := append([]uint{}, pathEdges[start+1:]...)
	edgeIDs = append(edgeIDs, closingEdge)

	return GraphCycle{NodeIDs: nodes, EdgeIDs: edgeIDs}
}

// cycleKey identifies a cycle by its edges, independent of where the walk
// entered it, so the same loop is not reported once per node.
func cycleKey(edgeIDs []uint) string {
	sorted := append([]uint{}, edgeIDs...)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i] < sorted[j] })

	key := make([]byte, 0, len(sorted)*4)
	for _, id := range sorted {
		key = append(key, byte(id), byte(id>>8), byte(id>>16), byte(id>>24))
	}
	return string(key)
}

// computeDepths ranks each node by the longest path leading into it, which is
// what lets the canvas lay the graph out in columns.
//
// Nodes inside a cycle have no well-defined depth; they keep the depth they
// were first reached at rather than looping forever.
func computeDepths(nodeIDs []uint, edges []GraphEdge) map[uint]int {
	children := map[uint][]uint{}
	indegree := map[uint]int{}
	for _, id := range nodeIDs {
		indegree[id] = 0
	}
	for _, edge := range edges {
		children[edge.ParentID] = append(children[edge.ParentID], edge.ChildID)
		indegree[edge.ChildID]++
	}

	depth := map[uint]int{}
	queue := make([]uint, 0, len(nodeIDs))
	for _, id := range nodeIDs {
		if indegree[id] == 0 {
			queue = append(queue, id)
		}
	}

	// A pure topological walk stalls on a cycle, leaving those nodes unranked.
	// They are given the depth of whichever neighbour reached them, which is
	// enough for a readable layout.
	for len(queue) > 0 {
		node := queue[0]
		queue = queue[1:]

		for _, child := range children[node] {
			if depth[node]+1 > depth[child] {
				depth[child] = depth[node] + 1
			}
			indegree[child]--
			if indegree[child] == 0 {
				queue = append(queue, child)
			}
		}
	}

	for _, id := range nodeIDs {
		if _, ok := depth[id]; !ok {
			depth[id] = 0
		}
	}
	return depth
}
