import { PrismaClient, Prisma, Upload, Server, TorrentClient } from '@prisma/client';
import logger from '../config/logger.js';

export class DatabaseService {
  private prisma = new PrismaClient({
    log: [{ emit: 'event' as const, level: 'error' as const }],
  });

  constructor() {

    this.prisma.$on('error', (e) => {
      logger.error(e, 'Prisma error');
    });
  }

  // Server queries
  async getServers(): Promise<Server[]> {
    return this.prisma.server.findMany();
  }

  async getServerById(id: string): Promise<Server | null> {
    return this.prisma.server.findUnique({ where: { id } });
  }

  async createServer(data: {
    name: string;
    apiEndpoint: string;
    apiToken: string;
    sshHost: string;
    sshPort?: number;
    sshUsername: string;
    sshPassword?: string;
    sshPath?: string;
    maxRetries?: number;
    backoffStrategy?: string;
    mediaCheckPolicy?: string;
  }): Promise<Server> {
    return this.prisma.server.create({ data });
  }

  async updateServer(id: string, data: Prisma.ServerUpdateInput): Promise<Server> {
    return this.prisma.server.update({ where: { id }, data });
  }

  async deleteServer(id: string): Promise<Server> {
    return this.prisma.server.delete({ where: { id } });
  }

  async updateServerCachedSpace(
    id: string,
    freeSpaceBytes: bigint
  ): Promise<Server> {
    return this.prisma.server.update({
      where: { id },
      data: {
        cachedFreeSpaceBytes: freeSpaceBytes,
        lastSpaceCheckAt: new Date(),
      },
    });
  }

  // Upload queries
  async getUploads(
    limit?: number,
    offset?: number
  ): Promise<{ uploads: Upload[]; total: number }> {
    const [uploads, total] = await Promise.all([
      this.prisma.upload.findMany({
        orderBy: { createdAt: 'desc' },
        take: limit || 50,
        skip: offset || 0,
        include: { server: { select: { id: true, name: true, sshPath: true } } },
      }),
      this.prisma.upload.count(),
    ]);

    return { uploads, total };
  }

  async getUploadById(id: string): Promise<Upload | null> {
    return this.prisma.upload.findUnique({
      where: { id },
      include: { server: { select: { id: true, name: true, sshPath: true } } },
    });
  }

  async createUpload(data: {
    filename: string;
    filepath: string;
    size: bigint;
    status?: string;
  }): Promise<Upload> {
    return this.prisma.upload.create({ data });
  }

  async updateUpload(id: string, data: Prisma.UploadUncheckedUpdateInput): Promise<Upload> {
    return this.prisma.upload.update({ where: { id }, data });
  }

  async getUploadsByStatus(status: string): Promise<Upload[]> {
    return this.prisma.upload.findMany({
      where: { status },
      include: { server: { select: { id: true, name: true, sshPath: true } } },
    });
  }

  async deleteUpload(id: string): Promise<Upload> {
    return this.prisma.upload.delete({ where: { id } });
  }

  async getUploadStats(): Promise<{
    total: number;
    byStatus: Record<string, number>;
    byServer: Record<string, number>;
    completedBytes: bigint;
  }> {
    const [statusGroups, serverGroups, completed] = await Promise.all([
      this.prisma.upload.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.upload.groupBy({ by: ['serverId'], _count: { _all: true } }),
      this.prisma.upload.aggregate({ where: { status: 'COMPLETED' }, _sum: { size: true } }),
    ]);

    const byStatus: Record<string, number> = {};
    let total = 0;
    for (const group of statusGroups) {
      byStatus[group.status] = group._count._all;
      total += group._count._all;
    }

    const byServer: Record<string, number> = {};
    for (const group of serverGroups) {
      if (group.serverId) byServer[group.serverId] = group._count._all;
    }

    return { total, byStatus, byServer, completedBytes: completed._sum.size ?? 0n };
  }

  async getUploadsByTorrentStatus(torrentStatus: string): Promise<Upload[]> {
    return this.prisma.upload.findMany({ where: { torrentStatus } });
  }

  /** Marks every upload waiting on this torrent at once (a disc often gives several MKVs) */
  async updateUploadsByTorrentHash(
    torrentHash: string,
    fromStatuses: string[],
    data: Prisma.UploadUncheckedUpdateManyInput
  ): Promise<string[]> {
    const uploads = await this.prisma.upload.findMany({
      where: { torrentHash, torrentStatus: { in: fromStatuses } },
      select: { id: true },
    });
    await this.prisma.upload.updateMany({ where: { id: { in: uploads.map((u) => u.id) } }, data });
    return uploads.map((u) => u.id);
  }

  // Torrent client queries
  async getTorrentClients(): Promise<TorrentClient[]> {
    return this.prisma.torrentClient.findMany({ orderBy: { createdAt: 'asc' } });
  }

  async getTorrentClientById(id: string): Promise<TorrentClient | null> {
    return this.prisma.torrentClient.findUnique({ where: { id } });
  }

  async createTorrentClient(data: Prisma.TorrentClientCreateInput): Promise<TorrentClient> {
    return this.prisma.torrentClient.create({ data });
  }

  async updateTorrentClient(id: string, data: Prisma.TorrentClientUpdateInput): Promise<TorrentClient> {
    return this.prisma.torrentClient.update({ where: { id }, data });
  }

  async deleteTorrentClient(id: string): Promise<TorrentClient> {
    return this.prisma.torrentClient.delete({ where: { id } });
  }

  // Settings
  async getSetting(key: string): Promise<string | null> {
    return (await this.prisma.setting.findUnique({ where: { key } }))?.value ?? null;
  }

  async setSetting(key: string, value: string | null): Promise<void> {
    if (value === null) {
      await this.prisma.setting.deleteMany({ where: { key } });
    } else {
      await this.prisma.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
    }
  }

  async disconnect(): Promise<void> {
    await this.prisma.$disconnect();
  }
}

export const db = new DatabaseService();
