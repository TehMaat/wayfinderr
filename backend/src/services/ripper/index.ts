import { EventEmitter } from 'events';
import { access, mkdir, rename, rm, stat, statfs } from 'fs/promises';
import path from 'path';
import { Rip } from '@prisma/client';
import { config } from '../../config/index.js';
import logger from '../../config/logger.js';
import { db } from '../database.js';
import {
  ArchiveError,
  classifyArchive,
  listArchive,
  pickUnpackTarget,
  scanFolder,
  unpackArchive,
  unpackDir,
  unpackNeeds,
  unpackRelativePath,
  unpackTargets,
  UnpackDisk,
  downloadsUnpackWritable,
  unrarAvailable,
} from './archive.js';
import { DiscType, findDiscs, isDownloadComplete, listFolders, makemkvSource } from './downloads.js';
import { EXCLUDED_PREFIX, excludedReason, ignoredFolder, matchExclusion, parseExclusions, parseFolders } from './exclusions.js';
import { joinDir, joinParts, partFile } from './join.js';
import { describeExit, DiscTitle, languageCodes, parseInfo, parseProgress, parseRipResult, selectionRule } from './makemkv.js';
import { playlistNumber } from './mpls.js';
import { parseDiscLabel, parseReleaseName } from './releaseName.js';
import { missingTools, openSource, RemuxSource, remuxNeeds, remuxTitle, remuxTools, scanDisc } from './remux.js';
import {
  cancelJob,
  ensureWorkDirs,
  jobOutputs,
  jobState,
  readJobLog,
  removeJob,
  RunnerJob,
  runnerAlive,
  submitJob,
} from './runner.js';
import { pickMainTitle } from './titlePicker.js';
import { getMovie, matchMovie, TmdbMovie, tmdbConfigured } from './tmdb.js';

/**
 * Automatic ripping. Every film disc that appears in the downloads folder goes
 * through:
 *
 *   WAITING   the download is still being written
 *   QUEUED    complete, waiting for the MakeMKV runner (one disc at a time)
 *   SCANNING  `makemkvcon info`: the titles and their tracks
 *   RIPPING   `makemkvcon mkv` of the film's title, Italian + original language
 *   DONE      moved to the watch folder as "Title (Year).mkv": the upload follows
 *
 * A RAR archive is listed once downloaded: it is handled when it holds one film,
 * a disc or an .mkv (see archive.ts). It is then
 *
 *   QUEUED     waiting for its turn (one archive or disc at a time)
 *   UNPACKING  unrar, on the disk with more free space: next to the downloads
 *              or next to the watch folder
 *   QUEUED     unpacked: a disc goes on as above, then its unpacked copy is
 *              deleted; an .mkv is renamed "Title (Year).mkv" and uploaded (DONE)
 *
 * When MakeMKV fails (a crash, an expired key), "Rip without MakeMKV" in the UI
 * rips the disc again with the backend's own tools (engine "remux", see
 * remux.ts): its titles are read again, then it goes on as above, RIPPING
 * being mkvmerge or ffmpeg here instead of the MakeMKV runner.
 *
 * The discs of one film ("Disc 1", "Disc 2") are joined by hand in the UI: each
 * one is ripped as above, but its film waits in the work folder (JOINING) for
 * the other parts; once every part is ripped mkvmerge appends them in order
 * (see join.ts) and the one film goes to the watch folder: every part is DONE.
 *
 * When the film or its title can't be told for sure, the rip stops in
 * NEEDS_ATTENTION and waits for a choice in the UI (so does an archive without
 * the space to unpack it). FAILED can be retried, SKIPPED is never ripped (by
 * hand, by an exclusion rule, or an archive without exactly one film). A
 * SKIPPED rip can be removed from the list: it is hidden, not deleted, so the
 * downloads scan doesn't list it again.
 */

export const RIP_STATUSES = [
  'WAITING',
  'QUEUED',
  'UNPACKING',
  'SCANNING',
  'RIPPING',
  'JOINING',
  'DONE',
  'NEEDS_ATTENTION',
  'FAILED',
  'SKIPPED',
];

const TICK_MS = 10_000;
const DISCOVER_MS = 60_000;
const LOG_TAIL_BYTES = 64 * 1024;
const SPACE_MARGIN_BYTES = 2 * 1024 ** 3;
const IDENTIFY_RETRY_MS = 10 * 60_000;
const INITIALIZED_KEY = 'rip_initialized';
const ARCHIVES_KEY = 'rip_archives_initialized';
const EXCLUSIONS_KEY = 'rip_exclusions';
const FOLDERS_KEY = 'rip_ignored_folders';
const ARRIVE_COMPLETE_KEY = 'rip_arrive_complete';
// Downloads that arrive complete: a short wait all the same, for a client that
// copies them from another disk instead of moving them
const ARRIVED_QUIET_MS = 60_000;
// Not started yet: a new exclusion rule skips them
const EXCLUDABLE = ['WAITING', 'QUEUED', 'NEEDS_ATTENTION'];
// Nothing made of them yet: a new ignored folder removes them from the list
const REMOVABLE = [...EXCLUDABLE, 'FAILED', 'SKIPPED'];
// Not being ripped nor ripped: they can be joined
const JOINABLE = ['QUEUED', 'NEEDS_ATTENTION', 'FAILED', 'SKIPPED'];

export interface ExclusionSettings {
  patterns: string[];
  folders: string[];
  arriveComplete: boolean;
}

const keptLanguages = () => languageCodes(config.RIP.LANGUAGE);

const isArchive = (rip: Rip) => rip.sourceType === 'RAR';

/** The unpacked film of an archive (null when not unpacked) */
const unpackedFilm = (rip: Rip) =>
  rip.unpackedTo && rip.contentPath ? path.join(unpackDir(rip.unpackedTo as UnpackDisk, rip.id), rip.contentPath) : null;

/** The disc for MakeMKV: in the downloads, or unpacked from an archive (in the work folder for "watch") */
const sourceOf = (rip: Rip): Pick<RunnerJob, 'source' | 'root'> => {
  if (!isArchive(rip)) return { source: makemkvSource({ path: rip.sourcePath, type: rip.sourceType as DiscType }) };
  const disk = rip.unpackedTo as UnpackDisk;
  const source = makemkvSource({ path: unpackRelativePath(disk, rip.id, rip.contentPath!), type: rip.contentType as DiscType });
  return disk === 'watch' ? { source, root: 'work' } : { source };
};

const exists = (file: string) =>
  access(file).then(
    () => true,
    () => false
  );

