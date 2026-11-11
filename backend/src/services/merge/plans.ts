import { EventEmitter } from 'events';
import { existsSync } from 'fs';
import { MergePlan, Upload } from '@prisma/client';
import logger from '../../config/logger.js';
import { db } from '../database.js';
import { describeError, getQbitClient, QbitTorrent } from '../qbittorrent.js';
import { getMovie, tmdbConfigured } from '../ripper/tmdb.js';
import { downloadNamesOf, uploadsOfDownload } from '../sourceTorrents.js';
import { topLevelName } from '../torrentCleanup.js';
import { HoldDecision, RIP_UNFINISHED } from './hold.js';
import { mergeActive } from './index.js';
import { HOLDABLE, HoldError, manualHolds } from './manual.js';
import { MergeError, mergePairs } from './pairs.js';

/**
 * Pairs planned before their two files arrive (issue #53, step 3): by hand on the Merge
 * page ("Plan a pair…", two downloads among the rips not finished and the torrents of
 * the clients), or by bookrr through the API, when it sends the two torrents of a merge
 * to the client.
 *
 * Each side is a download, known by its torrent's info hash and/or its name (the
 * download's folder or file, as the rip and the torrent cleanup know it), or a file
 * already there (an upload). Each file is held as it arrives (holdKind PLANNED), without
 * looking for a twin; once both are there the pair is created and Dyadrr analyzes it.
 * The confirmation before the merge stays.
 *
 * A new file is a side when:
 * - its upload has the side's info hash (its source .torrent was sent beforehand), or
 * - the download it comes from (its rip's download, else its folder at the top of the
 *   watch folder) has the side's name, or the name of the side's torrent in a client.
 */

export type PlanStatus = 'WAITING' | 'PAIRED' | 'ERROR';
export type SideKey = 'A' | 'B';

export interface PlanSide {
  infoHash: string | null;
  name: string | null;
  label: string | null;
  uploadId: string | null;
}

// Plans still open: a file to come, or a pair to create again
const OPEN: PlanStatus[] = ['WAITING', 'ERROR'];
const HASH = /^[0-9a-f]{40}$/i;
const MAX_NAME = 255;
const MAX_LABEL = 100;
const MAX_ORIGIN = 40;
// A code ISO 639-1 or 639-2, or an IETF tag (pt-BR), as for a pair
const LANGUAGE = /^[a-z]{2,3}(-[a-z0-9]{2,8})*$/i;

const text = (value: unknown, max: number): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().slice(0, max);
  return trimmed || null;
};

export const sideOf = (plan: MergePlan, key: SideKey): PlanSide =>
  key === 'A'
    ? { infoHash: plan.hashA, name: plan.nameA, label: plan.labelA, uploadId: plan.uploadAId }
    : { infoHash: plan.hashB, name: plan.nameB, label: plan.labelB, uploadId: plan.uploadBId };

const other = (key: SideKey): SideKey => (key === 'A' ? 'B' : 'A');

/** What a side is called in messages: its label, then its name or hash. */
export const describeSide = (side: PlanSide): string => {
  const what = side.name ? `"${side.name}"` : side.infoHash ? `the torrent ${side.infoHash.slice(0, 8)}…` : 'its file';
  return side.label ? `${side.label} (${what})` : what;
};

/**
 * Whether a new file is this side: the same info hash, or a download name in common.
 * `torrentNames`: the names of the side's torrent in the clients, found by its hash.
 */
export const sideMatches = (
  side: Pick<PlanSide, 'infoHash' | 'name'>,
  file: { infoHash: string | null; names: string[] },
  torrentNames: string[] = []
): boolean => {
  if (side.infoHash && file.infoHash && side.infoHash === file.infoHash.toLowerCase()) return true;
  const wanted = [side.name, ...torrentNames].filter((n): n is string => Boolean(n));
  return wanted.some((name) => file.names.includes(name));
};

/** The same download: an info hash, a name or an upload in common. */
export const sameDownload = (a: Omit<PlanSide, 'label'>, b: Omit<PlanSide, 'label'>): boolean =>
  Boolean(
    (a.infoHash && a.infoHash === b.infoHash) || (a.name && a.name === b.name) || (a.uploadId && a.uploadId === b.uploadId)
  );

