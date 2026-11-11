import { create } from 'zustand';
import { clientsApi, mergeApi, ripsApi, serversApi, spaceApi, systemApi, uploadsApi } from './api';

// HELD: kept for a merge (MERGE_ENABLED), uploaded only when released by hand
// MERGED: an input of a merge, done through the merged file
export type UploadStatus = 'PENDING' | 'QUEUED' | 'UPLOADING' | 'COMPLETED' | 'FAILED' | 'SKIPPED' | 'CANCELLED' | 'HELD' | 'MERGED';

// Why a file is held: no Italian audio, a twin of the same film around, or maybe one
export type HoldKind = 'NO_ITALIAN' | 'TWIN' | 'POSSIBLE_TWIN';

export type TorrentStatus = 'NO_MATCH' | 'REVIEW' | 'WAITING' | 'REMOVED' | 'ERROR';

// Rename on the server, then the tracker command (ITTUP / Unit3Dup)
export type ReleaseStatus =
  | 'CONFIRM'
  | 'RENAMED'
  | 'QUEUED'
  | 'RUNNING'
  | 'NEEDS_INPUT'
  | 'DONE'
  | 'SKIPPED'
  | 'UNKNOWN'
  | 'FAILED'
  | 'CANCELLED';

// The question the tracker command waits on
export interface ReleasePrompt {
  kind: 'tmdb' | 'duplicate' | 'trailer' | 'text';
  text: string;
}

export interface ReleaseFlags {
  title: string;
  year: string;
  version: string;
  remux: boolean;
}

export interface ReleaseAnalysis {
  video: {
    resolution: string | null;
    width: number;
    height: number;
    codec: string | null;
    dv: boolean;
    dvProfile: number | null;
    hdr: string | null;
  };
  audio: { codec: string; language: string }[];
  audioStreams: { index: number; codec: string; language: string; channels: number | null; bitrate: number | null; title: string | null }[];
  subtitles: string[];
  extraLanguages: { audio: string[]; subtitles: string[] };
}

export interface ReleaseProposal {
  analysis: ReleaseAnalysis;
  defaults: ReleaseFlags;
  versions: string[];
  rip: { tmdbId: number | null; title: string | null; year: number | null } | null;
  remotePath: string;
  releaseDir: string;
  releaseTag: string | null;
  hasTrackerCommand: boolean;
  // Where it is released: the server, or the machine of a download client (local)
  target: { name: string; local: boolean };
}

export interface ReleasePreview {
  filename: string;
  folder: string;
  path: string;
  autoHybrid: boolean;
  error: string | null;
}

export const UPLOAD_STATUSES: UploadStatus[] = ['UPLOADING', 'QUEUED', 'PENDING', 'HELD', 'COMPLETED', 'MERGED', 'FAILED', 'CANCELLED', 'SKIPPED'];

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
  // Released on the machine of this download client instead of uploaded
  localClientId: string | null;
  localClient?: { id: string; name: string } | null;
  currentRetryCount: number;
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
  // Source torrent cleanup (null until checked)
  torrentStatus: TorrentStatus | null;
  torrentClientId: string | null;
  torrentHash: string | null;
  torrentName: string | null;
  torrentScore: number | null;
  torrentMessage: string | null;
  torrentTracker: string | null; // the torrent's tracker host, kept once it is removed
  torrentFileName: string | null; // its .torrent, added by hand or sent beforehand (downloaded with uploadsApi.torrentFileUrl)
  // Where the file is on the server (null for uploads before it was stored)
  remotePath: string | null;
  remoteFound: boolean | null; // false: looked for on the server and not found
  // Release: renamed on the server, then uploaded to the tracker
  releaseStatus: ReleaseStatus | null;
  releaseName: string | null;
  releasePrompt: string | null; // JSON ReleasePrompt
  releaseLog?: string | null; // only from GET /api/uploads/:id
  releaseMessage: string | null;
  releaseStartedAt: string | null;
  releaseCompletedAt: string | null;
  // The .torrent the tracker gave back (downloaded with releaseApi.torrentUrl)
  releaseTracker: string | null;
  releaseTorrentName: string | null;
  releaseTorrentPath: string | null;
  releaseTorrentHash: string | null;
  tmdbId: number | null; // the film on TMDB the tracker command went on with
  // Held for a merge (status HELD): why, and the twin found
  holdKind: HoldKind | null;
  holdMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TorrentClient {
  id: string;
  name: string;
  url: string;
  username: string | null;
  category: string | null;
  hasPassword: boolean;
  hasApiKey: boolean;
  enabled: boolean;
  autoRemove: boolean;
  deleteFiles: boolean;
  // Pause every torrent below this many GB free on this machine (null = off)
  minFreeGB: number | null;
  spacePausedAt: string | null;
  spaceMessage: string | null;
  // Local release: files not uploaded yet are moved and sent to the tracker on its machine (SSH)
  localRelease: boolean;
  sshHost: string | null;
  sshPort: number;
  sshUsername: string | null;
  hasSshPassword: boolean;
  hostWatchDir: string | null; // the watch folder as that machine sees it
  releaseDir: string | null;
  releaseTag: string | null;
  trackerCommand: string | null;
  createdAt: string;
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
  // Release: renamed into releaseDir/<name>/, then trackerCommand runs on it
  releaseDir: string;
  releaseTag: string | null;
  trackerCommand: string | null;
  releaseAuto: boolean;
  // Ultra-API restart over SSH: automatic when unreachable, last run and why it failed
  autoRestartApi: boolean;
  apiRestartAt: string | null;
  apiRestartError: string | null;
  apiRestarting: boolean;
  lastSpaceCheckAt: string | null;
  // From /api/space (missing until loaded)
  reachable?: boolean;
  freeSpaceBytes?: string;
  usedSpaceBytes?: string;
  totalSpaceBytes?: string;
}