// Characters not allowed in file names on common filesystems
const safeFileName = (name: string) =>
  name
    .replace(/[\\/:*?"<>|]+/g, ' - ')
    .replace(/[\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.-]+|[\s.]+$/g, '');

export const formatBytes = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(1)} GB`;

/** The film of the rip, as TMDB gave it (the rip must be identified) */
const filmOf = (rip: Rip): TmdbMovie => ({
  id: rip.tmdbId!,
  title: rip.title ?? '',
  originalTitle: rip.originalTitle ?? '',
  originalLanguage: rip.originalLanguage ?? '',
  year: rip.year,
});

/** "Title (Year)": the TMDB title, or the download name when the film was not identified ("Film Test (2001)") */
const outputName = (rip: Rip) => {
  const film = rip.title || rip.originalTitle ? { title: rip.title || rip.originalTitle, year: rip.year } : parseReleaseName(rip.downloadName);
  return safeFileName(`${film.title || rip.downloadName}${film.year ? ` (${film.year})` : ''}`);
};

const DISK_NAMES: Record<UnpackDisk, string> = { downloads: 'the downloads disk', watch: 'the watch folder disk' };

// The archive being unpacked (unrar runs here, not in the MakeMKV container)
interface Unpacking {
  ripId: string;
  controller: AbortController;
  progress: number;
  finished: boolean;
  error?: Error;
  done: Promise<void>;
}

// The disc being ripped without MakeMKV (mkvmerge, 7-Zip or ffmpeg run here too), or
// the parts of a film being joined (mkvmerge: ripId is the first part's)
interface Remuxing extends Unpacking {
  result?: { file: string; warnings: string[] };
}

/** The work folder of a rip without MakeMKV: on the watch folder's disk, like MakeMKV's rips */
const remuxDir = (ripId: string) => path.join(config.RIP.WORK_DIR, 'remux', ripId);

class Ripper extends EventEmitter {
  private timer: NodeJS.Timeout | null = null;
  private busy = false;
  private lastDiscover = 0;
  private unpacking: Unpacking | null = null;
  private remuxing: Remuxing | null = null;
  private joining: Remuxing | null = null;
  private identifyTimer: NodeJS.Timeout | null = null;
  // The rip loop and the exclusion rules change the same rips: one at a time
  private lock: Promise<unknown> = Promise.resolve();

  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.lock.then(fn);
    this.lock = run.catch(() => undefined);
    return run;
  }

  start() {
    if (!config.RIP.ENABLED) {
      logger.info('Automatic ripping is off (RIP_ENABLED)');
      return;
    }
    logger.info({ source: config.RIP.SOURCE_DIR, work: config.RIP.WORK_DIR }, 'Automatic ripping started');
    if (!tmdbConfigured()) logger.warn('TMDB_API_KEY is not set: every rip will wait for a manual choice');
    ensureWorkDirs().catch((error) => logger.error(error, 'Cannot create the rip work folder'));
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.tick();
    if (tmdbConfigured()) this.identifyAgain();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    if (this.identifyTimer) clearTimeout(this.identifyTimer);
    this.timer = null;
    // unrar, mkvmerge and ffmpeg are children of this process: they would go on writing after it ends
    this.unpacking?.controller.abort();
    this.remuxing?.controller.abort();
    this.joining?.controller.abort();
    this.identifyTimer = null;
  }

  private changed(rip: Rip) {
    this.emit('rip-updated', { ripId: rip.id, status: rip.status });
  }

  private async update(id: string, data: Parameters<typeof db.updateRip>[1]) {
    const rip = await db.updateRip(id, data);
    this.changed(rip);
    return rip;
  }

  private async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      await this.exclusive(async () => {
        if (Date.now() - this.lastDiscover >= DISCOVER_MS) {
          this.lastDiscover = Date.now();
          await this.discover();
        }
        await this.advance();
      });
    } catch (error) {
      logger.error(error, 'Rip loop failed');
    } finally {
      this.busy = false;
    }
  }

  /** New discs in the downloads folder, and downloads that finished. */
  private async discover() {
    const { patterns: exclusions, folders, arriveComplete } = await this.exclusions();
    const discs = await findDiscs(config.RIP.SOURCE_DIR, folders);
    const known = new Map((await db.getRips()).map((rip) => [rip.sourcePath, rip]));

    // The first time, the downloads already there are only listed (RIP_EXISTING to rip them);
    // so are the archives already there when Wayfinderr started unpacking them
    const settings = await db.getSettings([INITIALIZED_KEY, ARCHIVES_KEY]);
    const initialized = settings[INITIALIZED_KEY];
    const archivesInitialized = settings[ARCHIVES_KEY];
    for (const disc of discs) {
      if (known.has(disc.path)) continue;
      const rule = matchExclusion(exclusions, disc.path);
      const existing = config.RIP.RIP_EXISTING
        ? null
        : !initialized
          ? 'Already in the downloads when ripping was turned on'
          : disc.type === 'RAR' && !archivesInitialized
            ? 'Already in the downloads when archives started being unpacked'
            : null;
      const skipped = existing || (rule && excludedReason(rule));
      const rip = await db.createRip({
        sourcePath: disc.path,
        sourceType: disc.type,
        downloadName: disc.downloadName,
        ...(skipped ? { status: 'SKIPPED', reason: skipped } : {}),
      });
      logger.info({ ripId: rip.id, source: disc.path, status: rip.status }, 'Disc found in the downloads');
      this.changed(rip);
    }
    const now = new Date().toISOString();
    if (!initialized || !archivesInitialized) {
      await db.setSettings({
        ...(!initialized ? { [INITIALIZED_KEY]: now } : {}),
        ...(!archivesInitialized ? { [ARCHIVES_KEY]: now } : {}),
      });
    }

    const present = new Set(discs.map((disc) => disc.path));
    // Moved here by the torrent client once complete: no need to wait RIP_QUIET_MINUTES
    const quietMs = Math.min(config.RIP.QUIET_MINUTES * 60_000, arriveComplete ? ARRIVED_QUIET_MS : Infinity);
    for (const rip of await db.getRipsByStatus(['WAITING'])) {
      if (!present.has(rip.sourcePath)) {
        // Deleted before it finished downloading
        await db.deleteRip(rip.id);
        this.emit('rip-updated', { ripId: rip.id, status: 'DELETED' });
      } else if (await isDownloadComplete(config.RIP.SOURCE_DIR, rip.downloadName, quietMs)) {
        // An archive is read right away: one without a film (subtitles...) is
        // skipped before the film next to it counts it as a second disc
        if (isArchive(rip)) await this.inspect(rip);
        else await this.update(rip.id, { status: 'QUEUED' });
      }
    }

    await this.cleanUpUploaded();
  }

  /** Lists the archive: QUEUED with its film and size, or SKIPPED/FAILED with the reason. */
  private async inspect(rip: Rip): Promise<Rip | null> {
    try {
      const content = classifyArchive(await listArchive(path.join(config.RIP.SOURCE_DIR, rip.sourcePath)));
      if (!content.film) {
        logger.info({ ripId: rip.id, reason: content.reason }, 'Archive skipped');
        await this.update(rip.id, { status: 'SKIPPED', reason: content.reason });
        return null;
      }
      logger.info({ ripId: rip.id, film: content.film, size: content.size }, 'Archive listed');
      return await this.update(rip.id, {
        status: 'QUEUED',
        reason: null,
        contentType: content.film.type,
        contentPath: content.film.path,
        unpackBytes: BigInt(content.size),
      });
    } catch (error) {
      const permanent = error instanceof ArchiveError && error.permanent;
      logger.warn({ ripId: rip.id, error: (error as Error).message }, 'Cannot read the archive');
      await this.update(rip.id, { status: permanent ? 'SKIPPED' : 'FAILED', reason: (error as Error).message });
      return null;
    }
  }

  /**
   * An .mkv unpacked next to the downloads is uploaded from there: its copy is
   * deleted once on the server (or skipped by the server's media policy, or
   * its upload deleted), kept while the upload can still be retried.
   */
  private async cleanUpUploaded() {
    for (const rip of await db.getUnpackedRips()) {
      if (rip.status !== 'DONE') continue;
      const upload = rip.outputFile ? await db.getUploadByPath(rip.outputFile) : null;
      if (upload && upload.status !== 'COMPLETED' && upload.status !== 'SKIPPED') continue;
      await this.discardUnpacked(rip);
      logger.info({ ripId: rip.id, upload: upload?.status ?? 'deleted' }, 'Unpacked copy deleted');
    }
  }

  /** Deletes the unpacked copy of an archive (stopping unrar if it is still at it). */
  private async discardUnpacked(rip: Rip) {
    if (this.unpacking?.ripId === rip.id) {
      this.unpacking.controller.abort();
      await this.unpacking.done;
      this.unpacking = null;
    }
    if (!rip.unpackedTo) return;
    await rm(unpackDir(rip.unpackedTo as UnpackDisk, rip.id), { recursive: true, force: true });
    await db.updateRip(rip.id, { unpackedTo: null });
  }

  /** Moves the active rip forward, or starts the next one. */
  private async advance() {
    const [active] = await db.getRipsByStatus(['UNPACKING', 'SCANNING', 'RIPPING']);
    if (active) {
      if (active.status === 'UNPACKING') await this.pollUnpack(active);
      else if (active.engine === 'remux') await this.pollRemux(active);
      else await this.poll(active);
      return;
    }
    // Joining the parts of a film (mkvmerge here) takes a turn like a rip
    if (this.joining) {
      await this.pollJoin();
      return;
    }
    if (await this.startReadyJoin()) return;

    // Unpacking an archive, moving its .mkv and ripping without MakeMKV don't need MakeMKV
    const queued = await db.getRipsByStatus(['QUEUED']);
    const alive = queued.length > 0 && (await runnerAlive());
    let next: Rip | undefined;
    for (const rip of queued) {
      if (isArchive(rip)) {
        const film = unpackedFilm(rip);
        if (!film || !(await exists(film))) {
          await this.unpack(rip);
          return;
        }
        if (rip.contentType === 'MKV') {
          await this.deliver(rip);
          return;
        }
      }
      if (alive || rip.engine === 'remux') {
        next = rip;
        break;
      }
    }
    if (!next) return;

    // Only a choice in the UI queues a scanned disc: with its title it is ripped
    // as it is, with just the film the title is picked again
    if (next.titles && next.titleIndex !== null) {
      await this.startRip(next);
    } else if (next.titles) {
      await this.decide(next, JSON.parse(next.titles), next.discName ?? undefined);
    } else if (next.engine === 'remux') {
      await this.scanWithoutMakemkv(next);
    } else {
      const jobId = await submitJob({ action: 'info', ...sourceOf(next), minLength: config.RIP.MIN_LENGTH });
      await this.update(next.id, { status: 'SCANNING', jobId, startedAt: new Date(), progress: 0, reason: null });
      logger.info({ ripId: next.id, jobId }, 'Scanning disc');
    }
  }

  /** Unpacks the archive on the disk with the most free space left afterwards. */
  private async unpack(rip: Rip) {
    // Unpacked before, but the film is gone: start over
    if (rip.unpackedTo) await this.discardUnpacked(rip);
    if (rip.contentType === null || rip.unpackBytes === null) {
      const listed = await this.inspect(rip);
      if (!listed) return;
      rip = listed;
    }

    const size = Number(rip.unpackBytes);
    const disc = rip.contentType !== 'MKV';
    await ensureWorkDirs();
    const targets = await unpackTargets();
    const target = pickUnpackTarget(targets, size, disc, SPACE_MARGIN_BYTES);
    if (!target) {
      const free = targets.map((t) => `${formatBytes(t.freeBytes)} free on ${DISK_NAMES[t.disk]}`).join(', ');
      await this.update(rip.id, {
        status: 'NEEDS_ATTENTION',
        reason:
          `Not enough free space to unpack the archive: ${formatBytes(size)} needed` +
          (disc ? ' (twice as much on the watch folder disk, for the rip too)' : '') +
          (free ? `, ${free}` : ''),
      });
      return;
    }

    const dir = unpackDir(target.disk, rip.id);
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
    rip = await this.update(rip.id, {
      status: 'UNPACKING',
      unpackedTo: target.disk,
      progress: 0,
      reason: null,
      startedAt: new Date(),
    });

    const ripId = rip.id;
    const controller = new AbortController();
    const job = { ripId, controller, progress: 0, finished: false } as Unpacking;
    job.done = unpackArchive(path.join(config.RIP.SOURCE_DIR, rip.sourcePath), dir, controller.signal, (progress) => {
      if (progress === job.progress) return;
      job.progress = progress;
      this.emit('rip-progress', { ripId, progress, status: 'UNPACKING' });
    })
      .catch((error: Error) => {
        job.error = error;
      })
      .finally(() => {
        job.finished = true;
      });
    this.unpacking = job;
    logger.info(
      { ripId, disk: target.disk, size: formatBytes(size), free: formatBytes(target.freeBytes), needs: formatBytes(unpackNeeds(target.disk, size, disc)) },
      'Unpacking archive'
    );
  }

  private async pollUnpack(rip: Rip) {
    const job = this.unpacking?.ripId === rip.id ? this.unpacking : null;
    if (!job) {
      // Interrupted by a restart: from scratch
      await this.discardUnpacked(rip);
      await this.update(rip.id, { status: 'QUEUED', progress: 0 });
      return;
    }
    if (!job.finished) {
      if (job.progress !== rip.progress) await db.updateRip(rip.id, { progress: job.progress });
      return;
    }
    this.unpacking = null;

    if (job.error) {
      logger.warn({ ripId: rip.id, error: job.error.message }, 'Unpacking failed');
      await this.discardUnpacked(rip);
      await this.update(rip.id, { status: 'FAILED', progress: 0, reason: `Unpacking failed: ${job.error.message}` });
      return;
    }

    // Trust what is on disk, not the listing: the film must be there, and no links
    const content = await scanFolder(unpackDir(rip.unpackedTo as UnpackDisk, rip.id))
      .then(classifyArchive)
      .catch((error: Error) => ({ film: null, reason: error.message }));
    if (!content.film) {
      await this.discardUnpacked(rip);
      await this.update(rip.id, { status: 'FAILED', progress: 0, reason: `Unpacked, but: ${content.reason}` });
      return;
    }
    await this.update(rip.id, {
      status: 'QUEUED',
      progress: 0,
      contentType: content.film.type,
      contentPath: content.film.path,
    });
    logger.info({ ripId: rip.id, film: content.film, disk: rip.unpackedTo }, 'Archive unpacked');
  }

  /**
   * The .mkv of an archive, named like a rip: moved to the watch folder when it
   * was unpacked there, uploaded from where it is when it was unpacked next to
   * the downloads (a move to the watch folder would be a copy to another disk).
   */
  private async deliver(rip: Rip) {
    try {
      await this.moveUnpacked(rip);
    } catch (error) {
      // The unpacked copy stays: Retry tries again
      logger.error({ ripId: rip.id, error }, 'Cannot hand over the unpacked film');
      await this.update(rip.id, { status: 'FAILED', reason: `Cannot move the unpacked film: ${(error as Error).message}` });
    }
  }

  private async moveUnpacked(rip: Rip) {
    if (rip.tmdbId === null && tmdbConfigured()) {
      // Only for the name: not identified, it is named after the download
      const { movie } = await this.identify(rip);
      if (movie) rip = await this.update(rip.id, this.movieFields(movie));
    }
    const from = unpackedFilm(rip)!;
    const done = { status: 'DONE', progress: 100, completedAt: new Date(), reason: null };

    if (rip.unpackedTo === 'watch') {
      const target = await this.freeName(config.WATCH_DIR, outputName(rip));
      await rename(from, target);
      await rm(unpackDir('watch', rip.id), { recursive: true, force: true });
      await this.update(rip.id, { ...done, outputFile: target, unpackedTo: null });
      logger.info({ ripId: rip.id, file: target }, 'Unpacked film moved to the watch folder');
      return;
    }

    const target = await this.freeName(path.dirname(from), outputName(rip), from);
    if (target !== from) await rename(from, target);
    const { size } = await stat(target);
    const { upload } = await db.updateRipWithUpload(
      rip.id,
      { ...done, outputFile: target, contentPath: path.relative(unpackDir('downloads', rip.id), target).split(path.sep).join('/') },
      { filename: path.basename(target), filepath: target, size: BigInt(size) }
    );
    this.changed({ ...rip, status: 'DONE' });
    this.emit('file-ready', { uploadId: upload.id, filepath: target, filename: path.basename(target) });
    logger.info({ ripId: rip.id, file: target, uploadId: upload.id }, 'Unpacked film sent to the upload queue');
  }

  /** A file name in dir that is new there and on the servers (current: the file's own name is fine). */
  private async freeName(dir: string, base: string, current?: string) {
    // The name must be new on the server too: with DELETE_AFTER_UPLOAD an earlier
    // film with this name is gone from the folder, and the upload would replace it
    const taken = async (file: string) =>
      (file !== current && (await exists(file))) || (await db.isUploadFileNameUsed(path.basename(file)));
    let target = path.join(dir, `${base}.mkv`);
    for (let n = 2; await taken(target); n++) {
      target = path.join(dir, `${base} (${n}).mkv`);
    }
    return target;
  }

  private async poll(rip: Rip) {
    if (!rip.jobId) {
      await this.update(rip.id, { status: 'FAILED', reason: 'Lost track of the MakeMKV job' });
      return;
    }
    const job = await jobState(rip.jobId);
    if (job.state === 'missing') {
      await this.update(rip.id, { status: 'FAILED', reason: 'The MakeMKV job disappeared', jobId: null });
      return;
    }
    if (job.state !== 'done') {
      if (rip.status === 'RIPPING') {
        const progress = parseProgress(await readJobLog(rip.jobId, LOG_TAIL_BYTES));
        if (progress !== null && progress !== rip.progress) {
          await db.updateRip(rip.id, { progress });
          this.emit('rip-progress', { ripId: rip.id, progress, status: 'RIPPING' });
        }
      }
      return;
    }

    const output = await readJobLog(rip.jobId);
    if (rip.status === 'SCANNING') {
      await this.scanned(rip, output, job.exitCode);
    } else {
      await this.ripped(rip, output, job.exitCode);
    }
  }

  private async scanned(rip: Rip, output: string, exitCode: number) {
    const info = parseInfo(output);
    await removeJob(rip.jobId!);
    // makemkvcon exits 0 even when it can't open the disc: the messages tell
    if (info.titles.length === 0 && (exitCode !== 0 || info.errors.length > 0)) {
      await this.update(rip.id, {
        status: 'FAILED',
        jobId: null,
        reason: info.errors[0] || `MakeMKV could not read the disc: ${describeExit(exitCode)}`,
      });
      return;
    }
    rip = await this.update(rip.id, {
      jobId: null,
      discName: info.name ?? null,
      titles: JSON.stringify(info.titles),
    });
    await this.decide(rip, info.titles, info.name);
  }

  /**
   * The film of a download, from its name, the file or folder name or the disc label:
   * null (and why) when unsure. `failed` when TMDB itself did not answer.
   */
  private async identify(rip: Rip, discName?: string) {
    const files = [path.basename(rip.sourcePath)];
    // An archive: the film's own name inside it ("Film.2001.1080p.BluRay.mkv", "Film.2001.COMPLETE.BLURAY/")
    if (isArchive(rip) && rip.contentPath && rip.contentPath !== '.') files.push(path.posix.basename(rip.contentPath));
    const names = [...new Set([rip.downloadName, ...files])].map(parseReleaseName);
    if (discName) names.push(parseDiscLabel(discName));
    let reason = '';
    let failed = false;
    for (const name of names) {
      const match = await matchMovie(name).catch((error: Error) => {
        failed = true;
        return { movie: null, candidates: [], reason: error.message };
      });
      if (match.movie) return { movie: match.movie as TmdbMovie, reason: '', failed: false };
      reason ||= match.reason ?? '';
    }
    return { movie: null, reason: reason || 'Film not identified on TMDB', failed };
  }

  /**
   * At every start: the rips still waiting for their film are looked up again, so
   * that a better matcher (or a TMDB key added since) also applies to them. Those
   * identified now go back in the queue with their scan, or wait only for the title
   * if that is still unsure; the others get a fresh reason. TMDB is asked outside
   * the rip loop's lock, and when it does not answer the pass is tried again later.
   */
  private async identifyAgain() {
    this.identifyTimer = null;
    // Only rips nobody chose a film or title for, as they are when written (a Skip or Choose meanwhile wins)
    const untouched = { status: 'NEEDS_ATTENTION', tmdbId: null, titleIndex: null };
    try {
      for (const rip of await db.getRipsByStatus(['NEEDS_ATTENTION'])) {
        if (!rip.titles || rip.tmdbId !== null || rip.titleIndex !== null) continue;
        const identified = await this.identify(rip, rip.discName ?? undefined);
        if (identified.failed) throw new Error(identified.reason);
        const { movie } = identified;
        const { title, problems } = await this.pickTitle(rip, JSON.parse(rip.titles));
        if (!movie) problems.unshift(identified.reason);
        const reason = problems.join(' · ');
        if (!movie && reason === rip.reason) continue;
        const film = movie
          ? { tmdbId: movie.id, title: movie.title, originalTitle: movie.originalTitle, originalLanguage: movie.originalLanguage, year: movie.year }
          : {};
        const updated = await this.exclusive(() =>
          db.updateRipIf(rip.id, untouched, problems.length || !title ? { ...film, reason } : { ...film, status: 'QUEUED', reason: null })
        );
        if (!updated) continue;
        this.changed(updated);
        if (movie) logger.info({ ripId: rip.id, tmdbId: movie.id, film: movie.title, status: updated.status }, 'Film identified on a second look');
      }
    } catch (error) {
      logger.warn({ error: (error as Error).message }, 'TMDB did not answer: the waiting rips are looked up again in 10 minutes');
      if (this.timer) this.identifyTimer = setTimeout(() => this.identifyAgain(), IDENTIFY_RETRY_MS);
    }
  }

  /** The title to rip: the chosen one, or the only long one when the download has a single disc. */
  private async pickTitle(rip: Rip, titles: DiscTitle[]) {
    const problems: string[] = [];
    let title: DiscTitle | null = null;
    if (rip.titleIndex !== null) {
      title = titles.find((t) => t.index === rip.titleIndex) ?? null;
      if (!title) problems.push('The chosen title is not on the disc');
    } else {
      // The parts of a join are all ripped: the other discs of the download don't matter
      const siblings = rip.joinId
        ? []
        : (await db.getRips()).filter((r) => r.downloadName === rip.downloadName && r.status !== 'SKIPPED');
      if (siblings.length > 1) {
        problems.push(
          `This download has ${siblings.length} discs: choose the film on the right one and skip the others, or join the discs of one film`
        );
      }
      const choice = pickMainTitle(titles, keptLanguages());
      if (choice.title) title = choice.title;
      else problems.push(choice.reason);
    }
    return { title, problems };
  }

  /** Film (TMDB) and title (disc): rip right away when both are sure. */
  private async decide(rip: Rip, titles: DiscTitle[], discName?: string) {
    const problems: string[] = [];

    let movie: TmdbMovie | null = null;
    const joined = rip.tmdbId === null ? await this.joinFilm(rip) : null;
    if (rip.tmdbId !== null) {
      movie = filmOf(rip);
    } else if (joined) {
      // The film of the other parts: the same languages are kept on every disc
      movie = joined;
      rip = await this.update(rip.id, this.movieFields(movie));
    } else if (!tmdbConfigured()) {
      problems.push('TMDB_API_KEY is not set: confirm the title to rip');
    } else {
      const identified = await this.identify(rip, discName);
      movie = identified.movie;
      if (movie) rip = await this.update(rip.id, this.movieFields(movie));
      else problems.push(identified.reason);
    }

    const { title, problems: titleProblems } = await this.pickTitle(rip, titles);
    problems.push(...titleProblems);

    if (problems.length > 0 || !title) {
      logger.info({ ripId: rip.id, problems }, 'Rip needs a choice');
      await this.update(rip.id, { status: 'NEEDS_ATTENTION', reason: problems.join(' · ') });
      return;
    }
    await this.startRip({ ...rip, titleIndex: title.index });
  }

  private movieFields(movie: TmdbMovie) {
    return {
      tmdbId: movie.id,
      title: movie.title,
      originalTitle: movie.originalTitle,
      originalLanguage: movie.originalLanguage,
      year: movie.year,
    };
  }

  private async startRip(rip: Rip) {
    const titles: DiscTitle[] = JSON.parse(rip.titles ?? '[]');
    const title = titles.find((t) => t.index === rip.titleIndex);
    if (!title) {
      await this.update(rip.id, { status: 'NEEDS_ATTENTION', reason: 'The chosen title is not on the disc' });
      return;
    }
    // Ripped again: an earlier part must not be joined if this rip fails
    if (rip.joinId) await rm(partFile(rip.joinId, rip.joinPart!), { force: true });
    if (rip.engine === 'remux') {
      await this.startRemux(rip, title);
      return;
    }

    const { bavail, bsize } = await statfs(config.RIP.WORK_DIR);
    const free = bavail * bsize;
    if (free < title.sizeBytes + SPACE_MARGIN_BYTES) {
      await this.update(rip.id, {
        status: 'NEEDS_ATTENTION',
        reason: `Not enough free space for the rip: ${formatBytes(title.sizeBytes)} needed, ${formatBytes(free)} free`,
      });
      return;
    }

    // Film not identified (ripped by hand): its language is unknown, keep them all
    const original = languageCodes(rip.originalLanguage);
    const languages = [keptLanguages(), original].filter((codes) => codes.length > 0);
    const jobId = await submitJob({
      action: 'mkv',
      ...sourceOf(rip),
      minLength: config.RIP.MIN_LENGTH,
      title: title.index,
      selection: selectionRule(languages, original.length === 0),
    });
    await this.update(rip.id, {
      status: 'RIPPING',
      jobId,
      titleIndex: title.index,
      progress: 0,
      reason: null,
      startedAt: new Date(),
    });
    logger.info({ ripId: rip.id, jobId, title: title.index, film: rip.title }, 'Ripping');
  }

  private async ripped(rip: Rip, output: string, exitCode: number) {
    const result = parseRipResult(output, exitCode);
    const files = await jobOutputs(rip.jobId!);
    if (!result.ok || files.length !== 1) {
      await removeJob(rip.jobId!);
      await this.update(rip.id, {
        status: 'FAILED',
        jobId: null,
        reason: result.ok ? `Expected one .mkv file, MakeMKV wrote ${files.length}` : result.error,
      });
      return;
    }

    const target = rip.joinId ? await this.stashPart(rip, files[0]) : await this.handOver(rip, files[0]);
    await removeJob(rip.jobId!);
    logger.info({ ripId: rip.id, file: target }, rip.joinId ? 'Part of a join ripped' : 'Rip completed');
  }

  /** Moves a ripped film into the watch folder (the upload follows): DONE. */
  private async handOver(rip: Rip, file: string) {
    // Same filesystem: the watcher sees the complete file appear at once
    const target = await this.freeName(config.WATCH_DIR, outputName(rip));
    await rename(file, target);
    // Ripped: the disc unpacked from an archive is not needed any more
    await this.discardUnpacked(rip);
    await this.update(rip.id, {
      status: 'DONE',
      jobId: null,
      progress: 100,
      outputFile: target,
      completedAt: new Date(),
    });
    return target;
  }

  // --- Ripping without MakeMKV (remux.ts) ---

  /** The disc on disk: in the downloads, or unpacked from an archive (null when that is gone). */
  private async discOf(rip: Rip): Promise<{ file: string; type: DiscType } | null> {
    if (!isArchive(rip)) return { file: path.join(config.RIP.SOURCE_DIR, rip.sourcePath), type: rip.sourceType as DiscType };
    const film = unpackedFilm(rip);
    return film && rip.contentType !== 'MKV' && (await exists(film)) ? { file: film, type: rip.contentType as DiscType } : null;
  }

  /** The titles of the disc read without MakeMKV, then on as after MakeMKV's scan. */
  private async scanWithoutMakemkv(rip: Rip) {
    const disc = await this.discOf(rip);
    let titles: DiscTitle[];
    try {
      if (!disc) throw new Error('the disc unpacked from the archive is gone');
      titles = await scanDisc(await openSource(disc.file, disc.type), `${remuxDir(rip.id)}-scan`);
    } catch (error) {
      logger.warn({ ripId: rip.id, error: (error as Error).message }, 'Cannot read the disc without MakeMKV');
      await this.update(rip.id, { status: 'FAILED', reason: `Cannot read the disc without MakeMKV: ${(error as Error).message}` });
      return;
    }
    // Like MakeMKV's minimum length: shorter titles are never the film (unless chosen already)
    titles = titles.filter((t) => t.durationSec >= config.RIP.MIN_LENGTH || t.index === rip.titleIndex);
    const titleIndex = titles.some((t) => t.index === rip.titleIndex) ? rip.titleIndex : null;
    rip = await this.update(rip.id, { titles: JSON.stringify(titles), titleIndex });
    logger.info({ ripId: rip.id, titles: titles.length, chosen: titleIndex }, 'Disc read without MakeMKV');
    // A title chosen on MakeMKV's scan is ripped as it is, like a choice in the UI
    if (titleIndex !== null) await this.startRip(rip);
    else await this.decide(rip, titles, rip.discName ?? undefined);
  }

  private async startRemux(rip: Rip, title: DiscTitle) {
    const disc = await this.discOf(rip);
    let source: RemuxSource;
    try {
      if (!disc) throw new Error('the disc unpacked from the archive is gone: Retry');
      source = await openSource(disc.file, disc.type);
    } catch (error) {
      await this.update(rip.id, { status: 'FAILED', reason: `Cannot read the disc without MakeMKV: ${(error as Error).message}` });
      return;
    }

    const needs = remuxNeeds(source, title);
    const { bavail, bsize } = await statfs(config.RIP.WORK_DIR);
    const free = bavail * bsize;
    if (free < needs + SPACE_MARGIN_BYTES) {
      await this.update(rip.id, {
        status: 'NEEDS_ATTENTION',
        reason:
          `Not enough free space for the rip: ${formatBytes(needs)} needed` +
          (needs > title.sizeBytes ? ' (the image is extracted first)' : '') +
          `, ${formatBytes(free)} free`,
      });
      return;
    }

    const dir = remuxDir(rip.id);
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
    rip = await this.update(rip.id, {
      status: 'RIPPING',
      jobId: null,
      titleIndex: title.index,
      progress: 0,
      reason: null,
      startedAt: new Date(),
    });

    // Film not identified (ripped by hand): its language is unknown, keep them all
    const original = languageCodes(rip.originalLanguage);
    const ripId = rip.id;
    const controller = new AbortController();
    const job = { ripId, controller, progress: 0, finished: false } as Remuxing;
    job.done = remuxTitle({
      source,
      title,
      languages: [keptLanguages(), original].filter((codes) => codes.length > 0),
      keepAll: original.length === 0,
      dir,
      name: 'film',
      signal: controller.signal,
      onProgress: (progress) => {
        if (progress === job.progress) return;
        job.progress = progress;
        this.emit('rip-progress', { ripId, progress, status: 'RIPPING' });
      },
    })
      .then((result) => {
        job.result = result;
      })
      .catch((error: Error) => {
        job.error = error;
      })
      .finally(() => {
        job.finished = true;
      });
    this.remuxing = job;
    logger.info({ ripId, title: title.name ?? title.index, film: rip.title, kind: source.kind, iso: source.iso }, 'Ripping without MakeMKV');
  }

  private async pollRemux(rip: Rip) {
    const job = this.remuxing?.ripId === rip.id ? this.remuxing : null;
    if (!job) {
      // Interrupted by a restart: from scratch, with the same title
      await rm(remuxDir(rip.id), { recursive: true, force: true });
      await this.update(rip.id, { status: 'QUEUED', progress: 0 });
      return;
    }
    if (!job.finished) {
      if (job.progress !== rip.progress) await db.updateRip(rip.id, { progress: job.progress });
      return;
    }
    this.remuxing = null;

    if (job.error || !job.result) {
      const message = job.error?.message ?? 'no file';
      logger.warn({ ripId: rip.id, error: message }, 'Ripping without MakeMKV failed');
      await rm(remuxDir(rip.id), { recursive: true, force: true });
      await this.update(rip.id, { status: 'FAILED', progress: 0, reason: `Ripping without MakeMKV failed: ${message}` });
      return;
    }
    if (job.result.warnings.length > 0) logger.warn({ ripId: rip.id, warnings: job.result.warnings }, 'Ripped without MakeMKV, with warnings');
    const target = rip.joinId ? await this.stashPart(rip, job.result.file) : await this.handOver(rip, job.result.file);
    await rm(remuxDir(rip.id), { recursive: true, force: true });
    logger.info({ ripId: rip.id, file: target }, rip.joinId ? 'Part of a join ripped without MakeMKV' : 'Rip without MakeMKV completed');
  }

  /** Stops the rip without MakeMKV of this rip, if running, and deletes its files. */
  private async discardRemux(rip: Rip) {
    if (this.remuxing?.ripId === rip.id) {
      this.remuxing.controller.abort();
      await this.remuxing.done;
      this.remuxing = null;
    }
    await rm(remuxDir(rip.id), { recursive: true, force: true });
  }

  /** Stops whatever rips this disc (MakeMKV or not), deleting its partial file. */
  private async stopRip(rip: Rip) {
    if (rip.jobId) {
      await cancelJob(rip.jobId);
      // The runner leaves an .exit file; the job's files are removed with it
      setTimeout(() => removeJob(rip.jobId!).catch(() => undefined), 30_000);
    }
    await this.discardRemux(rip);
  }

  // --- Discs of one film, joined (join.ts) ---

  /** The film of another part of the rip's join, null when none is identified (or not a join). */
  private async joinFilm(rip: Rip): Promise<TmdbMovie | null> {
    if (!rip.joinId) return null;
    const part = (await db.getRipsByJoinId(rip.joinId)).find((p) => p.tmdbId !== null);
    return part ? filmOf(part) : null;
  }

  /** A part of a join ripped: kept in the join's folder until every part is there. */
  private async stashPart(rip: Rip, file: string) {
    const target = partFile(rip.joinId!, rip.joinPart!);
    // Same filesystem as the rips: a rename
    await mkdir(joinDir(rip.joinId!), { recursive: true });
    await rename(file, target);
    // Ripped: the disc unpacked from an archive is not needed any more
    await this.discardUnpacked(rip);
    await this.update(rip.id, { status: 'JOINING', jobId: null, progress: 0, reason: null });
    await this.waitingReasons(rip.joinId!);
    return target;
  }

  /** "Part 1 of 2 ripped: waiting for part 2" on the ripped parts of a join. */
  private async waitingReasons(joinId: string) {
    const parts = await db.getRipsByJoinId(joinId);
    const missing = parts.filter((p) => p.status !== 'JOINING').map((p) => p.joinPart);
    for (const part of parts) {
      if (part.status !== 'JOINING') continue;
      const reason =
        `Part ${part.joinPart} of ${parts.length} ripped: ` +
        (missing.length > 0 ? `waiting for part${missing.length > 1 ? 's' : ''} ${missing.join(', ')}` : 'waiting to join the parts');
      if (part.reason !== reason) await this.update(part.id, { reason });
    }
  }

  /** Joins the parts of a film once all of them are ripped: true when mkvmerge started. */
  private async startReadyJoin() {
    const ripped = await db.getRipsByStatus(['JOINING']);
    for (const joinId of new Set(ripped.map((rip) => rip.joinId))) {
      if (!joinId) continue;
      const parts = await db.getRipsByJoinId(joinId);
      if (parts.every((part) => part.status === 'JOINING') && (await this.startJoin(parts))) return true;
    }
    return false;
  }

  private async startJoin(parts: Rip[]) {
    const [first] = parts;
    const joinId = first.joinId!;
    const files = parts.map((part) => partFile(joinId, part.joinPart!));
    let needs = 0;
    for (const [i, file] of files.entries()) {
      const info = await stat(file).catch(() => null);
      if (!info) {
        // Deleted meanwhile: that disc is ripped again (with the same title)
        logger.warn({ ripId: parts[i].id, file }, 'A ripped part of a join is gone: ripping it again');
        await this.update(parts[i].id, { status: 'QUEUED', reason: null, progress: 0 });
        await this.waitingReasons(joinId);
        return false;
      }
      needs += info.size;
    }

    // Until there is room: the queue goes on meanwhile
    const { bavail, bsize } = await statfs(config.RIP.WORK_DIR);
    const free = bavail * bsize;
    if (free < needs + SPACE_MARGIN_BYTES) {
      const reason = `Not enough free space to join the parts: ${formatBytes(needs)} needed, ${formatBytes(free)} free`;
      if (first.reason !== reason) await this.update(first.id, { reason });
      return false;
    }

    const output = path.join(joinDir(joinId), 'film.mkv');
    await rm(output, { force: true });
    // The first part shows the progress
    await this.update(first.id, { reason: null, progress: 0, startedAt: new Date() });
    for (const part of parts.slice(1)) await this.update(part.id, { reason: 'Being joined to part 1', progress: 0 });

    const ripId = first.id;
    const controller = new AbortController();
    const job = { ripId, controller, progress: 0, finished: false } as Remuxing;
    job.done = joinParts({
      parts: files,
      output,
      signal: controller.signal,
      onProgress: (progress) => {
        if (progress === job.progress) return;
        job.progress = progress;
        this.emit('rip-progress', { ripId, progress, status: 'JOINING' });
      },
    })
      .then((result) => {
        job.result = result;
      })
      .catch((error: Error) => {
        job.error = error;
      })
      .finally(() => {
        job.finished = true;
      });
    this.joining = job;
    logger.info({ ripId, parts: parts.length, size: formatBytes(needs), film: first.title }, 'Joining the parts of a film');
    return true;
  }

  private async pollJoin() {
    const job = this.joining!;
    const first = await db.getRipById(job.ripId);
    if (!first?.joinId || first.status !== 'JOINING') {
      // Cancelled meanwhile (cancelJoin stops it first): nothing left to do
      job.controller.abort();
      await job.done;
      this.joining = null;
      return;
    }
    if (!job.finished) {
      if (job.progress !== first.progress) await db.updateRip(first.id, { progress: job.progress });
      return;
    }
    this.joining = null;

    if (job.error || !job.result) {
      // The parts stay: Retry joins them again
      const message = job.error?.message ?? 'no file';
      logger.warn({ ripId: first.id, error: message }, 'Joining the parts failed');
      await rm(path.join(joinDir(first.joinId), 'film.mkv'), { force: true });
      await this.update(first.id, { status: 'FAILED', progress: 0, reason: `Joining the parts failed: ${message}` });
      await this.waitingReasons(first.joinId);
      return;
    }
    if (job.result.warnings.length > 0) logger.warn({ ripId: first.id, warnings: job.result.warnings }, 'Parts joined, with warnings');

    const joinId = first.joinId;
    const target = await this.handOver(first, job.result.file);
    // Every part is DONE with the one film (and its upload)
    for (const part of await db.getRipsByJoinId(joinId)) {
      if (part.id === first.id) continue;
      await this.update(part.id, { status: 'DONE', progress: 100, reason: null, outputFile: target, completedAt: new Date() });
    }
    await rm(joinDir(joinId), { recursive: true, force: true });
    logger.info({ ripId: first.id, file: target }, 'Parts joined');
  }

  /**
   * Undoes a join not done yet: what rips or joins its parts is stopped, its
   * ripped parts deleted, and every part leaves it with `status` and `reason`.
   */
  private async cancelJoin(joinId: string, status: 'SKIPPED' | 'NEEDS_ATTENTION', reason: string) {
    if (this.joining?.ripId === joinId) {
      this.joining.controller.abort();
      await this.joining.done;
      this.joining = null;
    }
    for (const part of await db.getRipsByJoinId(joinId)) {
      if (part.status === 'DONE') continue;
      await this.stopRip(part);
      if (status === 'SKIPPED') await this.discardUnpacked(part);
      await this.update(part.id, { status, reason, jobId: null, progress: 0, joinId: null, joinPart: null });
    }
    await rm(joinDir(joinId), { recursive: true, force: true });
    logger.info({ joinId, status, reason }, 'Join cancelled');
  }

  // --- Actions from the UI ---

  /** A rip in the list (one removed from it is not found either). */
  private async visibleRip(id: string) {
    const rip = await db.getRipById(id);
    if (!rip || rip.hidden) throw new Error('Rip not found');
    return rip;
  }

  /** Rips the given title as the given film (either may be kept as is). */
  async choose(id: string, choice: { titleIndex?: number; tmdbId?: number }) {
    const rip = await this.visibleRip(id);
    if (!['NEEDS_ATTENTION', 'FAILED', 'SKIPPED'].includes(rip.status)) throw new Error(`Rip is ${rip.status}`);
    const titles: DiscTitle[] = JSON.parse(rip.titles ?? '[]');
    if (choice.titleIndex !== undefined && !titles.some((t) => t.index === choice.titleIndex)) {
      throw new Error('No such title on the disc');
    }
    const movie = choice.tmdbId !== undefined ? await getMovie(choice.tmdbId) : null;
    const updated = await this.update(id, {
      status: 'QUEUED',
      reason: null,
      ...(choice.titleIndex !== undefined ? { titleIndex: choice.titleIndex } : {}),
      ...(movie ? this.movieFields(movie) : {}),
    });
    // A part of a join: one film for every part
    if (movie && rip.joinId) {
      for (const part of await db.getRipsByJoinId(rip.joinId)) {
        if (part.id !== id) await this.update(part.id, this.movieFields(movie));
      }
    }
    return updated;
  }

  /**
   * Joins discs of one download into one film, in the given order: each one is
   * ripped as usual (with the title chosen on it, if any; the film is the first
   * identified part's), then mkvmerge appends them. Discs in another join leave
   * it, and so do that join's other discs.
   */
  async join(ripIds: string[]) {
    return this.exclusive(async () => {
      if (ripIds.length < 2 || new Set(ripIds).size !== ripIds.length) throw new Error('Choose at least two discs');
      const rips: Rip[] = [];
      for (const id of ripIds) rips.push(await this.visibleRip(id));
      if (new Set(rips.map((rip) => rip.downloadName)).size > 1) throw new Error('The discs are not in the same download');
      for (const rip of rips) {
        if (!JOINABLE.includes(rip.status)) throw new Error(`Rip is ${rip.status}`);
        if (isArchive(rip) && rip.contentType === 'MKV') throw new Error('The archive holds an .mkv, not a disc');
      }
      for (const joinId of new Set(rips.map((rip) => rip.joinId))) {
        if (joinId) await this.cancelJoin(joinId, 'NEEDS_ATTENTION', 'Its discs were joined again in another way');
      }

      const film = rips.find((rip) => rip.tmdbId !== null);
      const joinId = rips[0].id;
      const parts: Rip[] = [];
      for (const [i, rip] of rips.entries()) {
        parts.push(
          await this.update(rip.id, {
            status: 'QUEUED',
            reason: null,
            progress: 0,
            joinId,
            joinPart: i + 1,
            ...(film ? this.movieFields(filmOf(film)) : {}),
          })
        );
      }
      logger.info({ joinId, parts: rips.map((rip) => rip.sourcePath) }, 'Discs joined into one film');
      return parts;
    });
  }

  /**
   * Rips the disc with the backend's own tools instead of MakeMKV (remux.ts): its
   * titles are read again. A title chosen on MakeMKV's scan of a Blu-ray is the
   * same playlist; on a DVD MakeMKV numbers the titles its own way, so it is not.
   */
  async ripWithoutMakemkv(id: string) {
    return this.exclusive(async () => {
      const rip = await this.visibleRip(id);
      if (!['FAILED', 'NEEDS_ATTENTION', 'SKIPPED', 'QUEUED'].includes(rip.status)) throw new Error(`Rip is ${rip.status}`);
      const type = isArchive(rip) ? rip.contentType : rip.sourceType;
      if (type === 'MKV') throw new Error('The archive holds an .mkv, not a disc');
      // An archive not listed yet: its disc type is known once unpacked
      const missing = type ? missingTools(await remuxTools(), type as DiscType) : null;
      if (missing) throw new Error(`Cannot rip without MakeMKV: ${missing} not installed`);

      const titles: DiscTitle[] = JSON.parse(rip.titles ?? '[]');
      const chosen = titles.find((t) => t.index === rip.titleIndex);
      const titleIndex = rip.engine === 'remux' ? (chosen?.index ?? null) : playlistNumber(chosen?.sourceFile ?? '');
      logger.info({ ripId: rip.id, title: titleIndex }, 'Rip without MakeMKV requested');
      return this.update(id, {
        engine: 'remux',
        status: 'QUEUED',
        reason: null,
        titles: null,
        titleIndex,
        progress: 0,
        jobId: null,
      });
    });
  }

  /** Starts over with MakeMKV: scan and automatic choices again (an archive not unpacked yet is listed again). */
  async retry(id: string) {
    const rip = await this.visibleRip(id);
    if (['UNPACKING', 'SCANNING', 'RIPPING', 'JOINING'].includes(rip.status)) throw new Error('Rip in progress');
    // Joining failed: the disc is ripped already, only the join is tried again
    if (rip.status === 'FAILED' && rip.joinId && (await exists(partFile(rip.joinId, rip.joinPart!)))) {
      return this.update(id, { status: 'JOINING', reason: null, progress: 0 });
    }
    return this.update(id, {
      engine: 'makemkv',
      status: 'QUEUED',
      reason: null,
      ...(isArchive(rip) && !rip.unpackedTo ? { contentType: null, contentPath: null, unpackBytes: null } : {}),
      titles: null,
      titleIndex: null,
      tmdbId: null,
      title: null,
      originalTitle: null,
      originalLanguage: null,
      year: null,
      progress: 0,
    });
  }

  /** Never rips it (stops it if running, deletes what was unpacked of its archive). */
  async skip(id: string) {
    return this.exclusive(async () => {
      const rip = await this.visibleRip(id);
      // A part of a join: the film is skipped, every disc of it
      if (rip.joinId && rip.status !== 'DONE') {
        await this.cancelJoin(rip.joinId, 'SKIPPED', 'Skipped');
        return db.getRipById(id) as Promise<Rip>;
      }
      await this.stopRip(rip);
      await this.discardUnpacked(rip);
      return this.update(id, { status: 'SKIPPED', reason: 'Skipped', jobId: null, progress: 0 });
    });
  }

  /** Removes a skipped rip from the list. */
  async remove(id: string) {
    return this.exclusive(async () => {
      const rip = await this.visibleRip(id);
      if (rip.status !== 'SKIPPED') throw new Error(`Rip is ${rip.status}`);
      await this.hide(rip);
    });
  }

  /** Removes every skipped rip from the list. */
  async removeSkipped() {
    return this.exclusive(async () => {
      const rips = await db.getRipsByStatus(['SKIPPED'], true);
      for (const rip of rips) await this.hide(rip);
      logger.info({ removed: rips.length }, 'Skipped rips removed from the list');
      return { removed: rips.length };
    });
  }

  private async hide(rip: Rip) {
    await this.discardRemux(rip);
    await this.discardUnpacked(rip);
    await db.updateRip(rip.id, { hidden: true });
    this.emit('rip-updated', { ripId: rip.id, status: 'DELETED' });
  }

  async exclusions(): Promise<ExclusionSettings> {
    const settings = await db.getSettings([EXCLUSIONS_KEY, FOLDERS_KEY, ARRIVE_COMPLETE_KEY]);
    return {
      patterns: parseExclusions(settings[EXCLUSIONS_KEY]),
      folders: parseFolders(settings[FOLDERS_KEY]),
      arriveComplete: settings[ARRIVE_COMPLETE_KEY] === 'true',
    };
  }

  /** The subfolders of a folder of the downloads, for picking the ignored ones */
  folders(relative: string) {
    return listFolders(config.RIP.SOURCE_DIR, relative);
  }

  /**
   * Saves the exclusion rules and the ignored folders (already normalized, see
   * normalizeExclusions and normalizeFolders); what is left out is kept as is.
   * The discs in a new ignored folder are removed from the list, unless they
   * are being ripped or were ripped. A new rule skips the discs not started yet
   * that it matches; the discs a rule skipped go back to the queue when no rule
   * matches them any more. Discs ripped or skipped by hand, or removed from
   * the list, are left alone.
   */
  async setExclusions(changes: Partial<ExclusionSettings>) {
    return this.exclusive(async () => {
      const current = await this.exclusions();
      const { patterns, folders, arriveComplete } = { ...current, ...changes };
      const previous = new Set(current.patterns.map((p) => p.toLowerCase()));
      const added = patterns.filter((p) => !previous.has(p.toLowerCase()));
      await db.setSettings({
        [EXCLUSIONS_KEY]: JSON.stringify(patterns),
        [FOLDERS_KEY]: JSON.stringify(folders),
        [ARRIVE_COMPLETE_KEY]: String(arriveComplete),
      });

      let removed = 0;
      for (const rip of await db.getRipsByStatus(REMOVABLE)) {
        if (!ignoredFolder(folders, rip.sourcePath)) continue;
        if (rip.joinId) await this.cancelJoin(rip.joinId, 'NEEDS_ATTENTION', 'Join cancelled: one of its discs is in an ignored folder');
        // Deleted, not hidden: a folder no longer ignored is searched from scratch
        await this.discardRemux(rip);
        await this.discardUnpacked(rip);
        await db.deleteRip(rip.id);
        if (rip.hidden) continue;
        this.emit('rip-updated', { ripId: rip.id, status: 'DELETED' });
        removed++;
      }

      let skipped = 0;
      let restored = 0;
      for (const rip of await db.getRipsByStatus([...EXCLUDABLE, 'SKIPPED'], true)) {
        if (rip.status !== 'SKIPPED') {
          const rule = matchExclusion(added, rip.sourcePath);
          if (!rule) continue;
          if (rip.joinId) await this.cancelJoin(rip.joinId, 'NEEDS_ATTENTION', 'Join cancelled: one of its discs is excluded');
          await this.discardUnpacked(rip);
          await this.update(rip.id, { status: 'SKIPPED', reason: excludedReason(rule) });
          skipped++;
        } else if (rip.reason?.startsWith(EXCLUDED_PREFIX)) {
          const rule = matchExclusion(patterns, rip.sourcePath);
          if (!rule) {
            // Back to the start: the next discovery checks it is still there and complete
            await this.update(rip.id, { status: 'WAITING', reason: null });
            restored++;
          } else if (rip.reason !== excludedReason(rule)) {
            await this.update(rip.id, { reason: excludedReason(rule) });
          }
        }
      }
      logger.info({ exclusions: patterns, folders, arriveComplete, removed, skipped, restored }, 'Rip exclusions saved');
      return { exclusions: patterns, ignoredFolders: folders, arriveComplete, removed, skipped, restored };
    });
  }

  async status() {
    const enabled = config.RIP.ENABLED;
    const { patterns, folders, arriveComplete } = await this.exclusions();
    return {
      enabled: config.RIP.ENABLED,
      runnerAlive: config.RIP.ENABLED ? await runnerAlive() : false,
      tmdbConfigured: tmdbConfigured(),
      language: config.RIP.LANGUAGE,
      minLength: config.RIP.MIN_LENGTH,
      exclusions: patterns,
      ignoredFolders: folders,
      arriveComplete,
      // RAR archives: unrar installed, and the disks they can be unpacked on
      unpack: {
        unrar: enabled ? await unrarAvailable() : false,
        disks: enabled ? await unpackTargets(false) : [],
        downloadsWritable: enabled ? await downloadsUnpackWritable() : false,
      },
      // Ripping without MakeMKV: the tools found
      remux: enabled ? await remuxTools() : null,
    };
  }
}

export const ripper = new Ripper();
