import { EventEmitter } from 'events';
import { readdir, stat } from 'fs/promises';
import path from 'path';
import { TorrentClient, Upload } from '@prisma/client';
import logger from '../config/logger.js';
import { config } from '../config/index.js';
import { db } from './database.js';
import { describeError, getQbitClient, QbitTorrent } from './qbittorrent.js';
import { isMeaningfulTitle, parseReleaseName, ParsedName, titleSimilarity } from './releaseName.js';
import { tmdb } from './tmdb.js';

// Score needed to remove a torrent without asking / to suggest it in the UI
export const AUTO_SCORE = 85;
export const SUGGEST_SCORE = 60;
// The runner-up must be this far behind, or the match is ambiguous
const MIN_LEAD = 15;
// Wait after the upload before removing: MakeMKV may still be ripping other titles
const REMOVE_DELAY_MS = 5 * 60 * 1000;
const RECHECK_MS = 2 * 60 * 1000;
// An MKV modified this recently means a rip is still running
const ACTIVITY_WINDOW_MS = 2 * 60 * 1000;
const TMDB_CONCURRENCY = 4;

export type TorrentStatus = 'NO_MATCH' | 'REVIEW' | 'WAITING' | 'REMOVED' | 'ERROR';

interface TorrentTitles {
  titles: string[];
  year?: number;
  season?: number;
  tmdbLabel?: string;
}

interface Candidate {
  client: TorrentClient;
  torrent: QbitTorrent;
  score: number;
  matched: string;
  tmdbLabel?: string;
}

const splitPath = (value: string) => value.split(/[\\/]+/).filter(Boolean);

// Runs fn over items with at most `limit` calls in flight
const mapLimit = async <T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> => {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
};

/** The MKV name and the folders it sits in (inside the watch folder) */
export const mkvNames = (filepath: string): ParsedName[] => {
  const relativeDir = path.relative(config.WATCH_DIR, path.dirname(filepath));
  const folders = relativeDir && !relativeDir.startsWith('..') && !path.isAbsolute(relativeDir) ? splitPath(relativeDir) : [];
  return [path.basename(filepath), ...folders.reverse()]
    .map(parseReleaseName)
    .filter((p) => isMeaningfulTitle(p.title));
};

/** All the names a torrent is known by: its own name, its folder/file name, and its TMDB titles */
const torrentTitles = async (torrent: QbitTorrent): Promise<TorrentTitles> => {
  const parsed = [torrent.name, splitPath(torrent.content_path ?? '').pop() ?? '']
    .map(parseReleaseName)
    .filter((p) => isMeaningfulTitle(p.title));
  if (parsed.length === 0) return { titles: [] };

  const main = parsed[0];
  const titles = new Set(parsed.map((p) => p.title));
  const year = parsed.find((p) => p.year)?.year;
  const season = parsed.find((p) => p.season !== undefined)?.season;

  const info = await tmdb.lookup(main.title, year, season !== undefined);
  // A year mismatch means TMDB found another movie with the same name
  const sameMovie = info && (!year || !info.year || Math.abs(info.year - year) <= 1);
  if (info && sameMovie) info.titles.forEach((t) => titles.add(t));

  return {
    titles: [...titles],
    year: year ?? (sameMovie ? info?.year : undefined),
    season,
    tmdbLabel: info && sameMovie ? `${info.title}${info.year ? ` (${info.year})` : ''}` : undefined,
  };
};

const scoreAgainst = (names: ParsedName[], torrent: TorrentTitles): { score: number; matched: string } => {
  let best = { score: 0, matched: '' };
  for (const name of names) {
    if (name.year && torrent.year && Math.abs(name.year - torrent.year) > 1) continue;
    if (name.season !== undefined && torrent.season !== undefined && name.season !== torrent.season) continue;
    for (const title of torrent.titles) {
      const score = titleSimilarity(name.title, title);
      if (score > best.score) best = { score, matched: title };
    }
  }
  return best;
};

/** First .mkv in the watch folder written in the last ACTIVITY_WINDOW_MS (a rip still running) */
const recentMkvActivity = async (): Promise<string | null> => {
  try {
    const entries = await readdir(config.WATCH_DIR, { recursive: true });
    const now = Date.now();
    for (const entry of entries) {
      if (path.extname(entry).toLowerCase() !== '.mkv') continue;
      const info = await stat(path.join(config.WATCH_DIR, entry)).catch(() => null);
      if (info && now - info.mtimeMs < ACTIVITY_WINDOW_MS) return entry;
    }
  } catch (error) {
    logger.warn({ error: (error as Error).message }, 'Cannot scan the watch folder for running rips');
  }
  return null;
};

export class TorrentCleanup extends EventEmitter {
  // One pending removal per torrent hash
  private timers = new Map<string, NodeJS.Timeout>();

