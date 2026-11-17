import { existsSync, readdirSync, statSync } from 'fs';
import path from 'path';
import { Upload } from '@prisma/client';
import { config } from '../config/index.js';
import logger from '../config/logger.js';
import { db } from './database.js';

/**
 * Files released by Wayfinderr that seed for good: on a server, or on the machine of a
 * download client (local release, see release/index.ts), where the file is moved out of
 * the watch folder into <releaseDir>/<name>/<name>.mkv and seeded by its client.
 *
 * - A file released locally can still be one side of a merge (the Italian one, or the
 *   better video): when the backend sees the client's release folder (LOCAL_RELEASE_DIR,
 *   mounted read only, and in the Dyadrr container as /data/seeding), the file is read
 *   there. Wayfinderr never writes, moves or deletes anything in it.
 * - The torrent of a release is never removed by the torrent cleanup: it is never the
 *   source torrent of a file, whatever its name, and is never removed by hand from
 *   Wayfinderr either (torrentCleanup.ts).
 */

/** Where a file released locally sits in the mounted release folder: the last <folder>/<file> of its path there. */
export const seedingPathOf = (remotePath: string | null, seedingDir: string): string | null => {
  if (!seedingDir || !remotePath) return null;
  const parts = remotePath.replace(/\\/g, '/').split('/').filter(Boolean);
  if (parts.length < 2) return null;
  const tail = parts.slice(-2);
  if (tail.some((part) => part === '.' || part === '..')) return null;
  return path.join(seedingDir, ...tail);
};

export type FileOfUpload = Pick<Upload, 'filepath' | 'localClientId' | 'remotePath' | 'size'>;

export interface UploadFile {
  path: string;
  seeding: boolean; // in the release folder: read only, never deleted
}

/** Why a film released locally cannot be read where it seeds. */
export type SeedingMiss = 'NOT_MOUNTED' | 'NO_REMOTE_PATH' | 'NOT_FOUND' | 'SIZE_MISMATCH' | 'UNREADABLE';

export interface SeedingMissDetail {
  reason: SeedingMiss;
  path: string | null; // where it was looked for
  size: string; // the upload's size, in bytes
  sizeThere?: string; // the size of the file found there
  error?: string; // the file system's error code (EACCES...)
}

export interface UploadFileLookup {
  file: UploadFile | null;
  miss?: SeedingMissDetail; // only for a film released locally
}

/** What each reason means, for the log and the messages. */
export const SEEDING_MISS_TEXT: Record<SeedingMiss, string> = {
  NOT_MOUNTED: 'the release folder is not mounted (LOCAL_RELEASE_DIR is not set)',
  NO_REMOTE_PATH: 'Wayfinderr does not know where it was moved',
  NOT_FOUND: 'no file at that path in the release folder (moved or renamed after the release?)',
  SIZE_MISMATCH: 'the file there has another size than the uploaded one',
  UNREADABLE: 'the release folder or the file cannot be read (user or permissions)',
};

/**
 * The file of an upload as Wayfinderr can read it, or why not: its own path while it is
 * there; for a file released locally, only its copy seeding in the mounted release folder,
 * with the same size (the release moved it away, and its old path in the watch folder may
 * hold another file by now, a merged one with the same name).
 */
export const lookupUploadFile = (upload: FileOfUpload, seedingDir = config.MERGE.SEEDING_DIR): UploadFileLookup => {
  if (!upload.localClientId) return { file: existsSync(upload.filepath) ? { path: upload.filepath, seeding: false } : null };
  const size = upload.size.toString();
  if (!seedingDir) return { file: null, miss: { reason: 'NOT_MOUNTED', path: null, size } };
  const seeding = seedingPathOf(upload.remotePath, seedingDir);
  if (!seeding) return { file: null, miss: { reason: 'NO_REMOTE_PATH', path: upload.remotePath, size } };
  try {
    const there = statSync(seeding).size;
    if (there === Number(upload.size)) return { file: { path: seeding, seeding: true } };
    return { file: null, miss: { reason: 'SIZE_MISMATCH', path: seeding, size, sizeThere: String(there) } };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? String(error);
    return { file: null, miss: { reason: code === 'ENOENT' || code === 'ENOTDIR' ? 'NOT_FOUND' : 'UNREADABLE', path: seeding, size, error: code } };
  }
};

