import { Router, Request, Response } from 'express';
import { Server } from '@prisma/client';
import { db } from '../services/database.js';
import { ApiRestartBusyError, serverManager } from '../services/serverManager.js';
import { hasUltraApi, isServerType, serverFieldsError, unusedFields } from '../services/serverTypes.js';
import { uploadManager } from '../services/uploadManager.js';
import logger from '../config/logger.js';

const router = Router();

// Never send the secrets back to the browser
const toPublic = ({ sshPassword, apiToken, ...server }: Server) => ({
  ...server,
  hasSshPassword: Boolean(sshPassword),
  hasApiToken: Boolean(apiToken),
  apiRestarting: serverManager.isRestartingApi(server.id),
});

const STRING_FIELDS = [
  'name',
  'type',
  'apiEndpoint',
  'apiToken',
  'sshHost',
  'sshUsername',
  'sshPassword',
  'sshPath',
  'backoffStrategy',
  'mediaCheckPolicy',
  'releaseDir',
] as const;
const INT_FIELDS = ['sshPort', 'maxRetries'] as const;
// Blank clears them
const NULLABLE_FIELDS = ['releaseTag', 'trackerCommand'] as const;

// Keeps only known fields, converts numbers, drops empty strings
// (an empty password on edit means "keep the current one")
type ServerBody = Record<string, string | number | boolean | null>;

const parseServerBody = (body: Record<string, unknown>) => {
  const data: ServerBody = {};
  for (const field of STRING_FIELDS) {
    const value = body[field];
    if (typeof value === 'string' && value.trim() !== '') {
      data[field] = value.trim();
    }
  }
  for (const field of NULLABLE_FIELDS) {
    const value = body[field];
    if (typeof value === 'string') data[field] = value.trim() || null;
  }
  for (const field of ['releaseAuto', 'autoRestartApi'] as const) {
    if (typeof body[field] === 'boolean') data[field] = body[field];
  }
  for (const field of INT_FIELDS) {
    const value = parseInt(String(body[field] ?? ''), 10);
    if (!Number.isNaN(value)) {
      data[field] = value;
    }
  }
  return data;
};

// GET all servers
router.get('/', async (req: Request, res: Response) => {
  try {
    const servers = await db.getServers();
    res.json(servers.map(toPublic));
  } catch (error) {
    logger.error(error, 'Failed to fetch servers');
    res.status(500).json({ error: 'Failed to fetch servers' });
  }
});

// GET server by ID
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const server = await db.getServerById(req.params.id);
    if (!server) {
      res.status(404).json({ error: 'Server not found' });
      return;
    }
    res.json(toPublic(server));
  } catch (error) {
    logger.error(error, 'Failed to fetch server');
    res.status(500).json({ error: 'Failed to fetch server' });
  }
});

// POST create server
router.post('/', async (req: Request, res: Response) => {
  try {
    // No type: Ultra.cc, as before server types
    const data: ServerBody = { type: 'ULTRA', ...parseServerBody(req.body) };
    const { type } = data;
    const invalid = serverFieldsError(data);
    if (invalid || !isServerType(type)) {
      res.status(400).json({ error: invalid });
      return;
    }

    const server = await db.createServer({
      ...data,
      ...unusedFields(type),
      type,
      name: String(data.name),
      sshHost: String(data.sshHost),
      sshUsername: String(data.sshUsername),
    });

    res.status(201).json(toPublic(server));
  } catch (error) {
    logger.error(error, 'Failed to create server');
    res.status(500).json({ error: 'Failed to create server' });
  }
});

// PUT update server
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const current = await db.getServerById(req.params.id);
    if (!current) {
      res.status(404).json({ error: 'Server not found' });
      return;
    }
    const data = parseServerBody(req.body);
    const merged = { ...current, ...data };
    const { type } = merged;
    const invalid = serverFieldsError(merged);
    if (invalid || !isServerType(type)) {
      res.status(400).json({ error: invalid });
      return;
    }
    // Another host or port is another machine: its host key is kept again at the next connection
    const moved =
      (data.sshHost !== undefined && data.sshHost !== current.sshHost) ||
      (data.sshPort !== undefined && data.sshPort !== current.sshPort);
    // Another type: what it does not use is emptied (Ultra-API endpoint, token, restart)
    const server = await db.updateServer(req.params.id, {
      ...data,
      ...unusedFields(type),
      ...(moved ? { sshHostKey: null } : {}),
    });
    res.json(toPublic(server));
  } catch (error) {
    logger.error(error, 'Failed to update server');
    res.status(500).json({ error: 'Failed to update server' });
  }
});

// DELETE the kept SSH host key: the next connection keeps the key it sees (a reinstalled server)
router.delete('/:id/ssh-host-key', async (req: Request, res: Response) => {
  const server = await db.getServerById(req.params.id).catch(() => null);
  if (!server) {
    res.status(404).json({ error: 'Server not found' });
    return;
  }
  const updated = await db.updateServer(server.id, { sshHostKey: null });
  logger.warn({ serverId: server.id, host: server.sshHost, forgotten: server.sshHostKey }, 'SSH host key forgotten');
  res.json(toPublic(updated));
});

// POST test server: the space (Ultra.cc: its API, else over SSH; other types: over SSH)
// + SSH/SFTP login + destination folder
router.post('/:id/test', async (req: Request, res: Response) => {
  const server = await db.getServerById(req.params.id).catch(() => null);
  if (!server) {
    res.status(404).json({ error: 'Server not found' });
    return;
  }

  const space = await serverManager.getServerSpace(server, true);
  if (!space) {
    res.status(502).json({
      error: hasUltraApi(server)
        ? 'Ultra.cc API unreachable or token invalid, and the space could not be read over SSH'
        : 'The space could not be read over SSH',
    });
    return;
  }

  try {
    await uploadManager.testConnection(server);
  } catch (error) {
    res.status(502).json({ error: `SSH/SFTP failed: ${(error as Error).message}` });
    return;
  }

  res.json({
    ok: true,
    freeSpaceGB: (Number(space.freeSpaceBytes) / 1024 / 1024 / 1024).toFixed(2),
    // api, or quota/disk: the API is unreachable, the space was read over SSH
    spaceSource: space.source,
  });
});

// POST restart the Ultra-API: Ultra's Ultra-API script over SSH, "Restart" entry
router.post('/:id/restart-api', async (req: Request, res: Response) => {
  const server = await db.getServerById(req.params.id).catch(() => null);
  if (!server) {
    res.status(404).json({ error: 'Server not found' });
    return;
  }
  if (!hasUltraApi(server)) {
    res.status(400).json({ error: 'Only Ultra.cc servers have an Ultra-API' });
    return;
  }

  try {
    const result = await serverManager.restartApi(server);
    if (!result.ok) {
      res.status(502).json({ error: result.message, output: result.output });
      return;
    }
    res.json(result);
  } catch (error) {
    if (error instanceof ApiRestartBusyError) {
      res.status(409).json({ error: error.message });
      return;
    }
    logger.error(error, 'Failed to restart the Ultra-API');
    res.status(500).json({ error: 'Failed to restart the Ultra-API' });
  }
});

// DELETE server
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const server = await db.deleteServer(req.params.id);
    res.json(toPublic(server));
  } catch (error) {
    logger.error(error, 'Failed to delete server');
    res.status(500).json({ error: 'Failed to delete server' });
  }
});

export default router;
