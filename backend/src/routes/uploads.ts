import { Router, Request, Response } from 'express';
import { db } from '../services/database.js';
import logger from '../config/logger.js';

const router = Router();

// GET all uploads with pagination
router.get('/', async (req: Request, res: Response) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : 0;

    const { uploads, total } = await db.getUploads(limit, offset);
    res.json({ uploads, total, limit, offset });
  } catch (error) {
    logger.error(error, 'Failed to fetch uploads');
    res.status(500).json({ error: 'Failed to fetch uploads' });
  }
});

// GET upload by ID
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const upload = await db.getUploadById(req.params.id);
    if (!upload) {
      res.status(404).json({ error: 'Upload not found' });
      return;
    }
    res.json(upload);
  } catch (error) {
    logger.error(error, 'Failed to fetch upload');
    res.status(500).json({ error: 'Failed to fetch upload' });
  }
});

// POST retry upload (placeholder for now)
router.post('/:id/retry', async (req: Request, res: Response) => {
  try {
    const upload = await db.getUploadById(req.params.id);
    if (!upload) {
      res.status(404).json({ error: 'Upload not found' });
      return;
    }

    // Reset upload state for retry
    const updated = await db.updateUpload(req.params.id, {
      status: 'PENDING',
      progress: 0,
      currentRetryCount: (upload.currentRetryCount || 0) + 1,
      error: null,
    });

    res.json(updated);
  } catch (error) {
    logger.error(error, 'Failed to retry upload');
    res.status(500).json({ error: 'Failed to retry upload' });
  }
});

export default router;
