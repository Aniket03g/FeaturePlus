package main

import (
	"FeaturePlus/database"
	"FeaturePlus/models"
	"fmt"
	"log"
	"os"
)

// The main redeclared error happens because we have two main functions when we run this script
// Let's rename this to fixPasswordsMain and call it from the main function
func fixPasswordsMain() {
	// Initialize database
	db, err := database.InitDB()
	if err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}

	// Get all users with empty passwords
	var users []models.User
	result := db.DB.Where("password = ? OR password IS NULL", "").Find(&users)
	if result.Error != nil {
		log.Fatalf("Error finding users: %v", result.Error)
	}

	fmt.Printf("Found %d users with empty passwords\n", len(users))

	// Update each user with a default password
	defaultPassword := "password123" // This is temporary - users should reset their passwords
	for _, user := range users {
		fmt.Printf("Setting password for user %s (ID: %d)\n", user.Username, user.ID)

		// Create a copy of the user to modify
		userCopy := user

		// Set and hash the password
		if err := userCopy.HashPassword(defaultPassword); err != nil {
			log.Printf("Error hashing password for user %d: %v", user.ID, err)
			continue
		}

		// Update only the password field
		if err := db.DB.Model(&user).Update("password", userCopy.Password).Error; err != nil {
			log.Printf("Error updating password for user %d: %v", user.ID, err)
		}
	}

	fmt.Println("Password update complete")
	fmt.Println("Default password set to: " + defaultPassword)
	fmt.Println("Please have users reset their passwords after logging in")
}

// We'll use a simple main function to call our password fixer
func main() {
	fixPasswordsMain()
	os.Exit(0) // Exit cleanly after running
}
