package v1

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"testing"

	"github.com/FeaturePlus/backend/models"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func decodeCopy(t *testing.T, body []byte) CopyDetailDTO {
	t.Helper()
	var env struct {
		Data CopyDetailDTO `json:"data"`
	}
	if err := json.Unmarshal(body, &env); err != nil {
		t.Fatalf("decode copy: %v: %s", err, body)
	}
	return env.Data
}

// copyFixture is a project with Payment > Refunds, Refunds needing Payment,
// saved as version 1.
type copyFixture struct {
	db               *gorm.DB
	owner, other     models.User
	project          models.Project
	payment, refunds models.Feature
	version          VersionDTO
	copies           string
}

func newCopyFixture(t *testing.T) copyFixture {
	t.Helper()
	db := newTestDB(t)
	owner, other, project := seed(t, db)

	payment := models.Feature{ProjectID: project.ID, Title: "Payment", Description: "Card only", Status: models.StatusInProgress}
	db.Create(&payment)
	refunds := models.Feature{ProjectID: project.ID, Title: "Refunds", ParentFeatureID: &payment.ID}
	db.Create(&refunds)

	base := "/api/v1/projects/" + strconv.Itoa(project.ID)
	w := do(versionsRouterAs(t, db, owner.ID), http.MethodPost, base+"/versions", `{"tag":"v1"}`)
	if w.Code != http.StatusCreated {
		t.Fatalf("save version: status %d: %s", w.Code, w.Body.String())
	}
	return copyFixture{
		db: db, owner: owner, other: other, project: project,
		payment: payment, refunds: refunds,
		version: decodeVersion(t, w.Body.Bytes()).VersionDTO,
		copies:  base + "/copies",
	}
}

func key(f models.Feature) string { return "f" + strconv.Itoa(int(f.ID)) }

func TestUploadedFileBecomesACopyOfItsVersion(t *testing.T) {
	fx := newCopyFixture(t)
	r := versionsRouterAs(t, fx.db, fx.owner.ID)

	// Payment renamed, Refunds moved to the top and now needing Payment, and a
	// new Wallet under Payment with a key the page made up.
	body := fmt.Sprintf(`{"base_version_id":%d,"name":" Checkout rework ","features":[
		{"key":%q,"title":"Payments"},
		{"key":"fpage1","title":"Wallet","parent_key":%q},
		{"key":%q,"title":"Refunds","needs":[%q]}
	]}`, fx.version.ID, key(fx.payment), key(fx.payment), key(fx.refunds), key(fx.payment))
	w := do(r, http.MethodPost, fx.copies, body)
	if w.Code != http.StatusCreated {
		t.Fatalf("upload: status %d, want 201: %s", w.Code, w.Body.String())
	}
	saved := decodeCopy(t, w.Body.Bytes())
	if saved.Name != "Checkout rework" {
		t.Errorf("name = %q", saved.Name)
	}
	if saved.Number != 1 || saved.Revision != 1 || saved.Base.Number != 1 || saved.Base.Tag != "v1" ||
		saved.FeatureCount != 3 || saved.Owner.Name != "owner" {
		t.Fatalf("copy = %+v", saved.CopyDTO)
	}

	w = do(r, http.MethodGet, fx.copies+"/"+strconv.Itoa(int(saved.ID)), "")
	if w.Code != http.StatusOK {
		t.Fatalf("get: status %d: %s", w.Code, w.Body.String())
	}
	snap := decodeSnapshot(t, decodeCopy(t, w.Body.Bytes()).Snapshot)
	if len(snap.Features) != 3 {
		t.Fatalf("features = %+v", snap.Features)
	}
	pay, wallet, ref := snap.Features[0], snap.Features[1], snap.Features[2]
	// What the file cannot carry comes from the version, matched by key.
	if pay.Key != key(fx.payment) || pay.FeatureID != fx.payment.ID || pay.Description != "Card only" || pay.Status != "in_progress" {
		t.Errorf("payment = %+v", pay)
	}
	if !strings.HasPrefix(wallet.Key, "n") || wallet.FeatureID != 0 || wallet.ParentKey != pay.Key {
		t.Errorf("wallet = %+v, want a fresh key under Payments", wallet)
	}
	if ref.Key != key(fx.refunds) || ref.ParentKey != "" || len(ref.Needs) != 1 || ref.Needs[0] != pay.Key {
		t.Errorf("refunds = %+v", ref)
	}

	// The real list is untouched.
	var live models.Feature
	fx.db.First(&live, fx.payment.ID)
	if live.Title != "Payment" {
		t.Errorf("live title = %q, a copy must not change the project", live.Title)
	}
	var count int64
	fx.db.Model(&models.Feature{}).Where("project_id = ?", fx.project.ID).Count(&count)
	if count != 2 {
		t.Errorf("live features = %d, want 2", count)
	}

	// Comparing the version with the copy shows the edits.
	cmp := "/api/v1/projects/" + strconv.Itoa(fx.project.ID) + "/versions/compare?from=" +
		strconv.Itoa(int(fx.version.ID)) + "&to=c" + strconv.Itoa(int(saved.ID))
	w = do(r, http.MethodGet, cmp, "")
	if w.Code != http.StatusOK {
		t.Fatalf("compare: status %d: %s", w.Code, w.Body.String())
	}
	var env struct {
		Data VersionComparison `json:"data"`
	}
	json.Unmarshal(w.Body.Bytes(), &env)
	if got := env.Data; got.Added != 1 || got.Changed != 2 || got.Removed != 0 || !got.To.Copy || got.To.Number != 1 {
		t.Errorf("comparison = %+v", got)
	}
}

