//go:build ignore

// This is a standalone debug script, not part of the server build.
// Run it directly:  go run test_manager_workflow.go
package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io/ioutil"
	"log"
	"net/http"
	"os"
	"time"
)

// Test data structures
type CreateReleaseRequest struct {
	Tag   string `json:"tag"`
	PRs   []int  `json:"prs"`
	Notes string `json:"notes"`
}

// Debug logging helper function
func debugLog(format string, args ...interface{}) {
	if os.Getenv("DEBUG") == "1" {
		log.Printf("[DEBUG] "+format, args...)
	}
}

func testManagerWorkflow() {
	// Check if debug mode is enabled
	if os.Getenv("DEBUG") == "1" {
		log.Println("DEBUG mode enabled - detailed logging will be shown")
	}

	baseURL := "http://localhost:8080"
	log.Printf("Using base URL: %s", baseURL)
	
	// Test 1: Approve a PR
	prID := 1 // Change this to an existing PR ID in your database
	log.Printf("Testing ApprovePR endpoint for PR ID %d...", prID)
	
	debugLog("Creating HTTP request to %s/prs/%d/approve", baseURL, prID)
	approveReq, err := http.NewRequest("POST", 
		fmt.Sprintf("%s/prs/%d/approve", baseURL, prID),
		nil)
	if err != nil {
		log.Fatalf("Error creating approve request: %v", err)
	}
	
	// Add headers
	approveReq.Header.Set("Content-Type", "application/json")
	debugLog("Request headers: %v", approveReq.Header)
	
	// Send request
	client := &http.Client{Timeout: 10 * time.Second}
	debugLog("Sending approve request...")
	approveResp, err := client.Do(approveReq)
	
	if err != nil {
		log.Fatalf("Error calling ApprovePR endpoint: %v", err)
	}
	defer approveResp.Body.Close()
	
	// Read response body
	approveBody, err := ioutil.ReadAll(approveResp.Body)
	if err != nil {
		log.Fatalf("Error reading approve response body: %v", err)
	}
	
	log.Printf("ApprovePR response status: %s", approveResp.Status)
	debugLog("ApprovePR response body: %s", string(approveBody))
	
	// Test 2: Create a Release
	log.Println("\nTesting CreateRelease endpoint...")
	
	releaseReq := CreateReleaseRequest{
		Tag:   "v1.0.0-test-" + time.Now().Format("20060102-150405"),
		PRs:   []int{prID}, // Using the same PR we just approved
		Notes: "Test release created via test script with debug logging",
	}
	debugLog("Release request data: %+v", releaseReq)
	
	reqBody, err := json.Marshal(releaseReq)
	if err != nil {
		log.Fatalf("Error marshaling release request: %v", err)
	}
	debugLog("Request JSON body: %s", string(reqBody))
	
	// Create request
	debugLog("Creating HTTP request to %s/api/releases", baseURL)
	releaseReq2, err := http.NewRequest(
		"POST",
		fmt.Sprintf("%s/api/releases", baseURL),
		bytes.NewBuffer(reqBody),
	)
	if err != nil {
		log.Fatalf("Error creating release request: %v", err)
	}
	
	// Add headers
	releaseReq2.Header.Set("Content-Type", "application/json")
	debugLog("Request headers: %v", releaseReq2.Header)
	
	// Send request
	debugLog("Sending release creation request...")
	releaseResp, err := client.Do(releaseReq2)
	
	if err != nil {
		log.Fatalf("Error calling CreateRelease endpoint: %v", err)
	}
	defer releaseResp.Body.Close()
	
	// Read response body
	releaseRespBody, err := ioutil.ReadAll(releaseResp.Body)
	if err != nil {
		log.Fatalf("Error reading release response body: %v", err)
	}
	
	log.Printf("CreateRelease response status: %s", releaseResp.Status)
	debugLog("CreateRelease response body: %s", string(releaseRespBody))
	
	// Parse the response to get the release ID
	var releaseResult map[string]interface{}
	if err := json.Unmarshal(releaseRespBody, &releaseResult); err != nil {
		log.Printf("Error parsing release response: %v", err)
	} else {
		if releaseID, ok := releaseResult["release_id"].(float64); ok {
			log.Printf("Created release with ID: %d", int(releaseID))
			
			// Test 3: Finalize the release
			log.Println("\nTesting FinalizeRelease endpoint...")
			
			// Create finalize request
			debugLog("Creating HTTP request to %s/api/releases/%d/finalize", baseURL, int(releaseID))
			finalizeURL := fmt.Sprintf("%s/api/releases/%d/finalize", baseURL, int(releaseID))
			finalizeReq, err := http.NewRequest("POST", finalizeURL, bytes.NewBuffer([]byte("{}")))
			if err != nil {
				log.Fatalf("Error creating finalize request: %v", err)
			}
			
			// Add headers
			finalizeReq.Header.Set("Content-Type", "application/json")
			debugLog("Request headers: %v", finalizeReq.Header)
			
			// Send request
			debugLog("Sending finalize request...")
			finalizeResp, err := client.Do(finalizeReq)
			if err != nil {
				log.Fatalf("Error calling FinalizeRelease endpoint: %v", err)
			}
			defer finalizeResp.Body.Close()
			
			// Read response body
			finalizeRespBody, err := ioutil.ReadAll(finalizeResp.Body)
			if err != nil {
				log.Fatalf("Error reading finalize response body: %v", err)
			}
			
			log.Printf("FinalizeRelease response status: %s", finalizeResp.Status)
			debugLog("FinalizeRelease response body: %s", string(finalizeRespBody))
		}
	}
	
	log.Println("\nTest completed successfully!")
}
