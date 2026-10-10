import { Request, Response, Router } from 'express';
import { Rip } from '@prisma/client';
import { db } from '../services/database.js';
import { ripper } from '../services/ripper/index.js';
import { normalizeExclusions, normalizeFolder, normalizeFolders } from '../services/ripper/exclusions.js';
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

// POST join discs of one download into one film ({ ripIds }, in order): each is ripped, then mkvmerge appends them
router.post('/join', async (req: Request, res: Response) => {
  const ripIds = req.body?.ripIds;
  if (!Array.isArray(ripIds) || ripIds.length > 20 || !ripIds.every((id) => typeof id === 'string')) {
    res.status(400).json({ error: 'ripIds must be a list of rip ids' });
    return;
  }
  try {
    res.json(await Promise.all((await ripper.join(ripIds)).map(toPublic)));
  } catch (error) {
    fail(res, error, 'Failed to join the discs');
  }
});

// GET the subfolders of a folder of the downloads (?path=, relative; none for the downloads folder)
router.get('/folders', async (req: Request, res: Response) => {
  const raw = String(req.query.path ?? '');
  let relative = '';
  try {
    relative = raw.trim() ? normalizeFolder(raw) : '';
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
    return;
  }
  try {
    res.json({ path: relative, folders: await ripper.folders(relative) });
  } catch (error) {
    fail(res, error, 'Failed to list the folder');
  }
});

// PUT the exclusion rules (discs whose path contains one are not ripped), the
// ignored folders (never searched) and whether downloads arrive complete;
// each one left out is kept as it is
router.put('/exclusions', async (req: Request, res: Response) => {
  const body = req.body ?? {};
  const changes: Parameters<typeof ripper.setExclusions>[0] = {};
  try {
    if (body.patterns !== undefined) changes.patterns = normalizeExclusions(body.patterns);
    if (body.folders !== undefined) changes.folders = normalizeFolders(body.folders);
    if (body.arriveComplete !== undefined) {
      if (typeof body.arriveComplete !== 'boolean') throw new Error('arriveComplete must be a boolean');
      changes.arriveComplete = body.arriveComplete;
    }
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
    return;
  }
  try {
    res.json(await ripper.setExclusions(changes));
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

// POST rip with mkvmerge/ffmpeg instead of MakeMKV (after MakeMKV failed)
router.post('/:id/remux', async (req: Request, res: Response) => {
  try {
    res.json(await toPublic(await ripper.ripWithoutMakemkv(req.params.id)));
  } catch (error) {
    fail(res, error, 'Failed to start the rip without MakeMKV');
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
