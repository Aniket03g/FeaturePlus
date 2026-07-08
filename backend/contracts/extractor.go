// Package contracts extracts stripped-down "contracts" from source files: the
// public shape (signatures, types, exported struct fields, doc comments) with
// implementation bodies and unexported details removed. A contract is what a
// scoped collaborator sees for a dependency they may call but not read.
//
// The Go extractor uses go/ast so the boundary between a signature and a body
// is exact — no regex guessing. This mirrors what godoc / .d.ts / .pyi stub
// generation already do, but with a confidentiality goal rather than docs.
package contracts

import (
	"bytes"
	"fmt"
	"go/ast"
	"go/parser"
	"go/printer"
	"go/token"
	"strings"
)

// ExtractGoContract parses Go source and returns its public contract: the
// package clause, exported type declarations (structs keep only exported
// fields), exported const/var declarations (values kept for consts, stripped
// for vars), and exported function/method signatures with bodies removed. Doc
// comments on kept declarations are preserved.
//
// Unexported declarations, unexported struct fields, and all function bodies
// are dropped.
func ExtractGoContract(filename string, src []byte) (string, error) {
	fset := token.NewFileSet()
	file, err := parser.ParseFile(fset, filename, src, parser.ParseComments)
	if err != nil {
		return "", fmt.Errorf("parse %s: %w", filename, err)
	}

	var out bytes.Buffer
	out.WriteString("package ")
	out.WriteString(file.Name.Name)
	out.WriteString("\n")

	pcfg := &printer.Config{Mode: printer.UseSpaces | printer.TabIndent, Tabwidth: 4}

	for _, decl := range file.Decls {
		doc, rendered, ok := renderDecl(fset, pcfg, decl)
		if !ok {
			continue
		}
		out.WriteString("\n")
		if doc != "" {
			out.WriteString(doc)
			out.WriteString("\n")
		}
		out.WriteString(rendered)
		out.WriteString("\n")
	}

	return out.String(), nil
}

// docText renders a doc comment group back to `// ...` lines. Handling doc
// comments ourselves (rather than leaving them on the AST nodes) avoids the
// printer misplacing them when a node's original source positions no longer
// match its stripped shape.
func docText(doc *ast.CommentGroup) string {
	if doc == nil {
		return ""
	}
	var b strings.Builder
	for i, c := range doc.List {
		if i > 0 {
			b.WriteString("\n")
		}
		b.WriteString(c.Text)
	}
	return b.String()
}

// renderDecl returns the doc comment text, the contract body text for a single
// top-level declaration, and whether it should be included at all.
func renderDecl(fset *token.FileSet, pcfg *printer.Config, decl ast.Decl) (string, string, bool) {
	switch d := decl.(type) {
	case *ast.FuncDecl:
		return renderFunc(fset, pcfg, d)
	case *ast.GenDecl:
		return renderGenDecl(fset, pcfg, d)
	default:
		return "", "", false
	}
}

// renderFunc strips a function/method body and keeps the exported signature.
// Methods are kept only when both the method name and its receiver type are
// exported (an unexported receiver type is itself private).
func renderFunc(fset *token.FileSet, pcfg *printer.Config, fn *ast.FuncDecl) (string, string, bool) {
	if fn.Name == nil || !fn.Name.IsExported() {
		return "", "", false
	}
	if fn.Recv != nil && !exportedReceiver(fn.Recv) {
		return "", "", false
	}

	// Clone the decl shell without a body (so the printer emits just the
	// signature) and without Doc (rendered separately for correct placement).
	stripped := &ast.FuncDecl{
		Recv: fn.Recv,
		Name: fn.Name,
		Type: fn.Type,
		Body: nil,
	}
	body, ok := printNode(fset, pcfg, stripped)
	return docText(fn.Doc), body, ok
}

// exportedReceiver reports whether a method receiver's base type is exported.
func exportedReceiver(recv *ast.FieldList) bool {
	if recv == nil || len(recv.List) == 0 {
		return false
	}
	return exportedTypeExpr(recv.List[0].Type)
}

// exportedTypeExpr peels pointer/type wrappers to find whether the named base
// type is exported.
func exportedTypeExpr(expr ast.Expr) bool {
	switch t := expr.(type) {
	case *ast.StarExpr:
		return exportedTypeExpr(t.X)
	case *ast.Ident:
		return t.IsExported()
	case *ast.IndexExpr: // generic receiver e.g. List[T]
		return exportedTypeExpr(t.X)
	case *ast.IndexListExpr:
		return exportedTypeExpr(t.X)
	default:
		return false
	}
}

