import chokidar from 'chokidar';
import { EventEmitter } from 'events';
import path from 'path';
import logger from '../config/logger.js';

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
        awaitWriteFinish: {
          stabilityThreshold: 500,
          pollInterval: 100,
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

export const fileWatcher = new FileWatcher(process.env.WATCH_DIR || '/makemkv-output');