export interface LocalFolder {
  key: 'watch' | 'downloads' | 'data' | 'logs';
  label: string;
  path: string;
}

/** A filesystem on the backend machine holding one or more of its folders */
export interface LocalDisk {
  id: string;
  mountPoint: string;
  device: string | null;
  fsType: string | null;
  kind: 'disk' | 'network' | 'shared' | 'memory' | 'other';
  totalBytes: string;
  freeBytes: string;
  usedBytes: string;
  folders: LocalFolder[];
}

export interface LocalDiskReport {
  sameDisk: boolean;
  disks: LocalDisk[];
  missing: (LocalFolder & { error: string })[];
}

export interface Stats {
  total: number;
  byStatus: Partial<Record<UploadStatus, number>>;
  byServer: Record<string, number>;
  completedBytes: string;
  queueSize: number;
}

export type RipStatus =
  | 'WAITING'
  | 'QUEUED'
  | 'UNPACKING'
  | 'SCANNING'
  | 'RIPPING'
  | 'JOINING'
  | 'DONE'
  | 'NEEDS_ATTENTION'
  | 'FAILED'
  | 'SKIPPED';

/** Where a RAR archive is unpacked: next to the downloads, or next to the watch folder */
export type UnpackDisk = 'downloads' | 'watch';

export interface DiscStream {
  type: 'video' | 'audio' | 'subtitle';
  lang?: string; // ISO 639-2 (ita, eng)
  langName?: string;
  codec?: string;
  channels?: number;
  forced: boolean;
  commentary: boolean;
}

export interface DiscTitle {
  index: number;
  name?: string;
  durationSec: number;
  sizeBytes: number;
  chapters: number;
  segmentsMap?: string;
  sourceFile?: string;
  outputFileName?: string;
  angle?: string;
  streams: DiscStream[];
}

export interface TmdbMovie {
  id: number;
  title: string;
  originalTitle: string;
  originalLanguage: string;
  year: number | null;
}

