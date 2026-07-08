package contracts

import (
	"go/ast"
	"strings"
)

// synthStructLiteral builds a synthetic composite literal for a struct type,
// e.g. Trail{ID: "mock-id", Name: "mock-name"}. It uses KEYED fields and only
// fills fields whose type it can synthesize safely; every other field is simply
// omitted and defaults to its zero value. That keeps the generated mock
// guaranteed-compilable regardless of the struct's shape.
//
// All values are derived from the field's type and name — never sampled from
// real or production data. This is a hard requirement: fixtures must not leak
// real data.
func synthStructLiteral(typeName string, st *ast.StructType, imports *importSet) string {
	var parts []string
	if st.Fields != nil {
		for _, f := range st.Fields.List {
			for _, name := range f.Names {
				if !name.IsExported() {
					continue
				}
				val, ok := synthValue(f.Type, name.Name)
				if !ok {
					continue // omit -> zero value
				}
				parts = append(parts, name.Name+": "+val)
			}
		}
	}
	return typeName + "{" + strings.Join(parts, ", ") + "}"
}

// synthValue returns a deterministic synthetic literal for a type and whether it
// could be synthesized. Unsupported types return ok=false so the caller omits
// the field (leaving its zero value).
func synthValue(expr ast.Expr, fieldName string) (string, bool) {
	id, ok := expr.(*ast.Ident)
	if !ok {
		return "", false
	}
	switch id.Name {
	case "string":
		return `"mock-` + strings.ToLower(fieldName) + `"`, true
	case "bool":
		return "false", true
	case "int", "int8", "int16", "int32", "int64",
		"uint", "uint8", "uint16", "uint32", "uint64", "byte", "rune", "uintptr":
		return "0", true
	case "float32", "float64":
		return "0", true
	case "error":
		return "nil", true
	default:
		return "", false
	}
}

// GenerateFixture returns a synthetic composite literal for a named struct found
// in a contract. Exposed for callers/tests that want fixtures independently of
// full mock generation. Returns "" if the type is not a known struct.
func GenerateFixture(contractSrc []byte, typeName string) (string, error) {
	structs, err := structTypes(contractSrc)
	if err != nil {
		return "", err
	}
	st, ok := structs[typeName]
	if !ok {
		return "", nil
	}
	return synthStructLiteral(typeName, st, newImportSet()), nil
}
