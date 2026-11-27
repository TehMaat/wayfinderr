import { Upload } from '@prisma/client';
import logger from '../../config/logger.js';
import { db } from '../database.js';
import { keepsChoice, ReleaseVersion, resolveVersion, VersionSource } from './version.js';

/** What the rip, the source .torrent and the merge plans of an upload say its version is (see version.ts) */
export const versionSources = async (upload: Upload, depth = 0): Promise<VersionSource[]> => {
  const sources: VersionSource[] = [];
  // Every part of a join has the same version
  for (const rip of await db.getRipsByOutputFile(upload.filepath)) {
    if (rip.version !== null) sources.push({ origin: 'rip', version: rip.version, from: rip.downloadName });
  }
  if (upload.torrentHash) {
    const torrent = await db.getSourceTorrentVersion(upload.torrentHash.toLowerCase());
    if (torrent && torrent.version !== null) {
      sources.push({ origin: 'torrent', version: torrent.version, from: torrent.origin ?? torrent.fileName });
    }
  }
  for (const plan of await db.getMergePlansOfUpload(upload.id)) {
    if (plan.version !== null) sources.push({ origin: 'plan', version: plan.version, from: plan.origin });
  }
  // A merged file: its plan, and what its two files were going to be
  if (depth === 0) {
    for (const pair of await db.getMergePairsByOutputUpload(upload.id)) {
      const plan = await db.getMergePlanByPairId(pair.id);
      if (plan && plan.version !== null) sources.push({ origin: 'plan', version: plan.version, from: plan.origin });
      for (const id of [pair.uploadAId, pair.uploadBId]) {
        const input = await db.getUploadById(id);
        if (!input) continue;
        const known = resolveVersion(input.version, await versionSources(input, depth + 1));
        if (known.version !== null) sources.push({ origin: 'merge', version: known.version, from: input.filename });
      }
    }
  }
  return sources;
};

export const releaseVersionOf = async (upload: Upload): Promise<ReleaseVersion> =>
  resolveVersion(upload.version, await versionSources(upload));

/** The uploads with their version, as the API returns them */
export const withReleaseVersion = async <T extends Upload>(upload: T): Promise<T & { releaseVersion: ReleaseVersion }> => ({
  ...upload,
  releaseVersion: await releaseVersionOf(upload),
});

/** These uploads' own choices that differ from a source's new version go: they follow their sources again */
export const followSource = async (uploadIds: (string | null | undefined)[], version: string | null, why: string) => {
  for (const id of new Set(uploadIds.filter((x): x is string => Boolean(x)))) {
    const upload = await db.getUploadById(id);
    if (!upload || keepsChoice(upload.version, version)) continue;
    await db.updateUpload(id, { version: null });
    logger.info({ uploadId: id, was: upload.version, now: version, why }, 'Version chosen on the upload dropped: its source changed');
  }
};