export interface Rip {
  id: string;
  sourcePath: string; // an archive: its first volume
  sourceType: 'ISO' | 'BDMV' | 'DVD' | 'RAR';
  downloadName: string;
  status: RipStatus;
  reason: string | null;
  // makemkv, or remux: ripped by the backend with mkvmerge/ffmpeg after MakeMKV failed
  engine: 'makemkv' | 'remux';
  // RAR archive: the film inside (once listed) and the disk it is unpacked on (null when not unpacked)
  contentType: 'ISO' | 'BDMV' | 'DVD' | 'MKV' | null;
  contentPath: string | null;
  unpackBytes: string | null; // bytes, serialized as string by the API
  unpackedTo: UnpackDisk | null;
  discName: string | null;
  titles: DiscTitle[] | null; // null until the disc is scanned
  titleIndex: number | null;
  // Discs of one film joined by hand: the first part's id, and this disc's place (1, 2...)
  joinId: string | null;
  joinPart: number | null;
  tmdbId: number | null;
  title: string | null; // localized (Italian) title
  originalTitle: string | null;
  originalLanguage: string | null; // ISO 639-1
  year: number | null;
  // ISO 639-2: audio kept beside the kept language when the disc has none in the original one (chosen by hand)
  secondLanguage: string | null;
  jobId: string | null;
  progress: number;
  outputFile: string | null; // path in the watch folder (or in the downloads' unpack folder), same as the upload's
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  upload: { id: string; status: UploadStatus; progress: number } | null;
  suggestion: { title: string; year: number | null }; // parsed from the download name
  canRipAgain: boolean; // done, and its disc still in the downloads
}

/** Ripping setup on the backend */
export interface RipperStatus {
  enabled: boolean;
  runnerAlive: boolean;
  tmdbConfigured: boolean;
  language: string; // ISO 639-1, kept with the film's original language
  minLength: number; // seconds
  exclusions: string[]; // discs whose path contains one are not ripped
  ignoredFolders: string[]; // folders of the downloads never searched (relative, "/" separators)
  arriveComplete: boolean; // downloads are moved to the downloads folder once complete: no quiet wait
  // RAR archives: unrar installed, the disks they can be unpacked on (one per disk), the downloads writable
  unpack?: {
    unrar: boolean;
    disks: { disk: UnpackDisk; freeBytes: number }[];
    downloadsWritable: boolean;
  };
  // Ripping without MakeMKV: mkvmerge (Blu-ray), 7-Zip (ISO images), ffmpeg with DVD support
  remux?: { mkvmerge: boolean; sevenZip: boolean; dvd: boolean } | null;
}

// Merging with Dyadrr (MERGE_ENABLED): the dyadrr container's runner checks in every 5 s
export interface MergeStatus {
  enabled: boolean;
  languageSupported: boolean; // Dyadrr only works with Italian (RIP_LANGUAGE=it)
  language: string;
  runnerAlive: boolean;
  runnerLastSeen: number | null; // seconds since the runner last checked in
  held: number; // files held for a merge
}

// Dyadrr's four choices (its docs/CLI.md): a fixed value for every merge, or 'ask' each time
export type MergeChoiceName = 'tail' | 'italian' | 'referenceItalianSubs' | 'edgeMismatch';
export type MergeChoiceSettings = Record<MergeChoiceName, string>;

// A source torrent's .torrent sent before its upload exists (bookrr, by hand): copied
// into its upload once the rip of its download is done (GET /api/source-torrents)
export interface SourceTorrent {
  infoHash: string;
  name: string; // the torrent's folder, or its file
  fileName: string;
  size: string; // BigInt as a string
  tracker: string;
  tmdbId: number | null;
  label: string | null;
  origin: string | null; // "bookrr", null by hand
  attachedAt: string | null;
  createdAt: string;
  uploadIds: string[]; // the uploads it was copied into
}

export type MergePairStatus = 'ANALYZING' | 'ELIGIBLE' | 'REFUSED' | 'ERROR' | 'CANCELLED' | 'MERGING' | 'MERGED';
export type MergeInputsAfter = 'keep' | 'delete';

// What the page shows of the merge's report
export interface MergeResult {
  decision: 'eligible' | 'refused' | 'error' | 'cancelled';
  reasons: { code: string; message: string }[];
  delivered: boolean;
  sizeBytes: number | null;
  durationMs: number | null;
  droppedSubtitles: unknown[];
  expect: { result: 'pass' | 'fail'; differences: string[] } | null;
  warnings: { code: string; message: string; source: string | null }[];
}