  private async setStatus(uploadId: string, data: {
    torrentStatus: TorrentStatus;
    torrentMessage: string;
    torrentClientId?: string | null;
    torrentHash?: string | null;
    torrentName?: string | null;
    torrentScore?: number | null;
  }): Promise<void> {
    await db.updateUpload(uploadId, data);
    this.emit('torrent-updated', { uploadId, torrentStatus: data.torrentStatus });
  }

  private async setStatusForHash(hash: string, from: TorrentStatus[], torrentStatus: TorrentStatus, torrentMessage: string) {
    const ids = await db.updateUploadsByTorrentHash(hash, from, { torrentStatus, torrentMessage });
    ids.forEach((uploadId) => this.emit('torrent-updated', { uploadId, torrentStatus }));
  }

  /** Called once an upload is COMPLETED: find its torrent and schedule the removal */
  async handleUploadCompleted(uploadId: string): Promise<void> {
    const upload = await db.getUploadById(uploadId);
    if (!upload || upload.status !== 'COMPLETED') return;
    // Already handled (e.g. "check again" on a removed one)
    if (upload.torrentStatus === 'REMOVED') return;

    const clients = (await db.getTorrentClients()).filter((c) => c.enabled);
    if (clients.length === 0) return;

    try {
      await this.matchAndSchedule(upload, clients);
    } catch (error) {
      logger.error({ uploadId, error: describeError(error) }, 'Torrent matching failed');
      await this.setStatus(uploadId, { torrentStatus: 'ERROR', torrentMessage: describeError(error) });
    }
  }

  private async matchAndSchedule(upload: Upload, clients: TorrentClient[]): Promise<void> {
    const names = mkvNames(upload.filepath);
    if (names.length === 0) {
      await this.setStatus(upload.id, {
        torrentStatus: 'NO_MATCH',
        torrentMessage:
          'The file name does not say which movie it is (e.g. title_t00.mkv). Rename it, or rip into a folder named after the movie.',
      });
      return;
    }

    const candidates: Candidate[] = [];
    const errors: string[] = [];
    for (const client of clients) {
      let torrents: QbitTorrent[];
      try {
        torrents = await getQbitClient(client).getCompletedTorrents(client.category);
      } catch (error) {
        errors.push(`${client.name}: ${describeError(error)}`);
        continue;
      }
      const scored = await mapLimit(torrents, TMDB_CONCURRENCY, async (torrent) => {
        const titles = await torrentTitles(torrent);
        return { client, torrent, tmdbLabel: titles.tmdbLabel, ...scoreAgainst(names, titles) };
      });
      candidates.push(...scored.filter((c) => c.score > 0));
    }

    if (errors.length > 0 && errors.length === clients.length) {
      await this.setStatus(upload.id, { torrentStatus: 'ERROR', torrentMessage: `Client unreachable: ${errors.join('; ')}` });
      return;
    }

    candidates.sort((a, b) => b.score - a.score);
    const [best, second] = candidates;
    const tmdbOn = await tmdb.isConfigured();
    logger.info(
      {
        uploadId: upload.id,
        names: names.map((n) => n.title),
        top: candidates.slice(0, 3).map((c) => ({ name: c.torrent.name, score: c.score, matched: c.matched })),
      },
      'Torrent match computed'
    );

    if (!best || best.score < SUGGEST_SCORE) {
      await this.setStatus(upload.id, {
        torrentStatus: 'NO_MATCH',
        torrentMessage: `No finished torrent matches "${names[0].title}".${tmdbOn ? '' : ' TMDB is not configured, so only names in the same language can match.'}`,
        torrentClientId: null,
        torrentHash: null,
        torrentName: null,
        torrentScore: best?.score ?? null,
      });
      return;
    }

    const match = {
      torrentClientId: best.client.id,
      torrentHash: best.torrent.hash,
      torrentName: best.torrent.name,
      torrentScore: best.score,
    };
    const via = best.tmdbLabel ? ` (TMDB: ${best.tmdbLabel})` : '';

    if (second && second.score >= SUGGEST_SCORE && best.score - second.score < MIN_LEAD) {
      await this.setStatus(upload.id, {
        ...match,
        torrentStatus: 'REVIEW',
        torrentMessage: `More than one torrent matches: "${best.torrent.name}" and "${second.torrent.name}". Check and remove it by hand.`,
      });
      return;
    }

    if (best.score < AUTO_SCORE) {
      await this.setStatus(upload.id, {
        ...match,
        torrentStatus: 'REVIEW',
        torrentMessage: `Probable match on "${best.matched}"${via}, not certain enough to remove it automatically.`,
      });
      return;
    }

    if (!best.client.autoRemove) {
      await this.setStatus(upload.id, {
        ...match,
        torrentStatus: 'REVIEW',
        torrentMessage: `Matched on "${best.matched}"${via}. Automatic removal is off for ${best.client.name}.`,
      });
      return;
    }

    await this.setStatus(upload.id, {
      ...match,
      torrentStatus: 'WAITING',
      torrentMessage: `Matched on "${best.matched}"${via}. Removal in ${REMOVE_DELAY_MS / 60000} minutes, once no rip is running.`,
    });
    this.schedule(best.torrent.hash, best.client.id, REMOVE_DELAY_MS);
  }

