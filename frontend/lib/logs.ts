// The log history (backend services/logs): one file a day per source, in the data volume

export const LOG_SOURCES = [
  { value: 'wayfinderr', label: 'Wayfinderr', hint: 'The backend' },
  { value: 'dyadrr-runner', label: 'Dyadrr runner', hint: 'The dyadrr container: jobs taken, exit codes, start and stop' },
  { value: 'dyadrr-job', label: 'Dyadrr jobs', hint: 'The analyses and merges, phase by phase' },
] as const;
export type LogSource = (typeof LOG_SOURCES)[number]['value'];

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export interface LogEntry {
  id: string;
  time: string;
  source: LogSource;
  level: LogLevel;
  msg: string;
  [field: string]: unknown;
}

export interface LogPage {
  entries: LogEntry[];
  next: string | null;
}

export interface LogQuery {
  source?: LogSource[];
  level?: LogLevel;
  q?: string;
  from?: string; // YYYY-MM-DD or ISO
  to?: string;
  before?: string | null;
  limit?: number;
  pair?: string;
  job?: string;
}

export interface LogsInfo {
  retentionDays: number; // 0: forever
  maxSizeMb: number; // 0: no limit
  usedBytes: number;
  oldestDay: string | null;
  days: string[]; // newest first
  sources: Record<LogSource, { bytes: number; oldestDay: string | null; days: number }>;
}

export const sourceLabel = (source: string) => LOG_SOURCES.find((s) => s.value === source)?.label ?? source;

// The structured fields of an entry: everything but what the row already shows
const SHOWN = new Set(['id', 'time', 'source', 'level', 'msg']);
export const entryFields = (entry: LogEntry) => Object.fromEntries(Object.entries(entry).filter(([k]) => !SHOWN.has(k)));

/** Local date as YYYY-MM-DD */
export const localDay = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

/** "16:31:02.481" in local time */
export const formatLogTime = (iso: string) => {
  const d = new Date(iso);
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
};
