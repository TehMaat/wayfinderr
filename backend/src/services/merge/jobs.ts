import { randomUUID } from 'crypto';
import { chmod, mkdir, readFile, rename, rm, stat, writeFile } from 'fs/promises';
import path from 'path';

/**
 * Talks to the runner in the Dyadrr container (ghcr.io/tehmaat/dyadrr) through
 * the watch folder, the folder both containers see. Dyadrr merges the Italian
 * audio of one rip into the better video of another, without re-encoding; its
 * file job protocol is in Dyadrr's docs/CONTAINER.md:
 *
 *   <id>.job     written here: command, inputs, output and options (key=value lines)
 *   <id>.run     the runner renamed .job to claim it (one job at a time)
 *   <id>.log     Dyadrr's stderr as it runs: one JSON progress event per line
 *   <id>.json    the report (Dyadrr's contract: the caller decides from `decision` only)
 *   <id>.exit    the exit code, written last: when it is there, so is the report
 *   <id>.cancel  written here to stop the job (the runner sends SIGTERM once)
 *   dyadrr.alive epoch seconds, rewritten by the runner every 5 s
 *
 * The runner never deletes a job's files: they are removed here once .exit is read.
 *
 * Paths in a job are relative to the container's /data, starting with the name of
 * the mounted folder: the watch folder is `watch`, the downloads `downloads`
 * (`watch/Film (2).mkv`). Each side swaps that name for its own path of the folder.
 */

export type DyadrrCommand = 'analyze' | 'merge';

// The user's choices (Dyadrr's docs/CLI.md, "Scelte"): always passed, so the report
// records the value used
export interface DyadrrChoices {
  tail?: 'trim' | 'keep';
  italian?: 'all' | 'main';
  referenceItalianSubs?: 'keep' | 'drop';
  edgeMismatch?: 'drop' | 'keep';
}

export interface DyadrrJob extends DyadrrChoices {
  command: DyadrrCommand;
  inputs: [string, string]; // paths as this container sees them
  output?: string; // merge only: the final file
  expect?: string; // merge only: the confirmed analyze report
  tempDir?: string;
  originalLanguage?: string; // ISO 639-1 or 639-2, from TMDB
}

// A folder shared with the Dyadrr container, mounted there as /data/<name>
export interface SharedFolder {
  name: string; // watch | downloads
  dir: string; // this container's path of the folder
}

export type DyadrrDecision = 'eligible' | 'refused' | 'error' | 'cancelled';

// The report fields read here; the rest is kept as it is
export interface DyadrrReport {
  format: number;
  dyadrr: string | null;
  mode: DyadrrCommand | null;
  decision: DyadrrDecision;
  reasons: { code: string; message: string }[];
  warnings?: { code: string; message: string; source?: string }[];
  [field: string]: unknown;
}

// One line of `--progress json` (Dyadrr's docs/REPORT.md, "Avanzamento")
export interface DyadrrEvent {
  event: 'phase' | 'progress' | 'end' | string;
  phase?: string;
  elapsedMs?: number;
  done?: number;
  total?: number | null;
  step?: number;
  steps?: number;
  percent?: number | null;
  decision?: DyadrrDecision;
  exitCode?: number;
  [field: string]: unknown;
}

export type DyadrrJobState =
  | { state: 'queued' }
  | { state: 'running' }
  | { state: 'done'; exitCode: number }
  | { state: 'missing' };

// The container counts as stopped when dyadrr.alive is older than this (six missed writes)
export const ALIVE_LIMIT_S = 30;

// Exit codes (Dyadrr's docs/CODICI.md): anything else is an error
export const EXIT_CODES: Record<number, DyadrrDecision> = {
  0: 'eligible',
  20: 'refused',
  30: 'error',
  40: 'error',
  50: 'cancelled',
};

const DECISIONS: DyadrrDecision[] = ['eligible', 'refused', 'error', 'cancelled'];
const JOB_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const JOB_FILES = ['job', 'run', 'log', 'json', 'exit', 'cancel'];

