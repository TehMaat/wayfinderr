import { Router, Request, Response } from 'express';
import { db } from '../services/database.js';
import { tmdb, TMDB_KEY_SETTING } from '../services/tmdb.js';
import logger from '../config/logger.js';
import { config } from '../config/index.js';

const router = Router();

// The key itself never goes back to the browser
const publicSettings = async () => ({
  hasTmdbApiKey: Boolean(await db.getSetting(TMDB_KEY_SETTING)),
  tmdbFromEnv: Boolean(config.TMDB_API_KEY),
});

router.get('/', async (req: Request, res: Response) => {
  try {
    res.json(await publicSettings());
  } catch (error) {
    logger.error(error, 'Failed to fetch settings');
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

// PUT { tmdbApiKey: "..." } sets the key (checked first), { tmdbApiKey: null } removes it
router.put('/', async (req: Request, res: Response) => {
  try {
    const { tmdbApiKey } = req.body as { tmdbApiKey?: string | null };
    if (tmdbApiKey === null) {
      await db.setSetting(TMDB_KEY_SETTING, null);
    } else if (typeof tmdbApiKey === 'string' && tmdbApiKey.trim() !== '') {
      try {
        await tmdb.test(tmdbApiKey.trim());
      } catch (error) {
        res.status(400).json({ error: (error as Error).message });
        return;
      }
      await db.setSetting(TMDB_KEY_SETTING, tmdbApiKey.trim());
    }
    tmdb.clearCache();
    res.json(await publicSettings());
  } catch (error) {
    logger.error(error, 'Failed to save settings');
    res.status(500).json({ error: 'Failed to save settings' });
  }
});

router.post('/tmdb/test', async (req: Request, res: Response) => {
  try {
    await tmdb.test();
    res.json({ ok: true });
  } catch (error) {
    res.status(502).json({ error: (error as Error).message });
  }
});

export default router;
