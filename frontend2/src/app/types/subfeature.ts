export interface SubFeature {
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