const exists = (file: string) =>
  stat(file).then(
    () => true,
    () => false
  );

const noLineBreak = (key: string, value: string) => {
  if (/[\r\n]/.test(value)) throw new Error(`Invalid ${key}: line break`);
  return value;
};

/**
 * How a job ended: the report's decision, or an error when the report is missing,
 * unreadable or says something else.
 */
export const jobOutcome = (report: DyadrrReport | null): DyadrrDecision =>
  report && DECISIONS.includes(report.decision) ? report.decision : 'error';

/** Parses the job's log: the progress events, and any line that is not one. */
export const parseLog = (text: string): { events: DyadrrEvent[]; messages: string[] } => {
  const events: DyadrrEvent[] = [];
  const messages: string[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed && typeof parsed === 'object' && typeof parsed.event === 'string') {
        events.push(parsed as DyadrrEvent);
        continue;
      }
    } catch {
      // Not JSON: Dyadrr could not write a report, or could not read its arguments
    }
    messages.push(line);
  }
  return { events, messages };
};

/** Where a job is: the last phase, and the last progress event of that phase. */
export const currentProgress = (events: DyadrrEvent[]) => {
  let phase: string | null = null;
  let progress: DyadrrEvent | null = null;
  let end: DyadrrEvent | null = null;
  for (const event of events) {
    if (event.event === 'phase') {
      phase = event.phase ?? null;
      progress = null;
    } else if (event.event === 'progress') {
      phase = event.phase ?? phase;
      progress = event;
    } else if (event.event === 'end') {
      end = event;
    }
  }
  return { phase, progress, end };
};

export class DyadrrJobs {
  constructor(
    // This container's path of /data/watch/.wayfinderr/dyadrr/jobs
    readonly jobsDir: string,
    readonly folders: SharedFolder[]
  ) {}

  private file(id: string, ext: string) {
    if (!JOB_ID.test(id)) throw new Error(`Invalid job id: ${id}`);
    return path.join(this.jobsDir, `${id}.${ext}`);
  }

