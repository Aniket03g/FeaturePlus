# Variables
BINARY_NAME=FeaturePlus
SRC_DIR=.
BUILD_DIR=bin
GO=go
GOFLAGS=-ldflags="-s -w"

# Default target
.PHONY: all
all: build

# Build the application
.PHONY: build
build:
	$(GO) build $(GOFLAGS) -o $(BUILD_DIR)/$(BINARY_NAME) $(SRC_DIR)

# Run the application
.PHONY: run
run:
	$(GO) run $(SRC_DIR)

# Test the application
.PHONY: test
test:
	$(GO) test ./... -v

# Lint the code using golangci-lint
.PHONY: lint
lint:
	golangci-lint run

# Clean build artifacts
.PHONY: clean
clean:
	rm -rf $(BUILD_DIR)

# Install dependencies
.PHONY: deps
deps:
	$(GO) mod tidy
	$(GO) mod download

# Format code
.PHONY: fmt
fmt:
	$(GO) fmt ./...

# Run with race detector
.PHONY: race
race:
	$(GO) run -race $(SRC_DIR)

# Build for multiple platforms
.PHONY: cross-build
cross-build:
	GOOS=linux GOARCH=amd64 $(GO) build $(GOFLAGS) -o $(BUILD_DIR)/$(BINARY_NAME)-linux-amd64 $(SRC_DIR)
	GOOS=windows GOARCH=amd64 $(GO) build $(GOFLAGS) -o $(BUILD_DIR)/$(BINARY_NAME)-windows-amd64.exe $(SRC_DIR)
	GOOS=darwin GOARCH=amd64 $(GO) build $(GOFLAGS) -o $(BUILD_DIR)/$(BINARY_NAME)-darwin-amd64 $(SRC_DIR)


