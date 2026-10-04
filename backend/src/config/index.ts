import { Config } from '../types/index.js';

export const loadConfig = (): Config => {
  return {
    NODE_ENV: (process.env.NODE_ENV as 'development' | 'production') || 'development',
    PORT: parseInt(process.env.PORT || '3001', 10),
    DATABASE_URL: process.env.DATABASE_URL || 'file:./data/wayfinderr.db',
    WATCH_DIR: process.env.WATCH_DIR || '/makemkv-output',
    LOG_LEVEL: process.env.LOG_LEVEL || 'info',
  };
};

export const config = loadConfig();