  /** A path of this container as the job writes it: `watch/Film (2).mkv`. */
  toJobPath(hostPath: string): string {
    const resolved = path.resolve(hostPath);
    // The most specific folder first: the downloads may sit inside the watch folder
    const folders = [...this.folders].sort((a, b) => path.resolve(b.dir).length - path.resolve(a.dir).length);
    for (const folder of folders) {
      const relative = path.relative(path.resolve(folder.dir), resolved);
      if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) continue;
      return noLineBreak('path', [folder.name, ...relative.split(path.sep)].join('/'));
    }
    throw new Error(`Not in a folder shared with Dyadrr: ${hostPath}`);
  }

  /** A path of the Dyadrr container (`/data/watch/…` in a report, or `watch/…`) as this one sees it. */
  fromJobPath(jobPath: string): string | null {
    const relative = jobPath.replace(/^\/data\//, '');
    const [name, ...rest] = relative.split('/');
    const folder = this.folders.find((f) => f.name === name);
    if (!folder || rest.length === 0 || rest.some((part) => !part || part === '.' || part === '..')) return null;
    return path.join(folder.dir, ...rest);
  }

  /** The job file's lines: the options of Dyadrr's command line, without the dashes. */
  jobLines(job: DyadrrJob): string[] {
    const lines = [`command=${job.command}`, ...job.inputs.map((input) => `input=${this.toJobPath(input)}`)];
    const paths: [string, string | undefined][] = [
      ['output', job.output],
      ['temp-dir', job.tempDir],
      ['expect', job.expect],
    ];
    for (const [key, value] of paths) {
      if (value !== undefined) lines.push(`${key}=${this.toJobPath(value)}`);
    }
    const values: [string, string | undefined][] = [
      ['original-language', job.originalLanguage],
      ['tail', job.tail],
      ['italian', job.italian],
      ['reference-italian-subs', job.referenceItalianSubs],
      ['edge-mismatch', job.edgeMismatch],
    ];
    for (const [key, value] of values) {
      if (value !== undefined) lines.push(`${key}=${noLineBreak(key, value)}`);
    }
    // Wayfinderr deletes the inputs itself, after a verified merge (its own files and records)
    if (job.command === 'merge') lines.push('inputs=keep');
    return lines;
  }

  /** Creates the jobs folder if the runner has not yet. */
  async ensureJobsDir(): Promise<void> {
    if (await exists(this.jobsDir)) return;
    await mkdir(this.jobsDir, { recursive: true });
    await chmod(this.jobsDir, 0o777);
  }

  /** Writes the job and returns its id. */
  async submit(job: DyadrrJob): Promise<string> {
    const content = this.jobLines(job).join('\n') + '\n';
    const id = randomUUID();
    await this.ensureJobsDir();
    // Written under a name the runner ignores (it starts with a dot), then renamed:
    // the runner never reads half a job
    const temp = path.join(this.jobsDir, `.${id}.tmp`);
    await writeFile(temp, content, { mode: 0o666 });
    await rename(temp, this.file(id, 'job'));
    return id;
  }

  async state(id: string): Promise<DyadrrJobState> {
    const exit = await readFile(this.file(id, 'exit'), 'utf8').catch(() => null);
    if (exit !== null) {
      const code = Number(exit.trim());
      return { state: 'done', exitCode: exit.trim() !== '' && Number.isInteger(code) ? code : 255 };
    }
    if (await exists(this.file(id, 'run'))) return { state: 'running' };
    if (await exists(this.file(id, 'job'))) return { state: 'queued' };
    return { state: 'missing' };
  }

  /** The report, once .exit is there; null when missing or unreadable. */
  async report(id: string): Promise<DyadrrReport | null> {
    const text = await readFile(this.file(id, 'json'), 'utf8').catch(() => null);
    if (text === null) return null;
    try {
      const report = JSON.parse(text);
      return report && typeof report === 'object' ? (report as DyadrrReport) : null;
    } catch {
      return null;
    }
  }

  async log(id: string) {
    return parseLog(await readFile(this.file(id, 'log'), 'utf8').catch(() => ''));
  }

  /**
   * Stops the job: a queued one is closed as cancelled by the runner without
   * running Dyadrr, a running one gets SIGTERM. Either way .exit follows.
   */
  async cancel(id: string): Promise<void> {
    await writeFile(this.file(id, 'cancel'), '', { mode: 0o666 });
  }

  /**
   * Takes back a job the runner has not claimed yet (it runs one job at a time, so a
   * job can wait behind a long one): true when withdrawn, false when the runner got it
   * first. Both sides rename the .job, so only one of them can win.
   */
  async withdraw(id: string): Promise<boolean> {
    const taken = path.join(this.jobsDir, `.${id}.withdrawn`);
    try {
      await rename(this.file(id, 'job'), taken);
    } catch {
      return false;
    }
    await rm(taken, { force: true });
    await this.remove(id);
    return true;
  }

  /** Removes the job's files, once its .exit has been read (or it never started). */
  async remove(id: string): Promise<void> {
    for (const ext of JOB_FILES) await rm(this.file(id, ext), { force: true });
  }

  /** Seconds since the runner last wrote dyadrr.alive, or null if it never did. */
  async lastSeen(now = Date.now()): Promise<number | null> {
    const text = await readFile(path.join(this.jobsDir, 'dyadrr.alive'), 'utf8').catch(() => null);
    const seconds = Number(text?.trim());
    return text !== null && Number.isFinite(seconds) && seconds > 0 ? Math.max(0, Math.round(now / 1000 - seconds)) : null;
  }

  async alive(now = Date.now()): Promise<boolean> {
    const seen = await this.lastSeen(now);
    return seen !== null && seen <= ALIVE_LIMIT_S;
  }
}
