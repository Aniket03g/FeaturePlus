export interface FeatureTag {
  tag_name: string;
  feature_id: number;
  created_by_user: number;
}

export interface Feature {
  id: number;
  project_id: number;
  parent_feature_id: number | null;
  title: string;
  description: string;
  status: string;
  priority: string;
  assignee_id: number;
  created_at: string;
  updated_at: string;
  tags?: FeatureTag[];
  tags_input?: string;
}

export interface User {
  id: number;
  username: string;
  email?: string;
}

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
} 