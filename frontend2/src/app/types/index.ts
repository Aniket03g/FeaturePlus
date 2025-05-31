export interface User {
  id: number;
  username: string;
  email: string;
  role: string;
  created_at: string;
  updated_at: string;
}

// Re-export Project from its own file
export type { Project } from './project';

export interface Feature {
  id: number;
  project_id: number;
  parent_feature_id: number | null;
  title: string;
  description: string;
  status: 'todo' | 'in_progress' | 'done';
  priority: 'low' | 'medium' | 'high';
  assignee_id: number;
  created_at: string;
  updated_at: string;
  parent_feature?: Feature;
  assignee?: User;
  tags?: Tag[];
  category?: string;
}

// Re-export SubFeature from its own file
export type { SubFeature } from './subfeature';

// Export Tag and Task interfaces
export interface Tag {
  tag_name: string;
  feature_id: number;
  created_by_user: number;
}

export interface Task {
  ID: number;
  task_type: string;
  task_name: string;
  description: string;
  feature_id: number;
} 