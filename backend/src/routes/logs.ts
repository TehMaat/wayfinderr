import { Router, Request, Response } from 'express';
import logger from '../config/logger.js';
import { logs, LOG_SOURCES, LogSource } from '../services/logs/index.js';
import type { LogQuery } from '../services/logs/reader.js';
import { DAY, LEVELS, LevelName } from '../services/logs/store.js';

const router = Router();

const PAGE = 200;
const MAX_PAGE = 1000;
const MAX_DOWNLOAD = 100_000;

class BadQuery extends Error {}

const one = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null);

/** A time: an ISO date-time, or a day (YYYY-MM-DD, its start; with `end`, its last ms). */
const time = (value: unknown, name: string, end = false): number | null => {
  const text = one(value);
  if (!text) return null;
  const ms = DAY.test(text) ? Date.parse(`${text}T00:00:00.000Z`) + (end ? 86_400_000 - 1 : 0) : Date.parse(text);
  if (!Number.isFinite(ms)) throw new BadQuery(`${name} must be a date (YYYY-MM-DD) or an ISO time`);
  return ms;
};

/** The filters of GET /api/logs and /api/logs/download, from the query string. */
const parseQuery = (q: Request['query'], maxLimit: number, defaultLimit: number): LogQuery => {
  const sources = (one(q.source)?.split(',') ?? [...LOG_SOURCES]).map((s) => s.trim()).filter(Boolean);
  for (const s of sources) {
    if (!LOG_SOURCES.includes(s as LogSource)) throw new BadQuery(`source must be one of ${LOG_SOURCES.join(', ')}`);
  }
  const level = one(q.level) ?? 'trace';
  if (!(level in LEVELS)) throw new BadQuery(`level must be one of ${Object.keys(LEVELS).join(', ')}`);
  const limit = one(q.limit) ? Number(q.limit) : defaultLimit;
  if (!Number.isInteger(limit) || limit < 1) throw new BadQuery('limit must be a positive whole number');
  return {
    sources: sources as LogSource[],
    minLevel: level as LevelName,
    q: one(q.q),
    from: time(q.from, 'from'),
    to: time(q.to, 'to', true),
    before: one(q.before),
    limit: Math.min(limit, maxLimit),
    pairId: one(q.pair),
    job: one(q.job),
  };
};

const fail = (res: Response, error: unknown, what: string) => {
  if (error instanceof BadQuery) {
    res.status(400).json({ error: error.message });
    return;
  }
  logger.error({ error }, `Failed to ${what}`);
  res.status(500).json({ error: `Failed to ${what}` });
};

// GET the history, newest first: ?source=wayfinderr,dyadrr-runner,dyadrr-job &level= (the lowest
// shown) &q= &from= &to= (YYYY-MM-DD or ISO) &pair= &job= &limit= &before= (the `next` of the last page)
router.get('/', async (req: Request, res: Response) => {
  try {
    res.json(await logs.query(parseQuery(req.query, MAX_PAGE, PAGE)));
  } catch (error) {
    fail(res, error, 'read the logs');
  }
});

// GET the retention in force, the space taken and the days kept
router.get('/info', async (req: Request, res: Response) => {
  try {
    res.json(await logs.info());
  } catch (error) {
    fail(res, error, 'read the logs');
  }
});

// GET the entries matching the same filters as a JSON Lines file (a whole day: from=to=<day>)
router.get('/download', async (req: Request, res: Response) => {
  try {
    const query = parseQuery(req.query, MAX_DOWNLOAD, MAX_DOWNLOAD);
    const { entries } = await logs.query(query);
    const day = query.from !== null && query.from !== undefined ? new Date(query.from).toISOString().slice(0, 10) : 'all';
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="wayfinderr-logs-${day}.jsonl"`);
    // Oldest first, as a log file reads
    res.send(entries.reverse().map(({ id: _id, ...entry }) => JSON.stringify(entry)).join('\n') + (entries.length ? '\n' : ''));
  } catch (error) {
    fail(res, error, 'download the logs');
  }
});

export default router;
