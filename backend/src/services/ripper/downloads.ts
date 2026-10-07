import { Dirent } from 'fs';
import { readdir, stat } from 'fs/promises';
import path from 'path';

/**
 * Finds film discs in the downloads folder: .iso files and folders holding a
 * Blu-ray (BDMV/index.bdmv) or a DVD (VIDEO_TS/VIDEO_TS.IFO). Each top-level
 * entry of the folder is one download.
 */

export type SourceType = 'ISO' | 'BDMV' | 'DVD';

export interface DiscSource {
  path: string; // relative to the downloads folder, with "/" separators
  type: SourceType;
  downloadName: string;
}

const MAX_DEPTH = 5;
// Files of a download still being written by qBittorrent and other clients
const INCOMPLETE = /\.(!qb|part|crdownload|aria2|tmp)$/i;

const list = (dir: string): Promise<Dirent[]> => readdir(dir, { withFileTypes: true }).catch(() => []);

const findIn = async (root: string, relative: string, downloadName: string, depth: number, found: DiscSource[]) => {
  const dir = path.join(root, relative);
  const entries = await list(dir);
  const sub = (name: string) => (relative ? `${relative}/${name}` : name);

  for (const dirName of ['BDMV', 'VIDEO_TS']) {
    const folder = entries.find((e) => e.isDirectory() && e.name.toUpperCase() === dirName);
    if (!folder) continue;
    const marker = dirName === 'BDMV' ? 'INDEX.BDMV' : 'VIDEO_TS.IFO';
    const inside = await list(path.join(dir, folder.name));
    if (inside.some((e) => e.isFile() && e.name.toUpperCase() === marker)) {
      // The disc root is this folder: nothing else to look for inside it
      found.push({ path: relative || '.', type: dirName === 'BDMV' ? 'BDMV' : 'DVD', downloadName });
      return;
    }
  }

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    if (entry.isFile() && /\.iso$/i.test(entry.name)) {
      found.push({ path: sub(entry.name), type: 'ISO', downloadName });
    } else if (entry.isDirectory() && depth < MAX_DEPTH) {
      await findIn(root, sub(entry.name), downloadName, depth + 1, found);
    }
  }
};

/** Every disc in the downloads folder (no file contents are read). */
export const findDiscs = async (root: string): Promise<DiscSource[]> => {
  const found: DiscSource[] = [];
  for (const entry of await list(root)) {
    if (entry.name.startsWith('.')) continue;
    if (entry.isFile() && /\.iso$/i.test(entry.name)) {
      found.push({ path: entry.name, type: 'ISO', downloadName: entry.name });
    } else if (entry.isDirectory()) {
      await findIn(root, entry.name, entry.name, 1, found);
    }
  }
  return found;
};

/**
 * A download is complete when no file is marked incomplete and nothing changed
 * for `quietMs` (qBittorrent preallocates, so sizes alone tell nothing).
 */
export const isDownloadComplete = async (root: string, downloadName: string, quietMs: number): Promise<boolean> => {
  const threshold = Date.now() - quietMs;
  const walk = async (target: string): Promise<boolean> => {
    const info = await stat(target).catch(() => null);
    if (!info) return false;
    if (info.mtimeMs > threshold) return false;
    if (!info.isDirectory()) return !INCOMPLETE.test(target);
    for (const entry of await list(target)) {
      if (!(await walk(path.join(target, entry.name)))) return false;
    }
    return true;
  };
  return walk(path.join(root, downloadName));
};

/** The makemkvcon source for a disc, relative to the downloads folder. */
export const makemkvSource = (source: Pick<DiscSource, 'path' | 'type'>) =>
  source.type === 'ISO' ? `iso:${source.path}` : `file:${source.path}`;
