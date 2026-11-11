import { copyFile, mkdir, readFile, stat, writeFile } from 'fs/promises';
import path from 'path';
import { DyadrrEvent, parseLog } from '../merge/jobs.js';
import { dayOf, LevelName, LogEntry, SOURCE_DIRS } from './store.js';

/**
 * The log of a Dyadrr job (`<id>.log`: its `--progress json` events), kept in the
 * history before Wayfinderr removes the job's files, with what it was for.
 */
export interface JobLogMeta {
  job: string;
  pairId: string | null;
  command: 'analyze' | 'merge';
  files: string[];
  exitCode: number | null;
  decision: string | null;
  code: string | null; // the report's reason, if any
  startedAt: string; // the log's last write, less the last event's elapsedMs
  finishedAt: string;
}

const jobsDayDir = (logsDir: string, day: string) => path.join(logsDir, SOURCE_DIRS['dyadrr-job'], day);

/** Copies the job's log into today's folder, with its meta. Null when there is no log. */
export const keepJobLog = async (
  logsDir: string,
  logFile: string,
  meta: Omit<JobLogMeta, 'startedAt' | 'finishedAt'>,
  now = new Date()
): Promise<JobLogMeta | null> => {
  const info = await stat(logFile).catch(() => null);
  if (!info) return null;
  const { events } = parseLog(await readFile(logFile, 'utf8'));
  const elapsed = Math.max(0, ...events.map((e) => (typeof e.elapsedMs === 'number' ? e.elapsedMs : 0)));
  const full: JobLogMeta = {
    ...meta,
    startedAt: new Date(info.mtimeMs - elapsed).toISOString(),
    finishedAt: now.toISOString(),
  };
  const dir = jobsDayDir(logsDir, dayOf(now));
  await mkdir(dir, { recursive: true });
  await copyFile(logFile, path.join(dir, `${meta.job}.log`));
  await writeFile(path.join(dir, `${meta.job}.meta.json`), JSON.stringify(full, null, 2) + '\n');
  return full;
};

const plural = (n: number, word: string) => `${n} ${word}`;

/** A progress event in words: the phase, how far, the checkpoints by outcome. */
export const describeEvent = (event: DyadrrEvent): string => {
  if (event.event === 'phase') return `phase ${event.phase ?? '?'}`;
  if (event.event === 'end') return `end: ${event.decision ?? '?'}, exit code ${event.exitCode ?? '?'}`;
  if (event.event === 'progress') {
    const parts = [event.phase ?? 'progress'];
    if (typeof event.step === 'number') {
      parts.push(`step ${event.step}/${event.steps ?? '?'}`);
      if (typeof event.percent === 'number') parts.push(`${Math.round(event.percent)}%`);
    } else if (typeof event.done === 'number') {
      parts.push(event.total ? `${event.done}/${event.total}` : `${event.done}`);
    }
    const outcomes = event.outcomes as Record<string, number> | undefined;
    if (outcomes && typeof outcomes === 'object') {
      const counts = Object.entries(outcomes).filter(([, n]) => typeof n === 'number' && n > 0);
      if (counts.length) parts.push(`· ${counts.map(([k, n]) => plural(n, k)).join(', ')}`);
    }
    return parts.join(' ');
  }
  return event.event;
};

const eventLevel = (event: DyadrrEvent): LevelName => {
  if (event.event === 'progress') return 'debug';
  if (event.event === 'end') {
    if (event.decision === 'error') return 'error';
    if (event.decision === 'refused' || event.decision === 'cancelled') return 'warn';
  }
  return 'info';
};

/**
 * The job's log as entries of the history: each event at the job's start plus its
 * elapsedMs (progress at debug), and a line that is not an event (Dyadrr could not
 * write a report) as an error at the end.
 */
export const jobEntries = (text: string, meta: JobLogMeta, day: string): (LogEntry & { id: string })[] => {
  const start = Date.parse(meta.startedAt);
  const end = Date.parse(meta.finishedAt);
  const entries: (LogEntry & { id: string })[] = [];
  text.split('\n').forEach((raw, lineNo) => {
    const line = raw.replace(/\r$/, '');
    if (!line.trim()) return;
    const id = `dyadrr-job:${day}:${meta.job}:${String(lineNo).padStart(7, '0')}`;
    const base = { job: meta.job, pairId: meta.pairId, command: meta.command };
    const [event] = parseLog(line).events;
    if (event) {
      const at = typeof event.elapsedMs === 'number' && Number.isFinite(start) ? start + event.elapsedMs : end;
      entries.push({
        id,
        time: new Date(at).toISOString(),
        source: 'dyadrr-job',
        level: eventLevel(event),
        msg: `${meta.command}: ${describeEvent(event)}`,
        ...base,
        event,
      });
    } else {
      entries.push({ id, time: meta.finishedAt, source: 'dyadrr-job', level: 'error', msg: `${meta.command}: ${line}`, ...base });
    }
  });
  // The outcome as Wayfinderr read it: one line, with the reason's code
  entries.push({
    id: `dyadrr-job:${day}:${meta.job}:9999999`,
    time: meta.finishedAt,
    source: 'dyadrr-job',
    level: meta.decision === 'error' ? 'error' : meta.decision === 'eligible' ? 'info' : 'warn',
    msg: `${meta.command} ended: ${meta.decision ?? 'no report'}${meta.code ? ` ${meta.code}` : ''}${meta.exitCode !== null ? `, exit code ${meta.exitCode}` : ''}`,
    job: meta.job,
    pairId: meta.pairId,
    command: meta.command,
    files: meta.files,
    code: meta.code,
  });
  return entries;
};
