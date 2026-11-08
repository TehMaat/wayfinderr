import express, { Router, Request, Response } from 'express';
import { parseTmdbId, SourceTorrentError, sourceTorrents } from '../services/sourceTorrents.js';
import logger from '../config/logger.js';

/**
 * Source torrents' .torrent files sent before their upload exists (bookrr, by hand):
 * see services/sourceTorrents.ts. Login or API key, like every /api route.
 */
const router = Router();

const HASH = /^[0-9a-f]{40}$/i;

const validHash = (req: Request, res: Response): string | null => {
  const hash = req.params.hash;
  if (!HASH.test(hash)) {
    res.status(400).json({ error: 'Not an info hash (40 hex characters)' });
    return null;
  }
  return hash.toLowerCase();
};

// GET every stored .torrent (without the file), with the uploads it was copied into
router.get('/', async (req: Request, res: Response) => {
  try {
    res.json(await sourceTorrents.list());
  } catch (error) {
    logger.error(error, 'Failed to list the source torrents');
    res.status(500).json({ error: 'Failed to list the source torrents' });
  }
});

// POST a .torrent: the body is the file itself; ?name= its file name, ?tmdbId=, ?label=, ?origin=
router.post('/', express.raw({ type: 'application/x-bittorrent', limit: '10mb' }), async (req: Request, res: Response) => {
  if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
    res.status(415).json({ error: 'Send the .torrent file as application/x-bittorrent' });
    return;
  }
  try {
    const { created, torrent } = await sourceTorrents.add(req.body, {
      fileName: typeof req.query.name === 'string' ? req.query.name : undefined,
      tmdbId: parseTmdbId(req.query.tmdbId),
      label: req.query.label,
      origin: req.query.origin,
    });
    res.status(created ? 201 : 200).json(torrent);
  } catch (error) {
    if (error instanceof SourceTorrentError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    logger.error(error, 'Failed to store a source .torrent');
    res.status(500).json({ error: 'Failed to store the source .torrent' });
  }
});

// GET one, by info hash: 404 when it is not stored
router.get('/:hash', async (req: Request, res: Response) => {
  const hash = validHash(req, res);
  if (!hash) return;
  try {
    const torrent = await sourceTorrents.get(hash);
    if (!torrent) {
      res.status(404).json({ error: 'No source .torrent with this info hash' });
      return;
    }
    res.json(torrent);
  } catch (error) {
    logger.error({ hash, error }, 'Failed to read a source torrent');
    res.status(500).json({ error: 'Failed to read the source torrent' });
  }
});

// GET the file
router.get('/:hash/file', async (req: Request, res: Response) => {
  const hash = validHash(req, res);
  if (!hash) return;
  try {
    const file = await sourceTorrents.file(hash);
    if (!file) {
      res.status(404).json({ error: 'No source .torrent with this info hash' });
      return;
    }
    res.attachment(file.name).type('application/x-bittorrent').send(file.data);
  } catch (error) {
    logger.error({ hash, error }, 'Failed to send a source .torrent');
    res.status(500).json({ error: 'Failed to send the source .torrent' });
  }
});

// DELETE one: the copies already in the uploads stay
router.delete('/:hash', async (req: Request, res: Response) => {
  const hash = validHash(req, res);
  if (!hash) return;
  try {
    if (!(await sourceTorrents.remove(hash))) {
      res.status(404).json({ error: 'No source .torrent with this info hash' });
      return;
    }
    res.status(204).end();
  } catch (error) {
    logger.error({ hash, error }, 'Failed to delete a source .torrent');
    res.status(500).json({ error: 'Failed to delete the source .torrent' });
  }
});

export default router;
