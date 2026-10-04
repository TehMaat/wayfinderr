import { EventEmitter } from 'events';
import { createReadStream, statSync } from 'fs';
import path from 'path';
import { Client as SSHClient, ClientChannel } from 'ssh2';
import logger from '../config/logger.js';
import { db } from './database.js';
import { Server } from '@prisma/client';

export interface UploadOptions {
  uploadId: string;
  filepath: string;
  server: Server;
  onProgress: (progress: number, bytes: bigint) => void;
}

export class UploadManager extends EventEmitter {
  private sshConnections: Map<string, SSHClient> = new Map();

  async uploadFile(options: UploadOptions): Promise<boolean> {
    const { uploadId, filepath, server, onProgress } = options;

    try {
      logger.info(
        { uploadId, serverId: server.id, filepath },
        'Starting file upload'
      );

      // Get file size
      const fileStats = statSync(filepath);
      const fileSize = fileStats.size;
      const filename = path.basename(filepath);

      // Update upload status to UPLOADING
      await db.updateUpload(uploadId, {
        status: 'UPLOADING',
        startedAt: new Date(),
        size: BigInt(fileSize),
      });

      // Create SSH connection
      const ssh = await this.getSSHConnection(server);

      // Create SFTP client
      return new Promise((resolve, reject) => {
        ssh.sftp((err, sftp) => {
          if (err) {
            logger.error({ uploadId, error: err }, 'SFTP error');
            reject(err);
            return;
          }

          // Ensure remote directory exists
          const remotePath = path.join(
            server.sshPath,
            filename
          ).replace(/\\/g, '/'); // Convert to Unix path
          const remoteDir = path.dirname(remotePath).replace(/\\/g, '/');

          sftp.mkdir(remoteDir, true, async (err) => {
            if (err && err.code !== 2) {
              // 2 = directory exists
              logger.error({ uploadId, error: err }, 'Failed to create remote directory');
              reject(err);
              return;
            }

            // Upload file
            const readStream = createReadStream(filepath);
            const writeStream = sftp.createWriteStream(remotePath);
            let uploadedBytes = 0n;

            readStream.on('data', (chunk) => {
              uploadedBytes += BigInt(chunk.length);
              const progress = Math.floor(
                (Number(uploadedBytes) / fileSize) * 100
              );
              onProgress(progress, uploadedBytes);
            });

            readStream.on('error', (error) => {
              logger.error({ uploadId, error }, 'Read stream error');
              reject(error);
            });

            writeStream.on('error', (error) => {
              logger.error({ uploadId, error }, 'Write stream error');
              reject(error);
            });

            writeStream.on('close', async () => {
              logger.info(
                { uploadId, uploadedBytes: uploadedBytes.toString() },
                'Upload completed'
              );
              resolve(true);
            });

            readStream.pipe(writeStream);
          });
        });
      });
    } catch (error) {
      logger.error({ uploadId, error }, 'Upload failed');
      throw error;
    }
  }

  async uploadWithRetry(options: UploadOptions): Promise<boolean> {
    const { uploadId, server } = options;

    let lastError: Error | null = null;
    const maxRetries = server.maxRetries || 3;
    const backoffStrategy = server.backoffStrategy || 'exponential';

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        logger.info(
          { uploadId, attempt: attempt + 1, maxRetries },
          'Upload attempt'
        );

        const success = await this.uploadFile(options);

        if (success) {
          logger.info({ uploadId }, 'Upload successful');
          await db.updateUpload(uploadId, {
            status: 'COMPLETED',
            completedAt: new Date(),
            progress: 100,
          });
          return true;
        }
      } catch (error) {
        lastError = error as Error;
        logger.warn(
          { uploadId, attempt: attempt + 1, error: lastError.message },
          'Upload attempt failed'
        );

        if (attempt < maxRetries - 1) {
          const delay = this.calculateBackoff(
            attempt,
            backoffStrategy
          );
          logger.info(
            { uploadId, delay },
            `Retrying after ${delay}ms`
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    // All retries exhausted
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

  private calculateBackoff(attempt: number, strategy: string): number {
    if (strategy === 'linear') {
      return (attempt + 1) * 1000; // 1s, 2s, 3s
    } else {
      // exponential: 100ms, 200ms, 400ms
      return Math.pow(2, attempt) * 100;
    }
  }

  private async getSSHConnection(server: Server): Promise<SSHClient> {
    const connKey = server.id;

    // Return existing connection if available
    if (this.sshConnections.has(connKey)) {
      const conn = this.sshConnections.get(connKey)!;
      if (conn.hasConnection) {
        return conn;
      }
    }

    // Create new connection
    return new Promise((resolve, reject) => {
      const conn = new SSHClient();

      conn.on('error', (err) => {
        logger.error(
          { serverId: server.id, error: err },
          'SSH connection error'
        );
        this.sshConnections.delete(connKey);
      });

      conn.connect({
        host: server.sshHost,
        port: server.sshPort,
        username: server.sshUsername,
        readyTimeout: 10000,
      });

      conn.on('ready', () => {
        logger.info({ serverId: server.id }, 'SSH connection established');
        this.sshConnections.set(connKey, conn);
        resolve(conn);
      });
    });
  }

  close(): void {
    for (const [, conn] of this.sshConnections) {
      conn.end();
    }
    this.sshConnections.clear();
    logger.info('All SSH connections closed');
  }
}

export const uploadManager = new UploadManager();
