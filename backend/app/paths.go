package app

import (
	"os"
	"path/filepath"
	"runtime"
)

// Resource and data locations are resolved here rather than assumed to sit in
// the working directory. A server started with `go run .` has its working
// directory inside backend/; a double-clicked desktop executable has whatever
// directory the user happened to launch it from. Everything that used to be a
// "./templates" style path resolves through these helpers instead.

// executableDir returns the directory holding the running binary. It falls back
// to the working directory when the executable path cannot be determined, which
// is rare but not worth crashing over.
func executableDir() string {
	exe, err := os.Executable()
	if err != nil {
		if wd, wdErr := os.Getwd(); wdErr == nil {
			return wd
		}
		return "."
	}
	if resolved, err := filepath.EvalSymlinks(exe); err == nil {
		exe = resolved
	}
	return filepath.Dir(exe)
}

// looksLikeResourceDir reports whether dir holds the assets the server serves.
// The templates directory is the marker: without it the HTML routes cannot
// render at all, so it is the one thing whose absence must be detected early.
func looksLikeResourceDir(dir string) bool {
	info, err := os.Stat(filepath.Join(dir, "templates"))
	return err == nil && info.IsDir()
}

// ResolveResourceDir finds the directory containing templates/ and static/.
//
// Search order:
//  1. FP_RESOURCE_DIR, when set — the explicit override, used by Docker and by
//     anyone running the binary from an unusual location.
//  2. The directory holding the executable, then its parent. A packaged desktop
//     app ships its assets next to the binary.
//  3. The working directory, then its parent. This is the `go run .` case, and
//     the parent covers running from backend/cmd/<something>.
//
// When nothing matches, the working directory is returned so the caller fails
// with a clear "template not found" rather than a confusing empty path.
func ResolveResourceDir() string {
	if dir := os.Getenv("FP_RESOURCE_DIR"); dir != "" {
		if abs, err := filepath.Abs(dir); err == nil {
			return abs
		}
		return dir
	}

	candidates := []string{}
	if exeDir := executableDir(); exeDir != "" {
		candidates = append(candidates, exeDir, filepath.Dir(exeDir))
	}
	if wd, err := os.Getwd(); err == nil {
		candidates = append(candidates, wd, filepath.Dir(wd))
	}

	for _, dir := range candidates {
		if looksLikeResourceDir(dir) {
			return dir
		}
	}

	if wd, err := os.Getwd(); err == nil {
		return wd
	}
	return "."
}

// ResolveDataDir returns the directory for files the application writes:
// the database, uploads, and the templates/guidance JSON.
//
// In server mode this stays beside the resources, matching current behaviour.
// In desktop mode it moves to the per-user location the operating system
// expects, because a desktop application must not write into its own install
// directory — on Windows that is often Program Files, which is read-only for a
// non-elevated user.
func ResolveDataDir(mode Mode, resourceDir string) string {
	if dir := os.Getenv("DATA_PATH"); dir != "" {
		if abs, err := filepath.Abs(dir); err == nil {
			return abs
		}
		return dir
	}

	if mode == ModeDesktop {
		if dir := userDataDir(); dir != "" {
			return filepath.Join(dir, appDirName)
		}
	}

	return filepath.Join(resourceDir, "data")
}

// appDirName is the folder created inside the per-user data location.
const appDirName = "FeaturePlus"

// userDataDir returns the platform's per-user application data directory:
// %APPDATA% on Windows, ~/Library/Application Support on macOS, and
// $XDG_DATA_HOME (or ~/.local/share) elsewhere. An empty string means no
// suitable location was found and the caller should fall back.
func userDataDir() string {
	switch runtime.GOOS {
	case "windows":
		if dir := os.Getenv("APPDATA"); dir != "" {
			return dir
		}
	case "darwin":
		if home, err := os.UserHomeDir(); err == nil {
			return filepath.Join(home, "Library", "Application Support")
		}
	default:
		if dir := os.Getenv("XDG_DATA_HOME"); dir != "" {
			return dir
		}
		if home, err := os.UserHomeDir(); err == nil {
			return filepath.Join(home, ".local", "share")
		}
	}

	// Last resort: the Go standard library's own notion of a config directory.
	if dir, err := os.UserConfigDir(); err == nil {
		return dir
	}
	return ""
}
