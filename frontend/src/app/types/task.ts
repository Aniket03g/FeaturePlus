import { User } from './user';

export interface TaskAttachment {
  ID: number;
  task_id: number;
  file_name: string;
  file_size: number;
  mime_type: string;
  created_at?: string;
  updated_at?: string;
}

export interface Task {
  ID: number;
  task_type: string;
  task_name: string;
  description: string;
  feature_id?: number;
  sub_feature_id?: number;
  created_by_user: number;
  created_at: string;
  updated_at: string;
  deleted_at?: string;
  attachments?: TaskAttachment[];
  comments?: TaskComment[];
}

export interface TaskComment {
  id: number;
  task_id: number;
  attachment_id?: number;
  user_id: number;
  content: string;
  created_at: string;
  updated_at: string;
  user?: User;
  attachment?: TaskAttachment;
} 