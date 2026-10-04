package handlers

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/FeaturePlus/backend/models"
	"github.com/FeaturePlus/backend/services"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// ContractHandler serves file content to collaborators under the Scoped
// Contracts model. It is the enforcement point where "owner sees source,
// contract-scope sees a stripped contract, everyone else sees nothing" becomes
// a real HTTP boundary.
type ContractHandler struct {
	DB       *gorm.DB
	access   *services.AccessService
	contract *services.ContractService
}

// NewContractHandler builds a ContractHandler.
func NewContractHandler(db *gorm.DB, contract *services.ContractService) *ContractHandler {
	return &ContractHandler{
		DB:       db,
		access:   services.NewAccessService(db),
		contract: contract,
	}
}

// fileResponse is the JSON shape returned by ServeFile.
type fileResponse struct {
	FilePath string `json:"file_path"`
	Access   string `json:"access"`         // "owner" or "contract"
	IsSource bool   `json:"is_source"`      // true = real source, false = contract
	Content  string `json:"content"`        // source or contract text
	Note     string `json:"note,omitempty"` // behavior note, when present
	Commit   string `json:"commit,omitempty"`
	Stale    bool   `json:"stale,omitempty"` // contract drifted from current source
}

// ServeFile returns the content of a file scoped to the caller's access:
//   - none     -> 404 (the file is invisible, not merely forbidden)
//   - contract -> the stripped contract (never real source)
//   - owner    -> the real source
func (h *ContractHandler) ServeFile(c *gin.Context) {
	userIDVal, ok := c.Get("user_id")
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Authentication required"})
		return
	}
	userID := 0
	if u, ok := userIDVal.(uint); ok {
		userID = int(u)
	}

	projectID, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid project id"})
		return
	}
	filePath := c.Query("path")
	if filePath == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Missing path"})
		return
	}
	commit := c.Query("commit")

	fa, err := h.access.ResolveFileAccess(userID, projectID, filePath)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Access check failed"})
		return
	}

	switch fa.Level {
	case models.AccessNone:
		// Invisible: do not reveal whether the file exists.
		c.JSON(http.StatusNotFound, gin.H{"error": "Not found"})
		return

	case models.AccessContract:
		artifact, err := h.contract.ContractFor(projectID, fa.FeatureID, filePath, commit)
		if err != nil {
			// No contract available yet and source can't be reached — do not
			// fall through to real source.
			c.JSON(http.StatusNotFound, gin.H{"error": "Contract not available"})
			return
		}
		stale := false
		if d, derr := h.contract.CheckDrift(projectID, filePath); derr == nil {
			stale = d.Drifted
		}
		c.JSON(http.StatusOK, fileResponse{
			FilePath: filePath,
			Access:   string(models.AccessContract),
			IsSource: false,
			Content:  services.ContractWithNote(artifact),
			Note:     artifact.BehaviorNote,
			Commit:   artifact.CommitHash,
			Stale:    stale,
		})
		return

	case models.AccessOwner:
		src, err := h.contract.RealSource(projectID, filePath)
		if err != nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Source unavailable"})
			return
		}
		c.JSON(http.StatusOK, fileResponse{
			FilePath: filePath,
			Access:   string(models.AccessOwner),
			IsSource: true,
			Content:  string(src),
			Commit:   commit,
		})
		return

	default:
		c.JSON(http.StatusNotFound, gin.H{"error": "Not found"})
	}
}

// mockResponse is the JSON shape returned by ServeMock.
type mockResponse struct {
	FilePath     string `json:"file_path"`
	MockFilename string `json:"mock_filename"`
	Content      string `json:"content"`
}

// ServeMock returns a generated mock for a dependency file so a contract-scope
// collaborator can build/test against a fake. Access rules:
//   - none  -> 404 (invisible)
//   - owner -> 409: owners have the real source; a mock is not what they want
//   - contract -> the generated mock package
func (h *ContractHandler) ServeMock(c *gin.Context) {
	userIDVal, ok := c.Get("user_id")
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Authentication required"})
		return
	}
	userID := 0
	if u, ok := userIDVal.(uint); ok {
		userID = int(u)
	}

	projectID, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid project id"})
		return
	}
	filePath := c.Query("path")
	if filePath == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Missing path"})
		return
	}
	commit := c.Query("commit")

	fa, err := h.access.ResolveFileAccess(userID, projectID, filePath)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Access check failed"})
		return
	}

	switch fa.Level {
	case models.AccessNone:
		c.JSON(http.StatusNotFound, gin.H{"error": "Not found"})
		return
	case models.AccessOwner:
		c.JSON(http.StatusConflict, gin.H{"error": "You have source access to this file; a mock is unnecessary"})
		return
	case models.AccessContract:
		mock, err := h.contract.MockFor(projectID, fa.FeatureID, filePath, commit)
		if err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "Mock not available"})
			return
		}
		c.JSON(http.StatusOK, mockResponse{
			FilePath:     filePath,
			MockFilename: mockFilename(filePath),
			Content:      mock,
		})
		return
	default:
		c.JSON(http.StatusNotFound, gin.H{"error": "Not found"})
	}
}

// mockFilename derives the mock file name for a source path, e.g.
// trails/trail_service.go -> trail_service_mock.go.
func mockFilename(filePath string) string {
	base := filePath
	if i := strings.LastIndexAny(base, "/\\"); i >= 0 {
		base = base[i+1:]
	}
	if strings.HasSuffix(base, ".go") {
		return strings.TrimSuffix(base, ".go") + "_mock.go"
	}
	return base + "_mock.go"
}

// GetContractView renders the collaborator-facing view of a single contract
// with a staleness banner when the contract has drifted from the current source.
// It is access-gated exactly like ServeFile: none -> 404, and only contract- or
// owner-level callers may view.
func (h *ContractHandler) GetContractView(c *gin.Context) {
	userIDVal, ok := c.Get("user_id")
	if !ok {
		c.String(http.StatusUnauthorized, "Authentication required")
		return
	}
	userID := 0
	if u, ok := userIDVal.(uint); ok {
		userID = int(u)
	}
	projectID, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.String(http.StatusBadRequest, "Invalid project id")
		return
	}
	filePath := c.Query("path")
	if filePath == "" {
		c.String(http.StatusBadRequest, "Missing path")
		return
	}

	fa, err := h.access.ResolveFileAccess(userID, projectID, filePath)
	if err != nil {
		c.String(http.StatusInternalServerError, "Access check failed")
		return
	}
	if fa.Level == models.AccessNone {
		c.String(http.StatusNotFound, "Not found")
		return
	}

	// Owners see the real implementation; contract-tier collaborators only ever
	// see the stripped contract (with behavior note + drift status).
	if fa.Level == models.AccessOwner {
		src, err := h.contract.RealSource(projectID, filePath)
		if err != nil {
			c.String(http.StatusNotFound, "Source not available")
			return
		}
		c.HTML(http.StatusOK, "contract-view.html", gin.H{
			"FilePath": filePath,
			"Contract": string(src),
			"IsSource": true,
		})
		return
	}

	artifact, err := h.contract.ContractFor(projectID, fa.FeatureID, filePath, "")
	if err != nil {
		c.String(http.StatusNotFound, "Contract not available")
		return
	}
	drift, _ := h.contract.CheckDrift(projectID, filePath)

	c.HTML(http.StatusOK, "contract-view.html", gin.H{
		"FilePath": filePath,
		"Contract": services.ContractWithNote(artifact),
		"Stale":    drift.Drifted,
		"Artifact": artifact,
		"Drift":    drift,
	})
}
