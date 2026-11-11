import { readdir, rm, stat } from 'fs/promises';
import path from 'path';
import { DAY, LOG_SOURCES, LogSource, SOURCE_DIRS } from './store.js';

/** A day of one source: a file (.jsonl) or, for the job logs, a folder. */
export interface LogDay {
  source: LogSource;
  day: string;
  path: string;
  bytes: number;
}

export interface RetentionLimits {
  days: number; // days kept, today included; 0: forever
  maxBytes: number; // 0: no limit
  today: string;
}

const dirSize = async (dir: string): Promise<number> => {
  let total = 0;
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) total += await dirSize(full);
    else total += (await stat(full).catch(() => null))?.size ?? 0;
  }
  return total;
};

/** Every day kept on the disk, of every source, oldest first. */
export const scanLogDays = async (dir: string, sources: readonly LogSource[] = LOG_SOURCES): Promise<LogDay[]> => {
  const days: LogDay[] = [];
  for (const source of sources) {
    const folder = path.join(dir, SOURCE_DIRS[source]);
    for (const entry of await readdir(folder, { withFileTypes: true }).catch(() => [])) {
      if (source === 'dyadrr-job') {
        if (!entry.isDirectory() || !DAY.test(entry.name)) continue;
        const full = path.join(folder, entry.name);
        days.push({ source, day: entry.name, path: full, bytes: await dirSize(full) });
      } else {
        const day = entry.name.replace(/\.jsonl$/, '');
        if (!entry.isFile() || !entry.name.endsWith('.jsonl') || !DAY.test(day)) continue;
        const full = path.join(folder, entry.name);
        days.push({ source, day, path: full, bytes: (await stat(full).catch(() => null))?.size ?? 0 });
      }
    }
  }
  return days.sort((a, b) => a.day.localeCompare(b.day) || a.source.localeCompare(b.source));
};

/** The day `n` days before `day` (YYYY-MM-DD, UTC). */
export const daysBefore = (day: string, n: number): string => {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - n);
  return date.toISOString().slice(0, 10);
};

/**
 * What retention deletes: the days older than the last `days` (today included),
 * then, while the folder is over `maxBytes`, the oldest day left, of every
 * source. Today is never deleted, whatever its size.
 */
export const retentionPlan = (days: LogDay[], limits: RetentionLimits): LogDay[] => {
  const doomed = new Set<LogDay>();
  if (limits.days > 0) {
    const oldestKept = daysBefore(limits.today, limits.days - 1);
    for (const d of days) if (d.day < oldestKept && d.day < limits.today) doomed.add(d);
  }
  if (limits.maxBytes > 0) {
    let total = days.filter((d) => !doomed.has(d)).reduce((sum, d) => sum + d.bytes, 0);
    const remaining = [...new Set(days.filter((d) => !doomed.has(d) && d.day < limits.today).map((d) => d.day))].sort();
    for (const day of remaining) {
      if (total <= limits.maxBytes) break;
      for (const d of days) {
        if (d.day === day && !doomed.has(d)) {
          doomed.add(d);
          total -= d.bytes;
        }
      }
    }
  }
  return days.filter((d) => doomed.has(d));
};

/** Deletes what the plan says; returns what went. */
export const applyRetention = async (dir: string, limits: RetentionLimits): Promise<LogDay[]> => {
  const doomed = retentionPlan(await scanLogDays(dir), limits);
  for (const d of doomed) await rm(d.path, { recursive: true, force: true });
  return doomed;
};
