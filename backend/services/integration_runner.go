package services

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// CommandRunner executes a command in a directory and returns its combined
// output and exit code. Injecting it keeps the integration runner testable
// without invoking a real toolchain.
type CommandRunner interface {
	Run(dir string, name string, args ...string) (output string, exitCode int)
}

// ExecCommandRunner runs commands with os/exec.
type ExecCommandRunner struct{}

// Run executes name+args in dir, returning combined output and exit code.
func (ExecCommandRunner) Run(dir, name string, args ...string) (string, int) {
	cmd := exec.Command(name, args...)
	cmd.Dir = dir
	out, err := cmd.CombinedOutput()
	code := 0
	if err != nil {
		if ee, ok := err.(*exec.ExitError); ok {
			code = ee.ExitCode()
		} else {
			code = 1
		}
	}
	return string(out), code
}

// IntegrationRunner is the privileged job that verifies a scoped collaborator's
// branch against the REAL dependency code. It runs with full repo access —
// something the collaborator never has — so its raw output must be redacted
// before being returned to them (see Redact).
type IntegrationRunner struct {
	runner CommandRunner
}

// NewIntegrationRunner builds a runner backed by the real command executor.
func NewIntegrationRunner() *IntegrationRunner {
	return &IntegrationRunner{runner: ExecCommandRunner{}}
}

// SetRunner overrides the command runner (used in tests).
func (r *IntegrationRunner) SetRunner(cr CommandRunner) {
	r.runner = cr
}

// RunResult is the raw, privileged result of an integration run. It may contain
// real file paths and internal error detail and must NOT be handed to a scoped
// collaborator directly.
type RunResult struct {
	Passed       bool
	ExitCode     int
	RawOutput    string
	SwappedFiles []string // paths (relative to workDir) replaced with real source
}

// RunIntegration swaps the collaborator's mocks for the real dependency source
// and runs the integration command.
//
// workDir is a checkout of the collaborator's branch. realFiles maps a path
// (relative to workDir, i.e. the mock the collaborator built against) to the
// real source content that must replace it before the real integration test
// runs. testCmd is the command to run (e.g. ["go","test","./..."]).
func (r *IntegrationRunner) RunIntegration(workDir string, realFiles map[string]string, testCmd []string) (RunResult, error) {
	swapped := make([]string, 0, len(realFiles))
	for rel, content := range realFiles {
		dest := filepath.Join(workDir, filepath.FromSlash(rel))
		if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
			return RunResult{}, err
		}
		if err := os.WriteFile(dest, []byte(content), 0o644); err != nil {
			return RunResult{}, err
		}
		swapped = append(swapped, rel)
	}

	name := "go"
	var args []string
	if len(testCmd) > 0 {
		name = testCmd[0]
		args = testCmd[1:]
	} else {
		args = []string{"test", "./..."}
	}

	output, code := r.runner.Run(workDir, name, args...)
	return RunResult{
		Passed:       code == 0,
		ExitCode:     code,
		RawOutput:    output,
		SwappedFiles: swapped,
	}, nil
}

// summarizeTestFailures pulls out Go test failure lines ("--- FAIL: ...") for
// use by the redactor. Kept here so the runner owns the raw parsing; the
// redactor decides what is safe to expose.
func summarizeTestFailures(raw string) []string {
	var lines []string
	for _, line := range strings.Split(raw, "\n") {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "--- FAIL") || strings.Contains(trimmed, "FAIL:") {
			lines = append(lines, trimmed)
		}
	}
	return lines
}
