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
import { DiscType, findDiscs, isDownloadComplete, makemkvSource } from './downloads.js';
import { EXCLUDED_PREFIX, excludedReason, matchExclusion, parseExclusions } from './exclusions.js';
import { describeExit, DiscTitle, languageCodes, parseInfo, parseProgress, parseRipResult, selectionRule } from './makemkv.js';
import { parseDiscLabel, parseReleaseName } from './releaseName.js';
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
 * When the film or its title can't be told for sure, the rip stops in
 * NEEDS_ATTENTION and waits for a choice in the UI (so does an archive without
 * the space to unpack it). FAILED can be retried, SKIPPED is never ripped (by
 * hand, by an exclusion rule, or an archive without exactly one film).
 */

export const RIP_STATUSES = [
  'WAITING',
  'QUEUED',
  'UNPACKING',
  'SCANNING',
  'RIPPING',
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
// Not started yet: a new exclusion rule skips them
const EXCLUDABLE = ['WAITING', 'QUEUED', 'NEEDS_ATTENTION'];

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

class Ripper extends EventEmitter {
  private timer: NodeJS.Timeout | null = null;
  private busy = false;
  private lastDiscover = 0;
  private unpacking: Unpacking | null = null;
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
    // unrar is a child of this process: it would go on writing after it ends
    this.unpacking?.controller.abort();
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
    const discs = await findDiscs(config.RIP.SOURCE_DIR);
    const known = new Map((await db.getRips()).map((rip) => [rip.sourcePath, rip]));

    // The first time, the downloads already there are only listed (RIP_EXISTING to rip them);
    // so are the archives already there when Wayfinderr started unpacking them
    const settings = await db.getSettings([INITIALIZED_KEY, ARCHIVES_KEY, EXCLUSIONS_KEY]);
    const initialized = settings[INITIALIZED_KEY];
    const archivesInitialized = settings[ARCHIVES_KEY];
    const exclusions = parseExclusions(settings[EXCLUSIONS_KEY]);
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
    const quietMs = config.RIP.QUIET_MINUTES * 60_000;
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
      else await this.poll(active);
      return;
    }

    // Unpacking an archive and moving its .mkv don't need MakeMKV
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
      if (alive) {
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
      const siblings = (await db.getRips()).filter((r) => r.downloadName === rip.downloadName && r.status !== 'SKIPPED');
      if (siblings.length > 1) {
        problems.push(`This download has ${siblings.length} discs: choose the film on the right one, skip the others`);
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
    if (rip.tmdbId !== null) {
      movie = { id: rip.tmdbId, title: rip.title ?? '', originalTitle: rip.originalTitle ?? '', originalLanguage: rip.originalLanguage ?? '', year: rip.year };
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

    // Same filesystem: the watcher sees the complete file appear at once
    const target = await this.freeName(config.WATCH_DIR, outputName(rip));
    await rename(files[0], target);
    await removeJob(rip.jobId!);
    // Ripped: the disc unpacked from an archive is not needed any more
    await this.discardUnpacked(rip);
    await this.update(rip.id, {
      status: 'DONE',
      jobId: null,
      progress: 100,
      outputFile: target,
      completedAt: new Date(),
    });
    logger.info({ ripId: rip.id, file: target }, 'Rip completed');
  }

  // --- Actions from the UI ---

  /** Rips the given title as the given film (either may be kept as is). */
  async choose(id: string, choice: { titleIndex?: number; tmdbId?: number }) {
    const rip = await db.getRipById(id);
    if (!rip) throw new Error('Rip not found');
    if (!['NEEDS_ATTENTION', 'FAILED', 'SKIPPED'].includes(rip.status)) throw new Error(`Rip is ${rip.status}`);
    const titles: DiscTitle[] = JSON.parse(rip.titles ?? '[]');
    if (choice.titleIndex !== undefined && !titles.some((t) => t.index === choice.titleIndex)) {
      throw new Error('No such title on the disc');
    }
    const movie = choice.tmdbId !== undefined ? await getMovie(choice.tmdbId) : null;
    return this.update(id, {
      status: 'QUEUED',
      reason: null,
      ...(choice.titleIndex !== undefined ? { titleIndex: choice.titleIndex } : {}),
      ...(movie ? this.movieFields(movie) : {}),
    });
  }

  /** Starts over: scan and automatic choices again (an archive not unpacked yet is listed again). */
  async retry(id: string) {
    const rip = await db.getRipById(id);
    if (!rip) throw new Error('Rip not found');
    if (['UNPACKING', 'SCANNING', 'RIPPING'].includes(rip.status)) throw new Error('Rip in progress');
    return this.update(id, {
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
      const rip = await db.getRipById(id);
      if (!rip) throw new Error('Rip not found');
      if (rip.jobId) {
        await cancelJob(rip.jobId);
        // The runner leaves an .exit file; the job's files are removed with it
        setTimeout(() => removeJob(rip.jobId!).catch(() => undefined), 30_000);
      }
      await this.discardUnpacked(rip);
      return this.update(id, { status: 'SKIPPED', reason: 'Skipped', jobId: null, progress: 0 });
    });
  }

  async exclusions() {
    return parseExclusions((await db.getSettings([EXCLUSIONS_KEY]))[EXCLUSIONS_KEY]);
  }

  /**
   * Saves the exclusion rules (already normalized, see normalizeExclusions).
   * A new rule skips the discs not started yet that it matches; the discs a
   * rule skipped go back to the queue when no rule matches them any more.
   * Discs ripped or skipped by hand are left alone.
   */
  async setExclusions(patterns: string[]) {
    return this.exclusive(async () => {
      const previous = new Set((await this.exclusions()).map((p) => p.toLowerCase()));
      const added = patterns.filter((p) => !previous.has(p.toLowerCase()));
      await db.setSettings({ [EXCLUSIONS_KEY]: JSON.stringify(patterns) });

      let skipped = 0;
      let restored = 0;
      for (const rip of await db.getRipsByStatus([...EXCLUDABLE, 'SKIPPED'])) {
        if (rip.status !== 'SKIPPED') {
          const rule = matchExclusion(added, rip.sourcePath);
          if (!rule) continue;
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
      logger.info({ exclusions: patterns, skipped, restored }, 'Rip exclusions saved');
      return { exclusions: patterns, skipped, restored };
    });
  }

  async status() {
    const enabled = config.RIP.ENABLED;
    return {
      enabled: config.RIP.ENABLED,
      runnerAlive: config.RIP.ENABLED ? await runnerAlive() : false,
      tmdbConfigured: tmdbConfigured(),
      language: config.RIP.LANGUAGE,
      minLength: config.RIP.MIN_LENGTH,
      exclusions: await this.exclusions(),
      // RAR archives: unrar installed, and the disks they can be unpacked on
      unpack: {
        unrar: enabled ? await unrarAvailable() : false,
        disks: enabled ? await unpackTargets(false) : [],
        downloadsWritable: enabled ? await downloadsUnpackWritable() : false,
      },
    };
  }
}

export const ripper = new Ripper();
