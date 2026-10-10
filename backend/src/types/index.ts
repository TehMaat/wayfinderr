// Media information types
// Fields beyond language/codec/index are optional: uploads probed by earlier
// versions only have those (the detail page probes them again on demand)
interface StreamFlags {
  title?: string | null;
  default?: boolean;
  forced?: boolean;
  bitrate?: number | null; // bits per second
}

export interface VideoTrack extends StreamFlags {
  index: number;
  codec: string;
  profile: string | null;
  width: number;
  height: number;
  aspectRatio: string | null; // display aspect ratio, "16:9"
  frameRate: number | null;
  bitDepth: number | null;
  pixelFormat: string | null;
  colorSpace: string | null; // bt709, bt2020nc
  hdr: string | null; // HDR10, HDR10+, HLG, Dolby Vision (+ its profile)
  language: string;
}

export interface AudioTrack extends StreamFlags {
  language: string;
  codec: string;
  index: number;
  profile?: string | null; // DTS-HD MA, LC
  channels?: number | null;
  channelLayout?: string | null; // 5.1(side)
  sampleRate?: number | null;
  bitDepth?: number | null;
  atmos?: boolean;
}

export interface SubtitleTrack extends StreamFlags {
  language: string;
  codec: string;
  index: number;
  hearingImpaired?: boolean;
  elements?: number | null; // number of captions (mkvmerge statistics tags)
}

export interface ContainerInfo {
  format: string; // "Matroska / WebM"
  title: string | null;
  duration: number | null; // seconds
  bitrate: number | null; // overall, bits per second
  chapters: number;
}

export interface MediaInfo {
  container?: ContainerInfo;
  videoTracks?: VideoTrack[];
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
  key: 'watch' | 'downloads' | 'data';
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
  DELETE_AFTER_UPLOAD: boolean;
  RIP: RipConfig;
}

// Automatic ripping of film discs found in the downloads folder (services/ripper)
export interface RipConfig {
  ENABLED: boolean;
  SOURCE_DIR: string; // downloads folder, as this container sees it
  WORK_DIR: string; // shared with the MakeMKV runner: jobs and rips in progress
  QUIET_MINUTES: number; // a download is complete when nothing changed for this long
  MIN_LENGTH: number; // seconds: shorter titles are never the film
  RIP_EXISTING: boolean; // also rip the downloads already there when ripping is first enabled
  LANGUAGE: string; // ISO 639-1: tracks always kept, besides the film's original language
  TMDB_API_KEY?: string;
  TMDB_LANGUAGE: string; // language of the title used for the file name
  TMDB_API_URL: string;
  UNRAR_PATH: string; // unrar command, for the RAR archives in the downloads
  // Rip without MakeMKV (see services/ripper/remux.ts)
  MKVMERGE_PATH: string; // Blu-ray
  SEVENZIP_PATH: string; // 7-Zip (7zz), to read ISO images
  FFMPEG_PATH: string; // DVD (needs the dvdvideo input)
  FFPROBE_PATH: string;
}
