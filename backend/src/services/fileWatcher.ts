import chokidar from 'chokidar';
import { EventEmitter } from 'events';
import { Dirent, promises as fs } from 'fs';
import path from 'path';
import logger from '../config/logger.js';
import { config } from '../config/index.js';

export interface FileDetectedEvent {
  filepath: string;
  filename: string;
}

interface ScannedFile {
  filepath: string;
  size: number;
  mtimeMs: number;
}

// Ignore dot files/folders and temporary files
const IGNORED = /(^|[\/\\])\.|~tmp/;
// MakeMKV writes big files slowly: wait until the size is stable for 30s
const STABILITY_MS = 30_000;
// The whole folder is also rescanned on this interval: on Docker Desktop and
// network mounts the watcher can miss files, especially inside subfolders.
// The rescan waits twice as long, so normally the watcher picks the file first.
const RESCAN_INTERVAL_MS = 30_000;
const RESCAN_STABILITY_MS = 2 * STABILITY_MS;

const isMkv = (filepath: string) => path.extname(filepath).toLowerCase() === '.mkv';

export class FileWatcher extends EventEmitter {
  private watcher: chokidar.FSWatcher | null = null;
  private watchDir: string;
  // Files already handled, by absolute path. 'existing' were there at startup
  // and are not uploaded (like ignoreInitial), 'detected' were already emitted.
  private known: Map<string, 'existing' | 'detected'> = new Map();
  // Files found by the rescan, waiting until they stop changing
  private pending: Map<string, ScannedFile & { since: number }> = new Map();
  private baselineDone = false;
  private rescanTimer: NodeJS.Timeout | null = null;
  private stopped = false;

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
        awaitWriteFinish: {
          stabilityThreshold: STABILITY_MS,
          pollInterval: 1000,
        },
        ignored: IGNORED,
      });

      this.watcher.on('add', (filepath: string) => {
        // Only monitor .mkv files
        if (isMkv(filepath)) this.detect(filepath);
      });

      this.watcher.on('unlink', (filepath: string) => this.forget(filepath));

      this.watcher.on('error', (error: Error) => {
        logger.error({ error }, 'File watcher error');
        this.emit('error', error);
      });

      // First run records the files already there, the next ones pick up new files
      this.stopped = false;
      this.scheduleRescan(0);

      logger.info('File watcher started successfully');
    } catch (error) {
      logger.error({ error }, 'Failed to start file watcher');
      throw error;
    }
  }

  stop(): Promise<void> {
    this.stopped = true;
    if (this.rescanTimer) {
      clearTimeout(this.rescanTimer);
      this.rescanTimer = null;
    }
    return new Promise((resolve, reject) => {
      if (this.watcher) {
        this.watcher.close().then(resolve).catch(reject);
      } else {
        resolve();
      }
    });
  }

  private detect(filepath: string): void {
    const key = path.resolve(filepath);
    if (this.known.get(key) === 'detected') return;
    this.known.set(key, 'detected');
    this.pending.delete(key);

    logger.info({ filepath }, 'New MKV file detected');
    const filename = path.basename(filepath);
    this.emit('file-detected', { filepath, filename } as FileDetectedEvent);
  }

  private forget(filepath: string): void {
    const key = path.resolve(filepath);
    this.known.delete(key);
    this.pending.delete(key);
  }

  private scheduleRescan(delay: number): void {
    this.rescanTimer = setTimeout(() => {
      this.rescan()
        .catch((error) => logger.error({ error }, 'Folder rescan failed'))
        .finally(() => {
          if (!this.stopped) this.scheduleRescan(RESCAN_INTERVAL_MS);
        });
    }, delay);
  }

  private async rescan(): Promise<void> {
    const knownBefore = new Set(this.known.keys());
    const found = new Map<string, ScannedFile>();
    const complete = await this.walk(this.watchDir, found);
    if (this.stopped) return;

    if (!this.baselineDone) {
      for (const key of found.keys()) {
        if (!this.known.has(key)) this.known.set(key, 'existing');
      }
      // Retry on the next run if a folder could not be read, so that files
      // already there are never taken for new ones
      this.baselineDone = complete;
      return;
    }

    const now = Date.now();
    for (const [key, file] of found) {
      if (this.known.has(key)) {
        this.pending.delete(key);
        continue;
      }
      const prev = this.pending.get(key);
      if (!prev || prev.size !== file.size || prev.mtimeMs !== file.mtimeMs) {
        this.pending.set(key, { ...file, since: now });
      } else if (now - prev.since >= RESCAN_STABILITY_MS) {
        logger.warn({ filepath: file.filepath }, 'MKV file found by the folder rescan, missed by the watcher');
        this.detect(file.filepath);
      }
    }

    // Forget files that are gone, so a new file with the same path is picked up.
    // Only after a full scan, and only files known before it started.
    if (complete) {
      for (const key of this.pending.keys()) {
        if (!found.has(key)) this.pending.delete(key);
      }
      for (const key of knownBefore) {
        if (!found.has(key)) this.known.delete(key);
      }
    }
  }

  /**
   * Collects the .mkv files under dir, subfolders included.
   * Returns false if some folder could not be read.
   */
  private async walk(dir: string, found: Map<string, ScannedFile>): Promise<boolean> {
    let entries: Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (error) {
      logger.debug({ dir, error: (error as Error).message }, 'Rescan: cannot read folder');
      return false;
    }

    let complete = true;
    for (const entry of entries) {
      if (this.stopped) return false;
      if (IGNORED.test(entry.name)) continue;
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        complete = (await this.walk(fullPath, found)) && complete;
      } else if (entry.isFile() && isMkv(entry.name)) {
        try {
          const stats = await fs.stat(fullPath);
          found.set(path.resolve(fullPath), {
            filepath: fullPath,
            size: stats.size,
            mtimeMs: stats.mtimeMs,
          });
        } catch {
          // Removed while scanning
        }
      }
    }
    return complete;
  }
}

export const fileWatcher = new FileWatcher(config.WATCH_DIR);
