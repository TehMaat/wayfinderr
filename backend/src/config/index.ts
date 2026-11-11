import path from 'path';
import { Config } from '../types/index.js';

// Load backend/.env when present (local run). In Docker the variables come from compose.
try {
  process.loadEnvFile();
} catch {
  // No .env file: rely on the process environment
}

// Prisma resolves a relative SQLite path against the folder of schema.prisma
const PRISMA_DIR = path.resolve(__dirname, '../../prisma');

/** The folder of the SQLite database: the data volume (/app/data in Docker). */
export const dataDir = (databaseUrl: string): string => {
  const file = databaseUrl.startsWith('file:') ? databaseUrl.slice('file:'.length).split('?')[0] : './data/wayfinderr.db';
  return path.dirname(path.resolve(PRISMA_DIR, file));
};

/** A whole number from the environment, or the default when unset or invalid (never negative). */
const wholeNumber = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return value !== undefined && value.trim() !== '' && Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
};

export const loadConfig = (): Config => {
  const databaseUrl = process.env.DATABASE_URL || 'file:./data/wayfinderr.db';
  const watchDir = process.env.WATCH_DIR || '/makemkv-output';
  const sourceDir = process.env.RIP_SOURCE_DIR || '/downloads';
  return {
    NODE_ENV: (process.env.NODE_ENV as 'development' | 'production') || 'development',
    PORT: parseInt(process.env.PORT || '3001', 10),
    DATABASE_URL: databaseUrl,
    WATCH_DIR: watchDir,
    WATCH_USE_POLLING: process.env.WATCH_USE_POLLING === 'true',
    LOG_LEVEL: process.env.LOG_LEVEL || 'info',
    MAX_CONCURRENT_UPLOADS: parseInt(process.env.MAX_CONCURRENT_UPLOADS || '2', 10),
    SSH_PRIVATE_KEY_PATH: process.env.SSH_PRIVATE_KEY_PATH || undefined,
    DELETE_AFTER_UPLOAD: process.env.DELETE_AFTER_UPLOAD === 'true',
    RIP: {
      ENABLED: process.env.RIP_ENABLED === 'true',
      SOURCE_DIR: sourceDir,
      WORK_DIR: process.env.RIP_WORK_DIR || path.join(watchDir, '.wayfinderr'),
      QUIET_MINUTES: parseInt(process.env.RIP_QUIET_MINUTES || '10', 10),
      MIN_LENGTH: parseInt(process.env.RIP_MIN_LENGTH || '2700', 10),
      RIP_EXISTING: process.env.RIP_EXISTING === 'true',
      LANGUAGE: process.env.RIP_LANGUAGE || 'it',
      TMDB_API_KEY: process.env.TMDB_API_KEY || undefined,
      TMDB_LANGUAGE: process.env.TMDB_LANGUAGE || 'it-IT',
      TMDB_API_URL: process.env.TMDB_API_URL || 'https://api.themoviedb.org/3',
      UNRAR_PATH: process.env.UNRAR_PATH || 'unrar',
      // Rip without MakeMKV (remux): Blu-ray with mkvmerge (ISOs extracted with 7-Zip), DVD with ffmpeg
      MKVMERGE_PATH: process.env.MKVMERGE_PATH || 'mkvmerge',
      SEVENZIP_PATH: process.env.SEVENZIP_PATH || '7zz',
      FFMPEG_PATH: process.env.FFMPEG_PATH || 'ffmpeg',
      FFPROBE_PATH: process.env.FFPROBE_PATH || 'ffprobe',
    },
    MERGE: {
      ENABLED: process.env.MERGE_ENABLED === 'true',
      // Fixed by Dyadrr's file job protocol: /data/watch/.wayfinderr/dyadrr/jobs in its container
      JOBS_DIR: path.join(watchDir, '.wayfinderr', 'dyadrr', 'jobs'),
      // The folders the dyadrr service mounts as /data/<name> (docker-compose.yml)
      FOLDERS: [
        { name: 'watch', dir: watchDir },
        { name: 'downloads', dir: sourceDir },
      ],
    },
    LOGS: {
      DIR: path.resolve(process.env.LOG_DIR || path.join(dataDir(databaseUrl), 'logs')),
      RETENTION_DAYS: wholeNumber(process.env.LOG_RETENTION_DAYS, 30),
      MAX_SIZE_MB: wholeNumber(process.env.LOG_MAX_SIZE_MB, 500),
    },
  };
};

export const config = loadConfig();
