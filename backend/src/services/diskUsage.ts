import { promises as fs } from 'fs';
import path from 'path';
import { config } from '../config/index.js';
import { LocalDisk, LocalDiskKind, LocalDiskReport, LocalFolder } from '../types/index.js';

interface Mount {
  mountPoint: string;
  fsType: string;
  source: string;
}

// Prisma resolves a relative SQLite path against the folder of schema.prisma
const PRISMA_DIR = path.resolve(__dirname, '../../prisma');

const NETWORK_FS = /^(nfs4?|cifs|smb3?|smbfs|afs|ceph|glusterfs|sshfs|davfs|fuse\.(sshfs|rclone|s3fs|davfs|glusterfs))$/;
// Host folders seen from a VM or from Docker Desktop
const SHARED_FS = /^(9p|virtiofs|fakeowner|grpcfuse|fuse\.grpcfuse|vboxsf|prl_fs|drvfs)$/;
const MEMORY_FS = /^(tmpfs|ramfs)$/;

/** The folders Wayfinderr keeps data in on this machine */
const localFolders = (): LocalFolder[] => {
  const folders: LocalFolder[] = [
    { key: 'watch', label: 'Watch folder', path: path.resolve(config.WATCH_DIR) },
  ];
  if (config.DATABASE_URL.startsWith('file:')) {
    const file = config.DATABASE_URL.slice('file:'.length).split('?')[0];
    folders.push({ key: 'data', label: 'Database', path: path.dirname(path.resolve(PRISMA_DIR, file)) });
  }
  return folders;
};

// /proc/self/mountinfo escapes spaces and tabs as \040, \011...
const unescapeMount = (value: string) =>
  value.replace(/\\([0-7]{3})/g, (_, octal: string) => String.fromCharCode(parseInt(octal, 8)));

/** Linux only: lets us name the device and the filesystem type (block storage, NFS, Docker volume...) */
const readMounts = async (): Promise<Mount[]> => {
  if (process.platform !== 'linux') return [];
  try {
    const text = await fs.readFile('/proc/self/mountinfo', 'utf8');
    return text.split('\n').flatMap((line) => {
      const [left, right] = line.split(' - ');
      const mountPoint = left?.split(' ')[4];
      const [fsType, source] = right?.split(' ') ?? [];
      return mountPoint && fsType ? [{ mountPoint: unescapeMount(mountPoint), fsType, source: unescapeMount(source ?? '') }] : [];
    });
  } catch {
    return [];
  }
};

/** Longest mount point containing the path; the last one wins when mounts are stacked */
const findMount = (mounts: Mount[], target: string): Mount | undefined => {
  let best: Mount | undefined;
  for (const mount of mounts) {
    const inside =
      target === mount.mountPoint || mount.mountPoint === '/' || target.startsWith(`${mount.mountPoint}/`);
    if (inside && (!best || mount.mountPoint.length >= best.mountPoint.length)) best = mount;
  }
  return best;
};

/** Without mountinfo (Windows, macOS): climb up while the parent is on the same device */
const climbToMountPoint = async (target: string, dev: bigint): Promise<string> => {
  let current = target;
  for (;;) {
    const parent = path.dirname(current);
    if (parent === current) return current;
    try {
      if ((await fs.stat(parent, { bigint: true })).dev !== dev) return current;
    } catch {
      return current;
    }
    current = parent;
  }
};

const kindOf = (mountPoint: string, mount: Mount | undefined): LocalDiskKind => {
  if (!mount) return mountPoint.startsWith('\\\\') ? 'network' : 'disk';
  if (NETWORK_FS.test(mount.fsType)) return 'network';
  if (SHARED_FS.test(mount.fsType)) return 'shared';
  if (MEMORY_FS.test(mount.fsType)) return 'memory';
  return mount.source.startsWith('/dev/') || mount.fsType === 'zfs' ? 'disk' : 'other';
};

/**
 * Free/used space of every filesystem holding one of the app folders.
 * Folders on the same filesystem are grouped, so a single entry means they share a disk.
 */
export const getLocalDisks = async (): Promise<LocalDiskReport> => {
  const mounts = await readMounts();
  const disks = new Map<string, LocalDisk>();
  const missing: LocalDiskReport['missing'] = [];

  for (const folder of localFolders()) {
    try {
      const real = await fs.realpath(folder.path);
      const [stat, statfs] = await Promise.all([fs.stat(real, { bigint: true }), fs.statfs(real, { bigint: true })]);
      const mount = findMount(mounts, real);
      // Same block device = same filesystem, even when st_dev differs (btrfs subvolumes)
      const id = mount?.source.startsWith('/dev/') ? mount.source : `dev:${stat.dev}`;

      const existing = disks.get(id);
      if (existing) {
        existing.folders.push(folder);
        continue;
      }

      const mountPoint = mount?.mountPoint ?? (await climbToMountPoint(real, stat.dev));
      disks.set(id, {
        id,
        mountPoint,
        device: mount?.source || null,
        fsType: mount?.fsType ?? null,
        kind: kindOf(mountPoint, mount),
        totalBytes: statfs.blocks * statfs.bsize,
        // What can still be written (excludes the blocks reserved for root)
        freeBytes: statfs.bavail * statfs.bsize,
        usedBytes: (statfs.blocks - statfs.bfree) * statfs.bsize,
        folders: [folder],
      });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      missing.push({ ...folder, error: code === 'ENOENT' ? 'Folder not found' : (error as Error).message });
    }
  }

  return { sameDisk: disks.size <= 1, disks: [...disks.values()], missing };
};
