import { PrismaClient, Upload, Server } from '@prisma/client';
import logger from '../config/logger.js';

export class DatabaseService {
  private prisma: PrismaClient;

  constructor() {
    this.prisma = new PrismaClient({
      log: [{ emit: 'event', level: 'error' }],
    });

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
    sshPath?: string;
    maxRetries?: number;
    backoffStrategy?: string;
    mediaCheckPolicy?: string;
  }): Promise<Server> {
    return this.prisma.server.create({ data });
  }

  async updateServer(id: string, data: Partial<Server>): Promise<Server> {
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
        include: { server: true },
      }),
      this.prisma.upload.count(),
    ]);

    return { uploads, total };
  }

  async getUploadById(id: string): Promise<Upload | null> {
    return this.prisma.upload.findUnique({
      where: { id },
      include: { server: true },
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

  async updateUpload(id: string, data: Partial<Upload>): Promise<Upload> {
    return this.prisma.upload.update({ where: { id }, data });
  }

  async getUploadsByStatus(status: string): Promise<Upload[]> {
    return this.prisma.upload.findMany({
      where: { status },
      include: { server: true },
    });
  }

  async disconnect(): Promise<void> {
    await this.prisma.$disconnect();
  }
}

export const db = new DatabaseService();
