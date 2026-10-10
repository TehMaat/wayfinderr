import { Router, Request, Response } from 'express';
import { TorrentClient } from '@prisma/client';
import { db } from '../services/database.js';
import { describeError, getQbitClient } from '../services/qbittorrent.js';
import logger from '../config/logger.js';

const router = Router();

// Never send the password or API key back to the browser
const toPublic = ({ password, apiKey, ...client }: TorrentClient) => ({
  ...client,
  hasPassword: Boolean(password),
  hasApiKey: Boolean(apiKey),
});

const STRING_FIELDS = ['name', 'url', 'username', 'password', 'apiKey', 'category'] as const;
// Secrets: blank on edit means "keep the current one"
const SECRET_FIELDS = new Set(['password', 'apiKey']);
const BOOLEAN_FIELDS = ['enabled', 'autoRemove', 'deleteFiles'] as const;

const parseClientBody = (body: Record<string, unknown>) => {
  const data: Record<string, string | boolean | null> = {};
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
  for (const field of BOOLEAN_FIELDS) {
    if (typeof body[field] === 'boolean') data[field] = body[field] as boolean;
  }
  return data;
};

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
    const client = await db.createTorrentClient({ ...data, name: String(data.name), url: String(data.url) });
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
    res.json(toPublic(await db.updateTorrentClient(req.params.id, data)));
  } catch (error) {
    logger.error(error, 'Failed to update torrent client');
    res.status(500).json({ error: 'Failed to update torrent client' });
  }
});

// POST test: login + version + how many finished torrents it would look at
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
    res.json({ ok: true, version, completedTorrents: torrents.length });
  } catch (error) {
    res.status(502).json({ error: `qBittorrent: ${describeError(error)}` });
  }
});

router.delete('/:id', async (req: Request, res: Response) => {
  try {
    res.json(toPublic(await db.deleteTorrentClient(req.params.id)));
  } catch (error) {
    logger.error(error, 'Failed to delete torrent client');
    res.status(500).json({ error: 'Failed to delete torrent client' });
  }
});

export default router;
