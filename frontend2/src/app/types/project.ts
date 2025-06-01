import { User } from './index';

export interface Project {
  id: number;
  name: string;
  description: string;
  owner_id?: number;
  owner?: User;
  status?: string;
  user?: User;
  created_at: string;
  updated_at: string;
  config?: Record<string, any>;
} 