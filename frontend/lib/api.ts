import axios from 'axios';
import { useAuthStore } from './auth';
import type { ReleaseFlags, ReleasePreview, ReleaseProposal, Rip, RipperStatus, TmdbMovie, Upload } from './store';

// Same-origin requests: the frontend server proxies /api to the backend.
// The session is an HttpOnly cookie the browser sends on its own.
const apiClient = axios.create({
  timeout: 15000,
});

// A password change or "sign out everywhere" in flight: the server revokes the
// old cookie before this page receives the new one
let sessionChange: Promise<unknown> = Promise.resolve();
const trackSessionChange = <T>(request: Promise<T>): Promise<T> => {
  sessionChange = request.catch(() => undefined);
  return request;
};

let checking: Promise<void> | null = null;

/**
 * Asks the backend whether this page is still signed in, and shows the login
 * (or setup) screen if not. A 401 alone is not enough: it may come from a
 * request sent with the cookie that a password change here just replaced.
 */
export const checkSession = (): Promise<void> => {
  checking ??= (async () => {
    await sessionChange;
    try {
      const { data } = await authApi.status();
      if (!data.username) useAuthStore.getState().signedOut(!data.configured, true);
    } catch {
      // Backend unreachable: keep the page, the next request will tell
    }
  })().finally(() => {
    checking = null;
  });
  return checking;
};

