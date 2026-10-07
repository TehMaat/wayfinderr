import path from 'path';
import { Config } from '../types/index.js';

// Load backend/.env when present (local run). In Docker the variables come from compose.
try {
  process.loadEnvFile();
} catch {
  // No .env file: rely on the process environment
}

export const loadConfig = (): Config => {
  const watchDir = process.env.WATCH_DIR || '/makemkv-output';
  return {
    NODE_ENV: (process.env.NODE_ENV as 'development' | 'production') || 'development',
    PORT: parseInt(process.env.PORT || '3001', 10),
    DATABASE_URL: process.env.DATABASE_URL || 'file:./data/wayfinderr.db',
    WATCH_DIR: watchDir,
    WATCH_USE_POLLING: process.env.WATCH_USE_POLLING === 'true',
    LOG_LEVEL: process.env.LOG_LEVEL || 'info',
    MAX_CONCURRENT_UPLOADS: parseInt(process.env.MAX_CONCURRENT_UPLOADS || '2', 10),
    SSH_PRIVATE_KEY_PATH: process.env.SSH_PRIVATE_KEY_PATH || undefined,
    DELETE_AFTER_UPLOAD: process.env.DELETE_AFTER_UPLOAD === 'true',
    RIP: {
      ENABLED: process.env.RIP_ENABLED === 'true',
      SOURCE_DIR: process.env.RIP_SOURCE_DIR || '/downloads',
      WORK_DIR: process.env.RIP_WORK_DIR || path.join(watchDir, '.wayfinderr'),
      QUIET_MINUTES: parseInt(process.env.RIP_QUIET_MINUTES || '10', 10),
      MIN_LENGTH: parseInt(process.env.RIP_MIN_LENGTH || '2700', 10),
      RIP_EXISTING: process.env.RIP_EXISTING === 'true',
      LANGUAGE: process.env.RIP_LANGUAGE || 'it',
      TMDB_API_KEY: process.env.TMDB_API_KEY || undefined,
      TMDB_LANGUAGE: process.env.TMDB_LANGUAGE || 'it-IT',
      TMDB_API_URL: process.env.TMDB_API_URL || 'https://api.themoviedb.org/3',
    },
  };
};

export const config = loadConfig();
