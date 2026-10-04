package handlers

import (
	"fmt"
	"log"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/FeaturePlus/backend/models"
	"github.com/FeaturePlus/backend/repositories"
)

var unsafeChars = regexp.MustCompile(`[^\w\-]`)
var multiDash = regexp.MustCompile(`-{2,}`)

func sanitizeFilename(name string) string {
	safe := unsafeChars.ReplaceAllString(strings.ToLower(strings.TrimSpace(name)), "-")
	return multiDash.ReplaceAllString(safe, "-")
}

// GenerateProjectMarkdown writes a per-project markdown file capturing all
// project details: info, template, features, tasks, and dependencies.
func GenerateProjectMarkdown(
	project *models.Project,
	template *repositories.Template,
	features []models.Feature,
	tasks []models.Task,
	dependencyCount int,
	outputDir string,
) error {
	if err := os.MkdirAll(outputDir, 0755); err != nil {
		return fmt.Errorf("failed to create output directory: %w", err)
	}

	filename := fmt.Sprintf("%s-%d.md", sanitizeFilename(project.Name), project.ID)
	filePath := filepath.Join(outputDir, filename)

	var sb strings.Builder

	// Title
	sb.WriteString(fmt.Sprintf("# %s\n\n", project.Name))
	if project.Description != "" {
		sb.WriteString(project.Description + "\n\n")
	}

	// Project info table
	sb.WriteString("## Project Info\n\n")
	sb.WriteString("| Field | Value |\n|-------|-------|\n")
	sb.WriteString(fmt.Sprintf("| **Created** | %s |\n", project.CreatedAt.Format("2006-01-02 15:04:05")))

	if project.Config != nil {
		if ts, ok := project.Config["tech_stack"].(string); ok && ts != "" {
			sb.WriteString(fmt.Sprintf("| **Tech Stack** | %s |\n", ts))
		}
		if ctx, ok := project.Config["context"].(string); ok && ctx != "" {
			sb.WriteString(fmt.Sprintf("| **Environment** | %s |\n", ctx))
		}
		if te, ok := project.Config["tags_enabled"].(bool); ok {
			sb.WriteString(fmt.Sprintf("| **Tags Enabled** | %v |\n", te))
		}
		if fc, ok := project.Config["feature_category"].([]interface{}); ok && len(fc) > 0 {
			cats := make([]string, 0, len(fc))
			for _, c := range fc {
				if s, ok := c.(string); ok {
					cats = append(cats, s)
				}
			}
			sb.WriteString(fmt.Sprintf("| **Feature Categories** | %s |\n", strings.Join(cats, ", ")))
		}
		if tt, ok := project.Config["task_types"].([]interface{}); ok && len(tt) > 0 {
			types := make([]string, 0, len(tt))
			for _, t := range tt {
				if s, ok := t.(string); ok {
					types = append(types, s)
				}
			}
			sb.WriteString(fmt.Sprintf("| **Task Types** | %s |\n", strings.Join(types, ", ")))
		}
		if pc, ok := project.Config["project_context"].(string); ok && pc != "" {
			sb.WriteString(fmt.Sprintf("| **Project Context** | %s |\n", pc))
		}
	}
	sb.WriteString("\n")

	// Template section
	if template != nil {
		sb.WriteString("## Template\n\n")
		sb.WriteString(fmt.Sprintf("**%s** (`%s`)\n\n", template.Name, template.ID))
		if template.Description != "" {
			sb.WriteString(template.Description + "\n\n")
		}
		if template.StarterRepo != "" {
			sb.WriteString(fmt.Sprintf("- **Starter Repo:** %s\n", template.StarterRepo))
		}
		if len(template.DocsLinks) > 0 {
			sb.WriteString("- **Docs:**\n")
			for _, link := range template.DocsLinks {
				sb.WriteString(fmt.Sprintf("  - %s\n", link))
			}
		}
		if template.StarterRepo != "" || len(template.DocsLinks) > 0 {
			sb.WriteString("\n")
		}

		if len(template.SetupSteps) > 0 {
			sb.WriteString("### Setup Steps\n\n")
			for i, step := range template.SetupSteps {
				sb.WriteString(fmt.Sprintf("%d. %s\n", i+1, step))
			}
			sb.WriteString("\n")
		}

		if len(template.EnvironmentVariables) > 0 {
			sb.WriteString("### Environment Variables\n\n```\n")
			for _, env := range template.EnvironmentVariables {
				sb.WriteString(env + "\n")
			}
			sb.WriteString("```\n\n")
		}
	}

	// Build a feature-ID -> tasks lookup
	tasksByFeature := make(map[uint][]models.Task)
	for _, t := range tasks {
		tasksByFeature[t.FeatureID] = append(tasksByFeature[t.FeatureID], t)
	}

	// Features (with tasks nested beneath each one)
	sb.WriteString(fmt.Sprintf("## Features (%d)\n\n", len(features)))
	if len(features) > 0 {
		byCategory := make(map[string][]models.Feature)
		var categoryOrder []string
		for _, f := range features {
			cat := f.Category
			if cat == "" {
				cat = "Uncategorized"
			}
			if _, exists := byCategory[cat]; !exists {
				categoryOrder = append(categoryOrder, cat)
			}
			byCategory[cat] = append(byCategory[cat], f)
		}
		for _, cat := range categoryOrder {
			sb.WriteString(fmt.Sprintf("### %s\n\n", cat))
			for _, f := range byCategory[cat] {
				status := string(f.Status)
				priority := string(f.Priority)
				sb.WriteString(fmt.Sprintf("#### %s `[%s]` `[%s]`\n\n", f.Title, status, priority))
				if f.Description != "" {
					sb.WriteString(fmt.Sprintf("%s\n\n", f.Description))
				}
				featureTasks := tasksByFeature[f.ID]
				if len(featureTasks) > 0 {
					sb.WriteString("**Tasks:**\n\n")
					for _, t := range featureTasks {
						taskType := t.TaskType
						if taskType == "" {
							taskType = "General"
						}
						sb.WriteString(fmt.Sprintf("- **%s** `[%s]`\n", t.TaskName, taskType))
						if t.Description != "" {
							sb.WriteString(fmt.Sprintf("  > %s\n", t.Description))
						}
					}
					sb.WriteString("\n")
				}
			}
		}
	} else {
		sb.WriteString("_No features created._\n\n")
	}

	// Dependencies
	if dependencyCount > 0 {
		sb.WriteString(fmt.Sprintf("## Dependencies\n\n%d dependency relationship(s) established from the template.\n\n", dependencyCount))
	}

	sb.WriteString(fmt.Sprintf("---\n_Generated by FeaturePlus on %s_\n", time.Now().Format("2006-01-02 15:04:05")))

	if err := os.WriteFile(filePath, []byte(sb.String()), 0644); err != nil {
		return fmt.Errorf("failed to write markdown file: %w", err)
	}

	log.Printf("INFO: Project markdown written to %s", filePath)
	return nil
}
