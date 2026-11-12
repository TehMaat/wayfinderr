import { EventEmitter } from 'events';
import { existsSync } from 'fs';
import { Upload } from '@prisma/client';
import logger from '../../config/logger.js';
import { db } from '../database.js';
import { jobQueue } from '../jobQueue.js';
import { HoldDecision } from './hold.js';
import { mergeActive } from './index.js';

/**
 * Holding a file for a merge by hand (issue #53), when Wayfinderr cannot tell on its
 * own: the twin's torrent is not in the client yet, its name says nothing, or the other
 * disc is ripped later.
 *
 * - an upload not on a server yet (PENDING, QUEUED, FAILED, SKIPPED, CANCELLED) is held
 *   at once: taken out of the upload queue first, as Stop does;
 * - a rip marked "Hold for merge" before it is done: its file is held as it arrives
 *   (see the hold decision in index.ts);
 * - "Hold every new file", a setting: every file that arrives is held, while it is on.
 *
 * A file held by hand is HELD like the others, with holdKind MANUAL: never uploaded,
 * deleted or cleaned up until it is paired, uploaded as it is or deleted.
 */

export class HoldError extends Error {
  constructor(message: string, public status = 409) {
    super(message);
  }
}

// Not on a server yet, and not being sent there: an upload in progress is stopped by hand first
export const HOLDABLE = ['PENDING', 'QUEUED', 'FAILED', 'SKIPPED', 'CANCELLED'];

export const MANUAL_MESSAGE = 'Held by hand';
export const RIP_MESSAGE = 'Held by hand: its rip was marked "Hold for merge"';
export const HOLD_ALL_MESSAGE = 'Held by hand: "Hold every new file" is on';

const HOLD_ALL_KEY = 'merge.holdAll';

/** Why an upload cannot be held now, or null when it can. `allowHeld`: already held is fine (its reason changes). */
export const holdRefusal = (upload: Pick<Upload, 'status' | 'filename'>, allowHeld = false): string | null => {
  if (upload.status === 'HELD') return allowHeld ? null : `${upload.filename} is already held for a merge`;
  if (upload.status === 'UPLOADING') return `${upload.filename} is being uploaded: stop it first`;
  if (upload.status === 'COMPLETED') return `${upload.filename} is already on a server`;
  if (upload.status === 'MERGED') return `${upload.filename} is already merged`;
  if (!HOLDABLE.includes(upload.status)) return `${upload.filename} is ${upload.status}: it cannot be held`;
  return null;
};

class ManualHolds extends EventEmitter {
  /**
   * Holds an upload not on a server yet: out of the upload queue (a transfer that
   * finishes before it stops is not held), then HELD with this reason.
   */
  async hold(uploadId: string, decision: HoldDecision, options: { allowHeld?: boolean } = {}): Promise<Upload> {
    if (!mergeActive()) throw new HoldError('Merging is off (MERGE_ENABLED, RIP_LANGUAGE=it)');
    const upload = await db.getUploadById(uploadId);
    if (!upload) throw new HoldError('Upload not found', 404);
    const refusal = holdRefusal(upload, options.allowHeld);
    if (refusal) throw new HoldError(refusal);
    if (!existsSync(upload.filepath)) throw new HoldError(`${upload.filename} is no longer on the disk`);

    if (jobQueue.hasJob(upload.id)) {
      await jobQueue.cancelUpload(upload.id);
      const after = await db.getUploadById(upload.id);
      if (!after) throw new HoldError('Upload not found', 404);
      if (after.status !== 'CANCELLED') {
        throw new HoldError(
          after.status === 'COMPLETED'
            ? `${upload.filename} finished uploading before it could be held`
            : `${upload.filename} is ${after.status}: try again once it has stopped`
        );
      }
    }

    const held = await db.updateUpload(upload.id, {
      status: 'HELD',
      holdKind: decision.kind,
      holdMessage: decision.message,
      progress: 0,
      progressBytes: 0n,
      error: null,
    });
    logger.info({ uploadId: upload.id, from: upload.status, hold: decision }, 'Held for a merge by hand');
    this.emit('upload-held', { uploadId: upload.id, kind: decision.kind });
    return held;
  }

  /** "Hold every new file": while on, every file that arrives is held for a merge. */
  async getHoldAll(): Promise<boolean> {
    return (await db.getSettings([HOLD_ALL_KEY]))[HOLD_ALL_KEY] === 'true';
  }

  async setHoldAll(value: unknown): Promise<boolean> {
    if (typeof value !== 'boolean') throw new HoldError('holdAll must be true or false', 400);
    await db.setSettings({ [HOLD_ALL_KEY]: String(value) });
    logger.info({ holdAll: value }, 'Hold every new file');
    return value;
  }
}

export const manualHolds = new ManualHolds();
