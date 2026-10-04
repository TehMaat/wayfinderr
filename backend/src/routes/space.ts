import { Router, Request, Response } from 'express';
import { Server } from '@prisma/client';
import { serverManager } from '../services/serverManager.js';
import { db } from '../services/database.js';
import { ServerSpaceInfo } from '../types/index.js';
import logger from '../config/logger.js';

const router = Router();

const toGB = (bytes: bigint) => (Number(bytes) / 1024 / 1024 / 1024).toFixed(2);

const formatSpace = (server: Server, space: ServerSpaceInfo | null) => ({
  id: server.id,
  name: server.name,
  // false when the Ultra.cc API could not be reached
  reachable: space !== null,
  freeSpaceBytes: space?.freeSpaceBytes.toString() ?? '0',
  usedSpaceBytes: space?.usedSpaceBytes.toString() ?? '0',
  totalSpaceBytes: space?.totalSpaceBytes.toString() ?? '0',
  freeSpaceGB: space ? toGB(space.freeSpaceBytes) : '0',
  lastSpaceCheckAt: server.lastSpaceCheckAt,
});

// GET all servers with current space info
router.get('/', async (req: Request, res: Response) => {
  try {
    const servers = await db.getServers();
    const result = await Promise.all(
      servers.map(async (server) => {
        const space = await serverManager.getServerSpace(server);
        // Re-read to get the lastSpaceCheckAt written by a fresh fetch
        const fresh = space ? ((await db.getServerById(server.id)) ?? server) : server;
        return formatSpace(fresh, space);
      })
    );
    res.json(result);
  } catch (error) {
    logger.error(error, 'Failed to fetch space info');
    res.status(500).json({ error: 'Failed to fetch space info' });
  }
});

// GET space for specific server
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const server = await db.getServerById(req.params.id);
    if (!server) {
      res.status(404).json({ error: 'Server not found' });
      return;
    }
    res.json(formatSpace(server, await serverManager.getServerSpace(server)));
  } catch (error) {
    logger.error(error, 'Failed to fetch space info');
    res.status(500).json({ error: 'Failed to fetch space info' });
  }
});

// POST refresh space for specific server (bypass cache)
router.post('/:id/refresh', async (req: Request, res: Response) => {
  try {
    const server = await db.getServerById(req.params.id);
    if (!server) {
      res.status(404).json({ error: 'Server not found' });
      return;
    }

    const space = await serverManager.getServerSpace(server, true);
    if (!space) {
      res.status(502).json({ error: 'Failed to fetch space info' });
      return;
    }

    const refreshed = (await db.getServerById(server.id)) ?? server;
    res.json(formatSpace(refreshed, space));
  } catch (error) {
    logger.error(error, 'Failed to refresh space info');
    res.status(500).json({ error: 'Failed to refresh space info' });
  }
});

export default router;