// What the page shows of Dyadrr's analyze report (the backend keeps the whole one)
export interface MergeSummary {
  dyadrr: string | null;
  decision: 'eligible' | 'refused' | 'error' | 'cancelled';
  reasons: { code: string; message: string }[];
  roles: { reference: 0 | 1; donor: 0 | 1 } | null; // 0: file A, 1: file B
  measureLanguage: string | null;
  offsetMs: number | null;
  dispersionMs: number | null;
  coverage: number | null; // 0-1
  film: { startMs: number; endMs: number } | null;
  commonMaterial: { startMs: number; endMs: number } | null;
  italian: { startMs: number | null; endMs: number | null } | null;
  audio: { id: number; name: string | null; role: string; taken: boolean | null }[];
  checkpoints?: { positionMs: number; outcome: string }[]; // where each checkpoint is, and how it went
  failedChecks: { name: string; code: string | null; blocking: boolean; detail: string | null }[];
  warnings: { code: string; message: string }[];
  choices: {
    name: MergeChoiceName;
    needed: boolean;
    status: 'decided' | 'pending' | 'ignored' | 'not-needed';
    value: string | null;
    effects: { value: string; italianStartMs: number | null; italianEndMs: number | null; warnings: string[] }[];
  }[];
}

export interface MergePair {
  id: string;
  uploadAId: string;
  uploadBId: string;
  fileA: string;
  fileB: string;
  originalLanguage: string | null;
  status: MergePairStatus;
  jobId: string | null;
  phase: string | null;
  progress: number | null;
  reasonCode: string | null;
  reasonMessage: string | null;
  dyadrrVersion: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  summary: MergeSummary | null;
  // The merge
  outputPath: string | null;
  mergeChoices: Record<string, string> | null;
  mergeReasonCode: string | null; // the last merge stopped or failed (the pair is eligible again)
  mergeReasonMessage: string | null;
  inputsAfter: MergeInputsAfter | null;
  outputUploadId: string | null;
  mergedAt: string | null;
  mergeSummary: MergeResult | null;
}

// A file that can be paired: on the disk, not uploading, not in a pair being analyzed
export interface MergeCandidate {
  id: string;
  filename: string;
  filepath: string;
  size: string;
  status: UploadStatus;
  hasItalianAudio: boolean;
  holdKind: HoldKind | null;
  holdMessage: string | null;
  mediaInfo: string | null;
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
  clients: TorrentClient[];
  clientsLoaded: boolean;
  spaceLoaded: boolean;
  stats: Stats | null;
  disks: LocalDiskReport | null;
  disksLoaded: boolean;
  connected: boolean;
  transfers: Record<string, Transfer>;
  // Live output of the tracker commands (WebSocket), by upload
  releaseLogs: Record<string, string>;
  filters: Filters;
  rips: Rip[];
  ripsLoaded: boolean;
  ripStatus: RipperStatus | null;
  mergePairs: MergePair[];
  mergePairsLoaded: boolean;

  loadUploads: () => Promise<void>;
  loadServers: () => Promise<void>;
  loadSpace: () => Promise<void>;
  loadClients: () => Promise<void>;
  loadStats: () => Promise<void>;
  loadDisks: () => Promise<void>;
  loadAll: () => Promise<void>;
  refreshUpload: (id: string) => Promise<void>;
  removeUpload: (id: string) => void;
  applyProgress: (id: string, progress: number, bytes: number) => void;
  setReleaseLog: (id: string, log: string) => void;
  setConnected: (connected: boolean) => void;
  setFilters: (filters: Partial<Filters>) => void;
  loadRips: () => Promise<void>;
  refreshRip: (id: string) => Promise<void>;
  removeRip: (id: string) => void;
  applyRipProgress: (id: string, progress: number, status?: 'UNPACKING' | 'RIPPING' | 'JOINING') => void;
  loadMergePairs: () => Promise<void>;
  refreshMergePair: (id: string) => Promise<void>;
  removeMergePair: (id: string) => void;
  applyMergeProgress: (id: string, phase: string | null, progress: number | null) => void;
}

const UPLOADS_LIMIT = 500;

