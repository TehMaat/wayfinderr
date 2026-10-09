import { Dirent } from 'fs';
import { readdir, stat } from 'fs/promises';
import path from 'path';

/**
 * Finds film discs in the downloads folder: .iso files and folders holding a
 * Blu-ray (BDMV/index.bdmv) or a DVD (VIDEO_TS/VIDEO_TS.IFO), and RAR archives
 * (which may hold one of them, or an .mkv). Each top-level entry of the folder
 * is one download.
 */

export type DiscType = 'ISO' | 'BDMV' | 'DVD';
export type SourceType = DiscType | 'RAR';

export interface DiscSource {
  path: string; // relative to the downloads folder, with "/" separators
  type: SourceType;
  downloadName: string;
}

const MAX_DEPTH = 5;
// Files of a download still being written by qBittorrent and other clients
const INCOMPLETE = /\.(!qb|part|crdownload|aria2|tmp)$/i;

const list = (dir: string): Promise<Dirent[]> => readdir(dir, { withFileTypes: true }).catch(() => []);

// RAR volumes: "name.rar" (single or first of "name.r00", "name.r01"...) and
// "name.part1.rar", "name.part2.rar"...
const RAR_PART = /^(.*)\.part(\d+)\.rar$/i;
const RAR = /^(.*)\.rar$/i;
const RAR_OLD_VOLUME = /^(.*)\.[r-z]\d{2}$/i;

/** The first volume of a RAR archive: the only one to open, the others follow. */
export const isFirstRarVolume = (name: string) => {
  const part = RAR_PART.exec(name);
  return part ? Number(part[2]) === 1 : RAR.test(name);
};

/** The name shared by the volumes of a RAR archive, or null for any other file. */
export const rarSetName = (name: string): string | null => {
  const file = name.replace(INCOMPLETE, '');
  const match = RAR_PART.exec(file) ?? RAR.exec(file) ?? RAR_OLD_VOLUME.exec(file);
  return match ? match[1].toLowerCase() : null;
};

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
    } else if (entry.isFile() && isFirstRarVolume(entry.name)) {
      found.push({ path: sub(entry.name), type: 'RAR', downloadName });
    } else if (entry.isDirectory() && depth < MAX_DEPTH) {
      await findIn(root, sub(entry.name), downloadName, depth + 1, found);
    }
  }
};

/** Every disc and archive in the downloads folder (no file contents are read). */
export const findDiscs = async (root: string): Promise<DiscSource[]> => {
  const found: DiscSource[] = [];
  for (const entry of await list(root)) {
    if (entry.name.startsWith('.')) continue;
    if (entry.isFile() && /\.iso$/i.test(entry.name)) {
      found.push({ path: entry.name, type: 'ISO', downloadName: entry.name });
    } else if (entry.isFile() && isFirstRarVolume(entry.name)) {
      found.push({ path: entry.name, type: 'RAR', downloadName: entry.name });
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
  // An archive right in the downloads folder: its other volumes are the files next to it
  const top = await stat(path.join(root, downloadName)).catch(() => null);
  if (!top?.isFile() || !isFirstRarVolume(downloadName)) return walk(path.join(root, downloadName));
  const set = rarSetName(downloadName);
  const volumes = (await list(root)).filter((entry) => !entry.isDirectory() && rarSetName(entry.name) === set);
  for (const entry of volumes) {
    if (!(await walk(path.join(root, entry.name)))) return false;
  }
  return volumes.length > 0;
};

/** The makemkvcon source for a disc, from its path relative to the downloads folder. */
export const makemkvSource = (source: { path: string; type: DiscType }) =>
  source.type === 'ISO' ? `iso:${source.path}` : `file:${source.path}`;
