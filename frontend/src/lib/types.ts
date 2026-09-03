/** Types mirroring the DTOs the Go API returns. */

export interface User {
  id: number
  username: string
  email: string
  name: string
  role: string
}

export interface ProjectStats {
  feature_count: number
  completed_features: number
  task_count: number
  completed_tasks: number
}

export interface Project {
  id: number
  name: string
  description: string
  brief: string
  owner_id: number
  owner?: User
  config: Record<string, unknown>
  stats?: ProjectStats
  created_at: string
  updated_at: string
}

export interface Session {
  user: User
  token: string
}