func TestReuploadingACopyOnlyAgainstItsBase(t *testing.T) {
	fx := newCopyFixture(t)
	r := versionsRouterAs(t, fx.db, fx.owner.ID)

	first := decodeCopy(t, do(r, http.MethodPost, fx.copies, fmt.Sprintf(
		`{"base_version_id":%d,"features":[{"key":%q,"title":"Payment"},{"key":"new1","title":"Wallet"}]}`,
		fx.version.ID, key(fx.payment))).Body.Bytes())
	snap := decodeSnapshot(t, decodeCopy(t, do(r, http.MethodGet, fx.copies+"/"+strconv.Itoa(int(first.ID)), "").Body.Bytes()).Snapshot)
	walletKey := snap.Features[1].Key

	upload := func(revision int, baseID uint) int {
		return do(r, http.MethodPost, fx.copies, fmt.Sprintf(
			`{"base_version_id":%d,"copy_id":%d,"revision":%d,"features":[{"key":%q,"title":"Wallet 2"}]}`,
			baseID, first.ID, revision, walletKey)).Code
	}

	// The file from revision 1 replaces the copy, and Wallet keeps its key.
	if code := upload(1, fx.version.ID); code != http.StatusOK {
		t.Fatalf("re-upload: status %d, want 200", code)
	}
	var stored models.FeatureCopy
	fx.db.First(&stored, first.ID)
	again, _ := readSnapshot(stored.Snapshot)
	if stored.Revision != 2 || len(again.Features) != 1 || again.Features[0].Key != walletKey || again.Features[0].Title != "Wallet 2" {
		t.Fatalf("after re-upload: revision %d, features %+v", stored.Revision, again.Features)
	}

	// The same old file again would undo the newer upload.
	if code := upload(1, fx.version.ID); code != http.StatusConflict {
		t.Errorf("stale file: status %d, want 409", code)
	}

	// A file that claims another base than the copy's.
	w := do(versionsRouterAs(t, fx.db, fx.owner.ID), http.MethodPost,
		"/api/v1/projects/"+strconv.Itoa(fx.project.ID)+"/versions", `{"tag":"v2"}`)
	v2 := decodeVersion(t, w.Body.Bytes())
	if code := upload(2, v2.ID); code != http.StatusConflict {
		t.Errorf("other base: status %d, want 409", code)
	}

	var copies int64
	fx.db.Model(&models.FeatureCopy{}).Count(&copies)
	if copies != 1 {
		t.Errorf("copies = %d, want 1", copies)
	}
}

