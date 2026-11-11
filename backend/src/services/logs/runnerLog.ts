import { mkdir, open, readFile, stat, writeFile } from 'fs/promises';
import path from 'path';
import { DailyLog, levelName, LogEntry, SOURCE_DIRS } from './store.js';

/**
 * Copies the Dyadrr runner's log into the history. The runner writes its lines to
 * `dyadrr.runner.jsonl` in the jobs folder (Dyadrr's docs/CONTAINER.md, "Log del
 * runner") and keeps only about the last MiB: past 1 MiB the file becomes
 * `dyadrr.runner.1.jsonl` and a new one starts. Read here by offset:
 *
 * - only whole lines: a last line without its line break is still being written;
 * - a file shorter than the offset, or another inode: rotated, so the rest of the
 *   old file (now `.1`) is read first, then the new one from the start;
 * - no file (a Dyadrr image from before the runner log): nothing to do.
 *
 * Where it got to is kept in logs/dyadrr-runner/.state.json, so a restart neither
 * loses nor repeats lines.
 */

const CURRENT = 'dyadrr.runner.jsonl';
const ROTATED = 'dyadrr.runner.1.jsonl';
// Read at most this much per file and pass: the runner writes a few lines a job
const MAX_READ = 4 * 1024 * 1024;

interface State {
  ino: number;
  offset: number;
}

/** A line of the runner's log as an entry of the history. */
export const fromRunnerLine = (line: string, now = new Date()): LogEntry => {
  try {
    const parsed = JSON.parse(line);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const { time, level, msg, source: _source, ...rest } = parsed as Record<string, unknown>;
      const date = typeof time === 'string' ? new Date(time) : now;
      return {
        time: (Number.isNaN(date.getTime()) ? now : date).toISOString(),
        source: 'dyadrr-runner',
        level: levelName(level),
        msg: typeof msg === 'string' ? msg : '',
        ...rest,
      };
    }
  } catch {
    // Not JSON: kept as it is
  }
  return { time: now.toISOString(), source: 'dyadrr-runner', level: 'warn', msg: line };
};

/** The whole lines of a chunk, and how many bytes they take (the rest waits). */
export const wholeLines = (chunk: Buffer): { lines: string[]; bytes: number } => {
  const end = chunk.lastIndexOf(0x0a);
  if (end < 0) return { lines: [], bytes: 0 };
  const lines = chunk
    .subarray(0, end)
    .toString('utf8')
    .split('\n')
    .map((l) => l.replace(/\r$/, ''))
    .filter((l) => l.trim());
  return { lines, bytes: end + 1 };
};

export class RunnerLogCollector {
  private log: DailyLog;
  private state: State | null | undefined;

  constructor(readonly jobsDir: string, readonly logsDir: string) {
    this.log = new DailyLog(logsDir, 'dyadrr-runner');
  }

  private get stateFile() {
    return path.join(this.logsDir, SOURCE_DIRS['dyadrr-runner'], '.state.json');
  }

  private async loadState(): Promise<State | null> {
    if (this.state !== undefined) return this.state;
    try {
      const parsed = JSON.parse(await readFile(this.stateFile, 'utf8'));
      this.state = Number.isInteger(parsed?.ino) && Number.isInteger(parsed?.offset) ? parsed : null;
    } catch {
      this.state = null;
    }
    return this.state ?? null;
  }

  private async saveState(state: State): Promise<void> {
    this.state = state;
    await mkdir(path.dirname(this.stateFile), { recursive: true });
    await writeFile(this.stateFile, JSON.stringify(state) + '\n');
  }

  /** Reads `file` from `offset`: the whole lines, appended to the history; returns the new offset. */
  private async readFrom(file: string, offset: number): Promise<number> {
    const handle = await open(file, 'r').catch(() => null);
    if (!handle) return offset;
    try {
      const { size } = await handle.stat();
      if (size <= offset) return offset;
      const length = Math.min(size - offset, MAX_READ);
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, offset);
      const { lines, bytes } = wholeLines(buffer.subarray(0, bytesRead));
      const now = new Date();
      for (const line of lines) this.log.append(fromRunnerLine(line, now));
      return offset + bytes;
    } finally {
      await handle.close();
    }
  }

  /** One pass: the lines written since the last one. Returns how many bytes were read. */
  async collect(): Promise<number> {
    const current = path.join(this.jobsDir, CURRENT);
    const info = await stat(current).catch(() => null);
    if (!info) return 0;
    const state = await this.loadState();
    let offset = 0;
    let read = 0;
    if (state && state.ino === info.ino && info.size >= state.offset) {
      offset = state.offset;
    } else {
      // Rotated since the last pass (or first pass ever): the rest of the old file first
      const rotated = path.join(this.jobsDir, ROTATED);
      const old = await stat(rotated).catch(() => null);
      if (old && (!state || old.ino === state.ino)) {
        const from = state && old.size >= state.offset ? state.offset : 0;
        read += (await this.readFrom(rotated, from)) - from;
      }
    }
    const next = await this.readFrom(current, offset);
    read += next - offset;
    if (!state || state.ino !== info.ino || state.offset !== next) await this.saveState({ ino: info.ino, offset: next });
    return read;
  }

  close(): void {
    this.log.close();
  }
}
