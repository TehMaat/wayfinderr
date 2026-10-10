import { EventEmitter } from 'events';
import { readdir, stat } from 'fs/promises';
import path from 'path';
import { TorrentClient, Upload } from '@prisma/client';
import logger from '../config/logger.js';
import { config } from '../config/index.js';
import { db } from './database.js';
import { describeError, getQbitClient, QbitTorrent } from './qbittorrent.js';
import { isMeaningfulTitle, MatchName, normalize, parseName, titleSimilarity } from './nameMatch.js';
import { parseReleaseName } from './ripper/releaseName.js';
import { getMovieTitles, matchMovie, tmdbConfigured } from './ripper/tmdb.js';

/**
 * Removes from qBittorrent the torrent an uploaded MKV was ripped from.
 *
 * The torrent is found exactly when the MKV comes from a rip of the downloads
 * folder (the torrent's top-level folder or file is the rip's download), else by
 * name: the MKV file and folder names against each finished torrent's name and,
 * with TMDB, every title of its film. A torrent is removed automatically only when
 * it is 100% the one: the rip's download, or a name match on the very same title
 * and year with no other torrent in sight; anything else is left to the user.
 */

// Score needed to suggest a torrent in the UI (automatic removal needs a certain match)
export const SUGGEST_SCORE = 60;
// The runner-up must be this far behind, or the match is ambiguous
const MIN_LEAD = 15;
// Wait after the upload before removing: MakeMKV may still be ripping other titles
const REMOVE_DELAY_MS = 5 * 60 * 1000;
const RECHECK_MS = 2 * 60 * 1000;
// An MKV modified this recently means a rip is still running
const ACTIVITY_WINDOW_MS = 2 * 60 * 1000;
const TMDB_CONCURRENCY = 4;

// Rips of a download still to finish: its torrent must stay
const RIP_UNFINISHED = new Set(['WAITING', 'QUEUED', 'UNPACKING', 'SCANNING', 'RIPPING', 'JOINING', 'NEEDS_ATTENTION']);
const UPLOAD_UNFINISHED = ['PENDING', 'QUEUED', 'UPLOADING'];

export type TorrentStatus = 'NO_MATCH' | 'REVIEW' | 'WAITING' | 'REMOVED' | 'ERROR';

interface TorrentTitles {
  titles: string[];
  year?: number;
  tmdbLabel?: string;
}

interface Candidate {
  client: TorrentClient;
  torrent: QbitTorrent;
  score: number;
  matched: string;
  // Both the MKV name and the torrent have a year, and they agree
  dated?: boolean;
  tmdbLabel?: string;
}

const splitPath = (value: string) => value.split(/[\\/]+/).filter(Boolean);

/** The torrent's entry in its save folder: its root folder, or its file for a single-file torrent */
export const topLevelName = (torrent: QbitTorrent): string => {
  const save = splitPath(torrent.save_path ?? '');
  const content = splitPath(torrent.content_path ?? '');
  const inSave = save.length > 0 && content.length > save.length && save.every((part, i) => part === content[i]);
  return (inSave ? content[save.length] : content.at(-1)) ?? torrent.name;
};

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
export const mkvNames = (filepath: string): MatchName[] => {
  const relativeDir = path.relative(config.WATCH_DIR, path.dirname(filepath));
  const folders = relativeDir && !relativeDir.startsWith('..') && !path.isAbsolute(relativeDir) ? splitPath(relativeDir) : [];
  return [path.basename(filepath), ...folders.reverse()]
    .map(parseName)
    .filter((p) => isMeaningfulTitle(p.title));
};

