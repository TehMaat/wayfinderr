import axios from 'axios';
import { EventEmitter } from 'events';
import { setTimeout as sleep } from 'timers/promises';
import logger from '../config/logger.js';
import { db } from './database.js';
import { remoteDirOf, uploadManager } from './uploadManager.js';
import { readSpaceOverSsh, SshSpace } from './sshSpace.js';
import { autoRestartDue, isTokenError, runRestartScript, tail, UltraApiError } from './ultraApi.js';
import { ServerSpaceInfo, SelectedServer, SpaceSource } from '../types/index.js';
import { Server } from '@prisma/client';

interface UltraAPIResponse {
  service_stats_info: {
    free_storage_bytes: number;
    free_storage_gb: number;
    used_storage_value: number;
    used_storage_unit: string;
    total_storage_value: number;
    total_storage_unit: string;
  };
}

// "1.5", "TB" -> bytes (Ultra.cc reports binary units)
const toBytes = (value: number | undefined, unit: string | undefined): bigint => {
  if (value === undefined || value === null || !unit) return 0n;
  const powers: Record<string, number> = { B: 0, K: 1, M: 2, G: 3, T: 4, P: 5 };
  const power = powers[unit.trim().charAt(0).toUpperCase()] ?? 0;
  return BigInt(Math.round(Number(value) * Math.pow(1024, power)));
};

export interface ApiRestartResult {
  ok: boolean;
  message: string;
  // Script output (end of it), for the toast details
  output: string;
  freeSpaceGB?: string;
}

export class ApiRestartBusyError extends Error {}

// The script can also print the API token: never pass it on
const hideToken = (text: string, token: string) => (token ? text.split(token).join('***') : text);

// After the script: how often and how many times the API is checked again
const VERIFY_DELAY_MS = 5_000;
const VERIFY_ATTEMPTS = 6;

// Reading the space over SSH: the quota command and statvfs answer at once
const SSH_SPACE_TIMEOUT_MS = 30_000;

const withTimeout = <T>(promise: Promise<T>, ms: number, message: string): Promise<T> => {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error(message)), ms)));
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
};

/**
 * Emits 'api-restarting' { serverId, auto } when an Ultra-API restart starts
 * and 'api-restarted' { serverId, ok, message, auto } when it ends.
 */
export class ServerManager extends EventEmitter {
  private cacheTimeout = 60000; // 60 seconds cache
  // Used/total are not stored in the DB: keep the last values in memory
  private capacity: Map<string, { used: bigint; total: bigint }> = new Map();
  // Where each server's last space came from (the API, or SSH while it is unreachable)
  private source: Map<string, SpaceSource> = new Map();
  // Ultra-API restarts running, and when each server's last one started
  // (the DB value of a Server object read earlier can be older)
  private restarting = new Set<string>();
  private restartStartedAt = new Map<string, Date>();

  /**
   * A server's space: from the cache (60 s), else its storage API. When the API cannot
   * be reached, over SSH instead (quota, else the disk: see sshSpace.ts), so the server
   * still takes uploads; sshFallback false reads the API only (the check after a restart).
   */
  async getServerSpace(server: Server, force = false, sshFallback = true): Promise<ServerSpaceInfo | null> {
    // Check cache first
    const source = this.source.get(server.id);
    if (
      !force &&
      // After a restart used/total are unknown: fetch once to fill them in
      this.capacity.has(server.id) &&
      source &&
      (sshFallback || source === 'api') &&
      server.lastSpaceCheckAt &&
      Date.now() - server.lastSpaceCheckAt.getTime() < this.cacheTimeout &&
      server.cachedFreeSpaceBytes
    ) {
      logger.debug({ serverId: server.id, cached: true, source }, 'Using cached server space');
      return {
        serverId: server.id,
        freeSpaceBytes: server.cachedFreeSpaceBytes,
        usedSpaceBytes: this.capacity.get(server.id)?.used ?? 0n,
        totalSpaceBytes: this.capacity.get(server.id)?.total ?? 0n,
        source,
      };
    }

    try {
      return await this.spaceFromApi(server);
    } catch (error) {
      // Log only message and status: the axios error carries the request
      // headers, including the API token
      const status = axios.isAxiosError(error) ? error.response?.status : undefined;
      logger.error(
        {
          serverId: server.id,
          error: (error as Error).message,
          status,
        },
        'Failed to fetch server space'
      );
      if (axios.isAxiosError(error) && !isTokenError(status)) this.maybeAutoRestart(server);
      return sshFallback ? this.spaceOverSsh(server) : null;
    }
  }

