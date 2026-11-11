import { EventEmitter } from 'events';
import path from 'path';
import { SourceTorrent, Upload } from '@prisma/client';
import logger from '../config/logger.js';
import { config } from '../config/index.js';
import { db } from './database.js';
import { parseTorrent, TorrentFile, torrentTrackers } from './release/torrentFile.js';

/**
 * Source torrents' .torrent files sent before their upload exists: by bookrr, through
 * the API, once the download is complete, or by hand from the Clients page. Each one is
 * kept for good, and copied into its upload (torrentFileName, torrentFileData, and the
 * hash, name and tracker of the source torrent when the upload has none yet):
 *
 * - as soon as the rip of its download is done: the upload of a rip whose download
 *   (rip.downloadName, the torrent's folder or file in the downloads) has the torrent's
 *   name, the same exact match the torrent cleanup makes with the torrents in the clients;
 * - for a file in the watch folder that comes from no rip, when the folder (or the file)
 *   it sits in at the top of the watch folder has the torrent's name;
 * - whenever the upload is matched to its info hash (torrent cleanup, by hand).
 *
 * The torrent cleanup then knows the source torrent for sure (see torrentCleanup.ts).
 */

export class SourceTorrentError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

/** A source torrent as listed: the file left out, with the uploads it was copied into */
export type SourceTorrentInfo = Omit<SourceTorrent, 'data'> & { uploadIds: string[] };

/** The name the .torrent was sent with (no folders), else the torrent's own */
export const torrentFileName = (given: string | undefined, torrentName: string): string => {
  const base = path.basename((given ?? '').replace(/\\/g, '/')).trim().slice(0, 255);
  return base || `${torrentName.replace(/[\\/:*?"<>|]/g, '_').slice(0, 240)}.torrent`;
};

const MAX_LABEL = 100;
const MAX_ORIGIN = 40;

/** A free text field: trimmed and capped, null when blank */
const text = (value: unknown, max: number): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().slice(0, max);
  return trimmed || null;
};

/** A TMDB id from a query parameter, null when missing or not a positive integer */
export const parseTmdbId = (value: unknown): number | null => {
  const n = typeof value === 'string' && /^\d{1,9}$/.test(value.trim()) ? Number(value.trim()) : NaN;
  return Number.isInteger(n) && n > 0 ? n : null;
};

/**
 * The entry a file sits in at the top of the watch folder: its folder, or the file itself
 * when it is right in the watch folder. Null outside the watch folder.
 */
export const watchTopLevel = (filepath: string, watchDir = config.WATCH_DIR): string | null => {
  const relative = path.relative(watchDir, filepath);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return relative.split(/[\\/]+/)[0] || null;
};

/** The download names an upload's file may come from: its rip's download, else its top entry in the watch folder */
export const downloadNamesOf = async (upload: Pick<Upload, 'filepath'>): Promise<string[]> => {
  const rip = await db.getRipByOutputFile(upload.filepath);
  if (rip) return [rip.downloadName];
  const top = watchTopLevel(upload.filepath);
  // A file right in the watch folder, from a single-file torrent: with or without its extension
  return top ? [...new Set([top, top.replace(/\.mkv$/i, '')])] : [];
};

/** The uploads that come from a download: its rips' files, and the files under its name in the watch folder */
export const uploadsOfDownload = async (name: string): Promise<Upload[]> => {
  const out: Upload[] = [];
  for (const rip of await db.getRipsByDownloadName(name)) {
    const upload = rip.outputFile ? await db.getUploadByPath(rip.outputFile) : null;
    if (upload) out.push(upload);
  }
  const inWatch = path.join(config.WATCH_DIR, name);
  for (const upload of await db.getUploadsByPathPrefix(inWatch)) {
    // That folder, or that very file (with or without .mkv): not "Dune.2021.Extended" for "Dune.2021"
    if ((await downloadNamesOf(upload)).includes(name)) out.push(upload);
  }
  return out;
};

/** The one torrent among these whose name is one of the download names (none when two or more are) */
export const pickByName = <T extends { name: string }>(torrents: T[], names: string[]): T | null => {
  const wanted = new Set(names);
  const found = torrents.filter((t) => wanted.has(t.name));
  return found.length === 1 ? found[0] : null;
};

const omitData = ({ data: _data, ...rest }: SourceTorrent): Omit<SourceTorrent, 'data'> => rest;

class SourceTorrents extends EventEmitter {
  /**
   * Keeps a .torrent (the same info hash again: the file is replaced, the TMDB id and
   * label kept unless given) and copies it into the uploads it is already for.
   */
  async add(
    data: Buffer,
    options: { fileName?: string; tmdbId?: number | null; label?: unknown; origin?: unknown } = {}
  ): Promise<{ created: boolean; torrent: SourceTorrentInfo }> {
    let torrent: TorrentFile;
    try {
      torrent = parseTorrent(data);
    } catch {
      throw new SourceTorrentError('Not a .torrent file', 400);
    }
    const tracker = torrentTrackers(data)[0];
    if (!tracker) throw new SourceTorrentError(`"${torrent.name}" names no tracker`, 422);

    const existing = await db.getSourceTorrent(torrent.infoHash);
    const label = text(options.label, MAX_LABEL);
    const fileName = torrentFileName(options.fileName, torrent.name);
    const fields = {
      name: torrent.name,
      // Sent again without its file name: the one it had stays
      ...(options.fileName?.trim() || !existing ? { fileName } : {}),
      data,
      size: BigInt(torrent.size),
      tracker,
      ...(options.tmdbId ? { tmdbId: options.tmdbId } : {}),
      ...(label ? { label } : {}),
    };
    await db.upsertSourceTorrent(torrent.infoHash, { ...fields, fileName, origin: text(options.origin, MAX_ORIGIN) }, fields);
    logger.info(
      { infoHash: torrent.infoHash, name: torrent.name, origin: text(options.origin, MAX_ORIGIN), created: !existing },
      'Source .torrent stored'
    );

    // Already for an upload: the ones with its hash, or the files of its download
    await this.attachExisting(torrent.infoHash);
    return { created: !existing, torrent: (await this.get(torrent.infoHash))! };
  }

