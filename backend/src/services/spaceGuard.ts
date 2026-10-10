import { EventEmitter } from 'events';
import { TorrentClient } from '@prisma/client';
import logger from '../config/logger.js';
import { db } from './database.js';
import { getLocalDisks } from './diskUsage.js';
import { describeError, getQbitClient } from './qbittorrent.js';
import { LocalDisk } from '../types/index.js';

/**
 * Pauses every torrent of a client while a disk of this machine (watch folder,
 * downloads, database) has less free space than the client's `minFreeGB`.
 *
 * The torrents it pauses are tagged in qBittorrent, so once there is room again
 * only those are resumed: torrents the user had paused stay paused. Checked every
 * CHECK_MS; a torrent started while space is low is paused again at the next check.
 */

export const SPACE_TAG = 'wayfinderr-low-space';
const CHECK_MS = 30 * 1000;
const GB = 1024 ** 3;
// Resumed only above the threshold plus this margin, or it would flap around it
const RESUME_MARGIN = 0.1;
const MIN_RESUME_MARGIN_BYTES = GB;

// qBittorrent 4 says "paused", 5 says "stopped"
const PAUSED_STATES = new Set(['pausedUP', 'pausedDL', 'stoppedUP', 'stoppedDL']);

const formatGB = (bytes: number) => `${(bytes / GB).toFixed(1)} GB`;

export const resumeAtBytes = (minFreeGB: number) =>
  minFreeGB * GB + Math.max(minFreeGB * GB * RESUME_MARGIN, MIN_RESUME_MARGIN_BYTES);

/** What to do with a client's torrents given the fullest disk: pause them, resume them, or nothing (null) */
export const spaceAction = (
  client: Pick<TorrentClient, 'enabled' | 'minFreeGB' | 'spacePausedAt'>,
  lowest: Pick<LocalDisk, 'mountPoint' | 'freeBytes'> | null
): { pause: boolean; why: string } | null => {
  const threshold = client.enabled ? client.minFreeGB : null;

  if (!threshold) {
    // Turned off, or the client disabled, while its torrents were paused
    return client.spacePausedAt ? { pause: false, why: 'Disk space check turned off' } : null;
  }
  // Disks unreadable: change nothing
  if (!lowest) return null;

  const free = Number(lowest.freeBytes);
  const where = `${lowest.mountPoint} has ${formatGB(free)} free`;

  if (free < threshold * GB) return { pause: true, why: `${where}, less than ${threshold} GB` };
  if (client.spacePausedAt && free >= resumeAtBytes(threshold)) return { pause: false, why: `${where} again` };
  return null;
};

export class SpaceGuard extends EventEmitter {
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;
  private again = false;

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.check(), CHECK_MS);
    this.check();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Runs a check now (e.g. after a client is saved); one at a time, a request during a run runs once more after it */
  check(): Promise<void> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = this.run()
      .catch((error) => logger.error({ error: describeError(error) }, 'Disk space check failed'))
      .finally(() => {
        this.running = null;
        if (this.again) {
          this.again = false;
          this.check();
        }
      });
    return this.running;
  }

  private async run(): Promise<void> {
    const clients = await db.getTorrentClients();
    // Nothing to watch or to undo: skip reading the disks
    if (!clients.some((c) => (c.enabled && c.minFreeGB) || c.spacePausedAt)) return;

    const { disks } = await getLocalDisks();
    // The fullest disk decides
    const lowest = disks.reduce<LocalDisk | null>(
      (min, disk) => (!min || disk.freeBytes < min.freeBytes ? disk : min),
      null
    );

    for (const client of clients) {
      const action = spaceAction(client, lowest);
      if (!action) continue;
      try {
        await (action.pause ? this.pause(client, action.why) : this.resume(client, action.why));
      } catch (error) {
        // Client down: tried again at the next check
        const message = `${action.pause ? 'Pause' : 'Resume'} failed: ${describeError(error)}`;
        logger.warn({ clientId: client.id, error: describeError(error) }, 'Low disk space pause/resume failed');
        if (client.spaceMessage !== message) await db.updateTorrentClient(client.id, { spaceMessage: message });
      }
    }
  }

  private async pause(client: TorrentClient, why: string): Promise<void> {
    const qbit = getQbitClient(client);
    const active = (await qbit.getAllTorrents()).filter((t) => !PAUSED_STATES.has(t.state));
    if (active.length > 0) {
      await qbit.pauseTorrents(active.map((t) => t.hash), SPACE_TAG);
      logger.warn({ clientId: client.id, torrents: active.length, why }, 'Torrents paused for low disk space');
    }

    const first = !client.spacePausedAt;
    // Torrents started while paused are paused again: say so only when there were some
    if (first || active.length > 0) {
      const message = `${why}: ${first ? '' : 'again '}paused ${active.length} torrent(s)`;
      await db.updateTorrentClient(client.id, { spacePausedAt: client.spacePausedAt ?? new Date(), spaceMessage: message });
      this.emit('client-updated', { clientId: client.id, paused: true, message, first });
    } else if (client.spaceMessage?.startsWith('Pause failed')) {
      await db.updateTorrentClient(client.id, { spaceMessage: `${why}: torrents paused` });
    }
  }

  private async resume(client: TorrentClient, why: string): Promise<void> {
    const resumed = await getQbitClient(client).resumeTagged(SPACE_TAG);
    const message = `${why}: resumed ${resumed} torrent(s)`;
    logger.info({ clientId: client.id, torrents: resumed, why }, 'Torrents resumed after low disk space');
    await db.updateTorrentClient(client.id, { spacePausedAt: null, spaceMessage: message });
    this.emit('client-updated', { clientId: client.id, paused: false, message, first: true });
  }

  /** Before a client is deleted: its paused torrents are resumed, or nothing would ever resume them */
  async release(client: TorrentClient): Promise<void> {
    if (!client.spacePausedAt) return;
    try {
      await getQbitClient(client).resumeTagged(SPACE_TAG);
    } catch (error) {
      logger.warn({ clientId: client.id, error: describeError(error) }, 'Could not resume the torrents of a deleted client');
    }
  }
}

export const spaceGuard = new SpaceGuard();
