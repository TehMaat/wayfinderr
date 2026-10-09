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
  checkTorrent: (id: string) => apiClient.post(`/api/uploads/${id}/torrent/check`, null, { timeout: 120000 }),
  removeTorrent: (id: string) => apiClient.post(`/api/uploads/${id}/torrent/remove`, null, { timeout: 45000 }),
};

// Download clients API (qBittorrent)
export const clientsApi = {
  listClients: () => apiClient.get('/api/clients'),
  createClient: (data: Record<string, unknown>) => apiClient.post('/api/clients', data),
  updateClient: (id: string, data: Record<string, unknown>) => apiClient.put(`/api/clients/${id}`, data),
  deleteClient: (id: string) => apiClient.delete(`/api/clients/${id}`),
  testClient: (id: string) => apiClient.post(`/api/clients/${id}/test`, null, { timeout: 45000 }),
};

// Settings API (TMDB key)
export const settingsApi = {
  getSettings: () => apiClient.get('/api/settings'),
  updateSettings: (data: { tmdbApiKey: string | null }) => apiClient.put('/api/settings', data),
  testTmdb: () => apiClient.post('/api/settings/tmdb/test'),
};

// Space API
export const spaceApi = {
  getAllSpace: () => apiClient.get('/api/space'),
  getServerSpace: (id: string) => apiClient.get(`/api/space/${id}`),
};

export default apiClient;