func TestCopiesBelongToWhoeverMadeThem(t *testing.T) {
	fx := newCopyFixture(t)
	owner := versionsRouterAs(t, fx.db, fx.owner.ID)
	other := versionsRouterAs(t, fx.db, fx.other.ID)
	body := fmt.Sprintf(`{"base_version_id":%d,"features":[{"key":%q,"title":"Payment"}]}`, fx.version.ID, key(fx.payment))

	if w := do(other, http.MethodPost, fx.copies, body); w.Code != http.StatusNotFound {
		t.Errorf("stranger upload: status %d, want 404", w.Code)
	}

	mine := decodeCopy(t, do(owner, http.MethodPost, fx.copies, body).Body.Bytes())

	// A viewer changes nothing by making a copy, so they may.
	share(t, fx.db, fx.project.ID, fx.other.ID, models.RoleViewer)
	if w := do(other, http.MethodPost, fx.copies, body); w.Code != http.StatusCreated {
		t.Fatalf("viewer upload: status %d, want 201: %s", w.Code, w.Body.String())
	}

	// Someone else's copy file becomes a copy of their own, leaving the
	// owner's alone.
	w := do(other, http.MethodPost, fx.copies, fmt.Sprintf(
		`{"base_version_id":%d,"copy_id":%d,"revision":1,"features":[{"key":%q,"title":"Taken over"}]}`,
		fx.version.ID, mine.ID, key(fx.payment)))
	if w.Code != http.StatusCreated {
		t.Fatalf("upload of another's copy: status %d, want 201: %s", w.Code, w.Body.String())
	}
	if got := decodeCopy(t, w.Body.Bytes()); got.ID == mine.ID || got.Number != 3 {
		t.Errorf("copy = %+v, want a new third copy", got.CopyDTO)
	}
	var stored models.FeatureCopy
	fx.db.First(&stored, mine.ID)
	if stored.Revision != 1 {
		t.Errorf("owner's copy revision = %d, want untouched", stored.Revision)
	}

	// Each sees only their own.
	var env struct {
		Data []CopyDTO `json:"data"`
	}
	json.Unmarshal(do(other, http.MethodGet, fx.copies, "").Body.Bytes(), &env)
	if len(env.Data) != 2 {
		t.Errorf("viewer's list = %d copies, want 2", len(env.Data))
	}
	if w := do(other, http.MethodGet, fx.copies+"/"+strconv.Itoa(int(mine.ID)), ""); w.Code != http.StatusNotFound {
		t.Errorf("another's copy: status %d, want 404", w.Code)
	}
	cmp := "/api/v1/projects/" + strconv.Itoa(fx.project.ID) + "/versions/compare?from=current&to=c" + strconv.Itoa(int(mine.ID))
	if w := do(other, http.MethodGet, cmp, ""); w.Code != http.StatusNotFound {
		t.Errorf("compare with another's copy: status %d, want 404", w.Code)
	}
}

func TestUploadedListRefusals(t *testing.T) {
	fx := newCopyFixture(t)
	r := versionsRouterAs(t, fx.db, fx.owner.ID)
	p, rf := key(fx.payment), key(fx.refunds)

	// Another project's version.
	otherProject := models.Project{Name: "Other", OwnerID: fx.owner.ID}
	fx.db.Create(&otherProject)
	w := do(r, http.MethodPost, "/api/v1/projects/"+strconv.Itoa(otherProject.ID)+"/copies",
		fmt.Sprintf(`{"base_version_id":%d,"features":[]}`, fx.version.ID))
	if w.Code != http.StatusUnprocessableEntity {
		t.Errorf("version of another project: status %d, want 422: %s", w.Code, w.Body.String())
	}

	cases := []struct{ name, features string }{
		{"blank name", `[{"key":"a","title":"  "}]`},
		{"same key twice", fmt.Sprintf(`[{"key":%q,"title":"A"},{"key":%q,"title":"B"}]`, p, p)},
		{"child before parent", fmt.Sprintf(`[{"key":%q,"title":"Refunds","parent_key":%q},{"key":%q,"title":"Payment"}]`, rf, p, p)},
		{"needs something missing", fmt.Sprintf(`[{"key":%q,"title":"Payment","needs":["gone"]}]`, p)},
		{"needs itself", fmt.Sprintf(`[{"key":%q,"title":"Payment","needs":[%q]}]`, p, p)},
		{"needs its parent", fmt.Sprintf(`[{"key":%q,"title":"Payment"},{"key":%q,"title":"Refunds","parent_key":%q,"needs":[%q]}]`, p, rf, p, p)},
	}
	for _, tc := range cases {
		body := fmt.Sprintf(`{"base_version_id":%d,"features":%s}`, fx.version.ID, tc.features)
		if w := do(r, http.MethodPost, fx.copies, body); w.Code != http.StatusUnprocessableEntity {
			t.Errorf("%s: status %d, want 422: %s", tc.name, w.Code, w.Body.String())
		}
	}

	var copies int64
	fx.db.Model(&models.FeatureCopy{}).Count(&copies)
	if copies != 0 {
		t.Errorf("copies = %d, want none saved", copies)
	}
}

