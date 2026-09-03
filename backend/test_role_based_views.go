//go:build ignore

// This is a standalone debug script, not part of the server build.
// Run it directly:  go run test_role_based_views.go
package main

import (
	"fmt"
	"net/http"
	"strings"
)

func main() {
	// Test viewing PR list as a manager
	fmt.Println("Testing PR list view as manager...")
	
	// Create a request with manager role in JWT token
	req, err := http.NewRequest("GET", "http://localhost:8080/web/prs", nil)
	if err != nil {
		fmt.Printf("Error creating request: %v\n", err)
		return
	}
	
	// Add a fake JWT token that would identify as manager role
	req.Header.Add("Authorization", "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjoxLCJyb2xlIjoibWFuYWdlciIsImV4cCI6MTY5MjM5MDAwMH0.fake-signature")
	
	// Make the request
	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		fmt.Printf("Error making request: %v\n", err)
		return
	}
	defer resp.Body.Close()
	
	// Check if the response contains the Approve button
	buf := new(strings.Builder)
	_, err = buf.ReadFrom(resp.Body)
	if err != nil {
		fmt.Printf("Error reading response: %v\n", err)
		return
	}
	
	content := buf.String()
	if strings.Contains(content, "Approve") {
		fmt.Println("✅ Manager view shows Approve button")
	} else {
		fmt.Println("❌ Manager view does not show Approve button")
	}
	
	fmt.Println("\nTest completed!")
}
