import { Request, Response, Router } from 'express';
import { Rip } from '@prisma/client';
import { db } from '../services/database.js';
import { ripper } from '../services/ripper/index.js';
import { normalizeExclusions } from '../services/ripper/exclusions.js';
import { parseReleaseName } from '../services/ripper/releaseName.js';
import { searchMovies } from '../services/ripper/tmdb.js';
import logger from '../config/logger.js';

const router = Router();

// Titles as objects, the upload of the ripped file, and what to search on TMDB
const toPublic = async (rip: Rip) => {
  const upload = rip.outputFile ? await db.getUploadByPath(rip.outputFile) : null;
  return {
    ...rip,
    titles: rip.titles ? JSON.parse(rip.titles) : null,
    upload: upload ? { id: upload.id, status: upload.status, progress: upload.progress } : null,
    suggestion: parseReleaseName(rip.downloadName),
  };
};

const fail = (res: Response, error: unknown, fallback: string) => {
  const message = error instanceof Error ? error.message : fallback;
  const status = /not found/i.test(message) ? 404 : 409;
  res.status(status).json({ error: message });
};

// GET rips and the state of the ripping setup
router.get('/', async (req: Request, res: Response) => {
  try {
    const rips = await db.getVisibleRips();
    res.json({ status: await ripper.status(), rips: await Promise.all(rips.map(toPublic)) });
  } catch (error) {
    logger.error(error, 'Failed to fetch rips');
    res.status(500).json({ error: 'Failed to fetch rips' });
  }
});

// GET TMDB search, for choosing the film by hand
router.get('/tmdb/search', async (req: Request, res: Response) => {
  const query = String(req.query.query ?? '').trim();
  const year = parseInt(String(req.query.year ?? ''), 10);
  if (!query) {
    res.status(400).json({ error: 'Missing query' });
    return;
  }
  try {
    res.json(await searchMovies(query, Number.isNaN(year) ? null : year));
  } catch (error) {
    logger.error(error, 'TMDB search failed');
    res.status(502).json({ error: error instanceof Error ? error.message : 'TMDB search failed' });
  }
});

// POST remove every skipped rip from the list
router.post('/clear-skipped', async (req: Request, res: Response) => {
  try {
    res.json(await ripper.removeSkipped());
  } catch (error) {
    logger.error(error, 'Failed to remove the skipped rips');
    res.status(500).json({ error: 'Failed to remove the skipped rips' });
  }
});

// PUT the exclusion rules: discs whose path contains one are not ripped
router.put('/exclusions', async (req: Request, res: Response) => {
  let patterns: string[];
  try {
    patterns = normalizeExclusions(req.body?.patterns);
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
    return;
  }
  try {
    res.json(await ripper.setExclusions(patterns));
  } catch (error) {
    logger.error(error, 'Failed to save the rip exclusions');
    res.status(500).json({ error: 'Failed to save the rip exclusions' });
  }
});

router.get('/:id', async (req: Request, res: Response) => {
  const rip = await db.getRipById(req.params.id).catch(() => null);
  if (!rip || rip.hidden) {
    res.status(404).json({ error: 'Rip not found' });
    return;
  }
  res.json(await toPublic(rip));
});

// POST choose the title and/or the film, then rip
router.post('/:id/choose', async (req: Request, res: Response) => {
  const titleIndex = req.body?.titleIndex;
  const tmdbId = req.body?.tmdbId;
  if ((titleIndex !== undefined && !Number.isInteger(titleIndex)) || (tmdbId !== undefined && !Number.isInteger(tmdbId))) {
    res.status(400).json({ error: 'titleIndex and tmdbId must be integers' });
    return;
  }
  try {
    res.json(await toPublic(await ripper.choose(req.params.id, { titleIndex, tmdbId })));
  } catch (error) {
    fail(res, error, 'Failed to start the rip');
  }
});

router.post('/:id/retry', async (req: Request, res: Response) => {
  try {
    res.json(await toPublic(await ripper.retry(req.params.id)));
  } catch (error) {
    fail(res, error, 'Failed to retry the rip');
  }
});

router.post('/:id/skip', async (req: Request, res: Response) => {
  try {
    res.json(await toPublic(await ripper.skip(req.params.id)));
  } catch (error) {
    fail(res, error, 'Failed to skip the rip');
  }
});

// DELETE a skipped rip from the list
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    await ripper.remove(req.params.id);
    res.status(204).end();
  } catch (error) {
    fail(res, error, 'Failed to remove the rip');
  }
});

export default router;
