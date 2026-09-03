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

export interface FeatureTaskCounts {
  total: number
  completed: number
}

export type FeatureStatus = 'todo' | 'in_progress' | 'done'
export type FeaturePriority = 'low' | 'medium' | 'high'

export interface Feature {
  id: number
  project_id: number
  parent_feature_id: number | null
  release_id: number | null
  title: string
  description: string
  category: string
  status: FeatureStatus
  priority: FeaturePriority
  assignee_id: number
  tags: string[]
  tasks?: FeatureTaskCounts
  sub_features?: Feature[]
  created_at: string
  updated_at: string
}

export interface TagCount {
  name: string
  count: number
}

/** The labels and tones used wherever a status or priority is displayed. */
export const STATUS_LABEL: Record<FeatureStatus, string> = {
  todo: 'To do',
  in_progress: 'In progress',
  done: 'Done',
}

export const PRIORITY_LABEL: Record<FeaturePriority, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
}
