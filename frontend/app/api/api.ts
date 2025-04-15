import axios from 'axios';

// Replace with your Go backend URL
const API = axios.create({
  baseURL: 'http://localhost:8080/api',  // Go backend URL with /api prefix
  timeout: 10000,
});

export default API;
