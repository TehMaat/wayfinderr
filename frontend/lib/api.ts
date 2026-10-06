import axios from 'axios';
import { useAuthStore } from './auth';

// Same-origin requests: the frontend server proxies /api to the backend.
// The session is an HttpOnly cookie the browser sends on its own.
const apiClient = axios.create({
  timeout: 15000,
});

// Session expired, revoked or account reset: back to the login (or setup) screen
apiClient.interceptors.response.use(undefined, (error) => {
  const code = error?.response?.data?.code;
  if (error?.response?.status === 401 && (code === 'auth_required' || code === 'auth_setup_required')) {
    useAuthStore.getState().signedOut(code === 'auth_setup_required');
  }
  return Promise.reject(error);
});

// Auth API
export const authApi = {
  status: () => apiClient.get<{ configured: boolean; username: string | null }>('/api/auth/status'),
  setup: (data: { setupCode: string; username: string; password: string }) =>
    apiClient.post<{ username: string }>('/api/auth/setup', data),
  login: (data: { username: string; password: string }) => apiClient.post<{ username: string }>('/api/auth/login', data),
  logout: () => apiClient.post('/api/auth/logout'),
  logoutEverywhere: () => apiClient.post('/api/auth/logout-everywhere'),
  changePassword: (data: { currentPassword: string; newPassword: string }) =>
    apiClient.post('/api/auth/change-password', data),
};

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

export default apiClient;
