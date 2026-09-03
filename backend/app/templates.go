package app

import (
	"encoding/json"
	"html/template"
	"strings"

	"github.com/gin-gonic/gin"
)

// templateFiles lists every HTML file loaded at startup, relative to the
// templates directory. Paths are resolved against Config.ResourceDir before
// loading, so the working directory no longer has to be backend/.
var templateFiles = []string{
	"dashboard.html",
	"login.html",
	"feature-detail.html",
	"pr-detail.html",
	"task-card.html",
	"dependency_panels.html",
	"dependency_modal.html",
	"pr_dependencies.html",
	"project-list.html",
	"project-list-fragment.html",
	"create_project.html",
	"import_project.html",
	"import_github.html",
	"template-details-fragment.html",
	"_project_create_success.html",
	"_pr_row.html",
	"pr-modal.html",
	"release-modal.html",
	"_pr_table.html",
	"task-comments-section.html",
	"task-comments-list.html",
	"attachment-comments-section.html",
	"attachment-comments-list.html",
	"comment-form.html",
	"all-tasks-list.html",
	"all-prs-list.html",
	"dashboard-status.html",
	"release-list.html",
	"release-detail.html",
	"release-edit-notes.html",
	"release-feature-form.html",
	"release-assign-features.html",
	"release-planned-features-oob.html",
	"feature-list.html",
	"feature-list-inner.html",
	"feature-list-oob.html",
	"feature-card.html",
	"feature-edit-form.html",
	"task-list.html",
	"task-edit-form.html",
	"task-guidance-fragment.html",
	"linked-code.html",
	"feature-scopes.html",
	"contract-view.html",
	"briefing.html",
	"feature-progress.html",
	"dependencies/dependencies-list.html",
	"dependencies/dependency_panels.html",
	"suggestions-error.html",
	"feature-form.html",
	"task-form.html",
	"project-detail.html",
	"project-settings-modal.html",
	"success-message.html",
	"dependencies/dependency_type_selector.html",
}

// templateFuncs are the helpers available inside every template. This must be
// installed before the templates are loaded, or the parser rejects any template
// referencing a function it does not yet know.
func templateFuncs() template.FuncMap {
	return template.FuncMap{
		"dict": func(values ...interface{}) map[string]interface{} {
			dict := make(map[string]interface{}, len(values)/2)
			for i := 0; i+1 < len(values); i += 2 {
				key, _ := values[i].(string)
				dict[key] = values[i+1]
			}
			return dict
		},
		"toJson": func(v interface{}) template.JS {
			a, _ := json.Marshal(v)
			return template.JS(a)
		},
		"div": func(a, b float64) float64 {
			if b == 0 {
				return 0
			}
			return a / b
		},
		"float64": func(i interface{}) float64 {
			switch v := i.(type) {
			case int:
				return float64(v)
			case int64:
				return float64(v)
			case float64:
				return v
			default:
				return 0
			}
		},
		"hasPrefix": strings.HasPrefix,
		"add":       func(a, b int) int { return a + b },
		"shortHash": func(hash string) string {
			if len(hash) > 7 {
				return hash[:7]
			}
			return hash
		},
		"truncate": func(s string, max int) string {
			if len(s) > max {
				return s[:max] + "…"
			}
			return s
		},
	}
}

// loadTemplates installs the function map and loads every template by absolute
// path. Gin registers each template under its base name, which is why the two
// dependencies/*.html files coexist with the top-level ones without collision.
func loadTemplates(router *gin.Engine, cfg *Config) {
	router.SetFuncMap(templateFuncs())

	paths := make([]string, 0, len(templateFiles))
	for _, name := range templateFiles {
		paths = append(paths, cfg.TemplatePath(strings.Split(name, "/")...))
	}

	router.LoadHTMLFiles(paths...)
}
