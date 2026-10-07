import { PrismaClient, Prisma, Rip, Upload, Server } from '@prisma/client';
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

  // Rip queries
  async getRips(): Promise<Rip[]> {
    return this.prisma.rip.findMany({ orderBy: { createdAt: 'desc' } });
  }

  async getRipById(id: string): Promise<Rip | null> {
    return this.prisma.rip.findUnique({ where: { id } });
  }

  async getRipsByStatus(statuses: string[]): Promise<Rip[]> {
    return this.prisma.rip.findMany({ where: { status: { in: statuses } }, orderBy: { createdAt: 'asc' } });
  }

  async createRip(data: Prisma.RipCreateInput): Promise<Rip> {
    return this.prisma.rip.create({ data });
  }

  async updateRip(id: string, data: Prisma.RipUpdateInput): Promise<Rip> {
    return this.prisma.rip.update({ where: { id }, data });
  }

  async deleteRip(id: string): Promise<Rip> {
    return this.prisma.rip.delete({ where: { id } });
  }

  async getUploadByPath(filepath: string): Promise<Upload | null> {
    return this.prisma.upload.findFirst({ where: { filepath }, orderBy: { createdAt: 'desc' } });
  }

  // Settings (key/value)
  async getSettings(keys: string[]): Promise<Record<string, string>> {
    const rows = await this.prisma.setting.findMany({ where: { key: { in: keys } } });
    return Object.fromEntries(rows.map((row) => [row.key, row.value]));
  }

  async setSettings(values: Record<string, string>): Promise<void> {
    await this.prisma.$transaction(
      Object.entries(values).map(([key, value]) =>
        this.prisma.setting.upsert({ where: { key }, create: { key, value }, update: { value } })
      )
    );
  }

  // Creates the setting only if it is missing; returns the stored value either way
  async getOrCreateSetting(key: string, create: () => string): Promise<string> {
    const existing = await this.prisma.setting.findUnique({ where: { key } });
    if (existing) return existing.value;
    try {
      return (await this.prisma.setting.create({ data: { key, value: create() } })).value;
    } catch (error) {
      // Created concurrently by another request
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return (await this.prisma.setting.findUniqueOrThrow({ where: { key } })).value;
      }
      throw error;
    }
  }

  // Adds 1 to a numeric setting (1 when missing) and writes the other values in
  // the same transaction; returns the new number
  async incrementSetting(key: string, values: Record<string, string> = {}): Promise<string> {
    return this.prisma.$transaction(async (tx) => {
      const current = Number((await tx.setting.findUnique({ where: { key } }))?.value ?? 1);
      const next = String((Number.isFinite(current) ? current : 1) + 1);
      for (const [name, value] of Object.entries({ ...values, [key]: next })) {
        await tx.setting.upsert({ where: { key: name }, create: { key: name, value }, update: { value } });
      }
      return next;
    });
  }

  async deleteSettings(keys: string[]): Promise<void> {
    await this.prisma.setting.deleteMany({ where: { key: { in: keys } } });
  }

  async disconnect(): Promise<void> {
    await this.prisma.$disconnect();
  }
}

export const db = new DatabaseService();
