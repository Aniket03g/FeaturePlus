package app

import (
	"errors"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/FeaturePlus/backend/internal/log"
	"github.com/joho/godotenv"
	"github.com/sirupsen/logrus"
)

// Mode selects how the application is being run. The two modes share every
// route, handler and service; they differ only in where things live and what
// address the server listens on.
type Mode string

const (
	// ModeServer is the long-running web server: binds a fixed public port,
	// keeps its data beside the binary, and expects environment configuration.
	ModeServer Mode = "server"

	// ModeDesktop is the application wrapped in a native window: binds an
	// ephemeral port on loopback only, and keeps its data in the per-user
	// application directory.
	ModeDesktop Mode = "desktop"
)

// Config is everything the application needs to know about its surroundings.
// It is resolved once at startup so that no handler has to consult the working
// directory or the environment on its own.
type Config struct {
	Mode Mode

	// Addr is the listen address, in Go's host:port form.
	Addr string

	// ResourceDir holds templates/ and static/ — the files the app reads.
	ResourceDir string

	// DataDir holds the database, uploads and JSON config — the files it writes.
	DataDir string

	// DBPath is the SQLite file. Defaults to test.db inside DataDir.
	DBPath string

	// SourceRoot is the default repository root the contract service reads
	// source files from. SourceRoots overrides it for individual projects.
	SourceRoot  string
	SourceRoots map[int]string

	// RequireGitHubToken makes a missing GITHUB_TOKEN a startup failure.
	// True for the server, where GitHub integration is expected to work;
	// the desktop build may choose to run without it.
	RequireGitHubToken bool

	// RouteDumpPath, when non-empty, receives the list of registered routes at
	// startup. This is a development aid and is skipped in desktop mode.
	RouteDumpPath string

	// MaxMultipartMemory caps in-memory upload buffering, in bytes.
	MaxMultipartMemory int64
}

// DefaultServerConfig builds the configuration for the web server, reading the
// environment the way the application always has. It is the direct replacement
// for the setup that used to open main().
func DefaultServerConfig() Config {
	loadDotEnv()

	resourceDir := ResolveResourceDir()
	dataDir := ResolveDataDir(ModeServer, resourceDir)

	cfg := Config{
		Mode:               ModeServer,
		Addr:               envOr("FP_ADDR", "0.0.0.0:8080"),
		ResourceDir:        resourceDir,
		DataDir:            dataDir,
		DBPath:             resolveDBPath(dataDir, resourceDir),
		SourceRoot:         resolveSourceRoot(resourceDir),
		SourceRoots:        ParseSourceRoots(os.Getenv("FEATUREPLUS_SOURCE_ROOTS")),
		RequireGitHubToken: true,
		RouteDumpPath:      filepath.Join(resourceDir, "routes.txt"),
		MaxMultipartMemory: 8 << 20, // 8 MiB
	}

	return cfg
}

// DefaultDesktopConfig builds the configuration for the desktop application.
//
// Two differences from the server matter. The listen address is loopback with
// port 0, so the operating system picks a free port and nothing outside the
// machine can reach the app — binding 0.0.0.0 on a laptop would put it on
// whatever network the user is attached to. And the data directory moves to the
// per-user location, since the install directory may not be writable.
func DefaultDesktopConfig() Config {
	loadDotEnv()

	resourceDir := ResolveResourceDir()
	dataDir := ResolveDataDir(ModeDesktop, resourceDir)

	return Config{
		Mode:               ModeDesktop,
		Addr:               "127.0.0.1:0",
		ResourceDir:        resourceDir,
		DataDir:            dataDir,
		DBPath:             resolveDBPath(dataDir, resourceDir),
		SourceRoot:         resolveSourceRoot(resourceDir),
		SourceRoots:        ParseSourceRoots(os.Getenv("FEATUREPLUS_SOURCE_ROOTS")),
		RequireGitHubToken: false,
		RouteDumpPath:      "",
		MaxMultipartMemory: 8 << 20,
	}
}

