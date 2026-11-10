package models

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
)

// MARKER:FEATURE_STATUS_CONFIG Configurable, parameterized feature statuses.
//
// A project defines its own list of feature statuses in its settings. Each
// status has a name and up to three parameter *definitions* (a UI name and a
// type). The parameter *values* are entered per feature when it takes that
// status, and are stored on the feature in StatusParams as JSON.
//
// When a project has not configured any statuses, DefaultStatuses() stands in,
// which reproduces the old fixed todo / in_progress / done set so existing data
// stays valid.

// Limits keep a project's status list and its parameters sane and bounded.
const (
	MaxStatuses        = 12 // how many statuses a project may define
	MaxStatusParams    = 3  // parameters per status
	MaxStatusName      = 40 // characters in a status name
	MaxStatusParamName = 40 // characters in a parameter's UI name
)

// StatusParamType is the value type a status parameter accepts. Only strings
// and integers are allowed, so values round-trip cleanly through JSON.
type StatusParamType string

const (
	ParamTypeString  StatusParamType = "string"
	ParamTypeInteger StatusParamType = "integer"
)

// StatusParamDef defines one parameter of a status: how it reads in the UI
// (UIName), the JSON key its value is stored under (Key, derived from UIName),
// and the type its value must be.
type StatusParamDef struct {
	UIName string          `json:"ui_name"`
	Key    string          `json:"key"`
	Type   StatusParamType `json:"type"`
}

// StatusDef is one status a project offers, with its parameter definitions.
type StatusDef struct {
	Name   string           `json:"name"`
	Params []StatusParamDef `json:"params"`
}

// DefaultStatuses is the fixed set used when a project has defined none. It
// matches the statuses the application shipped with before they were
// configurable, so old features validate without a migration.
func DefaultStatuses() []StatusDef {
	return []StatusDef{
		{Name: "todo", Params: []StatusParamDef{}},
		{Name: "in_progress", Params: []StatusParamDef{}},
		{Name: "done", Params: []StatusParamDef{}},
	}
}

var slugNonWord = regexp.MustCompile(`[^a-z0-9]+`)

// SlugifyKey turns a UI name into a stable JSON key: lowercase, words joined by
// underscores, e.g. "Assigned To" -> "assigned_to".
func SlugifyKey(uiName string) string {
	s := slugNonWord.ReplaceAllString(strings.ToLower(strings.TrimSpace(uiName)), "_")
	return strings.Trim(s, "_")
}

// ParseStatuses reads the JSON stored in ProjectSettings.Statuses. An empty or
// unreadable value yields the defaults, so a caller always gets a usable list.
func ParseStatuses(stored string) []StatusDef {
	stored = strings.TrimSpace(stored)
	if stored == "" {
		return DefaultStatuses()
	}
	var defs []StatusDef
	if err := json.Unmarshal([]byte(stored), &defs); err != nil || len(defs) == 0 {
		return DefaultStatuses()
	}
	return defs
}

