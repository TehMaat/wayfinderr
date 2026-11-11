import { EventEmitter } from 'events';
import { existsSync } from 'fs';
import { mkdir, rm, writeFile } from 'fs/promises';
import path from 'path';
import { MergePair, Upload } from '@prisma/client';
import { config } from '../../config/index.js';
import logger from '../../config/logger.js';
import { db } from '../database.js';
import { mkvNames } from '../torrentCleanup.js';
import { filmByName } from '../filmLookup.js';
import { outputName, ripper, safeFileName } from '../ripper/index.js';
import { logs } from '../logs/index.js';
import { dyadrr, mergeActive } from './index.js';
import { currentProgress, DyadrrChoices, DyadrrEvent, DyadrrReport, jobOutcome } from './jobs.js';

/**
 * Pairs of files of the same film, merged with Dyadrr. The user pairs two files by
 * hand (Dyadrr's study, §15: pairing works on uploads, not rips); Wayfinderr then
 * runs `dyadrr analyze` on them in the Dyadrr container and shows the report: the
 * offset, the plan, the checks, why it was refused, the choices still to make.
 *
 * Once confirmed, `dyadrr merge --expect` builds the final file in the watch folder,
 * under the name Wayfinderr gives the film (decision 5): it re-checks that nothing
 * changed since the analysis, merges and verifies. The merged file is then uploaded
 * like any other; the two inputs are kept or deleted (a setting, decision 6), and the
 * source torrents of both are cleaned up once it is on a server. A merge stopped or
 * failed (NO_SPACE...) is not a refusal: the pair goes back to eligible, to retry.
 *
 * The four choices are settings: a fixed value, passed to every analysis, or "ask"
 * each time, left pending in the report and chosen before the merge.
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
// After a merge: keep the two files (deletable from the GUI) or delete them
const INPUTS_KEY = 'merge.inputs';
export type InputsAfter = 'keep' | 'delete';
// Asked each time until set otherwise
export const DEFAULT_CHOICES: ChoiceSettings = { tail: 'ask', italian: 'ask', referenceItalianSubs: 'ask', edgeMismatch: 'ask' };

// A queued or running job: the pair waits for its report
const ACTIVE = ['ANALYZING', 'MERGING'];
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
    // Every checkpoint, where and how it went: the card draws them along the film
    checkpoints: (measurement?.checkpoints ?? []).map((c: Record<string, unknown>) => ({
      positionMs: c.positionMs,
      outcome: c.outcome,
    })),
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

const parseJson = <T>(text: string | null): T | null => {
  try {
    return text ? (JSON.parse(text) as T) : null;
  } catch {
    return null;
  }
};

/** What the merge's report adds: the final file, its verification, the warnings. */
export const mergeSummary = (report: DyadrrReport | null) => {
  if (!report) return null;
  const r = report as DyadrrReport & Record<string, any>;
  const output = r.output ?? null;
  return {
    decision: r.decision,
    reasons: r.reasons ?? [],
    delivered: Boolean(output?.delivered),
    sizeBytes: output?.sizeBytes ?? null,
    durationMs: output?.durationMs ?? null,
    droppedSubtitles: output?.build?.droppedSubtitles ?? [],
    expect: r.expect ? { result: r.expect.result, differences: r.expect.differences ?? [] } : null,
    warnings: (r.warnings ?? []).map((w: Record<string, unknown>) => ({ code: w.code, message: w.message, source: w.source ?? null })),
  };
};

const publicPair = (pair: MergePair) => {
  const { report, mergeReport, mergeChoices, ...rest } = pair;
  return {
    ...rest,
    mergeChoices: parseJson<Record<string, string>>(mergeChoices),
    summary: reportSummary(parseJson<DyadrrReport>(report)),
    mergeSummary: mergeSummary(parseJson<DyadrrReport>(mergeReport)),
  };
};
export type PublicPair = ReturnType<typeof publicPair>;

