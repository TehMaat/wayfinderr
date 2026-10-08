import { Router, Request, Response } from 'express';
import { Server } from '@prisma/client';
import { db } from '../services/database.js';
import { serverManager } from '../services/serverManager.js';
import { uploadManager } from '../services/uploadManager.js';
import logger from '../config/logger.js';

const router = Router();

// Never send the secrets back to the browser
const toPublic = ({ sshPassword, apiToken, ...server }: Server) => ({
  ...server,
  hasSshPassword: Boolean(sshPassword),
  hasApiToken: Boolean(apiToken),
});

const STRING_FIELDS = [
  'name',
  'apiEndpoint',
  'apiToken',
  'sshHost',
  'sshUsername',
  'sshPassword',
  'sshPath',
  'backoffStrategy',
  'mediaCheckPolicy',
] as const;
const INT_FIELDS = ['sshPort', 'maxRetries'] as const;

// Keeps only known fields, converts numbers, drops empty strings
// (an empty password on edit means "keep the current one")
const parseServerBody = (body: Record<string, unknown>) => {
  const data: Record<string, string | number> = {};
  for (const field of STRING_FIELDS) {
    const value = body[field];
    if (typeof value === 'string' && value.trim() !== '') {
      data[field] = value.trim();
    }
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
    const data = parseServerBody(req.body);
    const { name, apiEndpoint, apiToken, sshHost, sshUsername } = data;

    if (!name || !apiEndpoint || !apiToken || !sshHost || !sshUsername) {
      res.status(400).json({ error: 'Missing required fields' });
      return;
    }

    const server = await db.createServer({
      ...data,
      name: String(name),
      apiEndpoint: String(apiEndpoint),
      apiToken: String(apiToken),
      sshHost: String(sshHost),
      sshUsername: String(sshUsername),
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
    const server = await db.updateServer(req.params.id, parseServerBody(req.body));
    res.json(toPublic(server));
  } catch (error) {
    logger.error(error, 'Failed to update server');
    res.status(500).json({ error: 'Failed to update server' });
  }
});

// POST test server: Ultra.cc API + SSH/SFTP login + destination folder
router.post('/:id/test', async (req: Request, res: Response) => {
  const server = await db.getServerById(req.params.id).catch(() => null);
  if (!server) {
    res.status(404).json({ error: 'Server not found' });
    return;
  }

  const space = await serverManager.getServerSpace(server, true);
  if (!space) {
    res.status(502).json({ error: 'Ultra.cc API unreachable or token invalid' });
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
  });
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