// MarshalStatuses serializes a validated status list for storage.
func MarshalStatuses(defs []StatusDef) (string, error) {
	b, err := json.Marshal(defs)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

// NormalizeAndValidateStatuses cleans a status list coming from the settings
// screen (trimming names, filling in each parameter's Key and defaulting its
// type) and checks it against the limits. It returns the cleaned list or an
// error naming the first problem found.
func NormalizeAndValidateStatuses(defs []StatusDef) ([]StatusDef, error) {
	if len(defs) == 0 {
		return nil, fmt.Errorf("define at least one status")
	}
	if len(defs) > MaxStatuses {
		return nil, fmt.Errorf("too many statuses: keep it to %d", MaxStatuses)
	}

	seen := map[string]bool{}
	out := make([]StatusDef, 0, len(defs))
	for _, d := range defs {
		name := strings.TrimSpace(d.Name)
		if name == "" {
			return nil, fmt.Errorf("a status needs a name")
		}
		if len(name) > MaxStatusName {
			return nil, fmt.Errorf("status name %q is too long", name)
		}
		key := SlugifyKey(name)
		if key == "" {
			return nil, fmt.Errorf("status name %q has no letters or digits", name)
		}
		if seen[key] {
			return nil, fmt.Errorf("duplicate status %q", name)
		}
		seen[key] = true

		if len(d.Params) > MaxStatusParams {
			return nil, fmt.Errorf("status %q has more than %d parameters", name, MaxStatusParams)
		}
		params := make([]StatusParamDef, 0, len(d.Params))
		paramSeen := map[string]bool{}
		for _, p := range d.Params {
			pName := strings.TrimSpace(p.UIName)
			if pName == "" {
				return nil, fmt.Errorf("a parameter of status %q needs a name", name)
			}
			if len(pName) > MaxStatusParamName {
				return nil, fmt.Errorf("parameter %q is too long", pName)
			}
			pKey := SlugifyKey(pName)
			if pKey == "" {
				return nil, fmt.Errorf("parameter %q has no letters or digits", pName)
			}
			if paramSeen[pKey] {
				return nil, fmt.Errorf("status %q has duplicate parameter %q", name, pName)
			}
			paramSeen[pKey] = true

			pType := p.Type
			if pType != ParamTypeString && pType != ParamTypeInteger {
				pType = ParamTypeString
			}
			params = append(params, StatusParamDef{UIName: pName, Key: pKey, Type: pType})
		}
		out = append(out, StatusDef{Name: name, Params: params})
	}
	return out, nil
}

// StatusAllowed reports whether value is one of the configured status names.
// The comparison is on the slug, so casing and spacing do not matter.
func StatusAllowed(defs []StatusDef, value string) bool {
	want := SlugifyKey(value)
	for _, d := range defs {
		if SlugifyKey(d.Name) == want {
			return true
		}
	}
	return false
}

// FindStatus returns the definition matching value (by slug), if any.
func FindStatus(defs []StatusDef, value string) (StatusDef, bool) {
	want := SlugifyKey(value)
	for _, d := range defs {
		if SlugifyKey(d.Name) == want {
			return d, true
		}
	}
	return StatusDef{}, false
}

// CoerceParamValues keeps only the parameters the given status defines, drops
// anything else (so switching status clears stale values), and coerces each
// value to the parameter's type. A string parameter takes the value as text; an
// integer parameter takes a whole number, rejecting anything that is not one.
// It returns the cleaned map ready to be stored as JSON.
func CoerceParamValues(def StatusDef, raw map[string]any) (map[string]any, error) {
	out := map[string]any{}
	for _, p := range def.Params {
		v, ok := raw[p.Key]
		if !ok || v == nil {
			continue
		}
		switch p.Type {
		case ParamTypeInteger:
			n, err := toInt(v)
			if err != nil {
				return nil, fmt.Errorf("%s must be a whole number", p.UIName)
			}
			out[p.Key] = n
		default:
			out[p.Key] = fmt.Sprintf("%v", stringValue(v))
		}
	}
	return out, nil
}

// MarshalStatusParams serializes per-feature parameter values. An empty map is
// stored as an empty string rather than "{}", so unset stays visibly unset.
func MarshalStatusParams(values map[string]any) (string, error) {
	if len(values) == 0 {
		return "", nil
	}
	b, err := json.Marshal(values)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

// ParseStatusParams reads stored per-feature parameter values.
func ParseStatusParams(stored string) map[string]any {
	stored = strings.TrimSpace(stored)
	if stored == "" {
		return map[string]any{}
	}
	var m map[string]any
	if err := json.Unmarshal([]byte(stored), &m); err != nil {
		return map[string]any{}
	}
	return m
}

func stringValue(v any) any {
	if f, ok := v.(float64); ok && f == float64(int64(f)) {
		return int64(f)
	}
	return v
}

func toInt(v any) (int64, error) {
	switch n := v.(type) {
	case float64:
		if n != float64(int64(n)) {
			return 0, fmt.Errorf("not a whole number")
		}
		return int64(n), nil
	case int:
		return int64(n), nil
	case int64:
		return n, nil
	case string:
		s := strings.TrimSpace(n)
		var out int64
		if _, err := fmt.Sscanf(s, "%d", &out); err != nil || fmt.Sprintf("%d", out) != s {
			return 0, fmt.Errorf("not a whole number")
		}
		return out, nil
	}
	return 0, fmt.Errorf("not a whole number")
}