export const scoreAgainst = (
  names: MatchName[],
  torrent: TorrentTitles
): { score: number; matched: string; dated: boolean } => {
  let best = { score: 0, matched: '', dated: false };
  for (const name of names) {
    if (name.year && torrent.year && Math.abs(name.year - torrent.year) > 1) continue;
    const dated = Boolean(name.year && torrent.year);
    for (const title of torrent.titles) {
      const score = titleSimilarity(name.title, title);
      // Same score: the name whose year confirms the film wins
      if (score > best.score || (score === best.score && dated && !best.dated)) best = { score, matched: title, dated };
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
  // TMDB titles per parsed torrent name (null: no film found); lives for the whole run
  private tmdbTitles = new Map<string, { titles: string[]; year?: number; label: string } | null>();

  /** All the names a torrent is known by: its own name, its folder/file name, and its TMDB titles */
  private async torrentTitles(torrent: QbitTorrent): Promise<TorrentTitles> {
    const parsed = [torrent.name, topLevelName(torrent)].map(parseName).filter((p) => isMeaningfulTitle(p.title));
    if (parsed.length === 0) return { titles: [] };

    const titles = new Set(parsed.map((p) => p.title));
    const year = parsed.find((p) => p.year)?.year;
    const film = await this.lookupFilm(torrent.name);
    film?.titles.forEach((t) => titles.add(t));

    return { titles: [...titles], year: year ?? film?.year, tmdbLabel: film?.label };
  }

  // The ripper's conservative TMDB match: a film only when exactly one has this title and year
  private async lookupFilm(torrentName: string) {
    if (!tmdbConfigured()) return null;
    const name = parseReleaseName(torrentName);
    const key = `${name.title}|${name.year ?? ''}`;
    if (this.tmdbTitles.has(key)) return this.tmdbTitles.get(key) ?? null;
    try {
      const { movie } = await matchMovie(name);
      const film = movie
        ? {
            titles: [...new Set((await getMovieTitles(movie.id)).map(normalize).filter(Boolean))],
            year: movie.year ?? undefined,
            label: `${movie.title}${movie.year ? ` (${movie.year})` : ''}`,
          }
        : null;
      this.tmdbTitles.set(key, film);
      return film;
    } catch (error) {
      // Not cached: a network error should not hide the film for the whole run
      logger.warn({ torrent: torrentName, error: (error as Error).message }, 'TMDB lookup failed');
      return null;
    }
  }

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
    const torrentsByClient: { client: TorrentClient; torrents: QbitTorrent[] }[] = [];
    const errors: string[] = [];
    for (const client of clients) {
      try {
        torrentsByClient.push({ client, torrents: await getQbitClient(client).getCompletedTorrents(client.category) });
      } catch (error) {
        errors.push(`${client.name}: ${describeError(error)}`);
      }
    }
    if (torrentsByClient.length === 0) {
      await this.setStatus(upload.id, { torrentStatus: 'ERROR', torrentMessage: `Client unreachable: ${errors.join('; ')}` });
      return;
    }

    // Ripped from the downloads folder: the torrent is the one holding that download
    const rip = await db.getRipByOutputFile(upload.filepath);
    if (rip) {
      const holders = torrentsByClient.flatMap(({ client, torrents }) =>
        torrents.filter((t) => topLevelName(t) === rip.downloadName).map((torrent) => ({ client, torrent }))
      );
      if (holders.length === 1) {
        const [{ client, torrent }] = holders;
        await this.matched(upload, { client, torrent, score: 100, matched: '' }, `Ripped from the download "${rip.downloadName}"`);
        return;
      }
      if (holders.length > 1) {
        await this.setStatus(upload.id, {
          torrentStatus: 'REVIEW',
          torrentMessage: `${holders.length} torrents hold the download "${rip.downloadName}". Check and remove it by hand.`,
          torrentClientId: holders[0].client.id,
          torrentHash: holders[0].torrent.hash,
          torrentName: holders[0].torrent.name,
          torrentScore: 100,
        });
        return;
      }
      // Not from a torrent in scope (other category, another client): try by name
    }

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
    for (const { client, torrents } of torrentsByClient) {
      const scored = await mapLimit(torrents, TMDB_CONCURRENCY, async (torrent) => {
        const titles = await this.torrentTitles(torrent);
        return { client, torrent, tmdbLabel: titles.tmdbLabel, ...scoreAgainst(names, titles) };
      });
      candidates.push(...scored.filter((c) => c.score > 0));
    }

    candidates.sort((a, b) => b.score - a.score);
    const [best, second] = candidates;
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
        torrentMessage: `No finished torrent matches "${names[0].title}".${
          tmdbConfigured() ? '' : ' TMDB_API_KEY is not set, so only names in the same language can match.'
        }`,
        torrentClientId: null,
        torrentHash: null,
        torrentName: null,
        torrentScore: best?.score ?? null,
      });
      return;
    }

    const via = best.tmdbLabel ? ` (TMDB: ${best.tmdbLabel})` : '';
    const suggestion = {
      torrentClientId: best.client.id,
      torrentHash: best.torrent.hash,
      torrentName: best.torrent.name,
      torrentScore: best.score,
    };

    if (second && second.score >= SUGGEST_SCORE && best.score - second.score < MIN_LEAD) {
      await this.setStatus(upload.id, {
        ...suggestion,
        torrentStatus: 'REVIEW',
        torrentMessage: `More than one torrent matches: "${best.torrent.name}" and "${second.torrent.name}". Check and remove it by hand.`,
      });
      return;
    }

    // Removed without asking only when 100% the one; else suggested
    const doubt =
      best.score < 100
        ? `Probable match on "${best.matched}"${via}: not the very same title, so not certain enough to remove it automatically.`
        : !best.dated
          ? `Same title as "${best.matched}"${via}, but the MKV or the torrent name has no year to rule out another film with that title, so it is not removed automatically.`
          : second && second.score >= SUGGEST_SCORE
            ? `Matched on "${best.matched}"${via}, but "${second.torrent.name}" matches too, so it is not removed automatically.`
            : null;
    if (doubt) {
      await this.setStatus(upload.id, { ...suggestion, torrentStatus: 'REVIEW', torrentMessage: `${doubt} Check and remove it by hand.` });
      return;
    }

    await this.matched(upload, best, `Matched on "${best.matched}"${via}`);
  }

  // A certain match: removal scheduled, or left to the user when automatic removal is off
  private async matched(upload: Upload, match: Candidate, why: string): Promise<void> {
    const data = {
      torrentClientId: match.client.id,
      torrentHash: match.torrent.hash,
      torrentName: match.torrent.name,
      torrentScore: match.score,
    };
    if (!match.client.autoRemove) {
      await this.setStatus(upload.id, {
        ...data,
        torrentStatus: 'REVIEW',
        torrentMessage: `${why}. Automatic removal is off for ${match.client.name}.`,
      });
      return;
    }
    await this.setStatus(upload.id, {
      ...data,
      torrentStatus: 'WAITING',
      torrentMessage: `${why}. Removal in ${REMOVE_DELAY_MS / 60000} minutes, once nothing of this download is still being ripped or uploaded.`,
    });
    this.schedule(match.torrent.hash, match.client.id, REMOVE_DELAY_MS);
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

  /** Why the torrent must stay for now: a rip or an upload of the same download still running */
  private async blocker(torrent: QbitTorrent): Promise<string | null> {
    // Rips of this download (a film can span several discs)
    const rips = await db.getRipsByDownloadName(topLevelName(torrent));
    if (rips.length > 0) {
      const ripping = rips.filter((r) => RIP_UNFINISHED.has(r.status));
      if (ripping.length) return `${ripping.length} more rip(s) of this download not finished (${ripping[0].status})`;
      for (const rip of rips) {
        const upload = rip.outputFile ? await db.getUploadByPath(rip.outputFile) : null;
        if (upload && UPLOAD_UNFINISHED.includes(upload.status)) return `${upload.filename} still uploading`;
      }
      return null;
    }

    // Matched by name: other MKVs of the same movie still to upload, or a rip being written
    const titles = await this.torrentTitles(torrent);
    const unfinished = (await Promise.all(UPLOAD_UNFINISHED.map((status) => db.getUploadsByStatus(status))))
      .flat()
      .filter((u) => scoreAgainst(mkvNames(u.filepath), titles).score >= SUGGEST_SCORE);
    if (unfinished.length) return `${unfinished.length} more file(s) of this disc still uploading`;

    const activeRip = await recentMkvActivity();
    return activeRip ? `MakeMKV is still writing ${activeRip}` : null;
  }

  /** Removes the torrent unless a rip or another upload of the same download is still in progress */
  private async tryRemove(hash: string, clientId: string): Promise<void> {
    const client = await db.getTorrentClientById(clientId);
    if (!client || !client.enabled) {
      await this.setStatusForHash(hash, ['WAITING'], 'ERROR', 'The download client was removed or disabled');
      return;
    }

    try {
      const torrent = await getQbitClient(client).getTorrent(hash);
      if (!torrent) {
        await this.setStatusForHash(hash, ['WAITING'], 'REMOVED', `Already gone from ${client.name}`);
        return;
      }

      const reason = await this.blocker(torrent);
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
