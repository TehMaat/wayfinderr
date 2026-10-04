import axios from 'axios';

const apiClient = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001',
  timeout: 10000,
});

// Servers API
export const serversApi = {
  listServers: () => apiClient.get('/api/servers'),
  getServer: (id: string) => apiClient.get(`/api/servers/${id}`),
  createServer: (data: any) => apiClient.post('/api/servers', data),
  updateServer: (id: string, data: any) =>
    apiClient.put(`/api/servers/${id}`, data),
  deleteServer: (id: string) => apiClient.delete(`/api/servers/${id}`),
  testServer: (id: string) =>
    apiClient.post(`/api/servers/${id}/test`),
  refreshSpace: (id: string) =>
    apiClient.post(`/api/space/${id}/refresh`),
};

// Uploads API
export const uploadsApi = {
  listUploads: (filters?: any) =>
    apiClient.get('/api/uploads', { params: filters }),
  getUpload: (id: string) => apiClient.get(`/api/uploads/${id}`),
  retryUpload: (id: string) => apiClient.post(`/api/uploads/${id}/retry`),
};

// Space API
export const spaceApi = {
  getAllSpace: () => apiClient.get('/api/space'),
  getServerSpace: (id: string) => apiClient.get(`/api/space/${id}`),
};

export default apiClient;
