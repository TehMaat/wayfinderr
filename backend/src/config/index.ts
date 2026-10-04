import { Config } from '../types/index.js';

// Load backend/.env when present (local run). In Docker the variables come from compose.
try {
  process.loadEnvFile();
} catch {
  // No .env file: rely on the process environment
}

export const loadConfig = (): Config => {
  return {
    NODE_ENV: (process.env.NODE_ENV as 'development' | 'production') || 'development',
    PORT: parseInt(process.env.PORT || '3001', 10),
    DATABASE_URL: process.env.DATABASE_URL || 'file:./data/wayfinderr.db',
    WATCH_DIR: process.env.WATCH_DIR || '/makemkv-output',
    WATCH_USE_POLLING: process.env.WATCH_USE_POLLING === 'true',
    LOG_LEVEL: process.env.LOG_LEVEL || 'info',
    MAX_CONCURRENT_UPLOADS: parseInt(process.env.MAX_CONCURRENT_UPLOADS || '2', 10),
    SSH_PRIVATE_KEY_PATH: process.env.SSH_PRIVATE_KEY_PATH || undefined,
  };
};

export const config = loadConfig();
