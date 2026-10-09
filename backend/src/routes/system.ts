import { Router, Request, Response } from 'express';
import { getLocalDisks } from '../services/diskUsage.js';
import logger from '../config/logger.js';

const router = Router();

// GET disk space of the folders on this machine (watch folder, downloads, database)
router.get('/disks', async (req: Request, res: Response) => {
  try {
    res.json(await getLocalDisks());
  } catch (error) {
    logger.error(error, 'Failed to read local disk space');
    res.status(500).json({ error: 'Failed to read local disk space' });
  }
});

export default router;