/** The file of an upload as Wayfinderr can read it (see lookupUploadFile); null when it is not there. */
export const fileOfUpload = (upload: FileOfUpload, seedingDir = config.MERGE.SEEDING_DIR): UploadFile | null =>
  lookupUploadFile(upload, seedingDir).file;

/** One line for a miss: the reason, what it means and where it was looked for. */
export const describeMiss = (miss: SeedingMissDetail): string =>
  `${miss.reason}: ${SEEDING_MISS_TEXT[miss.reason]}${miss.path ? ` (${miss.path}` : ''}${
    miss.path ? `${miss.sizeThere ? `, ${miss.sizeThere} bytes there, ${miss.size} uploaded` : ''}${miss.error ? `, ${miss.error}` : ''})` : ''
  }`;

/** The release folder as the backend sees it: not set, readable (with how many entries), or why not. */
export const seedingDirState = (
  seedingDir = config.MERGE.SEEDING_DIR
): { state: 'NOT_SET' } | { state: 'READABLE'; entries: number } | { state: 'UNREADABLE'; error: string } => {
  if (!seedingDir) return { state: 'NOT_SET' };
  try {
    return { state: 'READABLE', entries: readdirSync(seedingDir).length };
  } catch (error) {
    return { state: 'UNREADABLE', error: (error as NodeJS.ErrnoException).code ?? String(error) };
  }
};

/**
 * At startup: whether the release folder is there, and how many of the films released
 * locally are found in it. Each one missing is logged with its reason.
 */
export const logSeedingState = async (): Promise<void> => {
  const dir = config.MERGE.SEEDING_DIR;
  const state = seedingDirState(dir);
  const local = (await db.getReleasedUploads()).filter((u) => u.localClientId);
  if (state.state === 'NOT_SET') {
    const log = local.length ? logger.warn.bind(logger) : logger.info.bind(logger);
    log({ localReleases: local.length }, 'Release folder not set (LOCAL_RELEASE_DIR): films released locally are not offered for a merge');
    return;
  }
  if (state.state === 'UNREADABLE') {
    logger.warn({ dir, error: state.error, localReleases: local.length }, `Release folder ${dir} cannot be read (${state.error}): films released locally are not offered for a merge`);
    return;
  }
  const missing = local
    .map((upload) => ({ upload, miss: lookupUploadFile(upload, dir).miss }))
    .filter((m): m is { upload: Upload; miss: SeedingMissDetail } => Boolean(m.miss));
  logger.info(
    { dir, entries: state.entries, localReleases: local.length, found: local.length - missing.length },
    `Release folder ${dir}: ${state.entries} entries, ${local.length - missing.length} of ${local.length} films released locally found there`
  );
  for (const { upload, miss } of missing) {
    logger.warn({ uploadId: upload.id, filename: upload.filename, ...miss }, `Released locally, not found where it seeds: ${upload.filename}: ${describeMiss(miss)}`);
  }
};

/** Whether a path is in the release folder (read only: never deleted). */
export const isSeedingPath = (filepath: string, seedingDir = config.MERGE.SEEDING_DIR): boolean => {
  if (!seedingDir) return false;
  const relative = path.relative(path.resolve(seedingDir), path.resolve(filepath));
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
};

// What tells a release's torrent: its info hash, else (local release) its client and name
export type ReleaseKey = Pick<Upload, 'id' | 'releaseTorrentHash' | 'localClientId' | 'releaseName'>;

const withoutExtension = (name: string) => name.replace(/\.[^./]+$/, '');

/**
 * The upload a torrent is the release of: the same info hash, or (released locally on
 * this client, before its hash was known) its file or folder name. Null for any other torrent.
 */
export const releaseOfTorrent = <T extends ReleaseKey>(
  torrent: { hash: string; name: string; topLevel?: string },
  clientId: string,
  releases: T[]
): T | null => {
  const hash = torrent.hash.toLowerCase();
  const byHash = releases.find((r) => r.releaseTorrentHash?.toLowerCase() === hash);
  if (byHash) return byHash;
  const names = new Set([torrent.name, torrent.topLevel].filter((n): n is string => Boolean(n)));
  return (
    releases.find(
      (r) =>
        !r.releaseTorrentHash &&
        r.localClientId === clientId &&
        r.releaseName &&
        (names.has(r.releaseName) || names.has(withoutExtension(r.releaseName)))
    ) ?? null
  );
};

/** Every upload released on a server or locally: their torrents seed for good. */
export const releasedUploads = (): Promise<Upload[]> => db.getReleasedUploads();
