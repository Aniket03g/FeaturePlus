package services

import (
	"regexp"
	"strings"
)

// RedactedResult is the ONLY integration output a scoped collaborator may see.
// It reports pass/fail and a small number of sanitized failure hints, never the
// real file contents, diffs, paths, or internal error detail.
type RedactedResult struct {
	Passed  bool     `json:"passed"`
	Summary string   `json:"summary"`
	Hints   []string `json:"hints,omitempty"`
}

var (
	// goFileRef matches file:line references like trail_service.go:42.
	goFileRef = regexp.MustCompile(`[\w./\\-]+\.go:\d+`)
	// pathLike matches path-ish tokens (two+ segments with a separator).
	pathLike = regexp.MustCompile(`[\w.\-]+[\\/][\w.\-\\/]+`)
	// assertionLine matches conventional "expected/want ... got ..." assertions,
	// which are safe to surface (they reference the contract, not internals).
	assertionLine = regexp.MustCompile(`(?i)(expected|want).*got`)
	// maxHints caps how much detail leaves the trusted boundary.
	maxHints = 5
)

// Redact converts a raw privileged RunResult into a RedactedResult safe to
// return to a scoped collaborator. It drops all raw output and constructs a
// generic summary plus a few sanitized failure hints. `secrets` are additional
// strings (real file paths, internal symbols, repo root) that must never appear
// in the output.
func Redact(raw RunResult, secrets []string) RedactedResult {
	res := RedactedResult{Passed: raw.Passed}
	if raw.Passed {
		res.Summary = "Integration tests passed against the real dependency."
		return res
	}
	res.Summary = "Integration tests failed against the real dependency."

	// Always treat swapped file paths as secrets.
	allSecrets := append([]string{}, secrets...)
	allSecrets = append(allSecrets, raw.SwappedFiles...)

	seen := map[string]bool{}
	for _, line := range summarizeTestFailures(raw.RawOutput) {
		hint := sanitizeLine(line, allSecrets)
		if hint == "" || seen[hint] {
			continue
		}
		seen[hint] = true
		res.Hints = append(res.Hints, hint)
		if len(res.Hints) >= maxHints {
			break
		}
	}

	// Also surface a couple of assertion lines from the raw output, sanitized.
	for _, line := range strings.Split(raw.RawOutput, "\n") {
		if len(res.Hints) >= maxHints {
			break
		}
		if !assertionLine.MatchString(line) {
			continue
		}
		hint := sanitizeLine(line, allSecrets)
		if hint == "" || seen[hint] {
			continue
		}
		seen[hint] = true
		res.Hints = append(res.Hints, hint)
	}

	return res
}

// sanitizeLine strips file references, path-like tokens, and any known secret
// substrings from a line. If the line still contains a secret after stripping
// (defense in depth), it is dropped entirely by returning "".
func sanitizeLine(line string, secrets []string) string {
	s := strings.TrimSpace(line)
	// Remove explicit secrets first.
	for _, sec := range secrets {
		if sec == "" {
			continue
		}
		s = strings.ReplaceAll(s, sec, "")
		// Also strip the base name of a path-style secret.
		if base := lastSegment(sec); base != "" && base != sec {
			s = strings.ReplaceAll(s, base, "")
		}
	}
	// Remove file:line references and path-like tokens.
	s = goFileRef.ReplaceAllString(s, "")
	s = pathLike.ReplaceAllString(s, "")
	// Collapse whitespace left behind.
	s = strings.Join(strings.Fields(s), " ")

	// Defense in depth: if any secret still survives, drop the whole line.
	for _, sec := range secrets {
		if sec != "" && strings.Contains(s, sec) {
			return ""
		}
	}
	if s == "" || s == "---" {
		return ""
	}
	return s
}

// lastSegment returns the final path segment of a path-like string.
func lastSegment(p string) string {
	p = strings.ReplaceAll(p, "\\", "/")
	if i := strings.LastIndex(p, "/"); i >= 0 {
		return p[i+1:]
	}
	return p
}
