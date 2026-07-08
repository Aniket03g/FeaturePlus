package services

import (
	"testing"

	"github.com/FeaturePlus/backend/models"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// newTestDB spins up an in-memory SQLite DB with the schema the AccessService
// touches.
func newTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Silent),
	})
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	if err := db.AutoMigrate(
		&models.User{}, &models.Project{}, &models.Feature{},
		&models.FeatureFile{}, &models.Dependency{}, &models.FeatureScope{},
	); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	return db
}

// fixture builds a small project graph:
//
//	owner (project owner) — collaborator (invited)
//	Feature A "Trails"   (id set by DB) — file trails/trail_service.go
//	Feature B "Reviews"  — depends on A — file reviews/review_service.go
//	Feature C "Payments" — unrelated    — file payments/pay.go
//
// Returns the ids that tests need.
type fixture struct {
	db                    *gorm.DB
	ownerID, collaborator int
	projectID             int
	featA, featB, featC   uint
	fileA, fileB, fileC   string
}

func buildFixture(t *testing.T) fixture {
	t.Helper()
	db := newTestDB(t)

	owner := models.User{Email: "owner@x.io", Username: "owner", Password: "x", Role: "manager"}
	collab := models.User{Email: "dev@x.io", Username: "dev", Password: "x", Role: "developer"}
	if err := db.Create(&owner).Error; err != nil {
		t.Fatalf("create owner: %v", err)
	}
	if err := db.Create(&collab).Error; err != nil {
		t.Fatalf("create collab: %v", err)
	}

	project := models.Project{Name: "Hiking App", OwnerID: owner.ID}
	if err := db.Create(&project).Error; err != nil {
		t.Fatalf("create project: %v", err)
	}

	featA := models.Feature{ProjectID: project.ID, Title: "Trails", Category: "Backend"}
	featB := models.Feature{ProjectID: project.ID, Title: "Reviews", Category: "Backend"}
	featC := models.Feature{ProjectID: project.ID, Title: "Payments", Category: "Backend"}
	for _, f := range []*models.Feature{&featA, &featB, &featC} {
		if err := db.Create(f).Error; err != nil {
			t.Fatalf("create feature %s: %v", f.Title, err)
		}
	}

	fx := fixture{
		db:           db,
		ownerID:      owner.ID,
		collaborator: collab.ID,
		projectID:    project.ID,
		featA:        featA.ID,
		featB:        featB.ID,
		featC:        featC.ID,
		fileA:        "trails/trail_service.go",
		fileB:        "reviews/review_service.go",
		fileC:        "payments/pay.go",
	}

	// Map files to features.
	files := []models.FeatureFile{
		{FeatureID: featA.ID, FilePath: fx.fileA},
		{FeatureID: featB.ID, FilePath: fx.fileB},
		{FeatureID: featC.ID, FilePath: fx.fileC},
	}
	for i := range files {
		if err := db.Create(&files[i]).Error; err != nil {
			t.Fatalf("create feature file: %v", err)
		}
	}

	// B depends on A: Child B -> Parent A.
	dep := models.Dependency{
		ParentID: featA.ID, ParentType: models.EntityTypeFeature,
		ChildID: featB.ID, ChildType: models.EntityTypeFeature,
	}
	if err := db.Create(&dep).Error; err != nil {
		t.Fatalf("create dependency: %v", err)
	}

	return fx
}

func grantOwner(t *testing.T, db *gorm.DB, projectID, userID int, featureID uint) {
	t.Helper()
	scope := models.FeatureScope{
		ProjectID: projectID, FeatureID: featureID, UserID: userID,
		AccessLevel: models.AccessOwner, GrantedByID: 1,
	}
	if err := db.Create(&scope).Error; err != nil {
		t.Fatalf("grant owner: %v", err)
	}
}

func TestCollaboratorOwnsFeatureAndSeesDependencyAsContract(t *testing.T) {
	fx := buildFixture(t)
	svc := NewAccessService(fx.db)
	grantOwner(t, fx.db, fx.projectID, fx.collaborator, fx.featB)

	// Owns B -> owner.
	if lvl, _ := svc.EffectiveFeatureAccess(fx.collaborator, fx.projectID, fx.featB); lvl != models.AccessOwner {
		t.Errorf("feature B: want owner, got %s", lvl)
	}
	// A is a dependency of B -> contract.
	if lvl, _ := svc.EffectiveFeatureAccess(fx.collaborator, fx.projectID, fx.featA); lvl != models.AccessContract {
		t.Errorf("feature A: want contract, got %s", lvl)
	}
	// C is unrelated -> none.
	if lvl, _ := svc.EffectiveFeatureAccess(fx.collaborator, fx.projectID, fx.featC); lvl != models.AccessNone {
		t.Errorf("feature C: want none, got %s", lvl)
	}
}

