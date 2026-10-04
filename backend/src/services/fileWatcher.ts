import chokidar from 'chokidar';
import { EventEmitter } from 'events';
import path from 'path';
import logger from '../config/logger.js';
import { config } from '../config/index.js';

export interface FileDetectedEvent {
  filepath: string;
  filename: string;
}

export class FileWatcher extends EventEmitter {
  private watcher: chokidar.FSWatcher | null = null;
  private watchDir: string;

  constructor(watchDir: string) {
    super();
    this.watchDir = watchDir;
  }

  start(): void {
    try {
      logger.info({ watchDir: this.watchDir }, 'Starting file watcher');

      this.watcher = chokidar.watch(this.watchDir, {
        persistent: true,
        ignoreInitial: true,
        // Polling is needed when the folder is a Windows/network mount seen from Docker
        usePolling: config.WATCH_USE_POLLING,
        interval: 2000,
        // MakeMKV writes big files slowly: wait until the size is stable for 30s
        awaitWriteFinish: {
          stabilityThreshold: 30000,
          pollInterval: 1000,
        },
        // Ignore temporary files
        ignored: /(^|[\/\\])\.|~tmp/,
      });

      this.watcher.on('add', (filepath: string) => {
        // Only monitor .mkv files
        if (path.extname(filepath).toLowerCase() === '.mkv') {
          logger.info({ filepath }, 'New MKV file detected');
          const filename = path.basename(filepath);
          this.emit('file-detected', { filepath, filename } as FileDetectedEvent);
        }
      });

      this.watcher.on('error', (error: Error) => {
        logger.error({ error }, 'File watcher error');
        this.emit('error', error);
      });

      logger.info('File watcher started successfully');
    } catch (error) {
      logger.error({ error }, 'Failed to start file watcher');
      throw error;
    }
  }

  stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.watcher) {
        this.watcher.close().then(resolve).catch(reject);
      } else {
        resolve();
      }
    });
  }
}

export const fileWatcher = new FileWatcher(config.WATCH_DIR);
