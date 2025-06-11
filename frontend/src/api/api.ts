import axios from 'axios';

// Replace with your Go backend URL
const API = axios.create({
  baseURL: 'http://localhost:8080/api',  // Go backend URL with /api prefix
  timeout: 10000,
});

// Request interceptor to add token to headers if available
API.interceptors.request.use(
  (config) => {
    // Check if we're in a browser environment
    if (typeof window !== 'undefined') {
      const token = localStorage.getItem('token');
      
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor to handle unauthorized responses
API.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response && error.response.status === 401) {
      // Clear token if unauthorized
      if (typeof window !== 'undefined') {
        localStorage.removeItem('token');
        
        // Redirect to login page if not already there
        if (window.location.pathname !== '/fflogin') {
          window.location.href = '/fflogin';
        }
      }
    }
    return Promise.reject(error);
  }
);

// Add endpoints for tags
const TagsAPI = {
  getAll: () => API.get('/tags'),
  getByName: (tagName: string) => API.get(`/tags/${encodeURIComponent(tagName)}`),
  getFeaturesByTag: (tagName: string) => API.get(`/tags/${encodeURIComponent(tagName)}/features`),
};

// Add endpoints for projects with config
const ProjectsAPI = {
  getById: (projectId: number) => API.get(`/projects/${projectId}`),
  getConfig: (projectId: number) => API.get(`/projects/${projectId}/config`),
  updateConfig: (projectId: number, config: any) => API.put(`/projects/${projectId}/config`, config),
};

// Add endpoints for features, subfeatures, tags, and tasks
const FeaturesAPI = {
  getById: (featureId: number) => API.get(`/features/${featureId}`),
  getSubfeatures: (featureId: number) => API.get(`/features/${featureId}/subfeatures`),
  getTags: (featureId: number) => API.get(`/features/${featureId}/tags`),
  create: (data: any) => API.post('/features', data),
  update: (featureId: number, data: any) => API.put(`/features/${featureId}`, data),
  updateField: (featureId: number, field: string, value: any) => 
    API.patch(`/features/${featureId}/field`, { field, value }),
  delete: (featureId: number) => API.delete(`/features/${featureId}`),
};

const TasksAPI = {
  getByFeature: (featureId: number) => API.get(`/features/${featureId}/tasks`),
  createForFeature: (featureId: number, data: any) => API.post(`/features/${featureId}/tasks`, data),
  deleteTask: (featureId: number, taskId: number) => API.delete(`/features/${featureId}/task/${taskId}`),
  updateTask: (featureId: number, taskId: number, data: any) => API.put(`/features/${featureId}/task/${taskId}`, data),
  getAll: () => API.get('/tasks'),
  getByProject: (projectId: number) => API.get(`/projects/${projectId}/tasks`),
  uploadAttachment: (taskId: number, formData: FormData) => API.post(`/tasks/${taskId}/attachments`, formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
      'Accept': 'application/json',
    },
  }),
  downloadAttachment: (taskId: number, fileName: string) => API.get(`/tasks/${taskId}/attachments/${fileName}`, {
    responseType: 'blob',
  }),
  deleteAttachment: (taskId: number, attachmentId: number) => API.delete(`/tasks/${taskId}/attachments/${attachmentId}`),
  // Comment endpoints
  getTaskComments: (taskId: number) => API.get(`/tasks/${taskId}/comments`),
  createComment: (taskId: number, data: { content: string; attachment_id?: number }) => 
    API.post(`/tasks/${taskId}/comments`, data),
  updateComment: (commentId: number, data: { content: string }) => 
    API.put(`/comments/${commentId}`, data),
  deleteComment: (commentId: number) => API.delete(`/comments/${commentId}`),
  getAttachmentComments: (attachmentId: number) => API.get(`/attachments/${attachmentId}/comments`),
};

export { TagsAPI, FeaturesAPI, TasksAPI, ProjectsAPI };
export default API;
