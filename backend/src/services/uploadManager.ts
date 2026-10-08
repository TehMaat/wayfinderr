import { EventEmitter } from 'events';
import { readFileSync, statSync } from 'fs';
import path from 'path';
import { setTimeout as sleep } from 'timers/promises';
import { Client as SSHClient, ConnectConfig, SFTPWrapper } from 'ssh2';
import logger from '../config/logger.js';
import { config } from '../config/index.js';
import { db } from './database.js';
import { Server } from '@prisma/client';

export interface UploadOptions {
  uploadId: string;
  filepath: string;
  server: Server;
  // Aborted when the user stops the upload
  signal?: AbortSignal;
  onProgress: (progress: number, bytes: bigint) => void;
}

// Emit progress at most this often (DB writes + WebSocket messages)
const PROGRESS_INTERVAL_MS = 1000;

// SFTP writes kept in flight, like OpenSSH sftp/scp (-R 64 -B 32768).
// One write at a time (as sftp.createWriteStream does) waits a full round
// trip per chunk: 64 KiB every ~30 ms caps the upload at ~2 MiB/s.
const SFTP_CONCURRENCY = 64;
const SFTP_CHUNK_SIZE = 32 * 1024;

// Max wait for the removal of the partial file when an upload is stopped
const CLEANUP_TIMEOUT_MS = 5000;

const sftpCall = <T = void>(fn: (cb: (err: Error | null | undefined, res?: T) => void) => void) =>
  new Promise<T>((resolve, reject) => {
    fn((err, res) => (err ? reject(err) : resolve(res as T)));
  });

export class UploadManager extends EventEmitter {
  private activeConnections: Set<SSHClient> = new Set();