  private async spaceFromApi(server: Server): Promise<ServerSpaceInfo> {
    logger.info({ serverId: server.id }, 'Fetching space from Ultra.cc API');

    const response = await axios.get<UltraAPIResponse>(server.apiEndpoint, {
      headers: {
        Authorization: `Bearer ${server.apiToken}`,
      },
      timeout: 5000,
    });

    const stats = response.data.service_stats_info;
    const freeSpaceBytes = BigInt(stats.free_storage_bytes);
    const usedSpaceBytes = toBytes(stats.used_storage_value, stats.used_storage_unit);
    let totalSpaceBytes = toBytes(stats.total_storage_value, stats.total_storage_unit);
    if (totalSpaceBytes < freeSpaceBytes) totalSpaceBytes = freeSpaceBytes + usedSpaceBytes;

    const space = await this.remember(server, { freeSpaceBytes, usedSpaceBytes, totalSpaceBytes, source: 'api' });
    logger.info({ serverId: server.id, freeSpaceBytes: freeSpaceBytes.toString() }, 'Space fetched successfully');
    return space;
  }

  /** The space read over SSH, when the storage API is unreachable (null: SSH failed too) */
  private async spaceOverSsh(server: Server): Promise<ServerSpaceInfo | null> {
    try {
      const ssh = await uploadManager.connect(server);
      let read: SshSpace;
      try {
        read = await withTimeout(readSpaceOverSsh(ssh, remoteDirOf(server)), SSH_SPACE_TIMEOUT_MS, 'Reading the space over SSH timed out');
      } finally {
        ssh.end();
      }
      const { method, ...bytes } = read;
      const space = await this.remember(server, { ...bytes, source: method });
      logger.warn(
        { serverId: server.id, method, freeSpaceBytes: space.freeSpaceBytes.toString() },
        'Storage API unreachable: space read over SSH'
      );
      return space;
    } catch (error) {
      logger.error({ serverId: server.id, error: (error as Error).message }, 'Failed to read the space over SSH');
      return null;
    }
  }

  /** Keeps the space: free in the DB (cache), used/total and the source in memory */
  private async remember(server: Server, space: Omit<ServerSpaceInfo, 'serverId'>): Promise<ServerSpaceInfo> {
    this.capacity.set(server.id, { used: space.usedSpaceBytes, total: space.totalSpaceBytes });
    this.source.set(server.id, space.source);
    await db.updateServerCachedSpace(server.id, space.freeSpaceBytes);
    return { serverId: server.id, ...space };
  }

  /** Unreachable API on a server with the automatic restart on: restart it in the background */
  private maybeAutoRestart(server: Server) {
    if (!server.autoRestartApi || this.restarting.has(server.id)) return;
    const memory = this.restartStartedAt.get(server.id);
    const last = memory && (!server.apiRestartAt || memory > server.apiRestartAt) ? memory : server.apiRestartAt;
    if (!autoRestartDue(last)) return;
    logger.warn({ serverId: server.id }, 'Ultra-API unreachable: restarting it automatically');
    this.restartApi(server, true).catch(() => undefined);
  }

  isRestartingApi(serverId: string) {
    return this.restarting.has(serverId);
  }

