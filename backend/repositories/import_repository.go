package repositories

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
)

// ImportRepository handles dynamic loading of GitHub-imported project templates
// Unlike TemplateRepository, this does NOT preload files at startup
type ImportRepository struct {
	importsPath string
}

// NewImportRepository creates a new import repository
// Does NOT preload any files - loads on demand only
func NewImportRepository(dataPath string) *ImportRepository {
	importsPath := filepath.Join(dataPath, "imports")
	
	// Ensure imports directory exists
	if err := os.MkdirAll(importsPath, 0755); err != nil {
		log.Printf("WARNING: Failed to create imports directory: %v", err)
	} else {
		log.Printf("INFO: Imports directory ready: %s", importsPath)
	}
	
	return &ImportRepository{
		importsPath: importsPath,
	}
}

// LoadImportTemplate dynamically reads a single JSON file on demand
// projectID could be a GitHub repo name or unique identifier
// Returns the parsed Template struct (reuses existing Template from template_repository.go)
func (r *ImportRepository) LoadImportTemplate(projectID string) (*Template, error) {
	// Sanitize projectID to prevent path traversal attacks
	cleanID := filepath.Base(projectID)
	
	// Remove any potentially dangerous characters
	cleanID = strings.ReplaceAll(cleanID, "..", "")
	cleanID = strings.ReplaceAll(cleanID, "/", "")
	cleanID = strings.ReplaceAll(cleanID, "\\", "")
	
	filePath := filepath.Join(r.importsPath, cleanID+".json")
	
	log.Printf("INFO: Attempting to load import template from: %s", filePath)
	
	// Check if file exists
	if _, err := os.Stat(filePath); os.IsNotExist(err) {
		log.Printf("ERROR: Import template not found: %s", filePath)
		return nil, fmt.Errorf("import template not found: %s", cleanID)
	}
	
	// Read file dynamically (NOT cached)
	data, err := os.ReadFile(filePath)
	if err != nil {
		log.Printf("ERROR: Failed to read import template: %v", err)
		return nil, fmt.Errorf("failed to read import template: %w", err)
	}
	
	log.Printf("DEBUG: Read %d bytes from import file", len(data))
	
	// Parse JSON into existing Template struct
	var template Template
	if err := json.Unmarshal(data, &template); err != nil {
		log.Printf("ERROR: Failed to parse import template JSON: %v", err)
		return nil, fmt.Errorf("failed to parse import template: %w", err)
	}
	
	log.Printf("INFO: Successfully loaded import template: %s (%d features, %d tasks)",
		template.Name, len(template.Features), len(template.Tasks))
	
	return &template, nil
}

// ListAvailableImports returns all available import JSON files
func (r *ImportRepository) ListAvailableImports() ([]string, error) {
	files, err := os.ReadDir(r.importsPath)
	if err != nil {
		log.Printf("ERROR: Failed to read imports directory: %v", err)
		return nil, fmt.Errorf("failed to read imports directory: %w", err)
	}
	
	var imports []string
	for _, file := range files {
		if !file.IsDir() && filepath.Ext(file.Name()) == ".json" {
			// Remove the .json extension. This trimmed four characters rather
			// than five, so every id kept a trailing dot — and since
			// LoadImportTemplate appends ".json" again, every id this returned
			// pointed at "name..json" and could not be loaded. The whole
			// import-from-saved-analysis path was listing files it could never
			// open.
			imports = append(imports, strings.TrimSuffix(file.Name(), ".json"))
		}
	}
	
	log.Printf("INFO: Found %d available import templates", len(imports))
	return imports, nil
}

// SaveImportTemplate saves a GitHub-imported template to disk
// Used when MCP generates a new project JSON
func (r *ImportRepository) SaveImportTemplate(projectID string, template *Template) error {
	cleanID := filepath.Base(projectID)
	filePath := filepath.Join(r.importsPath, cleanID+".json")
	
	data, err := json.MarshalIndent(template, "", "  ")
	if err != nil {
		log.Printf("ERROR: Failed to marshal template: %v", err)
		return fmt.Errorf("failed to marshal template: %w", err)
	}
	
	if err := os.WriteFile(filePath, data, 0644); err != nil {
		log.Printf("ERROR: Failed to write import template: %v", err)
		return fmt.Errorf("failed to write import template: %w", err)
	}
	
	log.Printf("INFO: Saved import template: %s", cleanID)
	return nil
}

// DeleteImportTemplate removes an import template file
func (r *ImportRepository) DeleteImportTemplate(projectID string) error {
	cleanID := filepath.Base(projectID)
	filePath := filepath.Join(r.importsPath, cleanID+".json")
	
	if err := os.Remove(filePath); err != nil {
		log.Printf("ERROR: Failed to delete import template: %v", err)
		return fmt.Errorf("failed to delete import template: %w", err)
	}
	
	log.Printf("INFO: Deleted import template: %s", cleanID)
	return nil
}
