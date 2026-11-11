import path from 'path';
import { config } from '../../config/index.js';
import logger from '../../config/logger.js';
import { JobLogMeta, keepJobLog } from './jobLogs.js';
import { LogQuery, readLogs } from './reader.js';
import { applyRetention, scanLogDays } from './retention.js';
import { RunnerLogCollector } from './runnerLog.js';
import { dayOf, LOG_SOURCES, LogSource } from './store.js';

export { LOG_SOURCES } from './store.js';
export type { LogSource } from './store.js';

// The Dyadrr runner's log is read this often (it writes a few lines a job)
const COLLECT_MS = 5_000;
// Retention: at the start, then once a day
const RETENTION_MS = 24 * 60 * 60 * 1000;
const MB = 1024 * 1024;

/**
 * The log history (TehMaat/wayfinderr#54): the backend's own log (written by the
 * logger, config/logger.ts), the Dyadrr runner's, and the Dyadrr jobs' logs, in
 * day files under LOG_DIR, deleted by LOG_RETENTION_DAYS and LOG_MAX_SIZE_MB.
 */
class LogService {
  readonly dir = config.LOGS.DIR;
  private runner = new RunnerLogCollector(config.MERGE.JOBS_DIR, this.dir);
  private collectTimer: NodeJS.Timeout | null = null;
  private retentionTimer: NodeJS.Timeout | null = null;
  private collecting = false;

  start(): void {
    if (this.collectTimer) return;
    this.retention().catch((error) => logger.error({ error }, 'log retention failed'));
    this.retentionTimer = setInterval(
      () => this.retention().catch((error) => logger.error({ error }, 'log retention failed')),
      RETENTION_MS
    );
    this.collectTimer = setInterval(() => this.collectRunner(), COLLECT_MS);
    this.collectRunner();
  }

  stop(): void {
    if (this.collectTimer) clearInterval(this.collectTimer);
    if (this.retentionTimer) clearInterval(this.retentionTimer);
    this.collectTimer = this.retentionTimer = null;
    this.runner.close();
  }

  private collectRunner(): void {
    if (this.collecting) return;
    this.collecting = true;
    this.runner
      .collect()
      .catch((error) => logger.warn({ error }, 'The Dyadrr runner log could not be read'))
      .finally(() => (this.collecting = false));
  }

  get limits() {
    return { days: config.LOGS.RETENTION_DAYS, maxBytes: config.LOGS.MAX_SIZE_MB * MB };
  }

  /** Deletes the days past the limits, and says so in the log. */
  async retention(): Promise<void> {
    const removed = await applyRetention(this.dir, { ...this.limits, today: dayOf(Date.now()) });
    if (!removed.length) return;
    logger.info(
      {
        removed: removed.map((d) => `${d.source}/${d.day}`),
        bytes: removed.reduce((sum, d) => sum + d.bytes, 0),
        retentionDays: config.LOGS.RETENTION_DAYS,
        maxSizeMb: config.LOGS.MAX_SIZE_MB,
      },
      `log retention: removed ${removed.length} day file(s), ${removed[0].day} to ${removed[removed.length - 1].day}`
    );
  }

  /** The retention in force, the space taken and the oldest day kept, per source too. */
  async info() {
    const days = await scanLogDays(this.dir);
    const sources = Object.fromEntries(
      LOG_SOURCES.map((source) => {
        const own = days.filter((d) => d.source === source);
        return [source, { bytes: own.reduce((sum, d) => sum + d.bytes, 0), oldestDay: own[0]?.day ?? null, days: own.length }];
      })
    ) as Record<LogSource, { bytes: number; oldestDay: string | null; days: number }>;
    return {
      retentionDays: config.LOGS.RETENTION_DAYS,
      maxSizeMb: config.LOGS.MAX_SIZE_MB,
      usedBytes: days.reduce((sum, d) => sum + d.bytes, 0),
      oldestDay: days[0]?.day ?? null,
      days: [...new Set(days.map((d) => d.day))].sort().reverse(),
      sources,
    };
  }

  query(query: LogQuery) {
    return readLogs(this.dir, query);
  }

  /** Keeps a Dyadrr job's log before its files are removed (merge/pairs.ts). */
  async keepDyadrrJob(meta: Omit<JobLogMeta, 'startedAt' | 'finishedAt'>): Promise<void> {
    try {
      await keepJobLog(this.dir, path.join(config.MERGE.JOBS_DIR, `${meta.job}.log`), meta);
    } catch (error) {
      // The job's outcome is in the pair either way: only its log is lost
      logger.warn({ error, job: meta.job, pairId: meta.pairId }, 'The Dyadrr job log could not be kept');
    }
  }
}

export const logs = new LogService();
