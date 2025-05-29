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
        // Remove the redirect to login
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

export { TagsAPI };
export default API;
