package contracts

import (
	"bytes"
	"fmt"
	"go/ast"
	"go/parser"
	"go/printer"
	"go/token"
	"sort"
	"strings"
)

// GenerateMock turns a contract (the stripped, valid-Go public shape) into a
// compilable mock package: the same types and sentinel errors, plus fake
// function bodies that return deterministic synthetic values. A contract-scope
// collaborator builds and tests against this instead of the real dependency —
// no access to the real code or its data.
//
// Function bodies use named return values so a bare `return` always yields
// valid zero values (the mock always compiles). Functions that take a string
// and return an error also dispatch on magic inputs to return each sentinel
// error the contract declares, so callers can exercise every documented error
// case.
func GenerateMock(filename string, contractSrc []byte) (string, error) {
	fset := token.NewFileSet()
	file, err := parser.ParseFile(fset, filename, contractSrc, parser.ParseComments)
	if err != nil {
		return "", fmt.Errorf("parse contract %s: %w", filename, err)
	}

	pcfg := &printer.Config{Mode: printer.UseSpaces | printer.TabIndent, Tabwidth: 4}

	// Collect struct types (for happy-path fixtures) and sentinel error vars.
	structs := map[string]*ast.StructType{}
	var sentinels []string
	for _, decl := range file.Decls {
		gd, ok := decl.(*ast.GenDecl)
		if !ok {
			continue
		}
		for _, spec := range gd.Specs {
			switch s := spec.(type) {
			case *ast.TypeSpec:
				if st, ok := s.Type.(*ast.StructType); ok {
					structs[s.Name.Name] = st
				}
			case *ast.ValueSpec:
				if gd.Tok == token.VAR {
					for _, n := range s.Names {
						if n.IsExported() && strings.HasPrefix(n.Name, "Err") {
							sentinels = append(sentinels, n.Name)
						}
					}
				}
			}
		}
	}
	sort.Strings(sentinels)

	var out bytes.Buffer
	out.WriteString("// Code generated from contract by FeaturePlus Scoped Contracts. DO NOT EDIT.\n")
	out.WriteString("// This is a MOCK: synthetic behavior only, never the real implementation.\n")
	out.WriteString("package ")
	out.WriteString(file.Name.Name)
	out.WriteString("\n")

	imports := newImportSet()

	// Re-emit type and var declarations (types + sentinel errors) verbatim.
	for _, decl := range file.Decls {
		gd, ok := decl.(*ast.GenDecl)
		if !ok || (gd.Tok != token.TYPE && gd.Tok != token.VAR && gd.Tok != token.CONST) {
			continue
		}
		collectImports(gd, imports)
		txt, _ := printNode(fset, pcfg, gd)
		out.WriteString("\n")
		out.WriteString(txt)
		out.WriteString("\n")
	}

	// Generate a mock body for each function.
	for _, decl := range file.Decls {
		fn, ok := decl.(*ast.FuncDecl)
		if !ok {
			continue
		}
		collectImports(fn.Type, imports)
		mock := generateFuncMock(fset, pcfg, fn, structs, sentinels)
		out.WriteString("\n")
		out.WriteString(mock)
		out.WriteString("\n")
	}

	// Prepend imports if any were needed.
	final := out.String()
	if imp := imports.render(); imp != "" {
		final = injectImports(final, imp)
	}
	return final, nil
}

// generateFuncMock builds one mock function: named results + optional sentinel
// dispatch + synthetic happy-path values.
func generateFuncMock(fset *token.FileSet, pcfg *printer.Config, fn *ast.FuncDecl, structs map[string]*ast.StructType, sentinels []string) string {
	// Name every result so a bare return yields zero values.
	results := nameResults(fn.Type.Results)
	sig := &ast.FuncDecl{
		Recv: fn.Recv,
		Name: fn.Name,
		Type: &ast.FuncType{
			TypeParams: fn.Type.TypeParams,
			Params:     fn.Type.Params,
			Results:    results,
		},
	}
	sigText, _ := printNode(fset, pcfg, sig)

	var body strings.Builder
	body.WriteString(sigText)
	body.WriteString(" {\n")

	errName := errorResultName(results)
	strParam := firstStringParam(fn.Type.Params)

	// Sentinel dispatch: magic inputs -> declared errors.
	if errName != "" && strParam != "" && len(sentinels) > 0 {
		body.WriteString("\tswitch ")
		body.WriteString(strParam)
		body.WriteString(" {\n")
		for _, s := range sentinels {
			body.WriteString("\tcase \"")
			body.WriteString(sentinelSlug(s))
			body.WriteString("\":\n\t\t")
			body.WriteString(errName)
			body.WriteString(" = ")
			body.WriteString(s)
			body.WriteString("\n\t\treturn\n")
		}
		body.WriteString("\t}\n")
	}

	// Happy path: fill pointer-to-struct results with a synthetic fixture.
	for _, r := range namedResultList(results) {
		if star, ok := r.typ.(*ast.StarExpr); ok {
			if id, ok := star.X.(*ast.Ident); ok {
				if st, known := structs[id.Name]; known {
					fixture := synthStructLiteral(id.Name, st, structs)
					body.WriteString("\t")
					body.WriteString(r.name)
					body.WriteString(" = &")
					body.WriteString(fixture)
					body.WriteString("\n")
				}
			}
		}
	}

	body.WriteString("\treturn\n}")
	return body.String()
}

// namedResult pairs a generated result name with its type.
type namedResult struct {
	name string
	typ  ast.Expr
}

// nameResults returns a copy of a result FieldList where every result has a
// single generated name (r0, r1, ...), preserving order and types.
func nameResults(results *ast.FieldList) *ast.FieldList {
	if results == nil {
		return nil
	}
	var fields []*ast.Field
	i := 0
	for _, f := range results.List {
		count := len(f.Names)
		if count == 0 {
			count = 1
		}
		for j := 0; j < count; j++ {
			fields = append(fields, &ast.Field{
				Names: []*ast.Ident{{Name: fmt.Sprintf("r%d", i)}},
				Type:  f.Type,
			})
			i++
		}
	}
	return &ast.FieldList{List: fields}
}

// namedResultList flattens a named result FieldList into name/type pairs.
func namedResultList(results *ast.FieldList) []namedResult {
	if results == nil {
		return nil
	}
	var out []namedResult
	for _, f := range results.List {
		for _, n := range f.Names {
			out = append(out, namedResult{name: n.Name, typ: f.Type})
		}
	}
	return out
}

// errorResultName returns the generated name of the (first) error result, or "".
func errorResultName(results *ast.FieldList) string {
	for _, r := range namedResultList(results) {
		if id, ok := r.typ.(*ast.Ident); ok && id.Name == "error" {
			return r.name
		}
	}
	return ""
}

// firstStringParam returns the name of the first string parameter, or "".
func firstStringParam(params *ast.FieldList) string {
	if params == nil {
		return ""
	}
	for _, f := range params.List {
		if id, ok := f.Type.(*ast.Ident); ok && id.Name == "string" {
			if len(f.Names) > 0 {
				return f.Names[0].Name
			}
		}
	}
	return ""
}

// sentinelSlug turns a sentinel error name into a magic input string, e.g.
// ErrTrailNotFound -> "trail-not-found".
func sentinelSlug(name string) string {
	name = strings.TrimPrefix(name, "Err")
	var b strings.Builder
	for i, r := range name {
		if i > 0 && r >= 'A' && r <= 'Z' {
			b.WriteByte('-')
		}
		if r >= 'A' && r <= 'Z' {
			r = r + ('a' - 'A')
		}
		b.WriteRune(r)
	}
	return b.String()
}
