import PQueue from 'p-queue';
import { unlink } from 'fs/promises';
import { EventEmitter } from 'events';
import { setTimeout as sleep } from 'timers/promises';
import logger from '../config/logger.js';
import { config } from '../config/index.js';
import { db } from './database.js';
import { uploadManager } from './uploadManager.js';
import { serverManager } from './serverManager.js';

export interface UploadJob {
  uploadId: string;
  filepath: string;
}

// Queued or running upload. `started` is set when the queue picks it up:
// from then on the job itself writes the final status.
interface ActiveJob {
  controller: AbortController;
  started: boolean;
  done: Promise<void>;
}

const BUSY_WAIT_MS = 5000;
// How long a stop request waits for the running transfer to wind down
const CANCEL_WAIT_MS = 10_000;

export class JobQueue extends EventEmitter {
  private queue: PQueue;
  // Servers currently receiving a file (max 1 upload per server)
  private busyServers: Set<string> = new Set();
  private jobs: Map<string, ActiveJob> = new Map();

  constructor() {
    super();
    // Max N concurrent jobs globally, max 1 per server (see busyServers)
    this.queue = new PQueue({ concurrency: config.MAX_CONCURRENT_UPLOADS });
  }

  /**
   * Adds the upload to the queue and returns immediately.
   */
  async enqueueUpload(job: UploadJob): Promise<void> {
    if (this.jobs.has(job.uploadId)) {
      logger.warn({ uploadId: job.uploadId }, 'Upload already queued');
      return;
    }
    logger.info({ uploadId: job.uploadId }, 'Adding upload to queue');

    await db.updateUpload(job.uploadId, { status: 'QUEUED' });

    const controller = new AbortController();
    const active = { controller, started: false } as ActiveJob;
    active.done = this.queue
      .add(async () => {
        // Stopped while waiting in the queue: the status is already CANCELLED
        if (controller.signal.aborted) return;
        active.started = true;
        await this.processUpload(job, controller.signal);
      })
      .catch((error) => logger.error({ uploadId: job.uploadId, error }, 'Queue job crashed'))
      .finally(() => {
        if (this.jobs.get(job.uploadId) === active) this.jobs.delete(job.uploadId);
      });
    this.jobs.set(job.uploadId, active);
  }

  /**
   * Stops a queued or running upload. A running transfer is interrupted and its
   * partial remote file removed; resolves once that is done (or after
   * CANCEL_WAIT_MS, the job then finishes on its own).
   */
  async cancelUpload(uploadId: string): Promise<void> {
    const job = this.jobs.get(uploadId);
    logger.info({ uploadId, running: Boolean(job?.started) }, 'Stopping upload');

    if (job?.started) {
      job.controller.abort();
      await Promise.race([job.done, sleep(CANCEL_WAIT_MS)]);
      return;
    }

    // Not picked up by the queue yet: nothing else writes its status
    job?.controller.abort();
    this.jobs.delete(uploadId);
    await db.updateUpload(uploadId, { status: 'CANCELLED' });
    this.emit('upload-cancelled', { uploadId });
  }

  /**
   * Re-enqueues uploads left unfinished by a previous run (crash, restart).
   */
  async resumePending(): Promise<void> {
    // Read all of them first: enqueueing turns a PENDING upload into QUEUED
    const uploads = [];
    for (const status of ['PENDING', 'QUEUED', 'UPLOADING']) {
      uploads.push(...(await db.getUploadsByStatus(status)));
    }
    for (const upload of uploads) {
      logger.info({ uploadId: upload.id, status: upload.status }, 'Resuming unfinished upload');
      await this.enqueueUpload({ uploadId: upload.id, filepath: upload.filepath });
    }
  }

  private async processUpload(job: UploadJob, signal: AbortSignal): Promise<void> {
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
        signal.throwIfAborted();

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
          await sleep(BUSY_WAIT_MS, undefined, { signal });
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

      signal.throwIfAborted();
      await db.updateUpload(uploadId, {
        status: 'UPLOADING',
        serverId: server.id,
        error: null,
      });
      this.emit('upload-started', { uploadId, serverId: server.id });

      const success = await uploadManager.uploadWithRetry({
        uploadId,
        filepath,
        server,
        signal,
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
        if (config.DELETE_AFTER_UPLOAD) {
          // The copy on the server is complete: free the local disk
          await unlink(filepath)
            .then(() => logger.info({ uploadId, filepath }, 'Local file deleted after upload'))
            .catch((error) => logger.error({ uploadId, filepath, error }, 'Failed to delete local file'));
        }
        this.emit('upload-completed', { uploadId });
      } else {
        logger.error({ uploadId }, 'Upload failed');
        this.emit('upload-failed', { uploadId });
      }
    } catch (error) {
      if (signal.aborted) {
        logger.info({ uploadId }, 'Upload stopped');
        await db.updateUpload(uploadId, { status: 'CANCELLED' });
        this.emit('upload-cancelled', { uploadId });
        return;
      }
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