/** A file with the merged file's name is already there: the GUI asks before replacing it. */
export class OutputExistsError extends MergeError {
  constructor(public fileName: string, public existsLocally: boolean, public existsOnServer: boolean) {
    super(`${fileName} is already ${existsLocally ? 'in the watch folder' : 'on a server'}`);
  }
}

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

  /** The merge's full report (null before a merge ended). */
  async mergeReport(id: string): Promise<DyadrrReport | null> {
    return parseJson<DyadrrReport>((await this.find(id)).mergeReport);
  }

  async getInputsAfter(): Promise<InputsAfter> {
    return (await db.getSettings([INPUTS_KEY]))[INPUTS_KEY] === 'delete' ? 'delete' : 'keep';
  }

  async setInputsAfter(value: unknown): Promise<InputsAfter> {
    if (value !== 'keep' && value !== 'delete') throw new MergeError('inputs must be keep or delete', 400);
    await db.setSettings({ [INPUTS_KEY]: value });
    return value;
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
      // Not ANALYZING (the column's default) until its job is written: analyze() refuses
      // a pair already analyzing, and one that fails to start can be analyzed again
      status: 'ERROR',
      reasonCode: 'NOT_STARTED',
      reasonMessage: 'The analysis has not started yet',
    });
    logger.info({ pairId: pair.id, files: [pair.fileA, pair.fileB], originalLanguage: pair.originalLanguage }, 'Merge pair created');
    return this.analyze(pair.id);
  }

  /** Runs (again) the analysis of a pair that is not analyzing. */
  async analyze(id: string, originalLanguage?: unknown): Promise<PublicPair> {
    if (!mergeActive()) throw new MergeError('Merging is off (MERGE_ENABLED, RIP_LANGUAGE=it)');
    const pair = await this.find(id);
    if (ACTIVE.includes(pair.status)) throw new MergeError(`The pair is already ${pair.status === 'MERGING' ? 'being merged' : 'being analyzed'}`);
    if (pair.status === 'MERGED') throw new MergeError('The pair is already merged');
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
      mergeReasonCode: null,
      mergeReasonMessage: null,
      startedAt: new Date(),
      completedAt: null,
    });
    logger.info({ pairId: id, jobId }, 'Merge analysis queued');
    this.emit('pair-updated', { pairId: id, status: updated.status });
    return publicPair(updated);
  }

  /** Stops an analysis or a merge: Dyadrr gets SIGTERM (or never starts it), and its report says cancelled. */
  async cancel(id: string): Promise<PublicPair> {
    const pair = await this.find(id);
    // An analysis that never got its job (pairs created before 0.23.2): nothing runs
    if (pair.status === 'ANALYZING' && !pair.jobId) {
      await this.finish(pair, null, 'cancelled', 'CANCELLED', 'Stopped before Dyadrr started it');
      return publicPair(await this.find(id));
    }
    // A merge still waiting for the rips: never started, eligible again
    if (pair.status === 'MERGING' && !pair.jobId) {
      const updated = await db.updateMergePair(id, {
        status: 'ELIGIBLE',
        mergeReasonCode: 'CANCELLED',
        mergeReasonMessage: 'Stopped before it started',
      });
      this.emit('pair-updated', { pairId: id, status: updated.status });
      return publicPair(updated);
    }
    if (!ACTIVE.includes(pair.status) || !pair.jobId) throw new MergeError(`The pair is ${pair.status}, nothing to stop`);
    // Still queued (the runner is busy with another job): withdrawn now, not when its turn comes
    if (await dyadrr.withdraw(pair.jobId)) {
      logger.info({ pairId: id, jobId: pair.jobId, status: pair.status }, 'Merge job withdrawn before it started');
      const message = 'Stopped before Dyadrr started it';
      if (pair.status === 'MERGING') await this.finishMerge(pair, null, 'cancelled', 'CANCELLED', message);
      else await this.finish(pair, null, 'cancelled', 'CANCELLED', message);
      return publicPair(await this.find(id));
    }
    await dyadrr.cancel(pair.jobId);
    logger.info({ pairId: id, jobId: pair.jobId, status: pair.status }, 'Merge job stop requested');
    return publicPair(pair);
  }

  /** The name Wayfinderr gives the film, as the merged file's default name (without .mkv). */
  async defaultOutputName(pair: MergePair): Promise<string> {
    const report = parseJson<DyadrrReport & Record<string, any>>(pair.report);
    const files = [pair.fileA, pair.fileB];
    // The reference first: its name is the better video's
    const order = report?.roles ? [files[report.roles.reference], files[report.roles.donor]] : files;
    for (const file of order) {
      const rip = await db.getRipByOutputFile(file);
      if (rip) return outputName(rip);
    }
    for (const file of order) {
      for (const name of mkvNames(file)) {
        const film = await filmByName({ title: name.title, year: name.year ?? null });
        if (film) return safeFileName(film.label);
      }
    }
    // The file's own name, without the " (2)" the ripper adds to a name already used
    return safeFileName(path.basename(order[0], path.extname(order[0])).replace(/ \(\d+\)$/, ''));
  }

  /** What the merge dialog needs: the default name, and whether a file with that name is already there. */
  async mergePreview(id: string, name?: unknown) {
    const pair = await this.find(id);
    const outputPath = this.outputPath(pair, typeof name === 'string' && name.trim() ? name : await this.defaultOutputName(pair));
    return { outputName: path.basename(outputPath, '.mkv'), ...(await this.existing(outputPath)), inputsAfter: await this.getInputsAfter() };
  }

  private outputPath(pair: MergePair, name: string): string {
    const base = safeFileName(name.trim().replace(/\.mkv$/i, '')).trim();
    if (!base || base.startsWith('.')) throw new MergeError('Give the merged file a name', 400);
    const outputPath = path.join(config.WATCH_DIR, `${base}.mkv`);
    if ([pair.fileA, pair.fileB].some((file) => path.resolve(file) === path.resolve(outputPath))) {
      throw new MergeError('The merged file must not have the name of one of the two files', 400);
    }
    return outputPath;
  }

  // A file with the merged file's name: in the watch folder, or uploaded to a server before
  private async existing(outputPath: string) {
    return {
      existsLocally: existsSync(outputPath),
      existsOnServer: await db.isUploadFileNameUsed(path.basename(outputPath)),
    };
  }

  /**
   * Merges an eligible pair: every choice the analysis left pending must be given;
   * the ones it decided are passed again. A file with the merged file's name already
   * there is replaced only with `replaceExisting` (deleted here; on the server the
   * upload replaces it), else 409 OUTPUT_EXISTS for the GUI to ask.
   */
  async merge(id: string, body: { choices?: unknown; outputName?: unknown; replaceExisting?: unknown }): Promise<PublicPair> {
    if (!mergeActive()) throw new MergeError('Merging is off (MERGE_ENABLED, RIP_LANGUAGE=it)');
    const pair = await this.find(id);
    if (pair.status !== 'ELIGIBLE') throw new MergeError(`The pair is ${pair.status}: only an eligible pair is merged`);
    const report = parseJson<DyadrrReport & Record<string, any>>(pair.report);
    if (!report) throw new MergeError('The analysis report is missing: analyze again');
    for (const uploadId of [pair.uploadAId, pair.uploadBId]) await this.pairable(uploadId, pair.id);

    const choices = this.mergeChoicesOf(report, body.choices);
    const outputPath = this.outputPath(pair, typeof body.outputName === 'string' && body.outputName.trim() ? body.outputName : await this.defaultOutputName(pair));
    const { existsLocally, existsOnServer } = await this.existing(outputPath);
    if ((existsLocally || existsOnServer) && body.replaceExisting !== true) {
      throw new OutputExistsError(path.basename(outputPath), existsLocally, existsOnServer);
    }
    if (existsLocally) {
      const upload = await db.getUploadByPath(outputPath);
      if (upload && ['PENDING', 'QUEUED', 'UPLOADING'].includes(upload.status)) {
        throw new MergeError(`${path.basename(outputPath)} is being uploaded: stop it first`);
      }
      // Dyadrr never overwrites (OUTPUT_EXISTS): the file already there goes, as confirmed
      await rm(outputPath, { force: true });
      logger.info({ pairId: id, outputPath }, 'Existing file deleted before the merge');
    }

    this.lastProgress.delete(id);
    let updated = await db.updateMergePair(id, {
      status: 'MERGING',
      jobId: null,
      phase: null,
      progress: null,
      outputPath,
      mergeChoices: JSON.stringify(choices),
      mergeReport: null,
      mergeReasonCode: null,
      mergeReasonMessage: null,
      inputsAfter: null,
      outputUploadId: null,
      mergedAt: null,
    });
    // One writer at a time: a rip running now (MakeMKV, unrar, a join) goes first, and
    // the merge starts after it (poll); rips wait for the merge in turn
    if (await ripper.writing()) {
      logger.info({ pairId: id, outputPath, choices }, 'Merge waiting for the rips to end');
    } else {
      updated = await this.submitMerge(updated);
    }
    this.emit('pair-updated', { pairId: id, status: updated.status });
    return publicPair(updated);
  }

  /** Writes the merge job of a pair that is MERGING: the confirmed analysis, then the job. */
  private async submitMerge(pair: MergePair): Promise<MergePair> {
    // The confirmed analysis: Dyadrr checks that inputs, roles, offset and plan are still the same
    const expect = path.join(dyadrr.jobsDir, '..', 'expect', `${pair.id}.json`);
    await mkdir(path.dirname(expect), { recursive: true });
    await writeFile(expect, pair.report!, { mode: 0o666 });
    const choices = parseJson<DyadrrChoices>(pair.mergeChoices) ?? {};
    const jobId = await dyadrr.submit({
      command: 'merge',
      inputs: [pair.fileA, pair.fileB],
      output: pair.outputPath!,
      expect,
      originalLanguage: pair.originalLanguage ?? undefined,
      ...choices,
    });
    logger.info({ pairId: pair.id, jobId, outputPath: pair.outputPath, choices }, 'Merge queued');
    return db.updateMergePair(pair.id, { jobId });
  }

  /** The choices for the merge: decided ones as the analysis used them, pending ones as given. */
  private mergeChoicesOf(report: Record<string, any>, given: unknown): DyadrrChoices {
    const values = given && typeof given === 'object' && !Array.isArray(given) ? (given as Record<string, unknown>) : {};
    const choices: Record<string, string> = {};
    const missing: string[] = [];
    for (const choice of (report.choices ?? []) as Record<string, any>[]) {
      if (!choice.needed || !CHOICE_NAMES.includes(choice.name)) continue;
      const name = choice.name as ChoiceName;
      if (choice.status === 'decided' && typeof choice.value === 'string') {
        choices[name] = choice.value;
        continue;
      }
      const value = values[name];
      if (typeof value === 'string' && CHOICE_VALUES[name].includes(value)) choices[name] = value;
      else missing.push(name);
    }
    if (missing.length) throw new MergeError(`Choose before the merge: ${missing.join(', ')}`, 400);
    return choices as DyadrrChoices;
  }

  /** The merged file of a pair being merged or merged: uploaded as it is, never held. */
  async isMergeOutput(filepath: string): Promise<MergePair | null> {
    const resolved = path.resolve(filepath);
    return (
      (await db.getMergePairsByStatus(['MERGING', 'MERGED'])).find((p) => p.outputPath && path.resolve(p.outputPath) === resolved) ?? null
    );
  }

  /** The merged file was picked up: its upload. */
  async setOutputUpload(pairId: string, uploadId: string): Promise<void> {
    const pair = await db.updateMergePair(pairId, { outputUploadId: uploadId });
    this.emit('pair-updated', { pairId, status: pair.status });
  }

  /**
   * The merged file is on a server: the source torrents of both inputs can go
   * (each input's upload is MERGED, which the torrent cleanup treats as uploaded).
   */
  async inputsOfUploadedOutput(uploadId: string): Promise<string[]> {
    const pair = (await db.getMergePairsByStatus(['MERGED'])).find((p) => p.outputUploadId === uploadId);
    if (!pair) return [];
    const inputs = [];
    for (const id of [pair.uploadAId, pair.uploadBId]) {
      const upload = await db.getUploadById(id);
      if (upload?.status === 'MERGED') inputs.push(id);
    }
    return inputs;
  }

  /**
   * Removes a pair; its files stay as they are. Not while Dyadrr runs it; a job the
   * runner has not picked up yet (container stopped) is withdrawn.
   */
  async remove(id: string): Promise<void> {
    const pair = await this.find(id);
    if (ACTIVE.includes(pair.status) && pair.jobId && (await dyadrr.state(pair.jobId)).state === 'running') {
      throw new MergeError(`Dyadrr is ${pair.status === 'MERGING' ? 'merging' : 'analyzing'} the pair: stop it first`);
    }
    await rm(path.join(dyadrr.jobsDir, '..', 'expect', `${pair.id}.json`), { force: true });
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
    if (busy) throw new MergeError(`${upload.filename} is already in another pair being analyzed or merged`);
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
      // A merge waiting for the rips: started once none is writing
      if (pair.status === 'MERGING' && !pair.jobId) {
        if (!(await ripper.writing())) {
          const started = await this.submitMerge(pair);
          this.emit('pair-updated', { pairId: pair.id, status: started.status });
        }
        continue;
      }
      // An analysis without a job never started (a pair created before 0.23.2): analyze again
      if (!pair.jobId) {
        await this.finish(pair, null, 'error', 'NOT_STARTED', 'The analysis never started: analyze again');
        continue;
      }
      try {
        await this.follow(pair, pair.jobId);
      } catch (error) {
        logger.error({ pairId: pair.id, error }, 'Failed to follow a merge job');
      }
    }
  }

  private async follow(pair: MergePair, jobId: string): Promise<void> {
    const state = await dyadrr.state(jobId);
    const merging = pair.status === 'MERGING';
    if (state.state === 'missing') {
      const lost = 'The Dyadrr job files are gone (deleted by hand?)';
      if (merging) await this.finishMerge(pair, null, 'error', 'JOB_LOST', `${lost}: merge again`);
      else await this.finish(pair, null, 'error', 'JOB_LOST', `${lost}: analyze again`);
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
    const reasonCode = reason?.code ?? (report ? null : 'NO_REPORT');
    const reasonMessage =
      reason?.message ?? (report ? null : `Dyadrr ended with ${state.exitCode} and no report${messages.length ? `: ${messages.at(-1)}` : ''}`);
    if (merging) await this.finishMerge(pair, report, decision, reasonCode, reasonMessage);
    else await this.finish(pair, report, decision, reasonCode, reasonMessage);
    // The job's log stays in the history (the Logs page, the pair's page) once its files go
    await logs.keepDyadrrJob({
      job: jobId,
      pairId: pair.id,
      command: merging ? 'merge' : 'analyze',
      files: [pair.fileA, pair.fileB],
      exitCode: state.exitCode,
      decision,
      code: reasonCode,
    });
    await dyadrr.remove(jobId);
  }

  /**
   * A merge ended. Merged and verified: the inputs are kept or deleted (the setting)
   * and marked MERGED; the merged file is picked up by the watcher and uploaded.
   * Refused (Dyadrr analyzed again, and the pair no longer passes): REFUSED. Stopped or
   * failed (NO_SPACE, INPUT_CHANGED, VERIFY_FAILED...): back to ELIGIBLE, to retry.
   */
  private async finishMerge(
    pair: MergePair,
    report: DyadrrReport | null,
    decision: string,
    reasonCode: string | null,
    reasonMessage: string | null
  ): Promise<void> {
    await rm(path.join(dyadrr.jobsDir, '..', 'expect', `${pair.id}.json`), { force: true });
    const output = (report as Record<string, any> | null)?.output;
    const merged = decision === 'eligible' && Boolean(output?.delivered);
    const status = merged ? 'MERGED' : decision === 'refused' ? 'REFUSED' : 'ELIGIBLE';
    const inputsAfter = merged ? await this.getInputsAfter() : null;
    await db.updateMergePair(pair.id, {
      status,
      jobId: null,
      phase: null,
      progress: null,
      mergeReport: report ? JSON.stringify(report) : null,
      mergeReasonCode: merged ? null : reasonCode ?? (decision === 'eligible' ? 'NOT_DELIVERED' : null),
      mergeReasonMessage: merged ? null : reasonMessage ?? (decision === 'eligible' ? 'Dyadrr did not deliver the merged file' : null),
      ...(decision === 'refused' ? { reasonCode, reasonMessage } : {}),
      inputsAfter,
      mergedAt: merged ? new Date() : null,
    });
    this.lastProgress.delete(pair.id);
    logger.info({ pairId: pair.id, status, reasonCode, outputPath: pair.outputPath }, 'Merge ended');
    if (merged) await this.afterMerge(pair, inputsAfter!);
    this.emit('pair-updated', { pairId: pair.id, status });
  }

  /** The two inputs after a verified merge: MERGED, and deleted when the setting says so. */
  private async afterMerge(pair: MergePair, inputsAfter: InputsAfter): Promise<void> {
    const name = pair.outputPath ? path.basename(pair.outputPath) : 'the merged file';
    for (const uploadId of [pair.uploadAId, pair.uploadBId]) {
      const upload = await db.getUploadById(uploadId);
      if (!upload) continue;
      // Only a file of the watch folder: the downloads belong to the torrent client
      const relative = path.relative(config.WATCH_DIR, upload.filepath);
      const inWatch = Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
      if (inputsAfter === 'delete' && inWatch) {
        await rm(upload.filepath, { force: true });
        logger.info({ pairId: pair.id, filepath: upload.filepath }, 'Merge input deleted');
      }
      // An input already on a server stays COMPLETED; the others count as done, through the merge
      if (upload.status !== 'COMPLETED') {
        await db.updateUpload(uploadId, {
          status: 'MERGED',
          holdKind: null,
          holdMessage: `Merged into ${name}${inputsAfter === 'delete' && inWatch ? ' (file deleted)' : ''}`,
        });
        this.emit('upload-merged', { uploadId });
      }
    }
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
