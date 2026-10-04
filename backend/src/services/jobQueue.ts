import PQueue from 'p-queue';
import { EventEmitter } from 'events';
import logger from '../config/logger.js';
import { db } from './database.js';
import { uploadManager } from './uploadManager.js';
import { serverManager } from './serverManager.js';
import { mediaInfoParser } from './mediaInfo.js';

export interface UploadJob {
  uploadId: string;
  filepath: string;
}

export class JobQueue extends EventEmitter {
  private queue: PQueue;
  private processingByServer: Map<string, boolean> = new Map();

  constructor() {
    super();
    // Max 2 concurrent jobs globally, but with server-level concurrency control
    this.queue = new PQueue({ concurrency: 2 });
  }

  async enqueueUpload(job: UploadJob): Promise<void> {
    logger.info({ uploadId: job.uploadId }, 'Adding upload to queue');

    await this.queue.add(async () => {
      await this.processUpload(job);
    });
  }

  private async processUpload(job: UploadJob): Promise<void> {
    const { uploadId, filepath } = job;

    try {
      logger.info({ uploadId }, 'Processing upload from queue');

      // Get upload record
      const upload = await db.getUploadById(uploadId);
      if (!upload) {
        logger.error({ uploadId }, 'Upload not found');
        return;
      }

      // Check media requirement
      let mediaInfo = null;
      if (upload.mediaInfo) {
        mediaInfo = JSON.parse(upload.mediaInfo);
      }

      // Select server
      const selectedServer = await serverManager.selectServerForUpload();
      if (!selectedServer) {
        logger.error({ uploadId }, 'No server available');
        await db.updateUpload(uploadId, {
          status: 'FAILED',
          error: 'No server available',
        });
        return;
      }

      // Get server config
      const server = await db.getServerById(selectedServer.serverId);
      if (!server) {
        logger.error(
          { uploadId, serverId: selectedServer.serverId },
          'Server not found'
        );
        return;
      }

      // Check media policy
      if (server.mediaCheckPolicy === 'SKIP_NO_ITA') {
        if (!upload.hasItalianAudio && !upload.hasItalianSubtitles) {
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
      }

      // Prevent concurrent uploads to same server
      if (this.processingByServer.get(server.id)) {
        logger.info(
          { uploadId, serverId: server.id },
          'Server already processing, re-queueing'
        );
        await this.enqueueUpload(job);
        return;
      }

      this.processingByServer.set(server.id, true);

      try {
        // Mark as uploading
        await db.updateUpload(uploadId, {
          status: 'UPLOADING',
          serverId: server.id,
        });

        // Perform upload with retry
        const success = await uploadManager.uploadWithRetry({
          uploadId,
          filepath,
          server,
          onProgress: (progress, bytes) => {
            // Update progress in DB periodically
            db.updateUpload(uploadId, {
              progress,
              progressBytes: bytes,
            }).catch((err) =>
              logger.error(err, 'Failed to update progress')
            );

            // Emit progress event for WebSocket broadcast
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
      } finally {
        this.processingByServer.set(server.id, false);
      }
    } catch (error) {
      logger.error({ uploadId, error }, 'Error processing upload job');
      await db.updateUpload(uploadId, {
        status: 'FAILED',
        error: (error as Error).message,
      });
      this.emit('upload-failed', { uploadId });
    }
  }

  getQueueSize(): number {
    return this.queue.size;
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
