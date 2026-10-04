import axios from 'axios';
import logger from '../config/logger.js';
import { db } from './database.js';
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

export class ServerManager {
  private cacheTimeout = 60000; // 60 seconds cache
  // Used/total are not stored in the DB: keep the last values in memory
  private capacity: Map<string, { used: bigint; total: bigint }> = new Map();

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
      logger.error(
        {
          serverId: server.id,
          error: (error as Error).message,
          status: axios.isAxiosError(error) ? error.response?.status : undefined,
        },
        'Failed to fetch server space'
      );
      return null;
    }
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
