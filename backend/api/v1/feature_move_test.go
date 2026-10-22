package v1

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"testing"

	"github.com/FeaturePlus/backend/models"
	"gorm.io/gorm"
)

// moveFixture is a project with
//
//	Accounts (Sign up, Log in > Forgot password)
//	Catalogue (Browse, Search, Book page)
//	Cart
type moveFixture struct {
	db  *gorm.DB
	ids map[string]uint
	run func(method, path, body string) int
	pid int
}

func newMoveFixture(t *testing.T) moveFixture {
	t.Helper()
	db := newTestDB(t)
	owner, _, project := seed(t, db)
	ids := map[string]uint{}
	add := func(title, parent string) {
		f := models.Feature{ProjectID: project.ID, Title: title}
		if parent != "" {
			p := ids[parent]
			f.ParentFeatureID = &p
		}
		if err := db.Create(&f).Error; err != nil {
			t.Fatal(err)
		}
		ids[title] = f.ID
	}
	add("Accounts", "")
	add("Sign up", "Accounts")
	add("Log in", "Accounts")
	add("Forgot password", "Log in")
	add("Catalogue", "")
	add("Browse", "Catalogue")
	add("Search", "Catalogue")
	add("Book page", "Catalogue")
	add("Cart", "")

	r := featureRouter(t, db, owner.ID, "developer")
	return moveFixture{db: db, ids: ids, pid: project.ID, run: func(method, path, body string) int {
		return do(r, method, path, body).Code
	}}
}

// children lists a feature's children (or the top level for "") by title, in order.
func (fx moveFixture) children(t *testing.T, parent string) string {
	t.Helper()
	q := fx.db.Model(&models.Feature{}).Where("project_id = ?", fx.pid)
	if parent == "" {
		q = q.Where("parent_feature_id IS NULL")
	} else {
		q = q.Where("parent_feature_id = ?", fx.ids[parent])
	}
	var titles []string
	if err := q.Order("position, id").Pluck("title", &titles).Error; err != nil {
		t.Fatal(err)
	}
	return strings.Join(titles, ", ")
}

func (fx moveFixture) move(title string, parent string, index int) int {
	p := "null"
	if parent != "" {
		p = strconv.Itoa(int(fx.ids[parent]))
	}
	return fx.run(http.MethodPost, fmt.Sprintf("/api/v1/features/%d/move", fx.ids[title]),
		fmt.Sprintf(`{"parent_feature_id":%s,"index":%d}`, p, index))
}

func TestNewFeaturesGoToTheBottomOfTheirParent(t *testing.T) {
	fx := newMoveFixture(t)
	if got := fx.children(t, "Catalogue"); got != "Browse, Search, Book page" {
		t.Errorf("Catalogue = %q", got)
	}
	if got := fx.children(t, ""); got != "Accounts, Catalogue, Cart" {
		t.Errorf("top = %q", got)
	}
}

func TestMoveReordersAmongSiblings(t *testing.T) {
	fx := newMoveFixture(t)
	if code := fx.move("Book page", "Catalogue", 0); code != http.StatusOK {
		t.Fatalf("move: %d", code)
	}
	if got := fx.children(t, "Catalogue"); got != "Book page, Browse, Search" {
		t.Errorf("Catalogue = %q", got)
	}
	// An index past the end puts it last.
	fx.move("Book page", "Catalogue", 99)
	if got := fx.children(t, "Catalogue"); got != "Browse, Search, Book page" {
		t.Errorf("Catalogue after = %q", got)
	}
}

func TestMoveBetweenLevelsKeepsBothListsInOrder(t *testing.T) {
	fx := newMoveFixture(t)

	// Search goes into Cart, and its old list closes up.
	if code := fx.move("Search", "Cart", 0); code != http.StatusOK {
		t.Fatalf("into Cart: %d", code)
	}
	if fx.children(t, "Cart") != "Search" || fx.children(t, "Catalogue") != "Browse, Book page" {
		t.Errorf("Cart = %q, Catalogue = %q", fx.children(t, "Cart"), fx.children(t, "Catalogue"))
	}

	// Log in goes to the top level, second, with Forgot password still inside it.
	if code := fx.move("Log in", "", 1); code != http.StatusOK {
		t.Fatalf("to top: %d", code)
	}
	if got := fx.children(t, ""); got != "Accounts, Log in, Catalogue, Cart" {
		t.Errorf("top = %q", got)
	}
	if fx.children(t, "Log in") != "Forgot password" || fx.children(t, "Accounts") != "Sign up" {
		t.Errorf("Log in = %q, Accounts = %q", fx.children(t, "Log in"), fx.children(t, "Accounts"))
	}
}

func TestMoveRefusals(t *testing.T) {
	fx := newMoveFixture(t)

	if code := fx.move("Accounts", "Forgot password", 0); code != http.StatusUnprocessableEntity {
		t.Errorf("into its own branch: %d, want 422", code)
	}
	if code := fx.move("Accounts", "Accounts", 0); code != http.StatusUnprocessableEntity {
		t.Errorf("into itself: %d, want 422", code)
	}

	// Book page -> inside Forgot password would be L3: allowed.
	if code := fx.move("Book page", "Forgot password", 0); code != http.StatusOK {
		t.Fatalf("to L3: %d, want 200", code)
	}
	// Accounts (whose branch now goes three levels down) inside Cart would reach L4.
	if code := fx.move("Accounts", "Cart", 0); code != http.StatusUnprocessableEntity {
		t.Errorf("branch past L3: %d, want 422", code)
	}
	// Nothing can be created inside an L3 feature either.
	body := fmt.Sprintf(`{"title":"Too deep","parent_feature_id":%d}`, fx.ids["Book page"])
	if code := fx.run(http.MethodPost, fmt.Sprintf("/api/v1/projects/%d/features", fx.pid), body); code != http.StatusUnprocessableEntity {
		t.Errorf("create at L4: %d, want 422", code)
	}
}

func TestEditingTheParentReallyMovesTheFeature(t *testing.T) {
	fx := newMoveFixture(t)
	body := fmt.Sprintf(`{"parent_feature_id":%d}`, fx.ids["Cart"])
	if code := fx.run(http.MethodPatch, fmt.Sprintf("/api/v1/features/%d", fx.ids["Search"]), body); code != http.StatusOK {
		t.Fatalf("patch: %d", code)
	}
	if got := fx.children(t, "Cart"); got != "Search" {
		t.Errorf("Cart = %q, the move did not stick", got)
	}
}
