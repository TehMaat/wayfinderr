import { Router, Request, Response } from 'express';
import { db } from '../services/database.js';
import logger from '../config/logger.js';

const router = Router();

// GET all servers with current space info
router.get('/', async (req: Request, res: Response) => {
  try {
    const servers = await db.getServers();
    res.json(servers);
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
    res.json(server);
  } catch (error) {
    logger.error(error, 'Failed to fetch server');
    res.status(500).json({ error: 'Failed to fetch server' });
  }
});

// POST create server
router.post('/', async (req: Request, res: Response) => {
  try {
    const {
      name,
      apiEndpoint,
      apiToken,
      sshHost,
      sshPort,
      sshUsername,
      sshPath,
      maxRetries,
      backoffStrategy,
      mediaCheckPolicy,
    } = req.body;

    if (!name || !apiEndpoint || !apiToken || !sshHost || !sshUsername) {
      res.status(400).json({ error: 'Missing required fields' });
      return;
    }

    const server = await db.createServer({
      name,
      apiEndpoint,
      apiToken,
      sshHost,
      sshPort: sshPort || 22,
      sshUsername,
      sshPath: sshPath || '/uploads',
      maxRetries: maxRetries || 3,
      backoffStrategy: backoffStrategy || 'exponential',
      mediaCheckPolicy: mediaCheckPolicy || 'SKIP_NO_ITA',
    });

    res.status(201).json(server);
  } catch (error) {
    logger.error(error, 'Failed to create server');
    res.status(500).json({ error: 'Failed to create server' });
  }
});

// PUT update server
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const server = await db.updateServer(req.params.id, req.body);
    res.json(server);
  } catch (error) {
    logger.error(error, 'Failed to update server');
    res.status(500).json({ error: 'Failed to update server' });
  }
});

// DELETE server
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const server = await db.deleteServer(req.params.id);
    res.json(server);
  } catch (error) {
    logger.error(error, 'Failed to delete server');
    res.status(500).json({ error: 'Failed to delete server' });
  }
});

export default router;
