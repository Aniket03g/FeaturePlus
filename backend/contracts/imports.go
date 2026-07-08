package contracts

import (
	"go/ast"
	"go/parser"
	"go/token"
	"sort"
	"strings"
)

// importSet accumulates the package short-names referenced by re-emitted
// declarations so a correct import block can be generated for the mock.
type importSet struct {
	names map[string]bool
}

func newImportSet() *importSet {
	return &importSet{names: map[string]bool{}}
}

// stdImportPath maps common standard-library short names to their import paths.
// For any name not listed, the short name itself is used as the path, which is
// correct for single-segment stdlib packages (errors, time, fmt, io, ...).
var stdImportPath = map[string]string{
	"errors":  "errors",
	"time":    "time",
	"fmt":     "fmt",
	"io":      "io",
	"context": "context",
	"sync":    "sync",
	"bytes":   "bytes",
	"sql":     "database/sql",
	"json":    "encoding/json",
	"http":    "net/http",
	"url":     "net/url",
	"big":     "math/big",
}

// add records a referenced package short-name.
func (s *importSet) add(name string) {
	if name == "" {
		return
	}
	s.names[name] = true
}

// render returns a formatted import block, or "" if none are needed.
func (s *importSet) render() string {
	if len(s.names) == 0 {
		return ""
	}
	paths := make([]string, 0, len(s.names))
	for name := range s.names {
		path, ok := stdImportPath[name]
		if !ok {
			path = name
		}
		paths = append(paths, path)
	}
	sort.Strings(paths)

	if len(paths) == 1 {
		return "import \"" + paths[0] + "\"\n"
	}
	var b strings.Builder
	b.WriteString("import (\n")
	for _, p := range paths {
		b.WriteString("\t\"")
		b.WriteString(p)
		b.WriteString("\"\n")
	}
	b.WriteString(")\n")
	return b.String()
}

// collectImports walks a node and records any package short-names used in
// selector expressions (pkg.Symbol), so declarations that reference them can be
// compiled in the mock.
func collectImports(node ast.Node, imports *importSet) {
	ast.Inspect(node, func(n ast.Node) bool {
		if sel, ok := n.(*ast.SelectorExpr); ok {
			if pkg, ok := sel.X.(*ast.Ident); ok && pkg.Obj == nil {
				// Heuristic: an Ident with no resolved object in a selector is a
				// package qualifier (lowercase, not a local var here).
				if pkg.Name != "" && strings.ToLower(pkg.Name[:1]) == pkg.Name[:1] {
					imports.add(pkg.Name)
				}
			}
		}
		return true
	})
}

// injectImports inserts an import block immediately after the package clause.
func injectImports(src, importBlock string) string {
	lines := strings.SplitN(src, "\n", -1)
	for i, line := range lines {
		if strings.HasPrefix(line, "package ") {
			// Insert after the package line (and a blank line for readability).
			head := strings.Join(lines[:i+1], "\n")
			tail := strings.Join(lines[i+1:], "\n")
			return head + "\n\n" + importBlock + tail
		}
	}
	return src
}

// structTypes parses a contract and returns its struct type definitions by name.
func structTypes(contractSrc []byte) (map[string]*ast.StructType, error) {
	fset := token.NewFileSet()
	file, err := parser.ParseFile(fset, "contract.go", contractSrc, parser.ParseComments)
	if err != nil {
		return nil, err
	}
	structs := map[string]*ast.StructType{}
	for _, decl := range file.Decls {
		gd, ok := decl.(*ast.GenDecl)
		if !ok || gd.Tok != token.TYPE {
			continue
		}
		for _, spec := range gd.Specs {
			if ts, ok := spec.(*ast.TypeSpec); ok {
				if st, ok := ts.Type.(*ast.StructType); ok {
					structs[ts.Name.Name] = st
				}
			}
		}
	}
	return structs, nil
}
