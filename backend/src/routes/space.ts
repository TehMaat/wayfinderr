import { Router, Request, Response } from 'express';
import { serverManager } from '../services/serverManager.js';
import { db } from '../services/database.js';
import logger from '../config/logger.js';

const router = Router();

// GET all servers with current space info
router.get('/', async (req: Request, res: Response) => {
  try {
    const servers = await db.getServers();
    const spaceInfos = await serverManager.getAllServersSpace();

    // Combine server info with space info
    const result = servers.map((server) => {
      const space = spaceInfos.find((s) => s.serverId === server.id);
      return {
        id: server.id,
        name: server.name,
        freeSpaceBytes: space?.freeSpaceBytes.toString() || '0',
        freeSpaceGB: space
          ? (Number(space.freeSpaceBytes) / 1024 / 1024 / 1024).toFixed(2)
          : '0',
        lastSpaceCheckAt: server.lastSpaceCheckAt,
      };
    });

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

    const space = await serverManager.getServerSpace(server);
    if (!space) {
      res.status(500).json({ error: 'Failed to fetch space info' });
      return;
    }

    res.json({
      id: server.id,
      name: server.name,
      freeSpaceBytes: space.freeSpaceBytes.toString(),
      freeSpaceGB: (Number(space.freeSpaceBytes) / 1024 / 1024 / 1024).toFixed(2),
      lastSpaceCheckAt: server.lastSpaceCheckAt,
    });
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

    // Bypass the cache
    const space = await serverManager.getServerSpace(server, true);
    if (!space) {
      res.status(500).json({ error: 'Failed to fetch space info' });
      return;
    }

    res.json({
      id: server.id,
      name: server.name,
      freeSpaceBytes: space.freeSpaceBytes.toString(),
      freeSpaceGB: (Number(space.freeSpaceBytes) / 1024 / 1024 / 1024).toFixed(2),
      lastSpaceCheckAt: new Date(),
    });
  } catch (error) {
    logger.error(error, 'Failed to refresh space info');
    res.status(500).json({ error: 'Failed to refresh space info' });
  }
});

export default router;