func TestFileAccessMirrorsFeatureAccess(t *testing.T) {
	fx := buildFixture(t)
	svc := NewAccessService(fx.db)
	grantOwner(t, fx.db, fx.projectID, fx.collaborator, fx.featB)

	cases := []struct {
		file string
		want models.FeatureAccessLevel
	}{
		{fx.fileB, models.AccessOwner},             // owned feature's file -> full source
		{fx.fileA, models.AccessContract},          // dependency's file -> contract
		{fx.fileC, models.AccessNone},              // unrelated file -> invisible
		{"totally/unmapped.go", models.AccessNone}, // not mapped to any feature
	}
	for _, tc := range cases {
		got, err := svc.ResolveFileAccess(fx.collaborator, fx.projectID, tc.file)
		if err != nil {
			t.Fatalf("resolve %s: %v", tc.file, err)
		}
		if got.Level != tc.want {
			t.Errorf("file %s: want %s, got %s", tc.file, tc.want, got.Level)
		}
	}
}

func TestProjectOwnerSeesEverythingAsOwner(t *testing.T) {
	fx := buildFixture(t)
	svc := NewAccessService(fx.db)

	for _, f := range []uint{fx.featA, fx.featB, fx.featC} {
		if lvl, _ := svc.EffectiveFeatureAccess(fx.ownerID, fx.projectID, f); lvl != models.AccessOwner {
			t.Errorf("owner on feature %d: want owner, got %s", f, lvl)
		}
	}
	got, _ := svc.ResolveFileAccess(fx.ownerID, fx.projectID, fx.fileC)
	if got.Level != models.AccessOwner {
		t.Errorf("owner file access: want owner, got %s", got.Level)
	}
}

func TestNonCollaboratorSeesNothing(t *testing.T) {
	fx := buildFixture(t)
	svc := NewAccessService(fx.db)
	// A brand-new user with no grants.
	stranger := models.User{Email: "stranger@x.io", Username: "stranger", Password: "x", Role: "developer"}
	if err := fx.db.Create(&stranger).Error; err != nil {
		t.Fatalf("create stranger: %v", err)
	}
	for _, f := range []uint{fx.featA, fx.featB, fx.featC} {
		if lvl, _ := svc.EffectiveFeatureAccess(stranger.ID, fx.projectID, f); lvl != models.AccessNone {
			t.Errorf("stranger on feature %d: want none, got %s", f, lvl)
		}
	}
}

// A shared dependency: both B and C depend on A. A collaborator who owns only B
// must still see A as contract (and never gain access to C, which also uses A).
func TestSharedDependencyStaysContract(t *testing.T) {
	fx := buildFixture(t)
	// Add C -> A dependency so A is shared.
	dep := models.Dependency{
		ParentID: fx.featA, ParentType: models.EntityTypeFeature,
		ChildID: fx.featC, ChildType: models.EntityTypeFeature,
	}
	if err := fx.db.Create(&dep).Error; err != nil {
		t.Fatalf("create shared dep: %v", err)
	}
	svc := NewAccessService(fx.db)
	grantOwner(t, fx.db, fx.projectID, fx.collaborator, fx.featB)

	// A is contract (dependency of owned B).
	if lvl, _ := svc.EffectiveFeatureAccess(fx.collaborator, fx.projectID, fx.featA); lvl != models.AccessContract {
		t.Errorf("shared dep A: want contract, got %s", lvl)
	}
	// C shares A but the collaborator doesn't own C and C isn't a dependency of
	// B, so C stays invisible.
	if lvl, _ := svc.EffectiveFeatureAccess(fx.collaborator, fx.projectID, fx.featC); lvl != models.AccessNone {
		t.Errorf("shared-dep sibling C: want none, got %s", lvl)
	}
}

// An explicit contract grant on a feature that is NOT a dependency should still
// yield contract (explicit grants are honored), while owner is the max.
func TestExplicitGrantHonored(t *testing.T) {
	fx := buildFixture(t)
	svc := NewAccessService(fx.db)
	// Explicitly grant contract on C (unrelated) to the collaborator.
	scope := models.FeatureScope{
		ProjectID: fx.projectID, FeatureID: fx.featC, UserID: fx.collaborator,
		AccessLevel: models.AccessContract, GrantedByID: fx.ownerID,
	}
	if err := fx.db.Create(&scope).Error; err != nil {
		t.Fatalf("grant contract: %v", err)
	}
	if lvl, _ := svc.EffectiveFeatureAccess(fx.collaborator, fx.projectID, fx.featC); lvl != models.AccessContract {
		t.Errorf("explicit contract on C: want contract, got %s", lvl)
	}
}
