import { closeSync, mkdirSync, openSync, writeSync } from 'fs';
import path from 'path';

/**
 * The log history on disk (TehMaat/wayfinderr#54), in the data volume:
 *
 *   logs/wayfinderr/<YYYY-MM-DD>.jsonl      the backend's own log (pino), one event a line
 *   logs/dyadrr-runner/<YYYY-MM-DD>.jsonl   the Dyadrr runner's lines, copied from dyadrr.runner.jsonl
 *   logs/dyadrr-jobs/<YYYY-MM-DD>/<id>.log  a Dyadrr job's log (--progress json), kept before its files go,
 *   logs/dyadrr-jobs/<YYYY-MM-DD>/<id>.meta.json  with the pair it was for
 *
 * One file (or folder) a day per source, by the UTC date of its events: retention
 * deletes whole days, and reading a period opens only the days asked for.
 *
 * Nothing here logs through pino: the backend's logger writes through this module.
 */

export const LOG_SOURCES = ['wayfinderr', 'dyadrr-runner', 'dyadrr-job'] as const;
export type LogSource = (typeof LOG_SOURCES)[number];

// The folder of each source under logs/
export const SOURCE_DIRS: Record<LogSource, string> = {
  wayfinderr: 'wayfinderr',
  'dyadrr-runner': 'dyadrr-runner',
  'dyadrr-job': 'dyadrr-jobs',
};

export const LEVELS = { trace: 10, debug: 20, info: 30, warn: 40, error: 50, fatal: 60 } as const;
export type LevelName = keyof typeof LEVELS;

export const levelName = (value: unknown): LevelName => {
  if (typeof value === 'string' && value in LEVELS) return value as LevelName;
  if (typeof value === 'number') {
    const found = (Object.entries(LEVELS) as [LevelName, number][]).reverse().find(([, n]) => value >= n);
    return found ? found[0] : 'trace';
  }
  return 'info';
};

/** One line of the history: when, where from, how bad, what; then the structured fields. */
export interface LogEntry {
  time: string; // ISO 8601, UTC
  source: LogSource;
  level: LevelName;
  msg: string;
  [field: string]: unknown;
}

export const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The UTC day of a time: the file it goes in. */
export const dayOf = (time: Date | number | string): string => new Date(time).toISOString().slice(0, 10);

/**
 * Appends lines to the day files of one source, synchronously (like pino's own
 * stdout): a line is on the disk when the call returns. A disk that is full or
 * read-only never stops the backend: the line is lost from the file only (it is
 * still on stdout), said once on stderr until a write works again.
 */
export class DailyLog {
  private fd: number | null = null;
  private day: string | null = null;
  private failing = false;

  constructor(readonly dir: string, readonly source: LogSource) {}

  get folder() {
    return path.join(this.dir, SOURCE_DIRS[this.source]);
  }

  append(entry: LogEntry): void {
    const day = dayOf(entry.time);
    try {
      if (this.day !== day || this.fd === null) {
        this.close();
        mkdirSync(this.folder, { recursive: true });
        this.fd = openSync(path.join(this.folder, `${day}.jsonl`), 'a');
        this.day = day;
      }
      writeSync(this.fd, JSON.stringify(entry) + '\n');
      this.failing = false;
    } catch (error) {
      this.close();
      if (!this.failing) {
        this.failing = true;
        process.stderr.write(`wayfinderr: the ${this.source} log file cannot be written: ${(error as Error).message}\n`);
      }
    }
  }

  close(): void {
    if (this.fd !== null) {
      try {
        closeSync(this.fd);
      } catch {
        // Already closed
      }
    }
    this.fd = null;
    this.day = null;
  }
}

// pino's own fields that say nothing in the history
const PINO_DROPPED = new Set(['pid', 'hostname', 'v']);

/**
 * A pino line as an entry of the history: ISO time, level by name, source. Null for
 * a line that must stay out of the file: the setup code (on stdout only, for
 * `docker logs` at the first login) or a line that is not JSON.
 */
export const fromPinoLine = (line: string): LogEntry | null => {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || 'setupCode' in parsed) return null;
  const { time, level, msg, ...rest } = parsed;
  const fields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rest)) if (!PINO_DROPPED.has(key)) fields[key] = value;
  const date = new Date(typeof time === 'number' || typeof time === 'string' ? time : Date.now());
  return {
    time: (Number.isNaN(date.getTime()) ? new Date() : date).toISOString(),
    source: 'wayfinderr',
    level: levelName(level),
    msg: typeof msg === 'string' ? msg : '',
    ...fields,
  };
};

/** The stream pino writes to besides stdout: the backend's day files. */
export const pinoFileStream = (dir: string) => {
  const log = new DailyLog(dir, 'wayfinderr');
  return {
    write(line: string) {
      const entry = fromPinoLine(line);
      if (entry) log.append(entry);
    },
    close: () => log.close(),
  };
};
