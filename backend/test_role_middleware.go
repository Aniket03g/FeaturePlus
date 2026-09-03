//go:build ignore

// This is a standalone debug script, not part of the server build.
// Run it directly:  go run test_role_middleware.go
package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"time"
)

// Simple test client to verify role-based middleware
func main() {
	// Wait for server to start if needed
	time.Sleep(1 * time.Second)

	baseURL := "http://localhost:8080"

	// Test cases
	testCases := []struct {
		name        string
		endpoint    string
		method      string
		token       string
		role        string
		expectCode  int
		description string
	}{
		{
			name:        "Public endpoint - health check",
			endpoint:    "/api/health",
			method:      "GET",
			token:       "",
			expectCode:  200,
			description: "Public endpoint should be accessible without auth",
		},
		{
			name:        "Developer accessing protected route",
			endpoint:    "/api/projects",
			method:      "GET",
			token:       "developer-token", // Replace with actual token
			role:        "developer",
			expectCode:  200,
			description: "Developer should be able to access regular protected routes",
		},
		{
			name:        "Developer accessing manager-only route",
			endpoint:    "/api/releases",
			method:      "POST",
			token:       "developer-token", // Replace with actual token
			role:        "developer",
			expectCode:  403,
			description: "Developer should NOT be able to access manager-only routes",
		},
		{
			name:        "Manager accessing manager-only route",
			endpoint:    "/api/releases",
			method:      "POST",
			token:       "manager-token", // Replace with actual token
			role:        "manager",
			expectCode:  200, // Might be 400/422 if payload validation fails, but not 401/403
			description: "Manager should be able to access manager-only routes",
		},
	}

	fmt.Println("=== Role Middleware Test ===")
	fmt.Println("Note: You'll need to replace the tokens with valid JWT tokens for your users")
	fmt.Println("This is just a template to help with manual testing")
	fmt.Println("")

	for _, tc := range testCases {
		fmt.Printf("Test: %s\n", tc.name)
		fmt.Printf("  Endpoint: %s %s\n", tc.method, tc.endpoint)
		fmt.Printf("  User Role: %s\n", tc.role)
		fmt.Printf("  Expected: %d\n", tc.expectCode)
		fmt.Printf("  Description: %s\n", tc.description)
		fmt.Println("  To test manually:")
		
		if tc.token == "" {
			fmt.Printf("    curl -X %s %s%s\n", tc.method, baseURL, tc.endpoint)
		} else {
			fmt.Printf("    curl -X %s -H \"Authorization: Bearer %s\" %s%s\n", 
				tc.method, tc.token, baseURL, tc.endpoint)
		}
		fmt.Println("")
	}

	fmt.Println("=== Testing Instructions ===")
	fmt.Println("1. Start the server: go run main.go")
	fmt.Println("2. Log in as a developer user and copy the JWT token")
	fmt.Println("3. Log in as a manager user and copy the JWT token")
	fmt.Println("4. Replace the tokens in the curl commands above")
	fmt.Println("5. Run the curl commands and verify the response codes")
	fmt.Println("")
	fmt.Println("For PR approval testing:")
	fmt.Println("1. Log in as a developer and try to approve a PR")
	fmt.Println("2. You should get a 403 Forbidden response")
	fmt.Println("3. Log in as a manager and try to approve the same PR")
	fmt.Println("4. You should get a successful response")
}
