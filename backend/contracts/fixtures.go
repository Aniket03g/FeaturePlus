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
func synthStructLiteral(typeName string, st *ast.StructType, structs map[string]*ast.StructType) string {
	return synthStructLiteralDepth(typeName, st, structs, 0)
}

// maxFixtureDepth bounds recursion so a self-referential or deeply nested struct
// can't produce an unbounded (or cyclic) fixture.
const maxFixtureDepth = 4

func synthStructLiteralDepth(typeName string, st *ast.StructType, structs map[string]*ast.StructType, depth int) string {
	var parts []string
	if st.Fields != nil {
		for _, f := range st.Fields.List {
			for _, name := range f.Names {
				if !name.IsExported() {
					continue
				}
				val, ok := synthValue(f.Type, name.Name, structs, depth)
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
// could be synthesized. It recurses into known struct types and fills slices
// with a single synthetic element. Unsupported types return ok=false so the
// caller omits the field (leaving its zero value), keeping the mock compilable.
//
// Every value is derived from the type and field name — never sampled from real
// or production data.
func synthValue(expr ast.Expr, fieldName string, structs map[string]*ast.StructType, depth int) (string, bool) {
	switch t := expr.(type) {
	case *ast.Ident:
		switch t.Name {
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
			// A named struct in the same contract -> recurse.
			if st, ok := structs[t.Name]; ok && depth < maxFixtureDepth {
				return synthStructLiteralDepth(t.Name, st, structs, depth+1), true
			}
			return "", false
		}
	case *ast.ArrayType:
		// Slice/array: emit a one-element literal when the element is synthesizable.
		if t.Len != nil {
			return "", false // fixed-size arrays: leave zero to avoid length mismatch
		}
		elem, ok := synthValue(t.Elt, fieldName, structs, depth+1)
		if !ok {
			return "", false
		}
		typeStr, ok := typeString(t.Elt, structs)
		if !ok {
			return "", false
		}
		return "[]" + typeStr + "{" + elem + "}", true
	case *ast.StarExpr:
		// Pointer to a known struct -> &Fixture{}.
		if id, ok := t.X.(*ast.Ident); ok {
			if st, known := structs[id.Name]; known && depth < maxFixtureDepth {
				return "&" + synthStructLiteralDepth(id.Name, st, structs, depth+1), true
			}
		}
		return "", false
	default:
		return "", false
	}
}

// typeString renders a simple element type back to source for use in a slice
// literal. Only the shapes synthValue can fill are supported.
func typeString(expr ast.Expr, structs map[string]*ast.StructType) (string, bool) {
	switch t := expr.(type) {
	case *ast.Ident:
		return t.Name, true
	case *ast.StarExpr:
		if inner, ok := typeString(t.X, structs); ok {
			return "*" + inner, true
		}
	}
	return "", false
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
	return synthStructLiteral(typeName, st, structs), nil
}
