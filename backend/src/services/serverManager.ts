import axios from 'axios';
import { EventEmitter } from 'events';
import { setTimeout as sleep } from 'timers/promises';
import logger from '../config/logger.js';
import { db } from './database.js';
import { uploadManager } from './uploadManager.js';
import { autoRestartDue, isTokenError, runRestartScript, tail, UltraApiError } from './ultraApi.js';
import { ServerSpaceInfo, SelectedServer } from '../types/index.js';
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

/**
 * Emits 'api-restarting' { serverId, auto } when an Ultra-API restart starts
 * and 'api-restarted' { serverId, ok, message, auto } when it ends.
 */
export class ServerManager extends EventEmitter {
  private cacheTimeout = 60000; // 60 seconds cache
  // Used/total are not stored in the DB: keep the last values in memory
  private capacity: Map<string, { used: bigint; total: bigint }> = new Map();
  // Ultra-API restarts running, and when each server's last one started
  // (the DB value of a Server object read earlier can be older)
  private restarting = new Set<string>();
  private restartStartedAt = new Map<string, Date>();

  async getServerSpace(server: Server, force = false): Promise<ServerSpaceInfo | null> {
    try {
      // Check cache first
      if (
        !force &&
        // After a restart used/total are unknown: fetch once to fill them in
        this.capacity.has(server.id) &&
        server.lastSpaceCheckAt &&
        Date.now() - server.lastSpaceCheckAt.getTime() < this.cacheTimeout &&
        server.cachedFreeSpaceBytes
      ) {
        logger.debug(
          { serverId: server.id, cached: true },
          'Using cached server space'
        );
        return {
          serverId: server.id,
          freeSpaceBytes: server.cachedFreeSpaceBytes,
          usedSpaceBytes: this.capacity.get(server.id)?.used ?? 0n,
          totalSpaceBytes: this.capacity.get(server.id)?.total ?? 0n,
        };
      }

      // Fetch from API
      logger.info({ serverId: server.id }, 'Fetching space from Ultra.cc API');

      const response = await axios.get<UltraAPIResponse>(
        server.apiEndpoint,
        {
          headers: {
            Authorization: `Bearer ${server.apiToken}`,
          },
          timeout: 5000,
        }
      );

      const stats = response.data.service_stats_info;
      const freeSpaceBytes = BigInt(stats.free_storage_bytes);
      const usedSpaceBytes = toBytes(stats.used_storage_value, stats.used_storage_unit);
      let totalSpaceBytes = toBytes(stats.total_storage_value, stats.total_storage_unit);
      if (totalSpaceBytes < freeSpaceBytes) totalSpaceBytes = freeSpaceBytes + usedSpaceBytes;
      this.capacity.set(server.id, { used: usedSpaceBytes, total: totalSpaceBytes });

      // Update cache in database
      await db.updateServerCachedSpace(server.id, freeSpaceBytes);

      const serverSpace: ServerSpaceInfo = {
        serverId: server.id,
        freeSpaceBytes,
        usedSpaceBytes,
        totalSpaceBytes,
      };

      logger.info(
        { serverId: server.id, freeSpaceBytes: freeSpaceBytes.toString() },
        'Space fetched successfully'
      );

      return serverSpace;
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
      return null;
    }
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
        space = await this.getServerSpace(server, true);
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
