package handlers

import (
	"net/http"
	"strconv"

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
		c.JSON(http.StatusOK, fileResponse{
			FilePath: filePath,
			Access:   string(models.AccessContract),
			IsSource: false,
			Content:  services.ContractWithNote(artifact),
			Note:     artifact.BehaviorNote,
			Commit:   artifact.CommitHash,
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
