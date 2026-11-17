import { existsSync, statSync } from 'fs';
import path from 'path';
import { Upload } from '@prisma/client';
import { config } from '../config/index.js';
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

/**
 * The file of an upload as Wayfinderr can read it: its own path while it is there; for a
 * file released locally, only its copy seeding in the mounted release folder, with the
 * same size (the release moved it away, and its old path in the watch folder may hold
 * another file by now, a merged one with the same name). Null when it is not there.
 */
export const fileOfUpload = (upload: FileOfUpload, seedingDir = config.MERGE.SEEDING_DIR): UploadFile | null => {
  if (!upload.localClientId) return existsSync(upload.filepath) ? { path: upload.filepath, seeding: false } : null;
  const seeding = seedingPathOf(upload.remotePath, seedingDir);
  if (!seeding) return null;
  try {
    return statSync(seeding).size === Number(upload.size) ? { path: seeding, seeding: true } : null;
  } catch {
    return null;
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
