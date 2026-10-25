import { PrismaClient, Prisma, Rip, Upload, Server, TorrentClient } from '@prisma/client';
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
  // The .torrent files are only sent on their own; the list also leaves out the
  // tracker command's output (up to 64 KB each)
  private uploadFields = (...left: Prisma.UploadScalarFieldEnum[]) =>
    Object.fromEntries(
      Object.values(Prisma.UploadScalarFieldEnum)
        .filter((field) => field !== 'releaseTorrentData' && field !== 'torrentFileData' && !left.includes(field))
        .map((field) => [field, true])
    ) as Record<Prisma.UploadScalarFieldEnum, boolean>;
  private listFields = this.uploadFields('releaseLog');
  private detailFields = this.uploadFields();

  async getUploads(
    limit?: number,
    offset?: number
  ): Promise<{ uploads: Upload[]; total: number }> {
    const [uploads, total] = await Promise.all([
      this.prisma.upload.findMany({
        orderBy: { createdAt: 'desc' },
        take: limit || 50,
        skip: offset || 0,
        select: {
          ...this.listFields,
          server: { select: { id: true, name: true, sshPath: true } },
          localClient: { select: { id: true, name: true } },
        },
      }) as Promise<Upload[]>,
      this.prisma.upload.count(),
    ]);

    return { uploads, total };
  }

  async getUploadById(id: string): Promise<Upload | null> {
    return this.prisma.upload.findUnique({
      where: { id },
      select: {
        ...this.detailFields,
        server: { select: { id: true, name: true, sshPath: true } },
        localClient: { select: { id: true, name: true } },
      },
    }) as Promise<Upload | null>;
  }

  async getUploadTorrent(id: string): Promise<{ name: string; data: Buffer } | null> {
    const upload = await this.prisma.upload.findUnique({
      where: { id },
      select: { releaseTorrentName: true, releaseTorrentData: true },
    });
    return upload?.releaseTorrentName && upload.releaseTorrentData
      ? { name: upload.releaseTorrentName, data: Buffer.from(upload.releaseTorrentData) }
      : null;
  }

  async getSourceTorrentFile(id: string): Promise<{ name: string; data: Buffer } | null> {
    const upload = await this.prisma.upload.findUnique({
      where: { id },
      select: { torrentFileName: true, torrentFileData: true },
    });
    return upload?.torrentFileName && upload.torrentFileData
      ? { name: upload.torrentFileName, data: Buffer.from(upload.torrentFileData) }
      : null;
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
    return this.prisma.upload.update({ where: { id }, data, select: this.detailFields }) as Promise<Upload>;
  }

  async getUploadsByStatus(status: string): Promise<Upload[]> {
    return this.prisma.upload.findMany({
      where: { status },
      include: { server: { select: { id: true, name: true, sshPath: true } } },
    });
  }

  async getUploadsByReleaseStatus(releaseStatus: string): Promise<Upload[]> {
    return this.prisma.upload.findMany({ where: { releaseStatus }, orderBy: { updatedAt: 'asc' } });
  }

  /** Uploads whose tracker command printed a TMDB id, not read yet (released before it was kept) */
  async getUploadsWithUnreadTmdb(): Promise<{ id: string; releaseLog: string | null }[]> {
    return this.prisma.upload.findMany({
      where: { tmdbId: null, releaseLog: { contains: "'TMDB ID'" } },
      select: { id: true, releaseLog: true },
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

  // Rip queries
  async getRips(): Promise<Rip[]> {
    return this.prisma.rip.findMany({ orderBy: { createdAt: 'desc' } });
  }

  // The rips in the list (not removed from it)
  async getVisibleRips(): Promise<Rip[]> {
    return this.prisma.rip.findMany({ where: { hidden: false }, orderBy: { createdAt: 'desc' } });
  }

  async getRipById(id: string): Promise<Rip | null> {
    return this.prisma.rip.findUnique({ where: { id } });
  }

  async getRipsByStatus(statuses: string[], visibleOnly = false): Promise<Rip[]> {
    return this.prisma.rip.findMany({
      where: { status: { in: statuses }, ...(visibleOnly ? { hidden: false } : {}) },
      orderBy: { createdAt: 'asc' },
    });
  }

  async createRip(data: Prisma.RipCreateInput): Promise<Rip> {
    return this.prisma.rip.create({ data });
  }

  async updateRip(id: string, data: Prisma.RipUpdateInput): Promise<Rip> {
    return this.prisma.rip.update({ where: { id }, data });
  }

  /** Updates the rip only if it still matches `where` (null otherwise): it may have changed meanwhile. */
  async updateRipIf(id: string, where: Prisma.RipWhereInput, data: Prisma.RipUpdateManyMutationInput): Promise<Rip | null> {
    const { count } = await this.prisma.rip.updateMany({ where: { ...where, id }, data });
    return count ? this.prisma.rip.findUnique({ where: { id } }) : null;
  }

  // The rip that produced this file (the uploaded MKV)
  async getRipByOutputFile(outputFile: string): Promise<Rip | null> {
    return this.prisma.rip.findFirst({ where: { outputFile }, orderBy: { updatedAt: 'desc' } });
  }

  // Every rip of one download (a film can span several discs)
  async getRipsByDownloadName(downloadName: string): Promise<Rip[]> {
    return this.prisma.rip.findMany({ where: { downloadName } });
  }

  // The parts of a join, in order
  async getRipsByJoinId(joinId: string): Promise<Rip[]> {
    return this.prisma.rip.findMany({ where: { joinId }, orderBy: { joinPart: 'asc' } });
  }

  async deleteRip(id: string): Promise<Rip> {
    return this.prisma.rip.delete({ where: { id } });
  }

  // Rips whose archive is unpacked somewhere (or being unpacked)
  async getUnpackedRips(): Promise<Rip[]> {
    return this.prisma.rip.findMany({ where: { unpackedTo: { not: null } }, orderBy: { createdAt: 'asc' } });
  }

  // The rip's file goes to the upload queue: both or neither, even on a crash
  async updateRipWithUpload(
    id: string,
    data: Prisma.RipUpdateInput,
    upload: { filename: string; filepath: string; size: bigint }
  ): Promise<{ rip: Rip; upload: Upload }> {
    const [created, rip] = await this.prisma.$transaction([
      this.prisma.upload.create({ data: { ...upload, status: 'PENDING' } }),
      this.prisma.rip.update({ where: { id }, data }),
    ]);
    return { rip, upload: created };
  }

  // The server copy of an upload has the same file name
  async isUploadFileNameUsed(filename: string): Promise<boolean> {
    return (await this.prisma.upload.count({ where: { filename } })) > 0;
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
