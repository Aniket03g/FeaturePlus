# FeaturePlus

A modern project management application that allows teams to track features and sub-features of their projects. It provides a hierarchical structure for organizing tasks, with features containing sub-features, and supports user assignment, priority management, and status tracking.

## Features

### Feature Management
- Create, read, update, and delete features
- Assign features to projects
- Set feature priority (low, medium, high)
- Track feature status (todo, in_progress, done)
- Assign features to users

### Sub-feature Management
- Create, read, update, and delete sub-features
- Link sub-features to parent features
- Set sub-feature priority
- Track sub-feature status
- Assign sub-features to users

### User Management
- User registration and authentication
- Role-based access control
- User assignment to features and sub-features

### Project Organization
- Hierarchical structure: Projects → Features → Sub-features
- Project ownership and management
- Project-specific feature tracking

## Tech Stack

### Frontend
- Next.js
- TypeScript
- CSS Modules
- Component-based architecture

### Backend
- Go
- Gin framework
- GORM (SQLite)
- RESTful API

## Prerequisites
- Node.js and npm for frontend
- Go for backend
- SQLite database

## Installation

1. Clone the repository:
```bash
git clone [repository-url]
cd FeaturePlus
```

2. Install frontend dependencies:
```bash
cd frontend
npm install
```

3. Install backend dependencies:
```bash
cd backend
go mod download
```

## Running the Application

1. Start the backend server:
```bash
cd backend
go run main.go
```

2. Start the frontend development server:
```bash
cd frontend
npm run dev
```

The application will be available at:
- Frontend: http://localhost:3000
- Backend: http://localhost:8080

## API Endpoints

### Users
```
GET    /users              - Get all users
GET    /users/:id          - Get user by ID
POST   /users              - Create new user
PUT    /users/:id          - Update user
DELETE /users/:id          - Delete user
```

### Projects
```
POST   /projects           - Create new project
GET    /projects           - Get all projects
GET    /projects/:id       - Get project by ID
PUT    /projects/:id       - Update project
DELETE /projects/:id       - Delete project
GET    /projects/user/:user_id - Get projects by user
```

### Features
```
POST   /features           - Create new feature
GET    /features/:id       - Get feature by ID
GET    /features/project/:project_id - Get project features
PUT    /features/:id       - Update feature
DELETE /features/:id       - Delete feature
```

### Sub-features
```
POST   /api/sub-features   - Create new sub-feature
PUT    /api/sub-features/:id - Update sub-feature
GET    /api/sub-features   - Get sub-features by feature
```

## Data Models

### User
```typescript
interface User {
  id: number;
  username: string;
  email: string;
  role: string;
  created_at: string;
  updated_at: string;
}
```

### Project
```typescript
interface Project {
  id: number;
  name: string;
  description: string;
  created_at: string;
  updated_at: string;
}
```

### Feature
```typescript
interface Feature {
  id: number;
  project_id: number;
  title: string;
  description: string;
  status: 'todo' | 'in_progress' | 'done';
  priority: 'low' | 'medium' | 'high';
  assignee_id: number;
  created_at: string;
  updated_at: string;
}
```

### SubFeature
```typescript
interface SubFeature {
  id: number;
  feature_id: number;
  title: string;
  description: string;
  status: 'todo' | 'in_progress' | 'done';
  priority: 'low' | 'medium' | 'high';
  assignee_id: number;
  created_at: string;
  updated_at: string;
}
```

## Development

### Frontend Development
The frontend is built using Next.js and follows a component-based architecture. Key components include:

- `FeatureCard`: Displays individual features and manages sub-features
- `SubFeatureCard`: Displays sub-features and provides edit functionality
- CSS Modules for styling
- TypeScript for type safety

### Backend Development
The backend is built using Go with the following components:

- Gin framework for routing and middleware
- GORM for database operations
- RESTful API design
- Structured error handling

## Contributing
1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

## License
[Add your license information here]

## Support
For support, please open an issue in the repository or contact the maintainers. 