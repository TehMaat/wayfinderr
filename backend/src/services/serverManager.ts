import axios, { AxiosError } from 'axios';
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

export class ServerManager {
  private cacheTimeout = 60000; // 60 seconds cache

  async getServerSpace(server: Server): Promise<ServerSpaceInfo | null> {
    try {
      // Check cache first
      if (
        server.lastSpaceCheckAt &&
        Date.now() - server.lastSpaceCheckAt.getTime() < this.cacheTimeout &&
        server.cachedFreeSpaceBytes
      ) {
        logger.info(
          { serverId: server.id, cached: true },
          'Using cached server space'
        );
        return {
          serverId: server.id,
          freeSpaceBytes: server.cachedFreeSpaceBytes,
          usedSpaceBytes: BigInt(0), // Not cached
          totalSpaceBytes: BigInt(0), // Not cached
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

      const freeSpaceBytes = BigInt(
        response.data.service_stats_info.free_storage_bytes
      );

      // Update cache in database
      await db.updateServerCachedSpace(server.id, freeSpaceBytes);

      const serverSpace: ServerSpaceInfo = {
        serverId: server.id,
        freeSpaceBytes,
        usedSpaceBytes: BigInt(0),
        totalSpaceBytes: BigInt(0),
      };

      logger.info(
        { serverId: server.id, freeSpaceBytes: freeSpaceBytes.toString() },
        'Space fetched successfully'
      );

      return serverSpace;
    } catch (error) {
      logger.error(
        { serverId: server.id, error },
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
    spaceInfos.sort(
      (a, b) => Number(b.freeSpaceBytes - a.freeSpaceBytes)
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

  async selectServerForUpload(excludeServerId?: string): Promise<SelectedServer | null> {
    const servers = await db.getServers();

    if (servers.length === 0) {
      logger.error('No servers configured');
      return null;
    }

    const spaceInfos = await this.getAllServersSpace();

    if (spaceInfos.length === 0) {
      logger.error('Could not fetch space info from any server');
      return null;
    }

    // Filter out excluded server
    let candidates = spaceInfos;
    if (excludeServerId) {
      candidates = candidates.filter((s) => s.serverId !== excludeServerId);
    }

    if (candidates.length === 0) {
      logger.warn('No servers available (all excluded or errored)');
      return null;
    }

    // Sort by free space descending
    candidates.sort((a, b) => Number(b.freeSpaceBytes - a.freeSpaceBytes));

    const selected = candidates[0];

    logger.info(
      {
        serverId: selected.serverId,
        freeSpaceBytes: selected.freeSpaceBytes.toString(),
        servers: spaceInfos.map((s) => ({
          id: s.serverId,
          free: s.freeSpaceBytes.toString(),
        })),
      },
      'Server selected for upload'
    );

    return selected;
  }
}

export const serverManager = new ServerManager();