  async list(): Promise<SourceTorrentInfo[]> {
    const torrents = await db.getSourceTorrents();
    const uploads = await db.getUploadIdsByTorrentHashes(torrents.map((t) => t.infoHash));
    return torrents.map((t) => ({ ...t, uploadIds: uploads[t.infoHash] ?? [] }));
  }

  async get(infoHash: string): Promise<SourceTorrentInfo | null> {
    const torrent = await db.getSourceTorrent(infoHash.toLowerCase());
    if (!torrent) return null;
    const uploads = await db.getUploadIdsByTorrentHashes([torrent.infoHash]);
    return { ...omitData(torrent), uploadIds: uploads[torrent.infoHash] ?? [] };
  }

  async file(infoHash: string): Promise<{ name: string; data: Buffer } | null> {
    const torrent = await db.getSourceTorrent(infoHash.toLowerCase());
    return torrent ? { name: torrent.fileName, data: Buffer.from(torrent.data) } : null;
  }

  /** Forgets a .torrent; the copies already in the uploads stay. */
  async remove(infoHash: string): Promise<boolean> {
    const removed = await db.deleteSourceTorrent(infoHash.toLowerCase());
    if (removed) logger.info({ infoHash }, 'Source .torrent deleted');
    return removed;
  }

  /**
   * A new upload (the rip of a download is done, or a file appeared in the watch folder):
   * the .torrent of its download, when one was sent before.
   */
  async attachToNewUpload(uploadId: string): Promise<boolean> {
    const upload = await db.getUploadById(uploadId);
    if (!upload || upload.torrentFileName) return false;
    const names = await downloadNamesOf(upload);
    if (names.length === 0) return false;
    const torrent = pickByName(await db.getSourceTorrentsByNames(names), names);
    if (!torrent) return false;
    // Matched to another torrent already: that one is its source
    if (upload.torrentHash && upload.torrentHash.toLowerCase() !== torrent.infoHash) return false;
    await this.copy(upload, torrent, `the download "${torrent.name}"`);
    return true;
  }

  /** The upload was matched to this info hash: its .torrent, when one was sent. */
  async attachByHash(uploadId: string, infoHash: string | null | undefined): Promise<boolean> {
    if (!infoHash) return false;
    const torrent = await db.getSourceTorrent(infoHash.toLowerCase());
    const upload = torrent ? await db.getUploadById(uploadId) : null;
    if (!torrent || !upload || upload.torrentFileName) return false;
    if (upload.torrentHash?.toLowerCase() !== torrent.infoHash) return false;
    await this.copy(upload, torrent, 'its info hash');
    return true;
  }

  /** Whether this hash was sent beforehand (by bookrr or by hand): the source for sure. */
  async has(infoHash: string | null | undefined): Promise<SourceTorrent | null> {
    return infoHash ? db.getSourceTorrent(infoHash.toLowerCase()) : null;
  }

  /** Just stored: the uploads that already have its hash, or that come from its download. */
  private async attachExisting(infoHash: string): Promise<void> {
    const torrent = await db.getSourceTorrent(infoHash);
    if (!torrent) return;
    const byHash = await db.getUploadsByTorrentHash(infoHash);
    const byDownload = await uploadsOfDownload(torrent.name);
    const seen = new Set<string>();
    for (const upload of [...byHash, ...byDownload]) {
      if (seen.has(upload.id) || upload.torrentFileName) continue;
      seen.add(upload.id);
      const hash = upload.torrentHash?.toLowerCase();
      if (hash && hash !== infoHash) continue;
      // By download name: only when no other stored torrent claims the same name
      if (!hash && !pickByName(await db.getSourceTorrentsByNames([torrent.name]), [torrent.name])) continue;
      await this.copy(upload, torrent, hash ? 'its info hash' : `the download "${torrent.name}"`);
    }
  }

  private async copy(upload: Upload, torrent: SourceTorrent, via: string): Promise<void> {
    await db.updateUpload(upload.id, {
      torrentFileName: torrent.fileName,
      torrentFileData: torrent.data,
      torrentTracker: upload.torrentTracker ?? torrent.tracker,
      // The hash and name of its source, until the torrent cleanup matches it
      ...(upload.torrentHash ? {} : { torrentHash: torrent.infoHash, torrentName: upload.torrentName ?? torrent.name }),
    });
    await db.markSourceTorrentAttached(torrent.infoHash);
    logger.info({ uploadId: upload.id, infoHash: torrent.infoHash, via }, 'Source .torrent copied into the upload');
    this.emit('torrent-updated', { uploadId: upload.id, torrentStatus: upload.torrentStatus, byHand: true });
  }
}

export const sourceTorrents = new SourceTorrents();
