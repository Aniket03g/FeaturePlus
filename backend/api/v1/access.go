package v1

import (
	"github.com/FeaturePlus/backend/api"
	"github.com/FeaturePlus/backend/models"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// Who may do what in a project, in one place.
//
// Every route that reads or changes something inside a project comes through
// here: the caller's role in the project is looked up and compared with what
// the route needs. A project is private to its owner until they share it.
// The one exception is an admin, who runs the server and can open every
// project with the owner's powers. The manager role gives no access.
//
// Someone with no role in a project is told it does not exist, the same answer
// as for an id nobody uses, so ids cannot be probed to learn what projects
// there are. Someone who can see a project but not do what they asked is told
// why.

// Aliases so call sites read as what they need rather than as a role name.
const (
	canView   = models.RoleViewer
	canEdit   = models.RoleEditor
	ownerOnly = models.RoleOwner
)

// projectRole is the caller's role in a project, or "" when they have none.
func projectRole(db *gorm.DB, project *models.Project, userID int) (models.ProjectRole, error) {
	if project.OwnerID == userID {
		return models.RoleOwner, nil
	}

	var member models.ProjectMember
	err := db.Where("project_id = ? AND user_id = ?", project.ID, userID).Limit(1).Find(&member).Error
	if err != nil {
		return "", err
	}
	return member.Role, nil
}

// requireProject loads a project and checks the caller has at least the role
// `need` in it.
func requireProject(c *gin.Context, db *gorm.DB, projectID int, need models.ProjectRole) (*models.Project, error) {
	project, _, err := requireProjectRole(c, db, projectID, need)
	return project, err
}

// requireProjectRole is requireProject that also says what the caller's role
// turned out to be, for responses that show it.
func requireProjectRole(c *gin.Context, db *gorm.DB, projectID int, need models.ProjectRole) (*models.Project, models.ProjectRole, error) {
	userID, err := api.UserID(c)
	if err != nil {
		return nil, "", err
	}

	var project models.Project
	if dbErr := db.First(&project, projectID).Error; dbErr != nil {
		return nil, "", api.FromDB(dbErr, "Project")
	}

	role, dbErr := projectRole(db, &project, userID)
	if dbErr != nil {
		return nil, "", api.Internal(dbErr)
	}
	if api.IsAdmin(c) && role != models.RoleOwner {
		role = models.RoleAdmin
	}
	if role == "" {
		return nil, "", api.NotFound("Project")
	}
	if role.Rank() < need.Rank() {
		return nil, role, refusal(role, need)
	}

	return &project, role, nil
}

// refusal explains why someone who can see a project cannot do this.
func refusal(have, need models.ProjectRole) error {
	if need == models.RoleOwner {
		return api.Forbidden("Only the project's owner can do this")
	}
	if have == models.RoleViewer {
		return api.Forbidden("You can view this project but not change it")
	}
	return api.Forbidden("You do not have permission to do this in this project")
}

// requireFeature loads a feature and checks the caller's role in its project.
// A feature in a project the caller cannot see is reported as not found.
func requireFeature(c *gin.Context, db *gorm.DB, featureID uint, need models.ProjectRole) (*models.Feature, error) {
	var feature models.Feature
	if dbErr := db.First(&feature, featureID).Error; dbErr != nil {
		return nil, api.FromDB(dbErr, "Feature")
	}
	if _, err := requireProject(c, db, feature.ProjectID, need); err != nil {
		return nil, asHidden(err, "Feature")
	}
	return &feature, nil
}

// requireTask loads a task and checks the caller's role in the project its
// feature belongs to.
func requireTask(c *gin.Context, db *gorm.DB, taskID uint, need models.ProjectRole) (*models.Task, error) {
	var task models.Task
	if dbErr := db.First(&task, taskID).Error; dbErr != nil {
		return nil, api.FromDB(dbErr, "Task")
	}
	if _, err := requireFeature(c, db, task.FeatureID, need); err != nil {
		return nil, asHidden(err, "Task")
	}
	return &task, nil
}

// asHidden renames a "Project not found" to the thing that was asked for, so
// a hidden task reads as a missing task rather than leaking that it sits in a
// project.
func asHidden(err error, resource string) error {
	if e := api.AsError(err); e != nil && e.Code == api.CodeNotFound {
		return api.NotFound(resource)
	}
	return err
}

// visibleProjectIDs is every project the user owns or has been added to.
func visibleProjectIDs(db *gorm.DB, userID int) ([]int, error) {
	var ids []int
	err := db.Model(&models.Project{}).Where("owner_id = ?", userID).
		Or("id IN (?)", db.Model(&models.ProjectMember{}).Select("project_id").Where("user_id = ?", userID)).
		Pluck("id", &ids).Error
	return ids, err
}

// rolesIn maps each of the given projects to the user's role in it.
func rolesIn(db *gorm.DB, projects []models.Project, userID int) (map[int]models.ProjectRole, error) {
	roles := make(map[int]models.ProjectRole, len(projects))
	ids := make([]int, 0, len(projects))
	for _, p := range projects {
		if p.OwnerID == userID {
			roles[p.ID] = models.RoleOwner
		} else {
			ids = append(ids, p.ID)
		}
	}
	if len(ids) == 0 {
		return roles, nil
	}

	var members []models.ProjectMember
	if err := db.Where("user_id = ? AND project_id IN ?", userID, ids).Find(&members).Error; err != nil {
		return nil, err
	}
	for _, m := range members {
		roles[m.ProjectID] = m.Role
	}
	return roles, nil
}