  async uploadFile(options: UploadOptions): Promise<boolean> {
    const { uploadId, filepath, server, signal, onProgress } = options;
    signal?.throwIfAborted();

    logger.info(
      { uploadId, serverId: server.id, filepath },
      'Starting file upload'
    );

    const fileSize = statSync(filepath).size;
    const filename = path.basename(filepath);

    await db.updateUpload(uploadId, {
      status: 'UPLOADING',
      startedAt: new Date(),
      size: BigInt(fileSize),
      progress: 0,
      progressBytes: 0n,
    });

    const remoteDir = server.sshPath.replace(/\\/g, '/').replace(/\/+$/, '') || '/';
    const remotePath = path.posix.join(remoteDir, filename);
    // Upload under a temporary name so the destination never sees a partial file
    const tempPath = path.posix.join(remoteDir, `.${filename}.part`);

    const ssh = await this.connect(server);
    // Ends the transfer on a stop or a dropped connection. On a drop, ssh2's
    // fastPut would wait forever for the reply to its handle CLOSE
    let interrupt!: (error: Error) => void;
    const interrupted = new Promise<never>((_, reject) => (interrupt = reject));
    interrupted.catch(() => undefined);
    const onAbort = () => interrupt(new Error('Upload stopped'));
    ssh.once('close', () => interrupt(new Error('SSH connection closed')));
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      signal?.throwIfAborted();
      const sftp = await sftpCall<SFTPWrapper>((cb) => ssh.sftp(cb));

      await this.ensureRemoteDir(sftp, remoteDir);
      signal?.throwIfAborted();

      let lastEmit = 0;
      const transfer = sftpCall((cb) =>
        sftp.fastPut(
          filepath,
          tempPath,
          {
            concurrency: SFTP_CONCURRENCY,
            chunkSize: SFTP_CHUNK_SIZE,
            step: (transferred) => {
              if (signal?.aborted) return;
              const now = Date.now();
              if (now - lastEmit < PROGRESS_INTERVAL_MS) return;
              lastEmit = now;
              const progress = fileSize > 0 ? Math.floor((transferred / fileSize) * 100) : 100;
              onProgress(progress, BigInt(transferred));
            },
          },
          cb
        )
      );
      try {
        await Promise.race([transfer, interrupted]);
      } catch (error) {
        if (signal?.aborted) {
          // Writes still in flight go to the unlinked file, freed when the
          // connection closes
          await Promise.race([
            sftpCall((cb) => sftp.unlink(tempPath, cb)),
            sleep(CLEANUP_TIMEOUT_MS),
          ]).catch((err) =>
            logger.warn({ uploadId, tempPath, error: (err as Error).message }, 'Could not remove partial file')
          );
        }
        throw error;
      }

      // Verify the size, then move the file into place
      const stats = await sftpCall<{ size: number }>((cb) => sftp.stat(tempPath, cb));
      if (stats.size !== fileSize) {
        throw new Error(`Remote size mismatch: ${stats.size} != ${fileSize}`);
      }
      await sftpCall((cb) => sftp.unlink(remotePath, cb)).catch(() => undefined);
      await sftpCall((cb) => sftp.rename(tempPath, remotePath, cb));

      onProgress(100, BigInt(fileSize));
      logger.info({ uploadId, remotePath }, 'Upload completed');
      return true;
    } finally {
      signal?.removeEventListener('abort', onAbort);
      ssh.end();
    }
  }

  async uploadWithRetry(options: UploadOptions): Promise<boolean> {
    const { uploadId, server, signal } = options;

    let lastError: Error | null = null;
    const maxRetries = server.maxRetries || 3;
    const backoffStrategy = server.backoffStrategy || 'exponential';

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        logger.info(
          { uploadId, attempt: attempt + 1, maxRetries },
          'Upload attempt'
        );

        await db.updateUpload(uploadId, { currentRetryCount: attempt });
        const success = await this.uploadFile(options);

        if (success) {
          logger.info({ uploadId }, 'Upload successful');
          await db.updateUpload(uploadId, {
            status: 'COMPLETED',
            completedAt: new Date(),
            progress: 100,
            error: null,
          });
          return true;
        }
      } catch (error) {
        if (signal?.aborted) throw error;
        lastError = error as Error;
        logger.warn(
          { uploadId, attempt: attempt + 1, error: lastError.message },
          'Upload attempt failed'
        );

        if (attempt < maxRetries - 1) {
          const delay = this.calculateBackoff(attempt, backoffStrategy);
          logger.info({ uploadId, delay }, `Retrying after ${delay}ms`);
          await sleep(delay, undefined, { signal });
        }
      }
    }

    logger.error(
      { uploadId, maxRetries, lastError: lastError?.message },
      'Upload failed after all retries'
    );

    await db.updateUpload(uploadId, {
      status: 'FAILED',
      error: lastError?.message || 'Unknown error',
      currentRetryCount: maxRetries,
    });

    return false;
  }

  /**
   * Opens an SSH connection, checks SFTP and the destination folder, then closes it.
   */
  async testConnection(server: Server): Promise<void> {
    const ssh = await this.connect(server);
    try {
      const sftp = await sftpCall<SFTPWrapper>((cb) => ssh.sftp(cb));
      await this.ensureRemoteDir(sftp, server.sshPath.replace(/\/+$/, '') || '/');
    } finally {
      ssh.end();
    }
  }

  private calculateBackoff(attempt: number, strategy: string): number {
    if (strategy === 'linear') {
      return (attempt + 1) * 10_000; // 10s, 20s, 30s
    }
    // exponential: 5s, 10s, 20s...
    return Math.pow(2, attempt) * 5_000;
  }

  private async ensureRemoteDir(sftp: SFTPWrapper, dir: string): Promise<void> {
    const parts = dir.split('/').filter(Boolean);
    let current = dir.startsWith('/') ? '' : '.';
    for (const part of parts) {
      current = `${current}/${part}`;
      const exists = await sftpCall<unknown>((cb) => sftp.stat(current, cb))
        .then(() => true)
        .catch(() => false);
      if (!exists) {
        await sftpCall((cb) => sftp.mkdir(current, cb));
      }
    }
  }

  private connect(server: Server): Promise<SSHClient> {
    const connectConfig: ConnectConfig = {
      host: server.sshHost,
      port: server.sshPort,
      username: server.sshUsername,
      readyTimeout: 20000,
      keepaliveInterval: 15000,
    };

    if (server.sshPassword) {
      connectConfig.password = server.sshPassword;
    } else if (config.SSH_PRIVATE_KEY_PATH) {
      connectConfig.privateKey = readFileSync(config.SSH_PRIVATE_KEY_PATH);
    } else {
      return Promise.reject(
        new Error('No SSH credentials: set a password on the server or SSH_PRIVATE_KEY_PATH')
      );
    }

    return new Promise((resolve, reject) => {
      const conn = new SSHClient();
      let ready = false;

      conn.on('ready', () => {
        ready = true;
        logger.info({ serverId: server.id }, 'SSH connection established');
        this.activeConnections.add(conn);
        resolve(conn);
      });

      conn.on('error', (err) => {
        logger.error({ serverId: server.id, error: err.message }, 'SSH connection error');
        if (!ready) reject(err);
      });

      conn.on('close', () => {
        this.activeConnections.delete(conn);
      });

      conn.connect(connectConfig);
    });
  }

  close(): void {
    for (const conn of this.activeConnections) {
      conn.end();
    }
    this.activeConnections.clear();
    logger.info('All SSH connections closed');
  }
}

export const uploadManager = new UploadManager();
