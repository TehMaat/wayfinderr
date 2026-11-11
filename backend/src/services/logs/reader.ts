import { readdir, readFile, stat } from 'fs/promises';
import path from 'path';
import { JobLogMeta, jobEntries } from './jobLogs.js';
import { LogDay, scanLogDays } from './retention.js';
import { dayOf, LEVELS, LevelName, levelName, LogEntry, LogSource } from './store.js';

/** An entry as the Logs page gets it: with an id, unique and stable, that orders it. */
export type LogRow = LogEntry & { id: string };

export interface LogQuery {
  sources: readonly LogSource[];
  minLevel: LevelName;
  q?: string | null; // free text, in the message or any field, any case
  from?: number | null; // ms since the epoch
  to?: number | null;
  before?: string | null; // the `next` of the previous page
  limit: number;
  pairId?: string | null;
  job?: string | null;
}

export interface LogPage {
  entries: LogRow[];
  next: string | null; // older entries are there: pass it as `before`
}

// Days parsed lately, by path: a past day does not change, today's is read again when it grows
const CACHE_SIZE = 16;
const cache = new Map<string, { key: string; rows: LogRow[] }>();

const cached = async (file: string, key: string, load: () => Promise<LogRow[]>): Promise<LogRow[]> => {
  const hit = cache.get(file);
  if (hit && hit.key === key) return hit.rows;
  const rows = await load();
  cache.delete(file);
  cache.set(file, { key, rows });
  while (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value as string);
  return rows;
};

/** The lines of a day file: one entry each (a line that is not JSON is kept as its message). */
export const parseDayFile = (text: string, source: LogSource, day: string): LogRow[] => {
  const rows: LogRow[] = [];
  text.split('\n').forEach((raw, lineNo) => {
    const line = raw.replace(/\r$/, '');
    if (!line.trim()) return;
    const id = `${source}:${day}:${String(lineNo).padStart(7, '0')}`;
    try {
      const parsed = JSON.parse(line);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        rows.push({
          ...parsed,
          id,
          source,
          time: typeof parsed.time === 'string' ? parsed.time : `${day}T00:00:00.000Z`,
          level: levelName(parsed.level),
          msg: typeof parsed.msg === 'string' ? parsed.msg : '',
        });
        return;
      }
    } catch {
      // Not JSON (a line cut by a full disk): kept as it is
    }
    rows.push({ id, source, time: `${day}T00:00:00.000Z`, level: 'info', msg: line });
  });
  return rows;
};

const loadJobDay = async (dir: string, day: string): Promise<LogRow[]> => {
  const rows: LogRow[] = [];
  for (const name of await readdir(dir).catch(() => [])) {
    if (!name.endsWith('.meta.json')) continue;
    const job = name.slice(0, -'.meta.json'.length);
    try {
      const meta = JSON.parse(await readFile(path.join(dir, name), 'utf8')) as JobLogMeta;
      const text = await readFile(path.join(dir, `${job}.log`), 'utf8').catch(() => '');
      rows.push(...jobEntries(text, { ...meta, job }, day));
    } catch {
      // A meta file half written or edited by hand: that job is left out
    }
  }
  return rows;
};

const loadDay = async (d: LogDay): Promise<LogRow[]> => {
  const info = await stat(d.path).catch(() => null);
  if (!info) return [];
  const key = `${info.mtimeMs}:${info.size}`;
  if (d.source === 'dyadrr-job') {
    // The folder's mtime changes when a job is added; the jobs themselves never change
    return cached(d.path, key, () => loadJobDay(d.path, d.day));
  }
  return cached(d.path, key, async () => parseDayFile(await readFile(d.path, 'utf8'), d.source, d.day));
};

const timeOf = (row: LogRow) => {
  const t = Date.parse(row.time);
  return Number.isFinite(t) ? t : 0;
};

/** Newest first: by time, then by id (a later line of the same file has a higher id). */
const newestFirst = (a: LogRow, b: LogRow) => timeOf(b) - timeOf(a) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);

export const cursorOf = (row: LogRow) => `${timeOf(row)}~${row.id}`;

const beforeCursor = (cursor: string | null | undefined) => {
  if (!cursor) return () => true;
  const sep = cursor.indexOf('~');
  const time = Number(cursor.slice(0, sep));
  const id = cursor.slice(sep + 1);
  if (sep < 0 || !Number.isFinite(time)) return () => true;
  return (row: LogRow) => {
    const t = timeOf(row);
    return t < time || (t === time && row.id < id);
  };
};

export const matches = (row: LogRow, query: LogQuery): boolean => {
  if (LEVELS[row.level] < LEVELS[query.minLevel]) return false;
  const t = timeOf(row);
  if (query.from != null && t < query.from) return false;
  if (query.to != null && t > query.to) return false;
  if (query.pairId && row.pairId !== query.pairId) return false;
  if (query.job && row.job !== query.job) return false;
  if (query.q) {
    const needle = query.q.toLowerCase();
    if (!row.msg.toLowerCase().includes(needle) && !JSON.stringify(row).toLowerCase().includes(needle)) return false;
  }
  return true;
};

/**
 * A page of the history, newest first: the days of the period, from the most
 * recent, until the page is full. `next` reads on from where this page ends.
 */
export const readLogs = async (dir: string, query: LogQuery): Promise<LogPage> => {
  const fromDay = query.from != null ? dayOf(query.from) : null;
  const toDay = query.to != null ? dayOf(query.to) : null;
  const before = beforeCursor(query.before);
  // The job logs are filed under the day they ended: a job that ran over midnight
  // has entries of the day before, so its folder is read one day further
  const days = (await scanLogDays(dir, query.sources)).filter((d) => {
    if (toDay && d.day > toDay && !(d.source === 'dyadrr-job' && d.day === nextDay(toDay))) return false;
    if (fromDay && d.day < fromDay) return false;
    return true;
  });
  const byDay = new Map<string, LogDay[]>();
  for (const d of days) byDay.set(d.day, [...(byDay.get(d.day) ?? []), d]);

  const found: LogRow[] = [];
  for (const day of [...byDay.keys()].sort().reverse()) {
    // A day holds entries of that day only (the job logs, of the day before too): once
    // the page and one more are found, and they are all newer than this day, it is done
    if (found.length > query.limit && day < found[query.limit].time.slice(0, 10)) break;
    const rows = (await Promise.all(byDay.get(day)!.map(loadDay))).flat();
    for (const row of rows) if (before(row) && matches(row, query)) found.push(row);
    found.sort(newestFirst);
    found.splice(query.limit + 1);
  }
  const entries = found.slice(0, query.limit);
  return { entries, next: found.length > query.limit && entries.length ? cursorOf(entries[entries.length - 1]) : null };
};

const nextDay = (day: string) => {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
};
