// Media information types
export interface AudioTrack {
  language: string;
  codec: string;
  index: number;
}

export interface SubtitleTrack {
  language: string;
  codec: string;
  index: number;
}

export interface MediaInfo {
  audioTracks: AudioTrack[];
  subtitles: SubtitleTrack[];
  hasItalianAudio: boolean;
  hasItalianSubtitles: boolean;
}

// Upload types
export interface UploadProgress {
  uploadId: string;
  progress: number;
  progressBytes: bigint;
  totalBytes: bigint;
  timestamp: number;
}

// Server types
export interface ServerSpaceInfo {
  serverId: string;
  freeSpaceBytes: bigint;
  usedSpaceBytes: bigint;
  totalSpaceBytes: bigint;
}

export interface SelectedServer {
  serverId: string;
  freeSpaceBytes: bigint;
}

// Local disk types (the machine Wayfinderr runs on)
export interface LocalFolder {
  key: 'watch' | 'data';
  label: string;
  path: string;
}

// disk: block device; network: NFS/SMB/sshfs; shared: host folder seen from a VM or Docker Desktop
export type LocalDiskKind = 'disk' | 'network' | 'shared' | 'memory' | 'other';

export interface LocalDisk {
  id: string;
  mountPoint: string;
  device: string | null;
  fsType: string | null;
  kind: LocalDiskKind;
  totalBytes: bigint;
  freeBytes: bigint;
  usedBytes: bigint;
  folders: LocalFolder[];
}

export interface LocalDiskReport {
  sameDisk: boolean;
  disks: LocalDisk[];
  missing: (LocalFolder & { error: string })[];
}

// Config types
export interface Config {
  NODE_ENV: 'development' | 'production';
  PORT: number;
  DATABASE_URL: string;
  WATCH_DIR: string;
  WATCH_USE_POLLING: boolean;
  LOG_LEVEL: string;
  MAX_CONCURRENT_UPLOADS: number;
  SSH_PRIVATE_KEY_PATH?: string;
}
