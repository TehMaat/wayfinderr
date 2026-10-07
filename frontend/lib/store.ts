import { create } from 'zustand';
import { serversApi, spaceApi, uploadsApi } from './api';

export type UploadStatus = 'PENDING' | 'QUEUED' | 'UPLOADING' | 'COMPLETED' | 'FAILED' | 'SKIPPED';

export const UPLOAD_STATUSES: UploadStatus[] = ['UPLOADING', 'QUEUED', 'PENDING', 'COMPLETED', 'FAILED', 'SKIPPED'];

export interface Upload {
  id: string;
  filename: string;
  filepath: string;
  size: string; // bytes, serialized as string by the API
  status: UploadStatus;
  progress: number;
  progressBytes: string;
  hasItalianAudio: boolean;
  hasItalianSubtitles: boolean;
  mediaInfo: string | null;
  serverId: string | null;
  server?: { id: string; name: string; sshPath?: string } | null;
  currentRetryCount: number;
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Server {
  id: string;
  name: string;
  apiEndpoint: string;
  hasApiToken: boolean;
  sshHost: string;
  sshPort: number;
  sshUsername: string;
  sshPath: string;
  hasSshPassword: boolean;
  maxRetries: number;
  backoffStrategy: string;
  mediaCheckPolicy: string;
  lastSpaceCheckAt: string | null;
  // From /api/space (missing until loaded)
  reachable?: boolean;
  freeSpaceBytes?: string;
  usedSpaceBytes?: string;
  totalSpaceBytes?: string;
}

export interface Stats {
  total: number;
  byStatus: Partial<Record<UploadStatus, number>>;
  byServer: Record<string, number>;
  completedBytes: string;
  queueSize: number;
}

interface Transfer {
  bytes: number;
  time: number;
  speed: number; // bytes/s, smoothed
}

export interface Filters {
  status: UploadStatus | 'ALL';
  serverId: string | 'ALL';
  search: string;
}

interface AppState {
  uploads: Upload[];
  uploadsLoaded: boolean;
  servers: Server[];
  serversLoaded: boolean;
  spaceLoaded: boolean;
  stats: Stats | null;
  connected: boolean;
  transfers: Record<string, Transfer>;
  filters: Filters;

  loadUploads: () => Promise<void>;
  loadServers: () => Promise<void>;
  loadSpace: () => Promise<void>;
  loadStats: () => Promise<void>;
  loadAll: () => Promise<void>;
  refreshUpload: (id: string) => Promise<void>;
  removeUpload: (id: string) => void;
  applyProgress: (id: string, progress: number, bytes: number) => void;
  setConnected: (connected: boolean) => void;
  setFilters: (filters: Partial<Filters>) => void;
}

const UPLOADS_LIMIT = 500;

export const useAppStore = create<AppState>((set, get) => ({
  uploads: [],
  uploadsLoaded: false,
  servers: [],
  serversLoaded: false,
  spaceLoaded: false,
  stats: null,
  connected: false,
  transfers: {},
  filters: { status: 'ALL', serverId: 'ALL', search: '' },

  loadUploads: async () => {
    const { data } = await uploadsApi.listUploads({ limit: UPLOADS_LIMIT });
    set({ uploads: data.uploads ?? [], uploadsLoaded: true });
  },

  // Server config first (fast), then the space info (calls the Ultra.cc API)
  loadServers: async () => {
    const { data } = await serversApi.listServers();
    const previous = new Map(get().servers.map((s) => [s.id, s]));
    set({
      servers: (data as Server[]).map((s) => {
        const old = previous.get(s.id);
        return old
          ? { ...s, reachable: old.reachable, freeSpaceBytes: old.freeSpaceBytes, usedSpaceBytes: old.usedSpaceBytes, totalSpaceBytes: old.totalSpaceBytes }
          : s;
      }),
      serversLoaded: true,
    });
    await get().loadSpace();
  },

  loadSpace: async () => {
    const { data } = await spaceApi.getAllSpace();
    const space = new Map((data as Partial<Server>[]).map((s) => [s.id, s]));
    set((state) => ({
      servers: state.servers.map((s) => {
        const info = space.get(s.id);
        return info
          ? {
              ...s,
              reachable: info.reachable,
              freeSpaceBytes: info.freeSpaceBytes,
              usedSpaceBytes: info.usedSpaceBytes,
              totalSpaceBytes: info.totalSpaceBytes,
              lastSpaceCheckAt: info.lastSpaceCheckAt ?? s.lastSpaceCheckAt,
            }
          : s;
      }),
      spaceLoaded: true,
    }));
  },

  loadStats: async () => {
    const { data } = await uploadsApi.getStats();
    set({ stats: data });
  },

  loadAll: async () => {
    await Promise.allSettled([get().loadUploads(), get().loadServers(), get().loadStats()]);
  },

  refreshUpload: async (id) => {
    try {
      const { data } = await uploadsApi.getUpload(id);
      set((state) => {
        const exists = state.uploads.some((u) => u.id === id);
        const transfers = { ...state.transfers };
        if (data.status !== 'UPLOADING') delete transfers[id];
        return {
          uploads: exists ? state.uploads.map((u) => (u.id === id ? data : u)) : [data, ...state.uploads],
          transfers,
        };
      });
    } catch {
      // Deleted in the meantime
    }
  },

  removeUpload: (id) =>
    set((state) => ({ uploads: state.uploads.filter((u) => u.id !== id) })),

  applyProgress: (id, progress, bytes) =>
    set((state) => {
      const now = Date.now();
      const prev = state.transfers[id];
      let speed = prev?.speed ?? 0;
      if (prev && now > prev.time && bytes >= prev.bytes) {
        const instant = ((bytes - prev.bytes) * 1000) / (now - prev.time);
        // Exponential moving average to keep the number readable
        speed = prev.speed ? prev.speed * 0.7 + instant * 0.3 : instant;
      }
      return {
        transfers: { ...state.transfers, [id]: { bytes, time: now, speed } },
        uploads: state.uploads.map((u) =>
          u.id === id ? { ...u, status: progress >= 100 ? u.status : 'UPLOADING', progress, progressBytes: String(bytes) } : u
        ),
      };
    }),

  setConnected: (connected) => set({ connected }),

  setFilters: (filters) => set((state) => ({ filters: { ...state.filters, ...filters } })),
}));

/** Total speed of the running transfers */
export const selectTotalSpeed = (state: AppState) =>
  state.uploads
    .filter((u) => u.status === 'UPLOADING')
    .reduce((sum, u) => sum + (state.transfers[u.id]?.speed ?? 0), 0);
