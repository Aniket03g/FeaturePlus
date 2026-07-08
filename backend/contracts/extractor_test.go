package contracts

import (
	"go/parser"
	"go/token"
	"strings"
	"testing"
)

// extract is a test helper that fails on error.
func extract(t *testing.T, src string) string {
	t.Helper()
	out, err := ExtractGoContract("test.go", []byte(src))
	if err != nil {
		t.Fatalf("ExtractGoContract: %v", err)
	}
	return out
}

func mustContain(t *testing.T, out string, subs ...string) {
	t.Helper()
	for _, s := range subs {
		if !strings.Contains(out, s) {
			t.Errorf("expected contract to contain %q\n--- contract ---\n%s", s, out)
		}
	}
}

func mustNotContain(t *testing.T, out string, subs ...string) {
	t.Helper()
	for _, s := range subs {
		if strings.Contains(out, s) {
			t.Errorf("expected contract to NOT contain %q\n--- contract ---\n%s", s, out)
		}
	}
}

func TestStructKeepsExportedFieldsDropsUnexported(t *testing.T) {
	out := extract(t, `package m

type Trail struct {
	ID          string
	Name        string
	closedUntil int    // unexported
	secretKey   string // unexported
}
`)
	mustContain(t, out, "type Trail struct", "ID", "Name", "// unexported fields omitted")
	mustNotContain(t, out, "closedUntil", "secretKey")
}

func TestFunctionBodyStrippedSignatureKept(t *testing.T) {
	out := extract(t, `package m

func Compute(a int, b string) (int, error) {
	secret := a * 42
	return secret, nil
}
`)
	mustContain(t, out, "func Compute(a int, b string) (int, error)")
	// Body content must be gone.
	mustNotContain(t, out, "secret := a * 42", "* 42", "return secret")
}

func TestMultipleReturnValuesPreserved(t *testing.T) {
	out := extract(t, `package m

func Lookup(id string) (value string, found bool, err error) {
	return "", false, nil
}
`)
	mustContain(t, out, "func Lookup(id string) (value string, found bool, err error)")
}

func TestDocCommentsPreserved(t *testing.T) {
	out := extract(t, `package m

// GetTrailByID looks up a trail by ID.
// Returns ErrNotFound if absent.
func GetTrailByID(id string) error {
	return nil
}
`)
	mustContain(t, out,
		"// GetTrailByID looks up a trail by ID.",
		"// Returns ErrNotFound if absent.",
		"func GetTrailByID(id string) error",
	)
}

func TestUnexportedDeclarationsDropped(t *testing.T) {
	out := extract(t, `package m

func Exported() {}

func unexportedHelper() { doSecretThing() }

type internalConfig struct{ Key string }
`)
	mustContain(t, out, "func Exported()")
	mustNotContain(t, out, "unexportedHelper", "doSecretThing", "internalConfig")
}

func TestUnexportedMethodAndReceiverDropped(t *testing.T) {
	out := extract(t, `package m

type Service struct{ Name string }

func (s *Service) Do() error { return nil }

func (s *Service) internal() {}

type hidden struct{ X int }

func (h *hidden) Exposed() {}
`)
	mustContain(t, out, "func (s *Service) Do() error")
	// unexported method dropped; method on unexported receiver dropped
	mustNotContain(t, out, "internal()", "func (h *hidden) Exposed")
}

func TestConstEnumValuesKept(t *testing.T) {
	out := extract(t, `package m

type Difficulty string

const (
	Easy Difficulty = "easy"
	Hard Difficulty = "hard"
)
`)
	mustContain(t, out, "Easy", `"easy"`, "Hard", `"hard"`)
}

func TestSentinelVarsKeepValueForValidity(t *testing.T) {
	out := extract(t, `package m

import "errors"

var ErrNotFound = errors.New("not found")
`)
	// Untyped var keeps its initializer so the contract stays valid Go, and the
	// error message is caller-relevant.
	mustContain(t, out, "var ErrNotFound", `errors.New("not found")`)
}

func TestTypedVarStripsValue(t *testing.T) {
	out := extract(t, `package m

var MaxRetries int = computeSecretDefault()
`)
	mustContain(t, out, "var MaxRetries int")
	mustNotContain(t, out, "computeSecretDefault")
}

func TestImportsDropped(t *testing.T) {
	out := extract(t, `package m

import (
	"fmt"
	"os"
)

func Noop() {}
`)
	mustNotContain(t, out, `"fmt"`, `"os"`, "import")
}

// The output must always be syntactically valid Go so downstream tooling (mock
// generation, display) can rely on it.
func TestOutputIsValidGo(t *testing.T) {
	out := extract(t, `package trails

import "time"

// Trail is a hiking trail.
type Trail struct {
	ID          string
	Difficulty  string
	closedUntil *time.Time
}

var ErrTrailNotFound = fmtErr("not found")
var ErrTrailClosed = fmtErr("closed")

// GetTrailByID looks up a trail.
func GetTrailByID(id string) (*Trail, error) {
	return nil, nil
}

func fmtErr(s string) error { return nil }
`)
	fset := token.NewFileSet()
	if _, err := parser.ParseFile(fset, "contract.go", out, parser.ParseComments); err != nil {
		t.Fatalf("extracted contract is not valid Go: %v\n--- contract ---\n%s", err, out)
	}
}
