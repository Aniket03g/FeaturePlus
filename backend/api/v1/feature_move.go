package v1

import (
	"errors"
	"sort"

	"github.com/FeaturePlus/backend/api"
	"github.com/FeaturePlus/backend/internal/log"
	"github.com/FeaturePlus/backend/models"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// MoveFeatureRequest says where a feature goes: inside which feature (null
// for the top level) and at which place among that feature's children,
// counting from 0 and not counting the feature being moved.
type MoveFeatureRequest struct {
	ParentFeatureID *uint `json:"parent_feature_id"`
	Index           int   `json:"index" binding:"min=0"`
}

// Move puts a feature somewhere else in the project's list: another place
// among the same siblings, inside another feature, or at the top level. It
// takes everything inside it along, and keeps the order of both the list it
// left and the list it joined.
//
// POST /api/v1/features/:featureId/move
//
// A feature cannot go inside itself or anything inside it, and nothing may end
// up deeper than L3.
func (h *FeaturesHandler) Move(c *gin.Context) {
	feature, err := h.loadForWrite(c)
	if err != nil {
		api.Fail(c, err)
		return
	}

	var req MoveFeatureRequest
	if bindErr := api.Bind(c, &req); bindErr != nil {
		api.Fail(c, bindErr)
		return
	}
	if req.ParentFeatureID != nil && *req.ParentFeatureID == 0 {
		req.ParentFeatureID = nil
	}

	txErr := h.db.Transaction(func(tx *gorm.DB) error {
		var all []models.Feature
		if err := tx.Select("id", "parent_feature_id", "position", "title").
			Where("project_id = ?", feature.ProjectID).Find(&all).Error; err != nil {
			return api.Internal(err)
		}
		parentOf := map[uint]uint{}
		known := map[uint]bool{}
		for _, f := range all {
			known[f.ID] = true
			if f.ParentFeatureID != nil {
				parentOf[f.ID] = *f.ParentFeatureID
			}
		}

		// Where it is going, and how deep that is.
		newDepth := 0
		if req.ParentFeatureID != nil {
			target := *req.ParentFeatureID
			if !known[target] {
				return api.Validation("The feature to move it into is not in this project").
					WithField("parent_feature_id", "Choose a feature from the same project")
			}
			for p, steps := target, 0; p != 0 && steps <= len(all); p, steps = parentOf[p], steps+1 {
				if p == feature.ID {
					return api.Validation("A feature can't go inside itself or anything inside it")
				}
				newDepth++
			}
		}

		// How deep its own branch goes below it.
		below := 0
		var reach func(id uint, depth int)
		reach = func(id uint, depth int) {
			if depth > below {
				below = depth
			}
			if depth > len(all) {
				return
			}
			for _, f := range all {
				if f.ParentFeatureID != nil && *f.ParentFeatureID == id {
					reach(f.ID, depth+1)
				}
			}
		}
		reach(feature.ID, 0)
		if newDepth+below > models.MaxFeatureDepth {
			return api.Validation("That would put part of “" + feature.Title + "” below L3. Features go down to L3 at most")
		}

		// The siblings it joins, in their order, with it slotted in.
		siblings := siblingsOf(all, req.ParentFeatureID, feature.ID)
		index := req.Index
		if index > len(siblings) {
			index = len(siblings)
		}
		order := append(append(append([]uint{}, siblings[:index]...), feature.ID), siblings[index:]...)

		if err := tx.Model(&models.Feature{}).Where("id = ?", feature.ID).
			UpdateColumn("parent_feature_id", req.ParentFeatureID).Error; err != nil {
			return api.Internal(err)
		}
		if err := renumber(tx, order); err != nil {
			return api.Internal(err)
		}

		// Close the gap in the list it left.
		if !sameParent(feature.ParentFeatureID, req.ParentFeatureID) {
			if err := renumber(tx, siblingsOf(all, feature.ParentFeatureID, feature.ID)); err != nil {
				return api.Internal(err)
			}
		}
		return nil
	})
	if txErr != nil {
		var refused *api.Error
		if errors.As(txErr, &refused) {
			api.Fail(c, refused)
		} else {
			api.Fail(c, api.Internal(txErr))
		}
		return
	}

	log.WithField("feature", feature.ID).Info("feature moved")

	moved, dbErr := h.repo.GetFeatureByID(int(feature.ID))
	if dbErr != nil {
		api.Fail(c, api.FromDB(dbErr, "Feature"))
		return
	}
	ids := []uint{moved.ID}
	api.OK(c, NewFeatureDTO(*moved, h.tagsByFeature(ids)[moved.ID], h.taskCountsByFeature(ids)[moved.ID]))
}

// siblingsOf lists the features under parent (nil for the top level) in
// their order, leaving out skip.
func siblingsOf(all []models.Feature, parent *uint, skip uint) []uint {
	var group []models.Feature
	for _, f := range all {
		if f.ID != skip && sameParent(f.ParentFeatureID, parent) {
			group = append(group, f)
		}
	}
	sort.SliceStable(group, func(i, j int) bool {
		if group[i].Position != group[j].Position {
			return group[i].Position < group[j].Position
		}
		return group[i].ID < group[j].ID
	})
	ids := make([]uint, 0, len(group))
	for _, f := range group {
		ids = append(ids, f.ID)
	}
	return ids
}

// renumber gives the features 1, 2, 3… in the order given.
func renumber(tx *gorm.DB, ids []uint) error {
	for i, id := range ids {
		if err := tx.Model(&models.Feature{}).Where("id = ?", id).UpdateColumn("position", i+1).Error; err != nil {
			return err
		}
	}
	return nil
}

func sameParent(a, b *uint) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return *a == *b
}
