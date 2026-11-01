import { EventEmitter } from 'events';
import { existsSync } from 'fs';
import { MergePair, Upload } from '@prisma/client';
import logger from '../../config/logger.js';
import { db } from '../database.js';
import { mkvNames } from '../torrentCleanup.js';
import { filmByName } from '../filmLookup.js';
import { dyadrr, mergeActive } from './index.js';
import { currentProgress, DyadrrChoices, DyadrrEvent, DyadrrReport, jobOutcome } from './jobs.js';

/**
 * Pairs of files of the same film, merged with Dyadrr. The user pairs two files by
 * hand (Dyadrr's study, §15: pairing works on uploads, not rips); Wayfinderr then
 * runs `dyadrr analyze` on them in the Dyadrr container and shows the report: the
 * offset, the plan, the checks, why it was refused, the choices still to make. The
 * merge itself comes after a confirmation (a later version).
 *
 * The four choices are settings: a fixed value, passed to every analysis, or "ask"
 * each time, left pending in the report for the merge to ask.
 */

export class MergeError extends Error {
  constructor(message: string, public status = 409) {
    super(message);
  }
}

export type ChoiceName = keyof DyadrrChoices;
export type ChoiceSetting = 'ask' | string;
export type ChoiceSettings = Record<ChoiceName, ChoiceSetting>;

// The values of each choice (Dyadrr's docs/CLI.md, "Scelte"), the default first
export const CHOICE_VALUES: Record<ChoiceName, readonly string[]> = {
  tail: ['trim', 'keep'],
  italian: ['all', 'main'],
  referenceItalianSubs: ['keep', 'drop'],
  edgeMismatch: ['drop', 'keep'],
};
const CHOICE_NAMES = Object.keys(CHOICE_VALUES) as ChoiceName[];
const SETTINGS_KEY = 'merge.choices';
// Asked each time until set otherwise
export const DEFAULT_CHOICES: ChoiceSettings = { tail: 'ask', italian: 'ask', referenceItalianSubs: 'ask', edgeMismatch: 'ask' };

// A queued or running job: the pair waits for its report
const ACTIVE = ['ANALYZING'];
// Uploads that can be paired: their file is on the disk and nothing else is using it
const PAIRABLE = ['HELD', 'COMPLETED', 'SKIPPED', 'FAILED', 'CANCELLED'];
const POLL_MS = 2000;
// A code ISO 639-1 or 639-2, or an IETF tag (pt-BR): Dyadrr checks it for real
const LANGUAGE = /^[a-z]{2,3}(-[a-z0-9]{2,8})*$/i;

/** 0-100 within the phase, when the event says how far it is. */
export const progressPercent = (event: DyadrrEvent | null): number | null => {
  if (!event) return null;
  if (typeof event.percent === 'number') return Math.round(event.percent);
  if (typeof event.done === 'number' && typeof event.total === 'number' && event.total > 0) {
    return Math.round((event.done / event.total) * 100);
  }
  if (typeof event.step === 'number' && typeof event.steps === 'number' && event.steps > 0) {
    return Math.round(((event.step - 1) / event.steps) * 100);
  }
  return null;
};

/** The choice settings, with a default for anything missing or no longer valid. */
export const parseChoiceSettings = (raw: string | undefined): ChoiceSettings => {
  let stored: Record<string, unknown> = {};
  try {
    stored = raw ? JSON.parse(raw) : {};
  } catch {
    stored = {};
  }
  const settings = { ...DEFAULT_CHOICES };
  for (const name of CHOICE_NAMES) {
    const value = stored[name];
    if (typeof value === 'string' && (value === 'ask' || CHOICE_VALUES[name].includes(value))) settings[name] = value;
  }
  return settings;
};

/** The fixed choices, passed to Dyadrr; the ones to ask are left out (pending in the report). */
export const fixedChoices = (settings: ChoiceSettings): DyadrrChoices => {
  const fixed: Record<string, string> = {};
  for (const name of CHOICE_NAMES) if (settings[name] !== 'ask') fixed[name] = settings[name];
  return fixed as DyadrrChoices;
};