func TestPublishingSharesACopyAndFreezesIt(t *testing.T) {
	fx := newCopyFixture(t)
	owner := versionsRouterAs(t, fx.db, fx.owner.ID)
	share(t, fx.db, fx.project.ID, fx.other.ID, models.RoleViewer)
	other := versionsRouterAs(t, fx.db, fx.other.ID)

	mine := decodeCopy(t, do(owner, http.MethodPost, fx.copies, fmt.Sprintf(
		`{"base_version_id":%d,"features":[{"key":%q,"title":"Payments"}]}`, fx.version.ID, key(fx.payment))).Body.Bytes())
	one := fx.copies + "/" + strconv.Itoa(int(mine.ID))
	cmp := "/api/v1/projects/" + strconv.Itoa(fx.project.ID) + "/versions/compare?from=" +
		strconv.Itoa(int(fx.version.ID)) + "&to=c" + strconv.Itoa(int(mine.ID))
	listed := func(r *gin.Engine) []CopyDTO {
		var env struct {
			Data []CopyDTO `json:"data"`
		}
		w := do(r, http.MethodGet, fx.copies, "")
		json.Unmarshal(w.Body.Bytes(), &env)
		return env.Data
	}

	// A draft is the owner's alone.
	if got := listed(other); len(got) != 0 {
		t.Fatalf("viewer sees %d copies before publishing, want 0", len(got))
	}
	if w := do(other, http.MethodPost, one+"/publish", ""); w.Code != http.StatusNotFound {
		t.Errorf("publish another's draft: status %d, want 404", w.Code)
	}

	w := do(owner, http.MethodPost, one+"/publish", "")
	if w.Code != http.StatusOK {
		t.Fatalf("publish: status %d: %s", w.Code, w.Body.String())
	}
	if got := decodeCopy(t, w.Body.Bytes()); got.PublishedAt == nil || !got.Mine {
		t.Errorf("published copy = %+v", got.CopyDTO)
	}
	if w := do(owner, http.MethodPost, one+"/publish", ""); w.Code != http.StatusConflict {
		t.Errorf("publish twice: status %d, want 409", w.Code)
	}

	// Now everyone on the project can read and compare it, but not change it.
	got := listed(other)
	if len(got) != 1 || got[0].Mine || got[0].PublishedAt == nil || got[0].Owner.Name != "owner" {
		t.Fatalf("viewer's list = %+v", got)
	}
	if w := do(other, http.MethodGet, one, ""); w.Code != http.StatusOK {
		t.Errorf("viewer get published: status %d, want 200", w.Code)
	}
	if w := do(other, http.MethodGet, cmp, ""); w.Code != http.StatusOK {
		t.Errorf("viewer compare published: status %d, want 200", w.Code)
	}
	if w := do(other, http.MethodPost, one+"/unpublish", ""); w.Code != http.StatusForbidden {
		t.Errorf("unpublish another's: status %d, want 403", w.Code)
	}

	reupload := fmt.Sprintf(`{"base_version_id":%d,"copy_id":%d,"revision":1,"features":[{"key":%q,"title":"Pay"}]}`,
		fx.version.ID, mine.ID, key(fx.payment))
	if w := do(owner, http.MethodPost, fx.copies, reupload); w.Code != http.StatusConflict {
		t.Errorf("upload over a published copy: status %d, want 409", w.Code)
	}

	// Unpublished, it is private again and can take the upload.
	if w := do(owner, http.MethodPost, one+"/unpublish", ""); w.Code != http.StatusOK {
		t.Fatalf("unpublish: status %d: %s", w.Code, w.Body.String())
	}
	if w := do(owner, http.MethodPost, one+"/unpublish", ""); w.Code != http.StatusConflict {
		t.Errorf("unpublish twice: status %d, want 409", w.Code)
	}
	if got := listed(other); len(got) != 0 {
		t.Errorf("viewer sees %d copies after unpublishing, want 0", len(got))
	}
	if w := do(other, http.MethodGet, one, ""); w.Code != http.StatusNotFound {
		t.Errorf("viewer get unpublished: status %d, want 404", w.Code)
	}
	if w := do(owner, http.MethodPost, fx.copies, reupload); w.Code != http.StatusOK {
		t.Errorf("upload after unpublishing: status %d, want 200: %s", w.Code, w.Body.String())
	}
}