/** A side as given: { infoHash, name, label, ripId, uploadId }, at least one of the first two or the last two. */
const parseSide = async (raw: unknown, index: number): Promise<PlanSide> => {
  const where = `files[${index}]`;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new MergeError(`${where} must be an object`, 400);
  const input = raw as Record<string, unknown>;
  let infoHash: string | null = null;
  if (input.infoHash !== undefined && input.infoHash !== null && input.infoHash !== '') {
    if (typeof input.infoHash !== 'string' || !HASH.test(input.infoHash.trim())) {
      throw new MergeError(`${where}.infoHash must be a v1 info hash (40 hex characters)`, 400);
    }
    infoHash = input.infoHash.trim().toLowerCase();
  }
  let name = text(input.name, MAX_NAME);
  if (name && /[\\/]/.test(name)) throw new MergeError(`${where}.name is the download's name, without folders`, 400);
  let uploadId: string | null = null;

  if (input.ripId !== undefined && input.ripId !== null) {
    const rip = typeof input.ripId === 'string' ? await db.getRipById(input.ripId) : null;
    if (!rip || rip.hidden) throw new MergeError(`${where}: rip not found`, 404);
    name = rip.downloadName;
    // Already ripped: its file
    const upload = rip.status === 'DONE' && rip.outputFile ? await db.getUploadByPath(rip.outputFile) : null;
    if (upload) uploadId = upload.id;
  }
  if (input.uploadId !== undefined && input.uploadId !== null) {
    const upload = typeof input.uploadId === 'string' ? await db.getUploadById(input.uploadId) : null;
    if (!upload) throw new MergeError(`${where}: upload not found`, 404);
    uploadId = upload.id;
  }
  if (!infoHash && !name && !uploadId) {
    throw new MergeError(`${where} needs an infoHash, a name, a ripId or an uploadId`, 400);
  }
  return { infoHash, name, label: text(input.label, MAX_LABEL), uploadId };
};

const fields = (key: SideKey, side: PlanSide) =>
  key === 'A'
    ? { hashA: side.infoHash, nameA: side.name, labelA: side.label, uploadAId: side.uploadId }
    : { hashB: side.infoHash, nameB: side.name, labelB: side.label, uploadBId: side.uploadId };

const uploadField = (key: SideKey) => (key === 'A' ? 'uploadAId' : 'uploadBId');