/** What the GUI shows of a report: the full one is large (every checkpoint, every track). */
export const reportSummary = (report: DyadrrReport | null) => {
  if (!report) return null;
  const r = report as DyadrrReport & Record<string, any>;
  const plan = r.plan ?? null;
  const measurement = r.measurement ?? null;
  return {
    dyadrr: r.dyadrr ?? null,
    decision: r.decision,
    reasons: r.reasons ?? [],
    // Indexes in the pair's files: 0 is file A, 1 is file B
    roles: r.roles ? { reference: r.roles.reference, donor: r.roles.donor } : null,
    measureLanguage: measurement?.language ?? null,
    offsetMs: measurement?.offset?.offsetMs ?? plan?.offsetMs ?? null,
    dispersionMs: measurement?.offset?.dispersionMs ?? null,
    coverage: measurement?.commonMaterial?.coverage ?? null,
    film: plan?.film ?? null,
    commonMaterial: plan?.commonMaterial ?? null,
    italian: plan?.italian ?? null,
    // The donor's Italian audio tracks: role, and whether they are taken (null: --italian pending)
    audio: (plan?.audio ?? []).map((t: Record<string, unknown>) => ({ id: t.id, name: t.name ?? null, role: t.role, taken: t.taken ?? null })),
    failedChecks: (r.checks ?? [])
      .filter((c: Record<string, unknown>) => c.result === 'fail')
      .map((c: Record<string, unknown>) => ({ name: c.name, code: c.code ?? null, blocking: c.blocking, detail: c.detail ?? null })),
    warnings: (r.warnings ?? []).map((w: Record<string, unknown>) => ({ code: w.code, message: w.message })),
    // The choices: decided (with the value used), pending (with what each value does), not needed
    choices: (r.choices ?? []).map((c: Record<string, any>) => ({
      name: c.name,
      needed: c.needed,
      status: c.status,
      value: c.value ?? null,
      effects: (c.effects ?? []).map((e: Record<string, unknown>) => ({
        value: e.value,
        italianStartMs: e.italianStartMs ?? null,
        italianEndMs: e.italianEndMs ?? null,
        warnings: e.warnings ?? [],
      })),
    })),
  };
};

const publicPair = (pair: MergePair) => {
  let report: DyadrrReport | null = null;
  try {
    report = pair.report ? (JSON.parse(pair.report) as DyadrrReport) : null;
  } catch {
    report = null;
  }
  const { report: _report, ...rest } = pair;
  return { ...rest, summary: reportSummary(report) };
};
export type PublicPair = ReturnType<typeof publicPair>;

