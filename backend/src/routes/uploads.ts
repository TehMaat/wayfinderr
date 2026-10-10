import { existsSync } from 'fs';
import { Router, Request, Response } from 'express';
import { db } from '../services/database.js';
import { jobQueue } from '../services/jobQueue.js';
import { torrentCleanup } from '../services/torrentCleanup.js';
import { describeError } from '../services/qbittorrent.js';
import { mediaInfoParser } from '../services/mediaInfo.js';
import logger from '../config/logger.js';

const router = Router();

// GET all uploads with pagination
router.get('/', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(req.query.limit ? parseInt(req.query.limit as string) : 50, 1000);
    const offset = req.query.offset ? parseInt(req.query.offset as string) : 0;

    const { uploads, total } = await db.getUploads(limit, offset);
    res.json({ uploads, total, limit, offset });
  } catch (error) {
    logger.error(error, 'Failed to fetch uploads');
    res.status(500).json({ error: 'Failed to fetch uploads' });
  }
});

// GET counters for the dashboard and the filters
router.get('/stats', async (req: Request, res: Response) => {
  try {
    res.json({ ...(await db.getUploadStats()), queueSize: jobQueue.getQueueSize() });
  } catch (error) {
    logger.error(error, 'Failed to fetch upload stats');
    res.status(500).json({ error: 'Failed to fetch upload stats' });
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

// POST retry upload
router.post('/:id/retry', async (req: Request, res: Response) => {
  try {
    const upload = await db.getUploadById(req.params.id);
    if (!upload) {
      res.status(404).json({ error: 'Upload not found' });
      return;
    }

    if (upload.status !== 'FAILED' && upload.status !== 'SKIPPED' && upload.status !== 'CANCELLED') {
      res.status(409).json({ error: `Upload is ${upload.status}, cannot retry` });
      return;
    }

    // Reset upload state and put it back in the queue
    await db.updateUpload(req.params.id, {
      progress: 0,
      progressBytes: 0n,
      currentRetryCount: 0,
      error: null,
    });
    await jobQueue.enqueueUpload({ uploadId: upload.id, filepath: upload.filepath });

    res.json(await db.getUploadById(upload.id));
  } catch (error) {
    logger.error(error, 'Failed to retry upload');
    res.status(500).json({ error: 'Failed to retry upload' });
  }
});

// POST stop a queued or running upload (the partial remote file is removed)
router.post('/:id/cancel', async (req: Request, res: Response) => {
  try {
    const upload = await db.getUploadById(req.params.id);
    if (!upload) {
      res.status(404).json({ error: 'Upload not found' });
      return;
    }

    if (upload.status !== 'QUEUED' && upload.status !== 'UPLOADING') {
      res.status(409).json({ error: `Upload is ${upload.status}, cannot stop` });
      return;
    }

    await jobQueue.cancelUpload(upload.id);

    // CANCELLED, or COMPLETED if the transfer finished before it could be stopped
    res.json(await db.getUploadById(upload.id));
  } catch (error) {
    logger.error(error, 'Failed to stop upload');
    res.status(500).json({ error: 'Failed to stop upload' });
  }
});

// POST read the file's media info again (uploads probed before the video and
// container details were stored); only while the local file is still there
router.post('/:id/media', async (req: Request, res: Response) => {
  try {
    const upload = await db.getUploadById(req.params.id);
    if (!upload) {
      res.status(404).json({ error: 'Upload not found' });
      return;
    }
    if (!existsSync(upload.filepath)) {
      res.status(409).json({ error: 'The local file is no longer there' });
      return;
    }

    const mediaInfo = await mediaInfoParser.parseFile(upload.filepath);
    await db.updateUpload(upload.id, {
      mediaInfo: JSON.stringify(mediaInfo),
      hasItalianAudio: mediaInfo.hasItalianAudio,
      hasItalianSubtitles: mediaInfo.hasItalianSubtitles,
    });
    res.json(await db.getUploadById(upload.id));
  } catch (error) {
    logger.warn({ uploadId: req.params.id, error }, 'Failed to read media info again');
    res.status(500).json({ error: 'Failed to read the media info' });
  }
});

// POST match the upload to its torrent again (e.g. after adding a client or the TMDB key)
router.post('/:id/torrent/check', async (req: Request, res: Response) => {
  try {
    res.json(await torrentCleanup.recheck(req.params.id));
  } catch (error) {
    res.status(409).json({ error: describeError(error) });
  }
});

// POST remove the matched torrent from the client now
router.post('/:id/torrent/remove', async (req: Request, res: Response) => {
  try {
    res.json(await torrentCleanup.removeNow(req.params.id));
  } catch (error) {
    logger.warn({ uploadId: req.params.id, error: describeError(error) }, 'Manual torrent removal failed');
    res.status(502).json({ error: describeError(error) });
  }
});

// DELETE upload record (history only, the file is not touched)
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const upload = await db.getUploadById(req.params.id);
    if (!upload) {
      res.status(404).json({ error: 'Upload not found' });
      return;
    }
    if (upload.status === 'QUEUED' || upload.status === 'UPLOADING') {
      res.status(409).json({ error: `Upload is ${upload.status}, cannot delete` });
      return;
    }
    await db.deleteUpload(upload.id);
    res.json({ ok: true });
  } catch (error) {
    logger.error(error, 'Failed to delete upload');
    res.status(500).json({ error: 'Failed to delete upload' });
  }
});

export default router;
