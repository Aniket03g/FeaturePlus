//go:build ignore

// This is a standalone debug script, not part of the server build.
// Run it directly:  go run debug_templates.go
package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
)

// TemplateData minimal struct just to test JSON parsing
type TemplateData struct {
	Templates []struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	} `json:"templates"`
}

func main() {
	// Step 1: Resolve data path
	dataPath := os.Getenv("DATA_PATH")
	if dataPath == "" {
		dataPath = "./data" // fallback for local dev
	}
	absPath, err := filepath.Abs(filepath.Join(dataPath, "templates.json"))
	if err != nil {
		log.Fatalf("ERROR: Failed to resolve absolute path: %v", err)
	}

	log.Printf("INFO: Using templates.json path: %s", absPath)

	// Step 2: Check if file exists
	info, err := os.Stat(absPath)
	if os.IsNotExist(err) {
		log.Fatalf("ERROR: templates.json does not exist at %s", absPath)
	} else if err != nil {
		log.Fatalf("ERROR: Failed to stat file: %v", err)
	}
	log.Printf("INFO: File exists, size=%d bytes, mode=%s", info.Size(), info.Mode())

	// Step 3: Open file and print first 10 lines
	file, err := os.Open(absPath)
	if err != nil {
		log.Fatalf("ERROR: Failed to open file: %v", err)
	}
	defer file.Close()

	log.Println("INFO: First 10 lines of templates.json:")
	scanner := bufio.NewScanner(file)
	for i := 1; i <= 10 && scanner.Scan(); i++ {
		fmt.Printf("LINE %02d: %s\n", i, scanner.Text())
	}
	if err := scanner.Err(); err != nil {
		log.Fatalf("ERROR: Reading file lines failed: %v", err)
	}

	// Step 4: Reset file pointer and test JSON unmarshal
	file.Seek(0, 0) // go back to start
	data, err := os.ReadFile(absPath)
	if err != nil {
		log.Fatalf("ERROR: Failed to read file fully: %v", err)
	}

	var td TemplateData
	if err := json.Unmarshal(data, &td); err != nil {
		log.Fatalf("ERROR: Failed to parse JSON: %v", err)
	}

	log.Printf("INFO: Successfully parsed JSON, found %d templates", len(td.Templates))
	for _, t := range td.Templates {
		log.Printf("DEBUG: Template ID=%s, Name=%s", t.ID, t.Name)
	}
}