class MergePairs extends EventEmitter {
  private timer: NodeJS.Timeout | null = null;
  private polling = false;
  // Last progress sent per pair, so unchanged progress is not written again
  private lastProgress = new Map<string, string>();

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      if (this.polling) return;
      this.polling = true;
      this.poll()
        .catch((error) => logger.error({ error }, 'Merge jobs poll failed'))
        .finally(() => (this.polling = false));
    }, POLL_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async list(): Promise<PublicPair[]> {
    return (await db.getMergePairs()).map(publicPair);
  }

  async get(id: string): Promise<PublicPair> {
    return publicPair(await this.find(id));
  }

  /** The full analyze report (null before it ends). */
  async report(id: string): Promise<DyadrrReport | null> {
    const pair = await this.find(id);
    return pair.report ? (JSON.parse(pair.report) as DyadrrReport) : null;
  }

  async getChoiceSettings(): Promise<ChoiceSettings> {
    return parseChoiceSettings((await db.getSettings([SETTINGS_KEY]))[SETTINGS_KEY]);
  }

  async setChoiceSettings(values: Record<string, unknown>): Promise<ChoiceSettings> {
    const settings = await this.getChoiceSettings();
    for (const [name, value] of Object.entries(values)) {
      if (!CHOICE_NAMES.includes(name as ChoiceName)) throw new MergeError(`Unknown choice: ${name}`, 400);
      const allowed = ['ask', ...CHOICE_VALUES[name as ChoiceName]];
      if (typeof value !== 'string' || !allowed.includes(value)) {
        throw new MergeError(`${name} must be one of ${allowed.join(', ')}`, 400);
      }
      settings[name as ChoiceName] = value;
    }
    await db.setSettings({ [SETTINGS_KEY]: JSON.stringify(settings) });
    return settings;
  }

  /** The uploads that can be paired: their file is still on the disk, and no upload or pair uses it. */
  async candidates() {
    const busy = new Set(
      (await db.getMergePairsByStatus(ACTIVE)).flatMap((p) => [p.uploadAId, p.uploadBId])
    );
    const uploads = (await Promise.all(PAIRABLE.map((status) => db.getUploadsByStatus(status)))).flat();
    return uploads
      .filter((u) => !busy.has(u.id) && existsSync(u.filepath))
      .sort((a, b) => Number(b.status === 'HELD') - Number(a.status === 'HELD') || b.createdAt.getTime() - a.createdAt.getTime())
      .map((u) => ({
        id: u.id,
        filename: u.filename,
        filepath: u.filepath,
        size: u.size.toString(),
        status: u.status,
        hasItalianAudio: u.hasItalianAudio,
        holdKind: u.holdKind,
        holdMessage: u.holdMessage,
        mediaInfo: u.mediaInfo,
      }));
  }

  /** Pairs two files and starts their analysis. */
  async create(uploadIds: unknown, originalLanguage?: unknown): Promise<PublicPair> {
    if (!mergeActive()) throw new MergeError('Merging is off (MERGE_ENABLED, RIP_LANGUAGE=it)');
    if (!Array.isArray(uploadIds) || uploadIds.length !== 2 || uploadIds.some((id) => typeof id !== 'string')) {
      throw new MergeError('uploadIds must be two upload ids', 400);
    }
    if (uploadIds[0] === uploadIds[1]) throw new MergeError('Pick two different files', 400);
    const language = this.checkLanguage(originalLanguage);
    const uploads = await Promise.all(uploadIds.map((id: string) => this.pairable(id)));
    const pair = await db.createMergePair({
      uploadAId: uploads[0].id,
      uploadBId: uploads[1].id,
      fileA: uploads[0].filepath,
      fileB: uploads[1].filepath,
      originalLanguage: language ?? (await this.originalLanguageOf(uploads)),
    });
    logger.info({ pairId: pair.id, files: [pair.fileA, pair.fileB], originalLanguage: pair.originalLanguage }, 'Merge pair created');
    return this.analyze(pair.id);
  }

  /** Runs (again) the analysis of a pair that is not analyzing. */
  async analyze(id: string, originalLanguage?: unknown): Promise<PublicPair> {
    if (!mergeActive()) throw new MergeError('Merging is off (MERGE_ENABLED, RIP_LANGUAGE=it)');
    const pair = await this.find(id);
    if (ACTIVE.includes(pair.status)) throw new MergeError('The pair is already being analyzed');
    const language = originalLanguage === undefined ? pair.originalLanguage : this.checkLanguage(originalLanguage);
    for (const uploadId of [pair.uploadAId, pair.uploadBId]) await this.pairable(uploadId, pair.id);

    const jobId = await dyadrr.submit({
      command: 'analyze',
      inputs: [pair.fileA, pair.fileB],
      originalLanguage: language ?? undefined,
      ...fixedChoices(await this.getChoiceSettings()),
    });
    this.lastProgress.delete(id);
    const updated = await db.updateMergePair(id, {
      status: 'ANALYZING',
      jobId,
      originalLanguage: language,
      phase: null,
      progress: null,
      reasonCode: null,
      reasonMessage: null,
      report: null,
      dyadrrVersion: null,
      startedAt: new Date(),
      completedAt: null,
    });
    logger.info({ pairId: id, jobId }, 'Merge analysis queued');
    this.emit('pair-updated', { pairId: id, status: updated.status });
    return publicPair(updated);
  }

  /** Stops an analysis: Dyadrr gets SIGTERM (or never starts it), and its report says cancelled. */
  async cancel(id: string): Promise<PublicPair> {
    const pair = await this.find(id);
    if (!ACTIVE.includes(pair.status) || !pair.jobId) throw new MergeError(`The pair is ${pair.status}, nothing to stop`);
    await dyadrr.cancel(pair.jobId);
    logger.info({ pairId: id, jobId: pair.jobId }, 'Merge analysis stop requested');
    return publicPair(pair);
  }

  /**
   * Removes a pair; its files stay as they are. Not while Dyadrr runs it; a job the
   * runner has not picked up yet (container stopped) is withdrawn.
   */
  async remove(id: string): Promise<void> {
    const pair = await this.find(id);
    if (ACTIVE.includes(pair.status) && pair.jobId && (await dyadrr.state(pair.jobId)).state === 'running') {
      throw new MergeError('Dyadrr is analyzing the pair: stop it first');
    }
    if (pair.jobId) await dyadrr.remove(pair.jobId);
    await db.deleteMergePair(id);
    this.lastProgress.delete(id);
    logger.info({ pairId: id }, 'Merge pair removed');
    this.emit('pair-removed', { pairId: id });
  }

  /** Whether an upload is in a pair being analyzed (or merged): its file must stay. */
  async uploadBusy(uploadId: string): Promise<boolean> {
    return (await db.getMergePairsOfUpload(uploadId)).some((p) => ACTIVE.includes(p.status));
  }

  private async find(id: string): Promise<MergePair> {
    const pair = await db.getMergePairById(id);
    if (!pair) throw new MergeError('Pair not found', 404);
    return pair;
  }

  private checkLanguage(value: unknown): string | null | undefined {
    if (value === undefined) return undefined;
    if (value === null || value === '') return null;
    if (typeof value !== 'string' || !LANGUAGE.test(value.trim()) || value.trim().toLowerCase() === 'und') {
      throw new MergeError('originalLanguage must be a language code (en, eng, ja, pt-BR)', 400);
    }
    return value.trim().toLowerCase();
  }

  private async pairable(uploadId: string, pairId?: string): Promise<Upload> {
    const upload = await db.getUploadById(uploadId);
    if (!upload) throw new MergeError('Upload not found', 404);
    if (!PAIRABLE.includes(upload.status)) throw new MergeError(`${upload.filename} is ${upload.status}: it cannot be merged now`);
    if (!existsSync(upload.filepath)) throw new MergeError(`${upload.filename} is no longer on the disk`);
    const busy = (await db.getMergePairsOfUpload(uploadId)).find((p) => p.id !== pairId && ACTIVE.includes(p.status));
    if (busy) throw new MergeError(`${upload.filename} is already being analyzed in another pair`);
    try {
      dyadrr.toJobPath(upload.filepath);
    } catch {
      throw new MergeError(`${upload.filename} is not in the watch folder or the downloads, so Dyadrr cannot read it`);
    }
    return upload;
  }

  /** The film's original language, from a rip of either file or TMDB; null when unknown. */
  private async originalLanguageOf(uploads: Upload[]): Promise<string | null> {
    for (const upload of uploads) {
      const rip = await db.getRipByOutputFile(upload.filepath);
      if (rip?.originalLanguage) return rip.originalLanguage;
    }
    for (const upload of uploads) {
      for (const name of mkvNames(upload.filepath)) {
        const film = await filmByName({ title: name.title, year: name.year ?? null });
        if (film?.originalLanguage) return film.originalLanguage;
      }
    }
    return null;
  }

  /** Follows the jobs of the pairs being analyzed: progress, then the report. */
  private async poll(): Promise<void> {
    for (const pair of await db.getMergePairsByStatus(ACTIVE)) {
      if (!pair.jobId) continue;
      try {
        await this.follow(pair, pair.jobId);
      } catch (error) {
        logger.error({ pairId: pair.id, error }, 'Failed to follow a merge job');
      }
    }
  }

  private async follow(pair: MergePair, jobId: string): Promise<void> {
    const state = await dyadrr.state(jobId);
    if (state.state === 'missing') {
      await this.finish(pair, null, 'error', 'JOB_LOST', 'The Dyadrr job files are gone (deleted by hand?): analyze again');
      return;
    }
    if (state.state === 'running') {
      const { phase, progress } = currentProgress((await dyadrr.log(jobId)).events);
      const percent = progressPercent(progress);
      const key = `${phase}|${percent}`;
      if (this.lastProgress.get(pair.id) === key) return;
      this.lastProgress.set(pair.id, key);
      await db.updateMergePair(pair.id, { phase, progress: percent });
      this.emit('pair-progress', { pairId: pair.id, phase, progress: percent, done: progress?.done ?? null, total: progress?.total ?? null });
      return;
    }
    if (state.state !== 'done') return;

    const report = await dyadrr.report(jobId);
    const decision = jobOutcome(report);
    const reason = report?.reasons?.[0];
    const messages = report ? [] : (await dyadrr.log(jobId)).messages;
    await this.finish(
      pair,
      report,
      decision,
      reason?.code ?? (report ? null : 'NO_REPORT'),
      reason?.message ?? (report ? null : `Dyadrr ended with ${state.exitCode} and no report${messages.length ? `: ${messages.at(-1)}` : ''}`)
    );
    await dyadrr.remove(jobId);
  }

  private async finish(
    pair: MergePair,
    report: DyadrrReport | null,
    decision: string,
    reasonCode: string | null,
    reasonMessage: string | null
  ): Promise<void> {
    const status = decision.toUpperCase();
    await db.updateMergePair(pair.id, {
      status,
      jobId: null,
      phase: null,
      progress: null,
      reasonCode,
      reasonMessage,
      report: report ? JSON.stringify(report) : null,
      dyadrrVersion: report?.dyadrr ?? null,
      completedAt: new Date(),
    });
    this.lastProgress.delete(pair.id);
    logger.info({ pairId: pair.id, status, reasonCode }, 'Merge analysis ended');
    this.emit('pair-updated', { pairId: pair.id, status });
  }
}

export const mergePairs = new MergePairs();
