import axios from 'axios';
import { getApiUrl } from './config';

const apiClient = axios.create({
  timeout: 15000,
});

// Resolved per request: the URL depends on the host the page was opened from
apiClient.interceptors.request.use((config) => {
  config.baseURL = getApiUrl();
  return config;
});

// Servers API
export const serversApi = {
  listServers: () => apiClient.get('/api/servers'),
  getServer: (id: string) => apiClient.get(`/api/servers/${id}`),
  createServer: (data: Record<string, unknown>) => apiClient.post('/api/servers', data),
  updateServer: (id: string, data: Record<string, unknown>) => apiClient.put(`/api/servers/${id}`, data),
  deleteServer: (id: string) => apiClient.delete(`/api/servers/${id}`),
  testServer: (id: string) => apiClient.post(`/api/servers/${id}/test`, null, { timeout: 45000 }),
  refreshSpace: (id: string) => apiClient.post(`/api/space/${id}/refresh`),
};

// Uploads API
export const uploadsApi = {
  listUploads: (params?: { limit?: number; offset?: number }) => apiClient.get('/api/uploads', { params }),
  getStats: () => apiClient.get('/api/uploads/stats'),
  getUpload: (id: string) => apiClient.get(`/api/uploads/${id}`),
  retryUpload: (id: string) => apiClient.post(`/api/uploads/${id}/retry`),
  deleteUpload: (id: string) => apiClient.delete(`/api/uploads/${id}`),
};

// Space API
export const spaceApi = {
  getAllSpace: () => apiClient.get('/api/space'),
  getServerSpace: (id: string) => apiClient.get(`/api/space/${id}`),
};

// System API (the machine the backend runs on)
export const systemApi = {
  getDisks: () => apiClient.get('/api/system/disks'),
};

export default apiClient;
