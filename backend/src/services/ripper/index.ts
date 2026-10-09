import { EventEmitter } from 'events';
import { access, rename, statfs } from 'fs/promises';
import path from 'path';
import { Rip } from '@prisma/client';
import { config } from '../../config/index.js';
import logger from '../../config/logger.js';
import { db } from '../database.js';
import { findDiscs, isDownloadComplete, makemkvSource, SourceType } from './downloads.js';
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
 * When the film or its title can't be told for sure, the rip stops in
 * NEEDS_ATTENTION and waits for a choice in the UI. FAILED can be retried,
 * SKIPPED is never ripped (by hand, or by an exclusion rule).
 */

export const RIP_STATUSES = ['WAITING', 'QUEUED', 'SCANNING', 'RIPPING', 'DONE', 'NEEDS_ATTENTION', 'FAILED', 'SKIPPED'];

const TICK_MS = 10_000;
const DISCOVER_MS = 60_000;
const LOG_TAIL_BYTES = 64 * 1024;
const SPACE_MARGIN_BYTES = 2 * 1024 ** 3;
const INITIALIZED_KEY = 'rip_initialized';
const EXCLUSIONS_KEY = 'rip_exclusions';
// Not started yet: a new exclusion rule skips them
const EXCLUDABLE = ['WAITING', 'QUEUED', 'NEEDS_ATTENTION'];

const keptLanguages = () => languageCodes(config.RIP.LANGUAGE);

const sourceOf = (rip: Rip) => makemkvSource({ path: rip.sourcePath, type: rip.sourceType as SourceType });

