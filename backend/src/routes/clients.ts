import { Router, Request, Response } from 'express';
import { TorrentClient } from '@prisma/client';
import { db } from '../services/database.js';
import { describeError, getQbitClient } from '../services/qbittorrent.js';
import { spaceGuard } from '../services/spaceGuard.js';
import { releaseManager } from '../services/release/index.js';
import logger from '../config/logger.js';

const router = Router();

// Never send the passwords or API key back to the browser
const toPublic = ({ password, apiKey, sshPassword, ...client }: TorrentClient) => ({
  ...client,
  hasPassword: Boolean(password),
  hasApiKey: Boolean(apiKey),
  hasSshPassword: Boolean(sshPassword),
});

const STRING_FIELDS = [
  'name',
  'url',
  'username',
  'password',
  'apiKey',
  'category',
  // Local release (see services/release)
  'sshHost',
  'sshUsername',
  'sshPassword',
  'hostWatchDir',
  'releaseDir',
  'releaseTag',
  'trackerCommand',
] as const;
// Secrets: blank on edit means "keep the current one"
const SECRET_FIELDS = new Set(['password', 'apiKey', 'sshPassword']);
const BOOLEAN_FIELDS = ['enabled', 'autoRemove', 'deleteFiles', 'localRelease'] as const;

const parseClientBody = (body: Record<string, unknown>) => {
  const data: Record<string, string | boolean | number | null> = {};
  for (const field of STRING_FIELDS) {
    const value = body[field];
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (trimmed !== '') data[field] = trimmed;
    else if (!SECRET_FIELDS.has(field)) data[field] = null; // e.g. clear the category
  }
  // Explicit removal of a stored secret
  if (body.clearPassword === true) data.password = null;
  if (body.clearApiKey === true) data.apiKey = null;
  if (body.clearSshPassword === true) data.sshPassword = null;
  for (const field of BOOLEAN_FIELDS) {
    if (typeof body[field] === 'boolean') data[field] = body[field] as boolean;
  }
  // Pause every torrent below this many GB free on this machine: null or blank = off
  if (body.minFreeGB === null || body.minFreeGB === '') data.minFreeGB = null;
  else if (body.minFreeGB !== undefined) data.minFreeGB = Number(body.minFreeGB);
  if (body.sshPort !== undefined && body.sshPort !== '') data.sshPort = Number(body.sshPort);
  return data;
};

const validPort = (value: unknown) => value === undefined || (Number.isInteger(value) && Number(value) > 0 && Number(value) < 65536);

/** What a client set for local release still lacks (null: complete, or local release off) */
const localReleaseError = (client: Record<string, unknown>) => {
  if (client.localRelease !== true) return null;
  const missing = [
    !client.sshHost && 'SSH host',
    !client.sshUsername && 'SSH username',
    !client.hostWatchDir && 'watch folder',
    !client.releaseDir && 'release folder',
  ].filter(Boolean);
  return missing.length ? `Local release needs: ${missing.join(', ')}` : null;
};

const validMinFree = (value: unknown) =>
  value === undefined || value === null || (typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 1_000_000);

const validUrl = (value: unknown) => typeof value === 'string' && /^https?:\/\/[^\s]+$/i.test(value);

router.get('/', async (req: Request, res: Response) => {
  try {
    res.json((await db.getTorrentClients()).map(toPublic));
  } catch (error) {
    logger.error(error, 'Failed to fetch torrent clients');
    res.status(500).json({ error: 'Failed to fetch torrent clients' });
  }
});

router.post('/', async (req: Request, res: Response) => {
  try {
    const data = parseClientBody(req.body);
    if (!data.name || !validUrl(data.url)) {
      res.status(400).json({ error: 'Name and a http(s) URL are required' });
      return;
    }
    if (!validMinFree(data.minFreeGB)) {
      res.status(400).json({ error: 'The minimum free space must be a number of GB above 0' });
      return;
    }
    const invalid = !validPort(data.sshPort) ? 'The SSH port must be a number from 1 to 65535' : localReleaseError(data);
    if (invalid) {
      res.status(400).json({ error: invalid });
      return;
    }
    const client = await db.createTorrentClient({ ...data, name: String(data.name), url: String(data.url) });
    spaceGuard.check();
    res.status(201).json(toPublic(client));
  } catch (error) {
    logger.error(error, 'Failed to create torrent client');
    res.status(500).json({ error: 'Failed to create torrent client' });
  }
});

router.put('/:id', async (req: Request, res: Response) => {
  try {
    const data = parseClientBody(req.body);
    if (data.name === null || ('url' in data && !validUrl(data.url))) {
      res.status(400).json({ error: 'Name and a http(s) URL are required' });
      return;
    }
    if (!validMinFree(data.minFreeGB)) {
      res.status(400).json({ error: 'The minimum free space must be a number of GB above 0' });
      return;
    }
    const current = await db.getTorrentClientById(req.params.id);
    if (!current) {
      res.status(404).json({ error: 'Client not found' });
      return;
    }
    const invalid = !validPort(data.sshPort) ? 'The SSH port must be a number from 1 to 65535' : localReleaseError({ ...current, ...data });
    if (invalid) {
      res.status(400).json({ error: invalid });
      return;
    }
    const client = await db.updateTorrentClient(req.params.id, data);
    // A new threshold applies right away
    spaceGuard.check();
    res.json(toPublic(client));
  } catch (error) {
    logger.error(error, 'Failed to update torrent client');
    res.status(500).json({ error: 'Failed to update torrent client' });
  }
});

// POST test: login + version + how many finished torrents it would look at;
// with local release, also the SSH login and the folders on that machine
router.post('/:id/test', async (req: Request, res: Response) => {
  const client = await db.getTorrentClientById(req.params.id).catch(() => null);
  if (!client) {
    res.status(404).json({ error: 'Client not found' });
    return;
  }
  try {
    const qbit = getQbitClient(client);
    const version = await qbit.getVersion();
    const torrents = await qbit.getCompletedTorrents(client.category);
    if (client.localRelease) {
      try {
        await releaseManager.testLocal(client);
      } catch (error) {
        res.status(502).json({ error: `Local release: ${(error as Error).message}` });
        return;
      }
    }
    res.json({ ok: true, version, completedTorrents: torrents.length, localRelease: client.localRelease });
  } catch (error) {
    res.status(502).json({ error: `qBittorrent: ${describeError(error)}` });
  }
});

router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const client = await db.getTorrentClientById(req.params.id);
    // Torrents paused for low disk space are resumed first
    if (client) await spaceGuard.release(client);
    res.json(toPublic(await db.deleteTorrentClient(req.params.id)));
  } catch (error) {
    logger.error(error, 'Failed to delete torrent client');
    res.status(500).json({ error: 'Failed to delete torrent client' });
  }
});

export default router;