// Session expired, revoked or account reset: back to the login (or setup) screen
apiClient.interceptors.response.use(undefined, (error) => {
  const code = error?.response?.data?.code;
  if (error?.response?.status === 401 && (code === 'auth_required' || code === 'auth_setup_required')) {
    checkSession();
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
  logoutEverywhere: () => trackSessionChange(apiClient.post('/api/auth/logout-everywhere')),
  changePassword: (data: { currentPassword: string; newPassword: string }) =>
    trackSessionChange(apiClient.post('/api/auth/change-password', data)),
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
  // The backend waits for the running transfer to stop (up to 10 s)
  cancelUpload: (id: string) => apiClient.post(`/api/uploads/${id}/cancel`, null, { timeout: 30000 }),
  deleteUpload: (id: string) => apiClient.delete(`/api/uploads/${id}`),
  // ffprobe on the local file; slow on a network share
  probeMedia: (id: string) => apiClient.post(`/api/uploads/${id}/media`, null, { timeout: 60000 }),
  checkTorrent: (id: string) => apiClient.post(`/api/uploads/${id}/torrent/check`, null, { timeout: 120000 }),
  removeTorrent: (id: string) => apiClient.post(`/api/uploads/${id}/torrent/remove`, null, { timeout: 45000 }),
  // The source .torrent given by hand: for this upload, or for the uploads with its info hash
  addTorrentFile: (id: string, file: File) =>
    apiClient.post<Upload>(`/api/uploads/${id}/torrent/file`, file, {
      params: { name: file.name },
      headers: { 'Content-Type': 'application/x-bittorrent' },
    }),
  importTorrentFile: (file: File) =>
    apiClient.post<{ name: string; infoHash: string; tracker: string; uploadIds: string[] }>('/api/uploads/torrent-file', file, {
      params: { name: file.name },
      headers: { 'Content-Type': 'application/x-bittorrent' },
    }),
  // The source .torrent kept once added by hand
  torrentFileUrl: (id: string) => `/api/uploads/${id}/torrent/file`,
};

// local: a file not uploaded yet, released on the machine of its download client instead
const localParams = (local: boolean) => (local ? { local: 1 } : undefined);

// Release API: rename on the server, then the tracker command (ITTUP / Unit3Dup)
export const releaseApi = {
  // May probe the file again (on the server for an upload whose local file is gone)
  proposal: (id: string, local = false) =>
    apiClient.get<ReleaseProposal>(`/api/uploads/${id}/release`, { params: localParams(local), timeout: 120000 }),
  preview: (id: string, flags: ReleaseFlags, local = false) =>
    apiClient.post<ReleasePreview>(`/api/uploads/${id}/release/preview`, flags, { params: localParams(local) }),
  // Local: its upload stops first (up to 10 s)
  confirm: (id: string, flags: ReleaseFlags, overwrite = false, local = false) =>
    apiClient.post<Upload>(`/api/uploads/${id}/release`, { ...flags, overwrite }, { params: localParams(local), timeout: 60000 }),
  run: (id: string) => apiClient.post<Upload>(`/api/uploads/${id}/release/run`),
  answer: (id: string, text: string) => apiClient.post(`/api/uploads/${id}/release/input`, { text }, { timeout: 30000 }),
  stop: (id: string) => apiClient.post<Upload>(`/api/uploads/${id}/release/stop`, null, { timeout: 30000 }),
  dismiss: (id: string) => apiClient.post<Upload>(`/api/uploads/${id}/release/dismiss`),
  // Looks for the file and its .torrent on the server, then probes it there
  link: (id: string) => apiClient.post<Upload>(`/api/uploads/${id}/release/link`, null, { timeout: 180000 }),
  torrentUrl: (id: string) => `/api/uploads/${id}/release/torrent`,
  // A .torrent given by hand: the file itself as the body
  addTorrent: (id: string, file: File) =>
    apiClient.put<Upload>(`/api/uploads/${id}/release/torrent`, file, {
      params: { name: file.name },
      headers: { 'Content-Type': 'application/x-bittorrent' },
      timeout: 60000,
    }),
};

// Download clients API (qBittorrent)
export const clientsApi = {
  listClients: () => apiClient.get('/api/clients'),
  createClient: (data: Record<string, unknown>) => apiClient.post('/api/clients', data),
  updateClient: (id: string, data: Record<string, unknown>) => apiClient.put(`/api/clients/${id}`, data),
  deleteClient: (id: string) => apiClient.delete(`/api/clients/${id}`),
  testClient: (id: string) => apiClient.post(`/api/clients/${id}/test`, null, { timeout: 45000 }),
};


// Rips API (film discs ripped with MakeMKV)
export const ripsApi = {
  listRips: () => apiClient.get<{ status: RipperStatus; rips: Rip[] }>('/api/rips'),
  getRip: (id: string) => apiClient.get<Rip>(`/api/rips/${id}`),
  chooseRip: (id: string, choice: { titleIndex?: number; tmdbId?: number }) =>
    apiClient.post<Rip>(`/api/rips/${id}/choose`, choice),
  retryRip: (id: string) => apiClient.post<Rip>(`/api/rips/${id}/retry`),
  remuxRip: (id: string) => apiClient.post<Rip>(`/api/rips/${id}/remux`),
  ripAgain: (id: string) => apiClient.post<Rip>(`/api/rips/${id}/rip-again`),
  skipRip: (id: string) => apiClient.post<Rip>(`/api/rips/${id}/skip`),
  removeRip: (id: string) => apiClient.delete(`/api/rips/${id}`),
  joinRips: (ripIds: string[]) => apiClient.post<Rip[]>('/api/rips/join', { ripIds }),
  clearSkippedRips: () => apiClient.post<{ removed: number }>('/api/rips/clear-skipped'),
  setExclusions: (settings: { patterns?: string[]; folders?: string[]; arriveComplete?: boolean }) =>
    apiClient.put<{
      exclusions: string[];
      ignoredFolders: string[];
      arriveComplete: boolean;
      removed: number;
      skipped: number;
      restored: number;
    }>('/api/rips/exclusions', settings),
  // Subfolders of a folder of the downloads ("" for the downloads folder)
  listFolders: (path: string) =>
    apiClient.get<{ path: string; folders: string[] }>('/api/rips/folders', { params: { path: path || undefined } }),
  searchTmdb: (query: string, year?: number | null) =>
    apiClient.get<TmdbMovie[]>('/api/rips/tmdb/search', { params: { query, year: year || undefined } }),
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