// Characters not allowed in file names on common filesystems
const safeFileName = (name: string) =>
  name
    .replace(/[\\/:*?"<>|]+/g, ' - ')
    .replace(/[\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.-]+|[\s.]+$/g, '');

export const formatBytes = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(1)} GB`;

class Ripper extends EventEmitter {
  private timer: NodeJS.Timeout | null = null;
  private busy = false;
  private lastDiscover = 0;
  private identifiedAgain = false;
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
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
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
        if (!this.identifiedAgain && tmdbConfigured()) {
          this.identifiedAgain = true;
          await this.identifyAgain();
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

    // The first time, the downloads already there are only listed (RIP_EXISTING to rip them)
    const settings = await db.getSettings([INITIALIZED_KEY, EXCLUSIONS_KEY]);
    const initialized = settings[INITIALIZED_KEY];
    const exclusions = parseExclusions(settings[EXCLUSIONS_KEY]);
    for (const disc of discs) {
      if (known.has(disc.path)) continue;
      const rule = matchExclusion(exclusions, disc.path);
      const skipped =
        !initialized && !config.RIP.RIP_EXISTING
          ? 'Already in the downloads when ripping was turned on'
          : rule && excludedReason(rule);
      const rip = await db.createRip({
        sourcePath: disc.path,
        sourceType: disc.type,
        downloadName: disc.downloadName,
        ...(skipped ? { status: 'SKIPPED', reason: skipped } : {}),
      });
      logger.info({ ripId: rip.id, source: disc.path, status: rip.status }, 'Disc found in the downloads');
      this.changed(rip);
    }
    if (!initialized) await db.setSettings({ [INITIALIZED_KEY]: new Date().toISOString() });

    const present = new Set(discs.map((disc) => disc.path));
    const quietMs = config.RIP.QUIET_MINUTES * 60_000;
    for (const rip of await db.getRipsByStatus(['WAITING'])) {
      if (!present.has(rip.sourcePath)) {
        // Deleted before it finished downloading
        await db.deleteRip(rip.id);
        this.emit('rip-updated', { ripId: rip.id, status: 'DELETED' });
      } else if (await isDownloadComplete(config.RIP.SOURCE_DIR, rip.downloadName, quietMs)) {
        await this.update(rip.id, { status: 'QUEUED' });
      }
    }
  }

  /** Moves the active rip forward, or starts the next one. */
  private async advance() {
    const [active] = await db.getRipsByStatus(['SCANNING', 'RIPPING']);
    if (active) {
      await this.poll(active);
      return;
    }
    const [next] = await db.getRipsByStatus(['QUEUED']);
    if (!next || !(await runnerAlive())) return;

    // Only a choice in the UI queues a scanned disc: with its title it is ripped
    // as it is, with just the film the title is picked again
    if (next.titles && next.titleIndex !== null) {
      await this.startRip(next);
    } else if (next.titles) {
      await this.decide(next, JSON.parse(next.titles), next.discName ?? undefined);
    } else {
      const jobId = await submitJob({ action: 'info', source: sourceOf(next), minLength: config.RIP.MIN_LENGTH });
      await this.update(next.id, { status: 'SCANNING', jobId, startedAt: new Date(), progress: 0, reason: null });
      logger.info({ ripId: next.id, jobId }, 'Scanning disc');
    }
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
          this.emit('rip-progress', { ripId: rip.id, progress });
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

  /** The film of a download, from its name, its folder or the disc label: null (and why) when unsure. */
  private async identify(rip: Rip, discName?: string): Promise<{ movie: TmdbMovie | null; reason: string }> {
    const names = [...new Set([rip.downloadName, path.basename(rip.sourcePath)])].map(parseReleaseName);
    if (discName) names.push(parseDiscLabel(discName));
    let reason = '';
    for (const name of names) {
      const match = await matchMovie(name).catch((error: Error) => ({ movie: null, candidates: [], reason: error.message }));
      if (match.movie) return { movie: match.movie, reason: '' };
      reason ||= match.reason ?? '';
    }
    return { movie: null, reason: reason || 'Film not identified on TMDB' };
  }

  /**
   * Once per start: the rips still waiting for their film are looked up again, so
   * that a better matcher (or a TMDB key added since) also applies to them. Those
   * identified now go back in the queue with their scan; the others stay as they are.
   */
  private async identifyAgain() {
    for (const rip of await db.getRipsByStatus(['NEEDS_ATTENTION'])) {
      if (!rip.titles || rip.tmdbId !== null || rip.titleIndex !== null) continue;
      const { movie } = await this.identify(rip, rip.discName ?? undefined);
      if (!movie) continue;
      logger.info({ ripId: rip.id, tmdbId: movie.id, film: movie.title }, 'Film identified on a second look');
      await this.update(rip.id, {
        status: 'QUEUED',
        reason: null,
        tmdbId: movie.id,
        title: movie.title,
        originalTitle: movie.originalTitle,
        originalLanguage: movie.originalLanguage,
        year: movie.year,
      });
    }
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
      if (movie) {
        rip = await this.update(rip.id, {
          tmdbId: movie.id,
          title: movie.title,
          originalTitle: movie.originalTitle,
          originalLanguage: movie.originalLanguage,
          year: movie.year,
        });
      } else {
        problems.push(identified.reason);
      }
    }

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

    if (problems.length > 0 || !title) {
      logger.info({ ripId: rip.id, problems }, 'Rip needs a choice');
      await this.update(rip.id, { status: 'NEEDS_ATTENTION', reason: problems.join(' · ') });
      return;
    }
    await this.startRip({ ...rip, titleIndex: title.index });
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
      source: sourceOf(rip),
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
    // Not identified on TMDB: named after the download ("Film Test (2001)")
    const film = rip.title || rip.originalTitle ? { title: rip.title || rip.originalTitle, year: rip.year } : parseReleaseName(rip.downloadName);
    const base = safeFileName(`${film.title || rip.downloadName}${film.year ? ` (${film.year})` : ''}`);
    // The name must be new on the server too: with DELETE_AFTER_UPLOAD an earlier
    // film with this name is gone from the folder, and the upload would replace it
    const taken = async (file: string) =>
      (await access(file).then(() => true, () => false)) || (await db.isUploadFileNameUsed(path.basename(file)));
    let target = path.join(config.WATCH_DIR, `${base}.mkv`);
    for (let n = 2; await taken(target); n++) {
      target = path.join(config.WATCH_DIR, `${base} (${n}).mkv`);
    }
    await rename(files[0], target);
    await removeJob(rip.jobId!);
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
      ...(movie
        ? {
            tmdbId: movie.id,
            title: movie.title,
            originalTitle: movie.originalTitle,
            originalLanguage: movie.originalLanguage,
            year: movie.year,
          }
        : {}),
    });
  }

  /** Starts over: scan and automatic choices again. */
  async retry(id: string) {
    const rip = await db.getRipById(id);
    if (!rip) throw new Error('Rip not found');
    if (['SCANNING', 'RIPPING'].includes(rip.status)) throw new Error('Rip in progress');
    return this.update(id, {
      status: 'QUEUED',
      reason: null,
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

  /** Never rips it (stops it if running). */
  async skip(id: string) {
    const rip = await db.getRipById(id);
    if (!rip) throw new Error('Rip not found');
    if (rip.jobId) {
      await cancelJob(rip.jobId);
      // The runner leaves an .exit file; the job's files are removed with it
      setTimeout(() => removeJob(rip.jobId!).catch(() => undefined), 30_000);
    }
    return this.update(id, { status: 'SKIPPED', reason: 'Skipped', jobId: null, progress: 0 });
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
    return {
      enabled: config.RIP.ENABLED,
      runnerAlive: config.RIP.ENABLED ? await runnerAlive() : false,
      tmdbConfigured: tmdbConfigured(),
      language: config.RIP.LANGUAGE,
      minLength: config.RIP.MIN_LENGTH,
      exclusions: await this.exclusions(),
    };
  }
}

export const ripper = new Ripper();