  private schedule(hash: string, clientId: string, delayMs: number): void {
    if (this.timers.has(hash)) return;
    const timer = setTimeout(() => {
      this.timers.delete(hash);
      this.tryRemove(hash, clientId).catch((error) =>
        logger.error({ hash, error: describeError(error) }, 'Scheduled torrent removal crashed')
      );
    }, delayMs);
    this.timers.set(hash, timer);
  }

  /** Removes the torrent unless a rip or another upload of the same disc is still in progress */
  private async tryRemove(hash: string, clientId: string): Promise<void> {
    const client = await db.getTorrentClientById(clientId);
    if (!client || !client.enabled) {
      await this.setStatusForHash(hash, ['WAITING'], 'ERROR', 'The download client was removed or disabled');
      return;
    }

    try {
      const qbit = getQbitClient(client);
      const torrent = await qbit.getTorrent(hash);
      if (!torrent) {
        await this.setStatusForHash(hash, ['WAITING'], 'REMOVED', `Already gone from ${client.name}`);
        return;
      }

      // Other MKVs of the same disc still to be uploaded: wait for them
      const titles = await torrentTitles(torrent);
      const unfinished = (
        await Promise.all(['PENDING', 'QUEUED', 'UPLOADING'].map((status) => db.getUploadsByStatus(status)))
      )
        .flat()
        .filter((u) => scoreAgainst(mkvNames(u.filepath), titles).score >= SUGGEST_SCORE);

      const activeRip = await recentMkvActivity();
      const reason = unfinished.length
        ? `${unfinished.length} more file(s) of this disc still uploading`
        : activeRip
          ? `MakeMKV is still writing ${activeRip}`
          : null;

      if (reason) {
        await this.setStatusForHash(hash, ['WAITING'], 'WAITING', `Waiting: ${reason}. Next check in ${RECHECK_MS / 60000} minutes.`);
        this.schedule(hash, clientId, RECHECK_MS);
        return;
      }

      await this.remove(client, hash);
    } catch (error) {
      // Client down: keep the removal pending and retry later
      logger.warn({ hash, error: describeError(error) }, 'Torrent removal postponed');
      await this.setStatusForHash(hash, ['WAITING'], 'WAITING', `Waiting: ${client.name} unreachable (${describeError(error)}). Retrying.`);
      this.schedule(hash, clientId, RECHECK_MS);
    }
  }

  private async remove(client: TorrentClient, hash: string): Promise<void> {
    const qbit = getQbitClient(client);
    await qbit.deleteTorrent(hash, client.deleteFiles);
    if (await qbit.getTorrent(hash)) {
      throw new Error('qBittorrent did not remove the torrent');
    }
    const what = client.deleteFiles ? 'torrent and downloaded files' : 'torrent only, files kept';
    await this.setStatusForHash(hash, ['WAITING', 'REVIEW', 'ERROR'], 'REMOVED', `Removed from ${client.name} (${what})`);
  }

  /** "Remove now" from the UI: the user has checked the match */
  async removeNow(uploadId: string): Promise<Upload | null> {
    const upload = await db.getUploadById(uploadId);
    if (!upload) throw new Error('Upload not found');
    if (!upload.torrentHash || !upload.torrentClientId) throw new Error('No torrent matched to this upload');
    if (upload.torrentStatus === 'REMOVED') return upload;

    const client = await db.getTorrentClientById(upload.torrentClientId);
    if (!client) throw new Error('The download client was removed');

    const timer = this.timers.get(upload.torrentHash);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(upload.torrentHash);
    }
    await this.remove(client, upload.torrentHash);
    return db.getUploadById(uploadId);
  }

  /** "Check again" from the UI */
  async recheck(uploadId: string): Promise<Upload | null> {
    const upload = await db.getUploadById(uploadId);
    if (!upload) throw new Error('Upload not found');
    if (upload.status !== 'COMPLETED') throw new Error('Only completed uploads are matched to a torrent');
    if ((await db.getTorrentClients()).filter((c) => c.enabled).length === 0) {
      throw new Error('No download client configured');
    }
    await this.handleUploadCompleted(uploadId);
    return db.getUploadById(uploadId);
  }

  /** After a restart: pick up the removals that were waiting */
  async resumePending(): Promise<void> {
    for (const upload of await db.getUploadsByTorrentStatus('WAITING')) {
      if (upload.torrentHash && upload.torrentClientId) {
        this.schedule(upload.torrentHash, upload.torrentClientId, RECHECK_MS);
      }
    }
  }

  stop(): void {
    this.timers.forEach((timer) => clearTimeout(timer));
    this.timers.clear();
  }
}

export const torrentCleanup = new TorrentCleanup();
