package models

import "testing"

func TestParseStatusesDefaults(t *testing.T) {
	if got := ParseStatuses(""); len(got) != 3 || got[0].Name != "todo" {
		t.Fatalf("empty should give defaults, got %+v", got)
	}
	if got := ParseStatuses("not json"); len(got) != 3 {
		t.Fatalf("bad json should fall back to defaults, got %+v", got)
	}
}

func TestNormalizeAndValidateStatuses(t *testing.T) {
	in := []StatusDef{
		{Name: "  To Do ", Params: []StatusParamDef{}},
		{Name: "In Progress", Params: []StatusParamDef{
			{UIName: "Assignee", Type: ParamTypeString},
			{UIName: "Hours", Type: ParamTypeInteger},
		}},
	}
	out, err := NormalizeAndValidateStatuses(in)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if out[0].Name != "To Do" {
		t.Errorf("name not trimmed: %q", out[0].Name)
	}
	if out[1].Params[0].Key != "assignee" || out[1].Params[1].Key != "hours" {
		t.Errorf("keys not slugified: %+v", out[1].Params)
	}

	// Duplicate names (by slug) are rejected.
	if _, err := NormalizeAndValidateStatuses([]StatusDef{{Name: "todo"}, {Name: "ToDo"}}); err == nil {
		t.Error("expected duplicate status error")
	}
	// More than three parameters is rejected.
	four := []StatusParamDef{{UIName: "a"}, {UIName: "b"}, {UIName: "c"}, {UIName: "d"}}
	if _, err := NormalizeAndValidateStatuses([]StatusDef{{Name: "x", Params: four}}); err == nil {
		t.Error("expected too-many-params error")
	}
}

func TestCoerceParamValues(t *testing.T) {
	def := StatusDef{Name: "in_progress", Params: []StatusParamDef{
		{UIName: "Assignee", Key: "assignee", Type: ParamTypeString},
		{UIName: "Hours", Key: "hours", Type: ParamTypeInteger},
	}}

	// Strings pass through; integers accept numeric strings; unknown keys drop.
	out, err := CoerceParamValues(def, map[string]any{"assignee": "Vinod", "hours": "8", "junk": "x"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if out["assignee"] != "Vinod" {
		t.Errorf("assignee = %v", out["assignee"])
	}
	if out["hours"] != int64(8) {
		t.Errorf("hours = %v (%T), want int64(8)", out["hours"], out["hours"])
	}
	if _, ok := out["junk"]; ok {
		t.Error("unknown key should be dropped")
	}

	// A non-numeric integer value is an error.
	if _, err := CoerceParamValues(def, map[string]any{"hours": "abc"}); err == nil {
		t.Error("expected integer coercion error")
	}
}

func TestStatusAllowed(t *testing.T) {
	defs := DefaultStatuses()
	if !StatusAllowed(defs, "In Progress") { // slug match, case/space-insensitive
		t.Error("In Progress should match in_progress")
	}
	if StatusAllowed(defs, "nope") {
		t.Error("unknown status should not be allowed")
	}
}