class MergePlans extends EventEmitter {
  // One claim or pairing at a time: two files of one plan arriving together
  private chain: Promise<unknown> = Promise.resolve();

  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.catch(() => undefined);
    return run;
  }

  async list() {
    return Promise.all((await db.getMergePlans()).map((plan) => this.toPublic(plan)));
  }

  async get(id: string) {
    return this.toPublic(await this.find(id));
  }

  /**
   * Plans a pair: { files: [side, side], tmdbId?, originalLanguage?, origin? }. The same
   * two downloads planned again (bookrr sending twice) give the plan already there.
   * Files already there are held for it at once, and paired when both are.
   */
  async create(body: Record<string, unknown>): Promise<{ created: boolean; plan: Awaited<ReturnType<MergePlans['toPublic']>> }> {
    if (!mergeActive()) throw new MergeError('Merging is off (MERGE_ENABLED, RIP_LANGUAGE=it)');
    const files = body.files;
    if (!Array.isArray(files) || files.length !== 2) throw new MergeError('files must be the two downloads of the pair', 400);
    const sides = [await parseSide(files[0], 0), await parseSide(files[1], 1)];
    if (sameDownload(sides[0], sides[1])) throw new MergeError('The two files must be two different downloads', 400);

    let tmdbId: number | null = null;
    if (body.tmdbId !== undefined && body.tmdbId !== null) {
      if (!Number.isInteger(body.tmdbId) || (body.tmdbId as number) <= 0) throw new MergeError('tmdbId must be a positive integer', 400);
      tmdbId = body.tmdbId as number;
    }
    let originalLanguage: string | null = null;
    if (body.originalLanguage !== undefined && body.originalLanguage !== null && body.originalLanguage !== '') {
      const value = body.originalLanguage;
      if (typeof value !== 'string' || !LANGUAGE.test(value.trim()) || value.trim().toLowerCase() === 'und') {
        throw new MergeError('originalLanguage must be a language code (en, eng, ja, pt-BR)', 400);
      }
      originalLanguage = value.trim().toLowerCase();
    }

    return this.exclusive(async () => {
      // Already planned: the same two downloads give that plan, one of them in another plan is refused
      for (const plan of await db.getMergePlansByStatus(OPEN)) {
        const [a, b] = [sideOf(plan, 'A'), sideOf(plan, 'B')];
        const same = (sameDownload(a, sides[0]) && sameDownload(b, sides[1])) || (sameDownload(a, sides[1]) && sameDownload(b, sides[0]));
        if (same) return { created: false, plan: await this.toPublic(plan) };
        const taken = sides.find((s) => sameDownload(a, s) || sameDownload(b, s));
        if (taken) throw new MergeError(`${describeSide(taken)} is already in another planned pair`);
      }
      // A file given must be one that can wait for the pair
      for (const side of sides) {
        if (!side.uploadId) continue;
        const upload = (await db.getUploadById(side.uploadId))!;
        if (upload.status !== 'HELD' && !HOLDABLE.includes(upload.status)) {
          throw new MergeError(`${upload.filename} is ${upload.status}: it cannot wait for a pair`);
        }
        if ((await db.getMergePairsOfUpload(upload.id)).some((p) => ['ANALYZING', 'MERGING'].includes(p.status))) {
          throw new MergeError(`${upload.filename} is already in a pair being analyzed or merged`);
        }
      }

      let plan = await db.createMergePlan({
        ...fields('A', { ...sides[0], uploadId: null }),
        ...fields('B', { ...sides[1], uploadId: null }),
        tmdbId,
        originalLanguage,
        origin: text(body.origin, MAX_ORIGIN),
      });
      logger.info({ planId: plan.id, sides, tmdbId, origin: plan.origin }, 'Merge pair planned');

      // The files already there: given, or arrived before the plan
      for (const [i, key] of (['A', 'B'] as SideKey[]).entries()) {
        const upload = sides[i].uploadId ? await db.getUploadById(sides[i].uploadId!) : await this.arrived(sides[i]);
        if (upload) plan = await this.fill(plan, key, upload);
      }
      plan = await this.pairIfReady(plan);
      this.emit('plan-updated', { planId: plan.id, status: plan.status });
      return { created: true, plan: await this.toPublic(plan) };
    });
  }

  /**
   * What a pair can be planned with: the rips not finished (one per download), the
   * torrents of the enabled clients, and the files not on a server yet. `problems`:
   * the clients that could not be reached.
   */
  async candidates() {
    const seen = new Set<string>();
    const rips = [];
    for (const rip of await db.getRipsByStatus(RIP_UNFINISHED, true)) {
      if (seen.has(rip.downloadName)) continue;
      seen.add(rip.downloadName);
      rips.push({ id: rip.id, downloadName: rip.downloadName, status: rip.status, title: rip.title, year: rip.year });
    }
    const torrents = [];
    const problems: string[] = [];
    for (const client of (await db.getTorrentClients()).filter((c) => c.enabled)) {
      try {
        for (const t of await getQbitClient(client).getTorrents(client.category)) {
          torrents.push({
            infoHash: t.hash.toLowerCase(),
            name: t.name,
            downloadName: topLevelName(t),
            client: client.name,
            progress: Math.round(t.progress * 100),
          });
        }
      } catch (error) {
        problems.push(`${client.name}: ${describeError(error)}`);
      }
    }
    const uploads = (await Promise.all(['HELD', ...HOLDABLE].map((s) => db.getUploadsByStatus(s))))
      .flat()
      .filter((u) => existsSync(u.filepath))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((u) => ({ id: u.id, filename: u.filename, status: u.status, holdKind: u.holdKind }));
    return { rips, torrents, uploads, problems };
  }

  /** Forgets a plan; its files already held stay held (to pair, upload or delete by hand). */
  async remove(id: string): Promise<void> {
    if (!(await db.deleteMergePlan(id))) throw new MergeError('Planned pair not found', 404);
    logger.info({ planId: id }, 'Planned pair removed');
    this.emit('plan-removed', { planId: id });
  }

  /** Creates the pair of a plan whose two files are there, again after an error. */
  async pair(id: string) {
    return this.exclusive(async () => {
      const plan = await this.find(id);
      if (plan.status === 'PAIRED') throw new MergeError('The pair is already created');
      if (!plan.uploadAId || !plan.uploadBId) throw new MergeError('A file of the pair has not arrived yet');
      const updated = await this.pairIfReady(plan);
      this.emit('plan-updated', { planId: id, status: updated.status });
      return this.toPublic(updated);
    });
  }

  /**
   * A new file (index.ts, before the twin search): held for the plan it is a side of.
   * Null when it is no side of an open plan.
   */
  async claim(upload: Upload): Promise<{ planId: string; decision: HoldDecision } | null> {
    return this.exclusive(async () => {
      const plans = await db.getMergePlansByStatus(['WAITING']);
      if (plans.length === 0) return null;
      const file = { infoHash: upload.torrentHash?.toLowerCase() ?? null, names: await downloadNamesOf(upload) };
      for (const plan of plans) {
        for (const key of ['A', 'B'] as SideKey[]) {
          const side = sideOf(plan, key);
          if (side.uploadId) continue;
          const torrentNames = side.infoHash ? await this.torrentNames(side.infoHash) : [];
          if (!sideMatches(side, file, torrentNames)) continue;
          const filled = await db.updateMergePlan(plan.id, { [uploadField(key)]: upload.id });
          logger.info({ planId: plan.id, side: key, uploadId: upload.id }, 'File of a planned pair arrived');
          this.emit('plan-updated', { planId: plan.id, status: filled.status });
          return { planId: plan.id, decision: this.decision(filled, key) };
        }
      }
      return null;
    });
  }

  /** Once a claimed file is held: the pair, when the other file is there too. */
  async pairIfArrived(planId: string): Promise<void> {
    await this.exclusive(async () => {
      const plan = await db.getMergePlanById(planId);
      if (!plan || plan.status !== 'WAITING') return;
      const updated = await this.pairIfReady(plan);
      if (updated.status !== plan.status) this.emit('plan-updated', { planId, status: updated.status });
    });
  }

  /** An upload deleted: its side waits for a file again. */
  async forgetUpload(uploadId: string): Promise<void> {
    for (const plan of await db.getMergePlansOfUpload(uploadId)) {
      if (plan.status === 'PAIRED') continue;
      const key: SideKey = plan.uploadAId === uploadId ? 'A' : 'B';
      await db.updateMergePlan(plan.id, { [uploadField(key)]: null, status: 'WAITING', message: null });
      this.emit('plan-updated', { planId: plan.id, status: 'WAITING' });
    }
  }

  // Why the file of this side is held
  private decision(plan: MergePlan, key: SideKey): HoldDecision {
    const otherSide = sideOf(plan, other(key));
    const label = sideOf(plan, key).label;
    return {
      kind: 'PLANNED',
      message: `Planned pair${label ? ` (${label})` : ''}: ${
        otherSide.uploadId ? 'its other file is here, the pair is created' : `waiting for ${describeSide(otherSide)}`
      }`,
    };
  }

  // A side's file held for the plan (not on a server yet, still on the disk)
  private async fill(plan: MergePlan, key: SideKey, upload: Upload): Promise<MergePlan> {
    const filled = await db.updateMergePlan(plan.id, { [uploadField(key)]: upload.id });
    try {
      await manualHolds.hold(upload.id, this.decision(filled, key), { allowHeld: true });
    } catch (error) {
      if (!(error instanceof HoldError)) throw error;
      logger.warn({ planId: plan.id, uploadId: upload.id, error: error.message }, 'File of a planned pair not held');
      return db.updateMergePlan(plan.id, { [uploadField(key)]: null });
    }
    return filled;
  }

  /** The file of a side that arrived before the plan: by its hash, or from its download; one that can still wait. */
  private async arrived(side: PlanSide): Promise<Upload | null> {
    const names = [side.name, ...(side.infoHash ? await this.torrentNames(side.infoHash) : [])].filter((n): n is string => Boolean(n));
    const found: Upload[] = side.infoHash ? await db.getUploadsByTorrentHash(side.infoHash) : [];
    for (const name of new Set(names)) found.push(...(await uploadsOfDownload(name)));
    const waiting = found
      .filter((u) => u.status === 'HELD' || HOLDABLE.includes(u.status))
      .sort((a, b) => Number(b.status === 'HELD') - Number(a.status === 'HELD') || b.createdAt.getTime() - a.createdAt.getTime());
    return waiting[0] ?? null;
  }

  /** The names of a torrent in the clients and as sent beforehand (its download's name). */
  private async torrentNames(infoHash: string): Promise<string[]> {
    const names = new Set<string>();
    const sent = await db.getSourceTorrent(infoHash);
    if (sent) names.add(sent.name);
    for (const client of (await db.getTorrentClients()).filter((c) => c.enabled)) {
      try {
        const torrent: QbitTorrent | null = await getQbitClient(client).getTorrent(infoHash);
        if (torrent) {
          names.add(topLevelName(torrent));
          names.add(torrent.name);
        }
      } catch (error) {
        logger.warn({ client: client.name, infoHash, error: describeError(error) }, 'Planned pair: client not reachable');
      }
    }
    return [...names];
  }

  /** Both files there: the pair is created and its analysis queued; ERROR with the reason when it cannot be. */
  private async pairIfReady(plan: MergePlan): Promise<MergePlan> {
    if (!plan.uploadAId || !plan.uploadBId || plan.status === 'PAIRED') return plan;
    try {
      const language = plan.originalLanguage ?? (await this.languageOf(plan.tmdbId));
      const pair = await mergePairs.create([plan.uploadAId, plan.uploadBId], language ?? undefined);
      const updated = await db.updateMergePlan(plan.id, { status: 'PAIRED', pairId: pair.id, message: null });
      for (const key of ['A', 'B'] as SideKey[]) {
        const uploadId = sideOf(plan, key).uploadId!;
        const upload = await db.getUploadById(uploadId);
        if (upload?.status === 'HELD') {
          const label = sideOf(plan, key).label;
          await db.updateUpload(uploadId, { holdMessage: `Planned pair${label ? ` (${label})` : ''}: paired, see the Merge page` });
        }
      }
      logger.info({ planId: plan.id, pairId: pair.id }, 'Planned pair created');
      return updated;
    } catch (error) {
      const message = error instanceof MergeError ? error.message : describeError(error);
      logger.warn({ planId: plan.id, error: message }, 'Planned pair could not be created');
      return db.updateMergePlan(plan.id, { status: 'ERROR', message });
    }
  }

  // The film's original language from TMDB, for a plan that gave its film only
  private async languageOf(tmdbId: number | null): Promise<string | null> {
    if (!tmdbId || !tmdbConfigured()) return null;
    try {
      return (await getMovie(tmdbId)).originalLanguage || null;
    } catch {
      return null;
    }
  }

  private async find(id: string): Promise<MergePlan> {
    const plan = await db.getMergePlanById(id);
    if (!plan) throw new MergeError('Planned pair not found', 404);
    return plan;
  }

  // Each side with its file (once arrived) and the rip of its download, when there is one
  private async toPublic(plan: MergePlan) {
    const side = async (key: SideKey) => {
      const s = sideOf(plan, key);
      const upload = s.uploadId ? await db.getUploadById(s.uploadId) : null;
      const rips = s.name ? (await db.getRipsByDownloadName(s.name)).filter((r) => !r.hidden) : [];
      const rip = rips.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0] ?? null;
      return {
        ...s,
        upload: upload ? { id: upload.id, filename: upload.filename, status: upload.status } : null,
        rip: rip ? { id: rip.id, status: rip.status, progress: rip.progress } : null,
      };
    };
    const { hashA, nameA, labelA, uploadAId, hashB, nameB, labelB, uploadBId, ...rest } = plan;
    return { ...rest, status: plan.status as PlanStatus, files: [await side('A'), await side('B')] };
  }
}

export const mergePlans = new MergePlans();