// renderGenDecl handles type/const/var/import blocks, keeping only the exported
// specs and, for structs, only exported fields.
func renderGenDecl(fset *token.FileSet, pcfg *printer.Config, gd *ast.GenDecl) (string, string, bool) {
	switch gd.Tok {
	case token.IMPORT:
		// Imports are implementation detail of the body we just removed; drop.
		return "", "", false
	case token.TYPE, token.CONST, token.VAR:
		// handled below
	default:
		return "", "", false
	}

	kept := make([]ast.Spec, 0, len(gd.Specs))
	for _, spec := range gd.Specs {
		switch s := spec.(type) {
		case *ast.TypeSpec:
			if !s.Name.IsExported() {
				continue
			}
			kept = append(kept, stripTypeSpec(s))
		case *ast.ValueSpec:
			vs := stripValueSpec(s, gd.Tok)
			if vs != nil {
				kept = append(kept, vs)
			}
		}
	}
	if len(kept) == 0 {
		return "", "", false
	}

	// Resolve the doc comment: prefer the decl-level doc, else a lone spec's doc.
	doc := gd.Doc
	if doc == nil && len(kept) == 1 {
		switch s := kept[0].(type) {
		case *ast.TypeSpec:
			doc = s.Doc
			s.Doc = nil
		case *ast.ValueSpec:
			doc = s.Doc
			s.Doc = nil
		}
	}

	stripped := &ast.GenDecl{
		Tok:    gd.Tok,
		Lparen: gd.Lparen,
		Specs:  kept,
		Rparen: gd.Rparen,
	}
	// A single kept spec reads better without the parenthesized group.
	if len(kept) == 1 {
		stripped.Lparen = token.NoPos
		stripped.Rparen = token.NoPos
	}
	body, ok := printNode(fset, pcfg, stripped)
	return docText(doc), body, ok
}

// stripTypeSpec, for struct types, removes unexported fields and notes that
// they were omitted. Non-struct exported types (interfaces, aliases) are kept
// as-is since their public shape is the whole point.
func stripTypeSpec(s *ast.TypeSpec) *ast.TypeSpec {
	st, ok := s.Type.(*ast.StructType)
	if !ok {
		return s
	}
	if st.Fields == nil {
		return s
	}

	keptFields := make([]*ast.Field, 0, len(st.Fields.List))
	dropped := false
	for _, f := range st.Fields.List {
		if fieldExported(f) {
			keptFields = append(keptFields, f)
		} else {
			dropped = true
		}
	}
	if dropped {
		// Add a marker comment field so the omission is visible.
		keptFields = append(keptFields, &ast.Field{
			Type: &ast.Ident{Name: "// unexported fields omitted"},
		})
	}

	newStruct := &ast.StructType{
		Struct: st.Struct,
		Fields: &ast.FieldList{
			Opening: st.Fields.Opening,
			List:    keptFields,
			Closing: st.Fields.Closing,
		},
		Incomplete: st.Incomplete,
	}
	return &ast.TypeSpec{
		Doc:        s.Doc,
		Name:       s.Name,
		TypeParams: s.TypeParams,
		Assign:     s.Assign,
		Type:       newStruct,
		Comment:    s.Comment,
	}
}

// fieldExported reports whether a struct field belongs in the contract. A named
// field is kept if any of its names is exported; an embedded field is kept if
// its type is exported.
func fieldExported(f *ast.Field) bool {
	if len(f.Names) == 0 { // embedded
		return exportedTypeExpr(f.Type)
	}
	for _, n := range f.Names {
		if n.IsExported() {
			return true
		}
	}
	return false
}

// stripValueSpec keeps exported const/var names. Const values are part of the
// public API (enum values a caller compares against) and are kept; var values
// are implementation and are stripped, leaving only name and type.
func stripValueSpec(s *ast.ValueSpec, tok token.Token) *ast.ValueSpec {
	exportedNames := make([]*ast.Ident, 0, len(s.Names))
	for _, n := range s.Names {
		if n.IsExported() {
			exportedNames = append(exportedNames, n)
		}
	}
	if len(exportedNames) == 0 {
		return nil
	}
	// Keep values when they are part of the observable API or when required for
	// validity:
	//   - const values are API (enum values callers compare against), and
	//   - a var with no explicit type would be invalid Go without its value,
	//     so we keep the initializer (typically a sentinel like errors.New).
	// A var that has an explicit type keeps only the type (value stripped).
	// Only safe when every name was exported and name/value counts line up.
	aligned := len(exportedNames) == len(s.Names) && len(s.Values) == len(s.Names)
	keepValues := aligned && (tok == token.CONST || s.Type == nil)

	out := &ast.ValueSpec{
		Doc:     s.Doc,
		Names:   exportedNames,
		Type:    s.Type,
		Comment: s.Comment,
	}
	if keepValues {
		out.Values = s.Values
	}
	return out
}

// printNode renders a single AST node to Go source. Because stripped nodes
// carry original file positions, we print into a buffer and normalize leading
// indentation the printer may introduce.
func printNode(fset *token.FileSet, pcfg *printer.Config, node ast.Node) (string, bool) {
	var buf bytes.Buffer
	if err := pcfg.Fprint(&buf, fset, node); err != nil {
		return "", false
	}
	return strings.TrimRight(buf.String(), "\n"), true
}