// Validate checks the configuration is usable and prepares the data directory.
// It returns an error rather than exiting so that a desktop build can show a
// dialog instead of dying silently with no console attached.
func (c *Config) Validate() error {
	if c.ResourceDir == "" {
		return errors.New("no resource directory resolved")
	}
	if !looksLikeResourceDir(c.ResourceDir) {
		return errors.New("templates directory not found under " + c.ResourceDir +
			" (set FP_RESOURCE_DIR to the directory containing templates/ and static/)")
	}
	if c.DataDir == "" {
		return errors.New("no data directory resolved")
	}
	if err := os.MkdirAll(c.DataDir, 0o755); err != nil {
		return err
	}

	// Downstream code still reads DATA_PATH from the environment, so keep it in
	// step with the resolved value rather than leaving the two to disagree.
	if err := os.Setenv("DATA_PATH", c.DataDir); err != nil {
		return err
	}

	if c.RequireGitHubToken && os.Getenv("GITHUB_TOKEN") == "" {
		return errors.New("GITHUB_TOKEN is not set — add it to your .env file or the environment")
	}

	return nil
}

// TemplatePath returns an absolute path to a file under templates/.
func (c *Config) TemplatePath(parts ...string) string {
	return filepath.Join(append([]string{c.ResourceDir, "templates"}, parts...)...)
}

// StaticDir returns the absolute path to the static asset directory.
func (c *Config) StaticDir() string {
	return filepath.Join(c.ResourceDir, "static")
}

// LogFields renders the configuration for the startup log line.
func (c *Config) LogFields() logrus.Fields {
	return logrus.Fields{
		"mode":      string(c.Mode),
		"addr":      c.Addr,
		"resources": c.ResourceDir,
		"data":      c.DataDir,
		"db":        c.DBPath,
	}
}

// loadDotEnv reads a .env file if one can be found nearby. Missing files are
// fine — in production the environment is usually set directly.
func loadDotEnv() {
	for _, candidate := range []string{".env", "../.env", "../../.env"} {
		if err := godotenv.Load(candidate); err == nil {
			log.WithField("file", candidate).Info("Loaded environment variables")
			return
		}
	}
	log.Warn("No .env file found in any checked location (this is OK in production if env vars are set)")
}

// resolveDBPath decides where the SQLite database lives.
//
// FP_DB_PATH wins when set. Otherwise an existing test.db beside the resources
// is preferred, so that running the server from a checkout keeps using the
// database already there rather than silently starting an empty one. Only when
// no such file exists does it fall to the data directory, which is where a
// fresh desktop install will create it.
func resolveDBPath(dataDir, resourceDir string) string {
	if path := os.Getenv("FP_DB_PATH"); path != "" {
		if abs, err := filepath.Abs(path); err == nil {
			return abs
		}
		return path
	}

	if existing := filepath.Join(resourceDir, "test.db"); fileExists(existing) {
		return existing
	}

	return filepath.Join(dataDir, "test.db")
}

// resolveSourceRoot returns the default repository root the contract service
// reads source from. This was previously filepath.Abs("..") relative to the
// working directory, which only gave the right answer when the server was
// started from inside backend/.
func resolveSourceRoot(resourceDir string) string {
	if root := os.Getenv("FEATUREPLUS_SOURCE_ROOT"); root != "" {
		if abs, err := filepath.Abs(root); err == nil {
			return abs
		}
		return root
	}
	return filepath.Dir(resourceDir)
}

func fileExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// ParseSourceRoots parses the FEATUREPLUS_SOURCE_ROOTS env value into a
// projectID -> source-root map. Entries are separated by ';' and each is
// "<projectID>=<path>". Malformed or empty entries are skipped so a bad env
// value can never crash startup; unmapped projects fall back to the default root.
func ParseSourceRoots(env string) map[int]string {
	roots := map[int]string{}
	for _, entry := range strings.Split(env, ";") {
		entry = strings.TrimSpace(entry)
		if entry == "" {
			continue
		}
		id, path, ok := strings.Cut(entry, "=")
		if !ok {
			continue
		}
		pid, err := strconv.Atoi(strings.TrimSpace(id))
		if err != nil {
			continue
		}
		if path = strings.TrimSpace(path); path != "" {
			roots[pid] = path
		}
	}
	return roots
}
