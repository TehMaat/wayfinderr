import { randomBytes } from 'crypto';
import { chmod, mkdir, open, readdir, readFile, rename, rm, stat, writeFile } from 'fs/promises';
import path from 'path';
import { config } from '../../config/index.js';

/**
 * Talks to the runner service in the MakeMKV container (makemkv/rootfs) through
 * the shared work folder, the only thing both containers see:
 *
 *   jobs/<id>.job     written here: action, source and options (key=value lines)
 *   jobs/<id>.run     the runner renamed .job to claim it
 *   jobs/<id>.log     makemkvcon robot output (-r), as it runs
 *   jobs/<id>.exit    makemkvcon exit code: the job is over
 *   jobs/<id>.cancel  written here to stop a job
 *   rips/<id>/        the .mkv files of an `mkv` job
 *   runner.alive      epoch seconds, rewritten by the runner every few seconds
 *
 * Sources are relative to the downloads folder: each container adds its own root.
 */

export interface RunnerJob {
  action: 'info' | 'mkv';
  source: string; // "iso:<relative path>" or "file:<relative path>"
  minLength: number; // seconds; must be the same for info and mkv, it changes title numbers
  title?: number; // mkv only
  selection?: string; // mkv only: MakeMKV track selection rule
}

export type JobState = { state: 'queued' } | { state: 'running' } | { state: 'done'; exitCode: number } | { state: 'missing' };

const ALIVE_MS = 60_000;

const jobsDir = () => path.join(config.RIP.WORK_DIR, 'jobs');
const jobFile = (id: string, ext: string) => path.join(jobsDir(), `${id}.${ext}`);
const exists = (file: string) =>
  stat(file).then(
    () => true,
    () => false
  );

export const ripDir = (id: string) => path.join(config.RIP.WORK_DIR, 'rips', id);

/**
 * Creates the work folders if the runner has not yet. They must stay writable
 * by the runner, which runs as the MakeMKV container's user, not as root.
 */
export const ensureWorkDirs = async () => {
  for (const dir of [config.RIP.WORK_DIR, jobsDir(), path.join(config.RIP.WORK_DIR, 'rips')]) {
    if (!(await exists(dir))) {
      await mkdir(dir, { recursive: true });
      await chmod(dir, 0o777);
    }
  }
};

/** Seconds since the runner last checked in, or null if it never did. */
export const runnerLastSeen = async (): Promise<number | null> => {
  const text = await readFile(path.join(config.RIP.WORK_DIR, 'runner.alive'), 'utf8').catch(() => null);
  const seconds = Number(text?.trim());
  return Number.isFinite(seconds) && seconds > 0 ? Math.max(0, Math.round(Date.now() / 1000 - seconds)) : null;
};

export const runnerAlive = async () => {
  const seen = await runnerLastSeen();
  return seen !== null && seen * 1000 < ALIVE_MS;
};

export const submitJob = async (job: RunnerJob): Promise<string> => {
  const lines = Object.entries(job)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => {
      if (/[\r\n]/.test(String(value))) throw new Error(`Invalid ${key}: line break`);
      return `${key}=${value}`;
    });
  const id = `${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`;
  await ensureWorkDirs();
  // Written under another name, then renamed: the runner never sees half a job
  const temp = jobFile(id, 'tmp');
  await writeFile(temp, lines.join('\n') + '\n', { mode: 0o666 });
  await rename(temp, jobFile(id, 'job'));
  return id;
};

export const jobState = async (id: string): Promise<JobState> => {
  const exit = await readFile(jobFile(id, 'exit'), 'utf8').catch(() => null);
  if (exit !== null) {
    const code = Number(exit.trim());
    return { state: 'done', exitCode: Number.isFinite(code) ? code : 255 };
  }
  if (await exists(jobFile(id, 'run'))) return { state: 'running' };
  if (await exists(jobFile(id, 'job'))) return { state: 'queued' };
  return { state: 'missing' };
};

/** The job's output so far; with maxBytes, only its end. */
export const readJobLog = async (id: string, maxBytes?: number): Promise<string> => {
  const file = jobFile(id, 'log');
  if (!maxBytes) return readFile(file, 'utf8').catch(() => '');
  const handle = await open(file, 'r').catch(() => null);
  if (!handle) return '';
  try {
    const { size } = await handle.stat();
    const length = Math.min(size, maxBytes);
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, size - length);
    return buffer.toString('utf8');
  } finally {
    await handle.close();
  }
};

export const cancelJob = async (id: string) => {
  // The runner checks for .cancel before and while running a job
  await writeFile(jobFile(id, 'cancel'), '', { mode: 0o666 }).catch(() => undefined);
  await rm(jobFile(id, 'job'), { force: true });
};

/** Removes the job's files and its output folder. */
export const removeJob = async (id: string) => {
  for (const ext of ['job', 'run', 'log', 'exit', 'cancel', 'tmp']) {
    await rm(jobFile(id, ext), { force: true });
  }
  await rm(ripDir(id), { recursive: true, force: true });
};

/** The .mkv files an `mkv` job produced. */
export const jobOutputs = async (id: string): Promise<string[]> =>
  (await readdir(ripDir(id)).catch(() => []))
    .filter((name) => name.toLowerCase().endsWith('.mkv'))
    .map((name) => path.join(ripDir(id), name));
