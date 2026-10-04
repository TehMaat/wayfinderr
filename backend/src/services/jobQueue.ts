import PQueue from 'p-queue';
import { EventEmitter } from 'events';
import logger from '../config/logger.js';
import { config } from '../config/index.js';
import { db } from './database.js';
import { uploadManager } from './uploadManager.js';
import { serverManager } from './serverManager.js';

export interface UploadJob {
  uploadId: string;
  filepath: string;
}

const BUSY_WAIT_MS = 5000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class JobQueue extends EventEmitter {
  private queue: PQueue;
  // Servers currently receiving a file (max 1 upload per server)
  private busyServers: Set<string> = new Set();

  constructor() {
    super();
    // Max N concurrent jobs globally, max 1 per server (see busyServers)
    this.queue = new PQueue({ concurrency: config.MAX_CONCURRENT_UPLOADS });
  }

  /**
   * Adds the upload to the queue and returns immediately.
   */
  async enqueueUpload(job: UploadJob): Promise<void> {
    logger.info({ uploadId: job.uploadId }, 'Adding upload to queue');

    await db.updateUpload(job.uploadId, { status: 'QUEUED' });

    this.queue
      .add(() => this.processUpload(job))
      .catch((error) => logger.error({ uploadId: job.uploadId, error }, 'Queue job crashed'));
  }

  /**
   * Re-enqueues uploads left unfinished by a previous run (crash, restart).
   */
  async resumePending(): Promise<void> {
    for (const status of ['PENDING', 'QUEUED', 'UPLOADING']) {
      const uploads = await db.getUploadsByStatus(status);
      for (const upload of uploads) {
        logger.info({ uploadId: upload.id, status }, 'Resuming unfinished upload');
        await this.enqueueUpload({ uploadId: upload.id, filepath: upload.filepath });
      }
    }
  }

  private async processUpload(job: UploadJob): Promise<void> {
    const { uploadId, filepath } = job;
    let serverId: string | null = null;

    try {
      logger.info({ uploadId }, 'Processing upload from queue');

      const upload = await db.getUploadById(uploadId);
      if (!upload) {
        logger.error({ uploadId }, 'Upload not found');
        return;
      }

      // Pick the server with most free space that can hold the file and is not busy.
      // The busy check and the reservation happen with no await in between,
      // so two jobs can never reserve the same server.
      while (serverId === null) {
        const candidates = await serverManager.getUploadCandidates(upload.size);

        if (candidates.length === 0) {
          const servers = await db.getServers();
          const reason =
            servers.length === 0
              ? 'No servers configured'
              : 'No reachable server has enough free space for this file';
          logger.error({ uploadId }, reason);
          await db.updateUpload(uploadId, { status: 'FAILED', error: reason });
          this.emit('upload-failed', { uploadId });
          return;
        }

        const free = candidates.find((c) => !this.busyServers.has(c.serverId));
        if (free) {
          serverId = free.serverId;
          this.busyServers.add(serverId);
        } else {
          logger.debug({ uploadId }, 'All candidate servers busy, waiting');
          await sleep(BUSY_WAIT_MS);
        }
      }

      const server = await db.getServerById(serverId);
      if (!server) {
        throw new Error(`Server ${serverId} not found`);
      }

      // Check media policy
      if (
        server.mediaCheckPolicy === 'SKIP_NO_ITA' &&
        !upload.hasItalianAudio &&
        !upload.hasItalianSubtitles
      ) {
        logger.info(
          { uploadId, serverId: server.id },
          'Skipping: No Italian audio/subtitles'
        );
        await db.updateUpload(uploadId, {
          status: 'SKIPPED',
          error: 'No Italian audio or subtitles found',
        });
        this.emit('upload-skipped', { uploadId });
        return;
      }

      await db.updateUpload(uploadId, {
        status: 'UPLOADING',
        serverId: server.id,
        error: null,
      });

      const success = await uploadManager.uploadWithRetry({
        uploadId,
        filepath,
        server,
        onProgress: (progress, bytes) => {
          db.updateUpload(uploadId, {
            progress,
            progressBytes: bytes,
          }).catch((err) =>
            logger.error(err, 'Failed to update progress')
          );

          this.emit('progress', { uploadId, progress, bytes });
        },
      });

      if (success) {
        logger.info({ uploadId, serverId: server.id }, 'Upload completed');
        this.emit('upload-completed', { uploadId });
      } else {
        logger.error({ uploadId }, 'Upload failed');
        this.emit('upload-failed', { uploadId });
      }
    } catch (error) {
      logger.error({ uploadId, error }, 'Error processing upload job');
      await db.updateUpload(uploadId, {
        status: 'FAILED',
        error: (error as Error).message,
      });
      this.emit('upload-failed', { uploadId });
    } finally {
      if (serverId) {
        this.busyServers.delete(serverId);
      }
    }
  }

  getQueueSize(): number {
    return this.queue.size + this.queue.pending;
  }

  isPaused(): boolean {
    return this.queue.isPaused;
  }

  pause(): void {
    this.queue.pause();
    logger.info('Queue paused');
  }

  resume(): void {
    this.queue.start();
    logger.info('Queue resumed');
  }

  clear(): void {
    this.queue.clear();
    logger.info('Queue cleared');
  }
}

export const jobQueue = new JobQueue();
