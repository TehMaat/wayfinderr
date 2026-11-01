import { Router, Request, Response } from 'express';
import logger from '../config/logger.js';
import { mergeStatus } from '../services/merge/index.js';

const router = Router();

// GET whether merging is on, and whether the Dyadrr container is running
router.get('/', async (req: Request, res: Response) => {
  try {
    res.json({ status: await mergeStatus() });
  } catch (error) {
    logger.error(error, 'Failed to read the merge status');
    res.status(500).json({ error: 'Failed to read the merge status' });
  }
});

export default router;
