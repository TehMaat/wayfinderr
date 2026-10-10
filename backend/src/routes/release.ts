import { Router, Request, Response } from 'express';
import { releaseManager, ReleaseError } from '../services/release/index.js';
import { ReleaseFlags } from '../services/release/name.js';
import { db } from '../services/database.js';
import logger from '../config/logger.js';

// Mounted on /api/uploads/:id/release
const router = Router({ mergeParams: true });

const flagsOf = (body: Record<string, unknown>): ReleaseFlags => ({
  title: typeof body.title === 'string' ? body.title.slice(0, 200) : '',
  year: typeof body.year === 'string' || typeof body.year === 'number' ? String(body.year) : '',
  version: typeof body.version === 'string' ? body.version.slice(0, 60) : '',
  remux: body.remux === true,
});

const handle =
  (action: (req: Request) => Promise<unknown>, failure: string) => async (req: Request, res: Response) => {
    try {
      res.json(await action(req));
    } catch (error) {
      if (error instanceof ReleaseError) {
        res.status(error.status).json({ error: error.message, code: error.code });
        return;
      }
      logger.error({ uploadId: req.params.id, error }, failure);
      res.status(502).json({ error: `${failure}: ${(error as Error).message}` });
    }
  };

// GET the rename proposal: media analysis and the name's prefilled parts
router.get('/', handle((req) => releaseManager.proposal(req.params.id), 'Failed to prepare the release'));

// POST the name these choices give (nothing is changed)
router.post('/preview', handle((req) => releaseManager.preview(req.params.id, flagsOf(req.body)), 'Failed to build the name'));

// POST rename on the server, then run the tracker command
router.post(
  '/',
  handle((req) => releaseManager.confirm(req.params.id, flagsOf(req.body), req.body.overwrite === true), 'Rename failed')
);

// POST run the tracker command again on the renamed file
router.post('/run', handle((req) => releaseManager.rerun(req.params.id), 'Failed to start the tracker command'));

// POST type an answer to the command's question
router.post(
  '/input',
  handle(async (req) => {
    const text = typeof req.body.text === 'string' ? req.body.text.slice(0, 500) : '';
    await releaseManager.answer(req.params.id, text);
    return { ok: true };
  }, 'Failed to send the answer')
);

// POST stop the tracker command (Ctrl-C)
router.post('/stop', handle((req) => releaseManager.stop(req.params.id), 'Failed to stop the tracker command'));

// POST link a release made before: its file on the server, its .torrent, its media info from there
router.post('/link', handle((req) => releaseManager.link(req.params.id), 'Failed to link the release'));

// GET the .torrent the tracker gave back
router.get('/torrent', async (req: Request, res: Response) => {
  try {
    const torrent = await db.getUploadTorrent(req.params.id);
    if (!torrent) {
      res.status(404).json({ error: 'No .torrent stored for this upload' });
      return;
    }
    res.attachment(torrent.name).type('application/x-bittorrent').send(torrent.data);
  } catch (error) {
    logger.error({ uploadId: req.params.id, error }, 'Failed to send the .torrent');
    res.status(500).json({ error: 'Failed to send the .torrent' });
  }
});

// POST no rename for now (asked on its own after the upload)
router.post('/dismiss', handle((req) => releaseManager.dismiss(req.params.id), 'Failed to dismiss'));

export default router;
