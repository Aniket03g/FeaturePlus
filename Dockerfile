# Build stage
FROM golang:1.23-alpine AS builder

# Install build dependencies
RUN apk add --no-cache git build-base

# Set working directory
WORKDIR /app

# Copy go.mod and go.sum from backend (only one module)
COPY backend/go.mod backend/go.sum ./backend/
# Copy pkg/featureplus go.mod so "replace" works
COPY pkg/featureplus/go.mod ./pkg/featureplus/

# Download dependencies
RUN cd backend && go mod download

# Copy source code (backend + pkg)
COPY backend ./backend
COPY pkg ./pkg

# Build the application
WORKDIR /app/backend

RUN go mod tidy
# Build the whole package, not a single file: package main is split across
# main.go and the app package it delegates to.
RUN CGO_ENABLED=1 GOOS=linux go build -o featureplus-server .


# Runtime stage
FROM alpine:latest

# Install necessary runtime dependencies
RUN apk add --no-cache ca-certificates tzdata bash

WORKDIR /app

# Copy the binary from builder stage
COPY --from=builder /app/backend/featureplus-server .

# Copy templates and static files into runtime container
COPY backend/templates ./templates
COPY backend/static ./static

# Copy entrypoint script
COPY docker-entrypoint.sh /app/
RUN chmod +x /app/docker-entrypoint.sh

# Create empty data directory for templates and guidance files
RUN mkdir -p /app/data

# Create volume for persistent data
VOLUME ["/app/data"]

# Set environment variables
ENV DATA_PATH=/app/data
ENV FP_RESOURCE_DIR=/app

# Expose the port your app runs on
EXPOSE 8080

# Use the entrypoint script
ENTRYPOINT ["/app/docker-entrypoint.sh"]