  /**
   * Runs Ultra's Ultra-API script over SSH, picks "Restart", then checks the API again
   * for up to VERIFY_DELAY_MS x VERIFY_ATTEMPTS. One restart per server at a time.
   */
  async restartApi(server: Server, auto = false): Promise<ApiRestartResult> {
    if (this.restarting.has(server.id)) {
      throw new ApiRestartBusyError('The Ultra-API of this server is already restarting');
    }
    this.restarting.add(server.id);
    const startedAt = new Date();
    this.restartStartedAt.set(server.id, startedAt);
    this.emit('api-restarting', { serverId: server.id, auto });

    let result: ApiRestartResult;
    try {
      logger.info({ serverId: server.id, auto }, 'Restarting the Ultra-API');
      let output = '';
      try {
        const ssh = await uploadManager.connect(server);
        try {
          output = hideToken((await runRestartScript(ssh)).output, server.apiToken);
        } finally {
          ssh.end();
        }
      } catch (error) {
        const message = (error as Error).message;
        throw new UltraApiError(
          error instanceof UltraApiError ? message : `SSH failed: ${message}`,
          error instanceof UltraApiError ? hideToken(error.output, server.apiToken) : ''
        );
      }

      let space: ServerSpaceInfo | null = null;
      for (let attempt = 0; attempt < VERIFY_ATTEMPTS && !space; attempt++) {
        await sleep(VERIFY_DELAY_MS);
        space = await this.getServerSpace(server, true, false);
      }

      result = space
        ? {
            ok: true,
            message: 'Ultra-API restarted, the API is reachable again',
            output: tail(output),
            freeSpaceGB: (Number(space.freeSpaceBytes) / 1024 / 1024 / 1024).toFixed(2),
          }
        : {
            ok: false,
            message: 'Ultra-API restarted, but the API is still unreachable',
            output: tail(output),
          };
    } catch (error) {
      result = {
        ok: false,
        message: (error as Error).message,
        output: tail(error instanceof UltraApiError ? error.output : ''),
      };
    } finally {
      this.restarting.delete(server.id);
    }

    const outcome = { serverId: server.id, auto, message: result.message };
    if (result.ok) logger.info(outcome, 'Ultra-API restart finished');
    else logger.warn(outcome, 'Ultra-API restart failed');
    await db
      .updateServer(server.id, { apiRestartAt: startedAt, apiRestartError: result.ok ? null : result.message })
      .catch((error: Error) => logger.error({ serverId: server.id, error: error.message }, 'Failed to save the restart'));
    this.emit('api-restarted', { serverId: server.id, ok: result.ok, message: result.message, auto });
    return result;
  }

  async getAllServersSpace(): Promise<ServerSpaceInfo[]> {
    const servers = await db.getServers();
    const spaceInfos: ServerSpaceInfo[] = [];

    for (const server of servers) {
      const space = await this.getServerSpace(server);
      if (space) {
        spaceInfos.push(space);
      }
    }

    return spaceInfos;
  }

  async selectBestServer(): Promise<SelectedServer | null> {
    const spaceInfos = await this.getAllServersSpace();

    if (spaceInfos.length === 0) {
      logger.error('No servers available for selection');
      return null;
    }

    // Sort by free space descending, select the one with most free space
    spaceInfos.sort((a, b) =>
      b.freeSpaceBytes > a.freeSpaceBytes ? 1 : b.freeSpaceBytes < a.freeSpaceBytes ? -1 : 0
    );

    const selected = spaceInfos[0];

    logger.info(
      {
        serverId: selected.serverId,
        freeSpaceBytes: selected.freeSpaceBytes.toString(),
      },
      'Selected best server'
    );

    return {
      serverId: selected.serverId,
      freeSpaceBytes: selected.freeSpaceBytes,
    };
  }

  /**
   * Servers with at least minFreeBytes free, sorted by free space (most free first).
   */
  async getUploadCandidates(minFreeBytes = 0n): Promise<SelectedServer[]> {
    const spaceInfos = await this.getAllServersSpace();

    const candidates = spaceInfos
      .filter((s) => s.freeSpaceBytes >= minFreeBytes)
      .sort((a, b) => (b.freeSpaceBytes > a.freeSpaceBytes ? 1 : b.freeSpaceBytes < a.freeSpaceBytes ? -1 : 0));

    logger.info(
      {
        minFreeBytes: minFreeBytes.toString(),
        servers: spaceInfos.map((s) => ({
          id: s.serverId,
          free: s.freeSpaceBytes.toString(),
        })),
        candidates: candidates.map((c) => c.serverId),
      },
      'Upload candidates computed'
    );

    return candidates.map((c) => ({ serverId: c.serverId, freeSpaceBytes: c.freeSpaceBytes }));
  }
}

export const serverManager = new ServerManager();