func TestCheckingAnUploadSavesNothing(t *testing.T) {
	fx := newCopyFixture(t)
	r := versionsRouterAs(t, fx.db, fx.owner.ID)

	body := fmt.Sprintf(`{"base_version_id":%d,"dry_run":true,"features":[
		{"key":%q,"title":"Payments"},{"key":"new1","title":"Wallet"}
	]}`, fx.version.ID, key(fx.payment))
	w := do(r, http.MethodPost, fx.copies, body)
	if w.Code != http.StatusOK {
		t.Fatalf("check: status %d: %s", w.Code, w.Body.String())
	}
	var env struct {
		Data CopyCheck `json:"data"`
	}
	json.Unmarshal(w.Body.Bytes(), &env)
	got := env.Data
	if got.Base.Number != 1 || got.Replaces != nil || got.Comparison.Added != 1 || got.Comparison.Removed != 1 ||
		got.Comparison.Changed != 1 || got.Comparison.FromList == nil || len(got.Comparison.ToList.Features) != 2 {
		t.Errorf("check = %+v", got)
	}

	var copies int64
	fx.db.Model(&models.FeatureCopy{}).Count(&copies)
	if copies != 0 {
		t.Errorf("copies = %d, a check must not save", copies)
	}

	// Checking a re-upload names the copy it would replace.
	saved := decodeCopy(t, do(r, http.MethodPost, fx.copies, strings.Replace(body, `"dry_run":true,`, `"name":"Rework",`, 1)).Body.Bytes())
	again := fmt.Sprintf(`{"base_version_id":%d,"copy_id":%d,"revision":1,"dry_run":true,"features":[{"key":%q,"title":"Pay"}]}`,
		fx.version.ID, saved.ID, key(fx.payment))
	json.Unmarshal(do(r, http.MethodPost, fx.copies, again).Body.Bytes(), &env)
	if env.Data.Replaces == nil || env.Data.Replaces.Name != "Rework" {
		t.Errorf("replaces = %+v", env.Data.Replaces)
	}
	var stored models.FeatureCopy
	fx.db.First(&stored, saved.ID)
	if stored.Revision != 1 {
		t.Errorf("revision = %d, a check must not replace", stored.Revision)
	}
}

func TestAStaleFileSaysWhichCopyToDownload(t *testing.T) {
	fx := newCopyFixture(t)
	r := versionsRouterAs(t, fx.db, fx.owner.ID)
	saved := decodeCopy(t, do(r, http.MethodPost, fx.copies, fmt.Sprintf(
		`{"base_version_id":%d,"name":"Rework","features":[{"key":%q,"title":"Payment"}]}`, fx.version.ID, key(fx.payment))).Body.Bytes())
	file := fmt.Sprintf(`{"base_version_id":%d,"copy_id":%d,"revision":1,"features":[{"key":%q,"title":"Pay"}]}`,
		fx.version.ID, saved.ID, key(fx.payment))
	do(r, http.MethodPost, fx.copies, file)

	w := do(r, http.MethodPost, fx.copies, file)
	if w.Code != http.StatusConflict {
		t.Fatalf("stale: status %d", w.Code)
	}
	var env struct {
		Error struct {
			Message string            `json:"message"`
			Fields  map[string]string `json:"fields"`
		} `json:"error"`
	}
	json.Unmarshal(w.Body.Bytes(), &env)
	f := env.Error.Fields
	if f["stale_copy_id"] != strconv.Itoa(int(saved.ID)) || f["stale_copy_name"] != "Rework" || f["stale_uploaded_at"] == "" ||
		!strings.Contains(env.Error.Message, "older than your copy") {
		t.Errorf("error = %+v", env.Error)
	}
}