export const useAppStore = create<AppState>((set, get) => ({
  uploads: [],
  uploadsLoaded: false,
  servers: [],
  serversLoaded: false,
  clients: [],
  clientsLoaded: false,
  spaceLoaded: false,
  stats: null,
  disks: null,
  disksLoaded: false,
  connected: false,
  transfers: {},
  releaseLogs: {},
  filters: { status: 'ALL', serverId: 'ALL', search: '' },
  rips: [],
  ripsLoaded: false,
  ripStatus: null,
  mergePairs: [],
  mergePairsLoaded: false,

  loadUploads: async () => {
    const { data } = await uploadsApi.listUploads({ limit: UPLOADS_LIMIT });
    // The list has no tracker output: keep what an upload page fetched
    const logs = new Map(get().uploads.filter((u) => u.releaseLog !== undefined).map((u) => [u.id, u.releaseLog]));
    set({
      uploads: ((data.uploads ?? []) as Upload[]).map((u) => (logs.has(u.id) ? { ...u, releaseLog: logs.get(u.id) } : u)),
      uploadsLoaded: true,
    });
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

  loadClients: async () => {
    const { data } = await clientsApi.listClients();
    set({ clients: data, clientsLoaded: true });
  },

  loadStats: async () => {
    const { data } = await uploadsApi.getStats();
    set({ stats: data });
  },

  loadDisks: async () => {
    try {
      const { data } = await systemApi.getDisks();
      set({ disks: data });
    } finally {
      set({ disksLoaded: true });
    }
  },

  loadAll: async () => {
    await Promise.allSettled([
      get().loadUploads(),
      get().loadServers(),
      get().loadStats(),
      get().loadRips(),
      get().loadMergePairs(),
      get().loadDisks(),
      get().loadClients(),
    ]);
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

  setReleaseLog: (id, log) => set((state) => ({ releaseLogs: { ...state.releaseLogs, [id]: log } })),

  setConnected: (connected) => set({ connected }),

  setFilters: (filters) => set((state) => ({ filters: { ...state.filters, ...filters } })),

  // A backend without ripping (or with it broken) leaves the list as it is
  loadRips: async () => {
    try {
      const { data } = await ripsApi.listRips();
      set({ rips: data.rips ?? [], ripStatus: data.status ?? null, ripsLoaded: true });
    } catch {
      set({ ripsLoaded: true });
    }
  },

  refreshRip: async (id) => {
    try {
      const { data } = await ripsApi.getRip(id);
      set((state) => {
        const exists = state.rips.some((r) => r.id === id);
        return { rips: exists ? state.rips.map((r) => (r.id === id ? data : r)) : [data, ...state.rips] };
      });
    } catch (err) {
      if ((err as { response?: { status?: number } })?.response?.status === 404) get().removeRip(id);
    }
  },

  removeRip: (id) => set((state) => ({ rips: state.rips.filter((r) => r.id !== id) })),

  loadMergePairs: async () => {
    try {
      const { data } = await mergeApi.listPairs();
      set({ mergePairs: data, mergePairsLoaded: true });
    } catch {
      set({ mergePairsLoaded: true });
    }
  },

  refreshMergePair: async (id) => {
    try {
      const { data } = await mergeApi.getPair(id);
      set((state) => {
        const exists = state.mergePairs.some((p) => p.id === id);
        return { mergePairs: exists ? state.mergePairs.map((p) => (p.id === id ? data : p)) : [data, ...state.mergePairs] };
      });
    } catch {
      // Removed meanwhile: the next list load drops it
    }
  },

  removeMergePair: (id) => set((state) => ({ mergePairs: state.mergePairs.filter((p) => p.id !== id) })),

  // A late progress event must not bring back an analysis that has ended
  applyMergeProgress: (id, phase, progress) =>
    set((state) => ({
      mergePairs: state.mergePairs.map((p) =>
        p.id === id && (p.status === 'ANALYZING' || p.status === 'MERGING') ? { ...p, phase, progress } : p
      ),
    })),

  // A late progress event must not bring back a rip that has already ended
  applyRipProgress: (id, progress, status = 'RIPPING') =>
    set((state) => ({
      rips: state.rips.map((r) =>
        r.id === id && (r.status === status || r.status === 'QUEUED' || (status === 'RIPPING' && r.status === 'SCANNING'))
          ? { ...r, status, progress }
          : r
      ),
    })),
}));

/** Total speed of the running transfers */
export const selectTotalSpeed = (state: AppState) =>
  state.uploads
    .filter((u) => u.status === 'UPLOADING')
    .reduce((sum, u) => sum + (state.transfers[u.id]?.speed ?? 0), 0);
