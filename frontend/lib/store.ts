import { create } from 'zustand';

export interface Upload {
  id: string;
  filename: string;
  size: bigint;
  status: 'PENDING' | 'QUEUED' | 'UPLOADING' | 'COMPLETED' | 'FAILED' | 'SKIPPED';
  progress: number;
  hasItalianAudio: boolean;
  hasItalianSubtitles: boolean;
  createdAt: string;
  completedAt?: string;
  error?: string;
}

export interface Server {
  id: string;
  name: string;
  freeSpaceBytes: string;
  freeSpaceGB: string;
  lastSpaceCheckAt?: string;
}

interface UploadsStore {
  uploads: Upload[];
  activeUpload: Upload | null;
  queueSize: number;
  setUploads: (uploads: Upload[]) => void;
  addUpload: (upload: Upload) => void;
  updateUpload: (id: string, partial: Partial<Upload>) => void;
  setActiveUpload: (upload: Upload | null) => void;
  setQueueSize: (size: number) => void;
}

export const useUploadsStore = create<UploadsStore>((set) => ({
  uploads: [],
  activeUpload: null,
  queueSize: 0,
  setUploads: (uploads) => set({ uploads }),
  addUpload: (upload) =>
    set((state) => ({
      uploads: [upload, ...state.uploads],
    })),
  updateUpload: (id, partial) =>
    set((state) => ({
      uploads: state.uploads.map((u) =>
        u.id === id ? { ...u, ...partial } : u
      ),
      activeUpload:
        state.activeUpload?.id === id
          ? { ...state.activeUpload, ...partial }
          : state.activeUpload,
    })),
  setActiveUpload: (upload) => set({ activeUpload: upload }),
  setQueueSize: (size) => set({ queueSize: size }),
}));

interface ServersStore {
  servers: Server[];
  setServers: (servers: Server[]) => void;
  updateServer: (id: string, partial: Partial<Server>) => void;
}

export const useServersStore = create<ServersStore>((set) => ({
  servers: [],
  setServers: (servers) => set({ servers }),
  updateServer: (id, partial) =>
    set((state) => ({
      servers: state.servers.map((s) =>
        s.id === id ? { ...s, ...partial } : s
      ),
    })),
}));
