import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFile, mkdir, mkdtemp, readdir, readFile, rename, rm, utimes, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { describeEvent, jobEntries, keepJobLog } from './jobLogs.js';
import { readLogs } from './reader.js';
import { applyRetention, daysBefore, LogDay, retentionPlan, scanLogDays } from './retention.js';
import { fromRunnerLine, RunnerLogCollector, wholeLines } from './runnerLog.js';
import { DailyLog, fromPinoLine, levelName } from './store.js';

const withDir = async (run: (dir: string) => Promise<void>) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'wayfinderr-logs-'));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};

const lines = async (file: string) =>
  (await readFile(file, 'utf8'))
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l));

test('a pino line becomes an entry: ISO time, level by name, no pid or hostname', () => {
  const entry = fromPinoLine(
    JSON.stringify({ level: 40, time: Date.UTC(2026, 10, 6, 14, 3, 12, 481), pid: 1, hostname: 'x', msg: 'Merge ended', pairId: 'p1' })
  );
  assert.deepEqual(entry, {
    time: '2026-11-06T14:03:12.481Z',
    source: 'wayfinderr',
    level: 'warn',
    msg: 'Merge ended',
    pairId: 'p1',
  });
});

test('the setup code and lines that are not JSON stay out of the file', () => {
  assert.equal(fromPinoLine(JSON.stringify({ level: 40, time: 1, msg: 'code', setupCode: 'abc' })), null);
  assert.equal(fromPinoLine('not json'), null);
});

test('levels by name or pino number', () => {
  assert.equal(levelName(30), 'info');
  assert.equal(levelName(35), 'info');
  assert.equal(levelName(50), 'error');
  assert.equal(levelName('warn'), 'warn');
  assert.equal(levelName('nonsense'), 'info');
});

test('a day file per UTC day', () =>
  withDir(async (dir) => {
    const log = new DailyLog(dir, 'wayfinderr');
    log.append({ time: '2026-11-06T23:59:59.000Z', source: 'wayfinderr', level: 'info', msg: 'a' });
    log.append({ time: '2026-11-07T00:00:01.000Z', source: 'wayfinderr', level: 'info', msg: 'b' });
    log.close();
    assert.deepEqual((await readdir(path.join(dir, 'wayfinderr'))).sort(), ['2026-11-06.jsonl', '2026-11-07.jsonl']);
    assert.equal((await lines(path.join(dir, 'wayfinderr', '2026-11-07.jsonl')))[0].msg, 'b');
  }));

const day = (source: LogDay['source'], d: string, bytes: number): LogDay => ({ source, day: d, path: `/x/${source}/${d}`, bytes });

test('retention: the days past the limit go, today never', () => {
  const days = [day('wayfinderr', '2026-10-01', 10), day('wayfinderr', '2026-10-31', 10), day('dyadrr-job', '2026-11-01', 10)];
  const removed = retentionPlan(days, { days: 2, maxBytes: 0, today: '2026-11-01' });
  assert.deepEqual(removed.map((d) => d.day), ['2026-10-01']);
  // 0: forever
  assert.deepEqual(retentionPlan(days, { days: 0, maxBytes: 0, today: '2026-11-01' }), []);
  assert.equal(daysBefore('2026-03-01', 1), '2026-02-28');
});

test('retention: over the size limit, the oldest whole days go, of every source', () => {
  const days = [
    day('wayfinderr', '2026-10-29', 40),
    day('dyadrr-runner', '2026-10-29', 5),
    day('wayfinderr', '2026-10-30', 40),
    day('wayfinderr', '2026-11-01', 500),
  ];
  const removed = retentionPlan(days, { days: 0, maxBytes: 100, today: '2026-11-01' });
  // Today alone is over the limit: everything else goes, today stays
  assert.deepEqual(removed.map((d) => `${d.source}/${d.day}`), ['wayfinderr/2026-10-29', 'dyadrr-runner/2026-10-29', 'wayfinderr/2026-10-30']);
  const fits = retentionPlan(days.slice(0, 3), { days: 0, maxBytes: 50, today: '2026-11-01' });
  assert.deepEqual(fits.map((d) => d.day), ['2026-10-29', '2026-10-29']);
});

test('retention deletes files and job folders on the disk', () =>
  withDir(async (dir) => {
    await mkdir(path.join(dir, 'wayfinderr'), { recursive: true });
    await mkdir(path.join(dir, 'dyadrr-jobs', '2026-10-01'), { recursive: true });
    await writeFile(path.join(dir, 'wayfinderr', '2026-10-01.jsonl'), 'x\n');
    await writeFile(path.join(dir, 'wayfinderr', '2026-11-01.jsonl'), 'x\n');
    await writeFile(path.join(dir, 'dyadrr-jobs', '2026-10-01', 'a.log'), 'x\n');
    const removed = await applyRetention(dir, { days: 7, maxBytes: 0, today: '2026-11-01' });
    assert.equal(removed.length, 2);
    assert.deepEqual((await scanLogDays(dir)).map((d) => `${d.source}/${d.day}`), ['wayfinderr/2026-11-01']);
  }));

test('runner lines: whole lines only, JSON or not', () => {
  const { lines: whole, bytes } = wholeLines(Buffer.from('{"a":1}\n{"b":2}\n{"c":'));
  assert.deepEqual(whole, ['{"a":1}', '{"b":2}']);
  assert.equal(bytes, 16);
  const now = new Date('2026-11-06T00:00:00Z');
  assert.deepEqual(fromRunnerLine('{"time":"2026-11-06T14:03:12.481Z","level":"warn","msg":"exit code 20","job":"j1","code":"NO_MATCH"}', now), {
    time: '2026-11-06T14:03:12.481Z',
    source: 'dyadrr-runner',
    level: 'warn',
    msg: 'exit code 20',
    job: 'j1',
    code: 'NO_MATCH',
  });
  assert.equal(fromRunnerLine('garbage', now).msg, 'garbage');
});

const runnerLine = (msg: string, time = '2026-11-06T10:00:00.000Z') => JSON.stringify({ time, level: 'info', msg }) + '\n';

test('the runner log is read by offset, across a rotation and a restart', () =>
  withDir(async (dir) => {
    const jobs = path.join(dir, 'jobs');
    const logsDir = path.join(dir, 'logs');
    await mkdir(jobs);
    const current = path.join(jobs, 'dyadrr.runner.jsonl');
    const copied = path.join(logsDir, 'dyadrr-runner', '2026-11-06.jsonl');

    // No file yet (an older Dyadrr image): nothing
    assert.equal(await new RunnerLogCollector(jobs, logsDir).collect(), 0);

    await writeFile(current, runnerLine('one') + '{"time":"2026-11-06T10:00:01.000Z","msg":"tw');
    let collector = new RunnerLogCollector(jobs, logsDir);
    await collector.collect();
    collector.close();
    assert.deepEqual((await lines(copied)).map((l) => l.msg), ['one']);

    // The half line is finished, then the runner rotates and writes on
    await appendFile(current, 'o"}\n' + runnerLine('three'));
    await rename(current, path.join(jobs, 'dyadrr.runner.1.jsonl'));
    await writeFile(current, runnerLine('four'));
    // A new collector, as after a restart: it goes on from the saved offset
    collector = new RunnerLogCollector(jobs, logsDir);
    await collector.collect();
    await collector.collect();
    collector.close();
    assert.deepEqual((await lines(copied)).map((l) => l.msg), ['one', 'two', 'three', 'four']);
  }));

test('progress events in words', () => {
  assert.equal(describeEvent({ event: 'phase', phase: 'anchors' }), 'phase anchors');
  assert.equal(
    describeEvent({ event: 'progress', phase: 'checkpoints', done: 12, total: 40, outcomes: { consistent: 11, unmatched: 1, shifted: 0 } }),
    'checkpoints 12/40 · 11 consistent, 1 unmatched'
  );
  assert.equal(describeEvent({ event: 'progress', phase: 'merge', step: 2, steps: 2, percent: 45.4 }), 'merge step 2/2 45%');
  assert.equal(describeEvent({ event: 'end', decision: 'refused', exitCode: 20 }), 'end: refused, exit code 20');
});

test('a job log is kept with its pair, and read back as entries', () =>
  withDir(async (dir) => {
    const jobLog = path.join(dir, 'j1.log');
    await writeFile(
      jobLog,
      [
        { event: 'phase', phase: 'read', elapsedMs: 0 },
        { event: 'progress', phase: 'checkpoints', done: 1, total: 2, elapsedMs: 1000 },
        { event: 'end', decision: 'refused', exitCode: 20, elapsedMs: 2000 },
      ]
        .map((e) => JSON.stringify(e))
        .join('\n') + '\n'
    );
    const mtime = new Date('2026-11-06T10:00:02.000Z');
    await utimes(jobLog, mtime, mtime);
    const logsDir = path.join(dir, 'logs');
    const meta = await keepJobLog(
      logsDir,
      jobLog,
      { job: 'j1', pairId: 'p1', command: 'analyze', files: ['a.mkv', 'b.mkv'], exitCode: 20, decision: 'refused', code: 'NO_MATCH' },
      new Date('2026-11-06T10:00:04.000Z')
    );
    assert.equal(meta?.startedAt, '2026-11-06T10:00:00.000Z');
    const text = await readFile(path.join(logsDir, 'dyadrr-jobs', '2026-11-06', 'j1.log'), 'utf8');
    const entries = jobEntries(text, meta!, '2026-11-06');
    assert.deepEqual(
      entries.map((e) => [e.time, e.level, e.msg]),
      [
        ['2026-11-06T10:00:00.000Z', 'info', 'analyze: phase read'],
        ['2026-11-06T10:00:01.000Z', 'debug', 'analyze: checkpoints 1/2'],
        ['2026-11-06T10:00:02.000Z', 'warn', 'analyze: end: refused, exit code 20'],
        ['2026-11-06T10:00:04.000Z', 'warn', 'analyze ended: refused NO_MATCH, exit code 20'],
      ]
    );
    assert.ok(entries.every((e) => e.pairId === 'p1' && e.job === 'j1'));

    // No log (the job never started): nothing kept
    assert.equal(await keepJobLog(logsDir, path.join(dir, 'none.log'), { ...meta!, job: 'j2' }), null);
  }));

test('reading: newest first, filtered, page by page, across sources and days', () =>
  withDir(async (dir) => {
    const own = new DailyLog(dir, 'wayfinderr');
    const runner = new DailyLog(dir, 'dyadrr-runner');
    for (let i = 0; i < 5; i++) {
      own.append({ time: `2026-11-0${5 + (i % 2)}T10:00:0${i}.000Z`, source: 'wayfinderr', level: i === 3 ? 'error' : 'info', msg: `own ${i}`, pairId: i === 1 ? 'p1' : undefined });
    }
    runner.append({ time: '2026-11-06T10:00:02.500Z', source: 'dyadrr-runner', level: 'warn', msg: 'exit code 20', job: 'j9' });
    own.close();
    runner.close();

    const base = { sources: ['wayfinderr', 'dyadrr-runner'] as const, minLevel: 'trace' as const, limit: 2 };
    const first = await readLogs(dir, base);
    assert.deepEqual(first.entries.map((e) => e.msg), ['own 3', 'exit code 20']);
    const second = await readLogs(dir, { ...base, before: first.next });
    assert.deepEqual(second.entries.map((e) => e.msg), ['own 1', 'own 4']);
    const third = await readLogs(dir, { ...base, before: second.next });
    assert.deepEqual(third.entries.map((e) => e.msg), ['own 2', 'own 0']);
    assert.equal(third.next, null);

    assert.deepEqual((await readLogs(dir, { ...base, limit: 10, minLevel: 'warn' })).entries.map((e) => e.msg), ['own 3', 'exit code 20']);
    assert.deepEqual((await readLogs(dir, { ...base, limit: 10, q: 'EXIT' })).entries.map((e) => e.msg), ['exit code 20']);
    assert.deepEqual((await readLogs(dir, { ...base, limit: 10, pairId: 'p1' })).entries.map((e) => e.msg), ['own 1']);
    assert.deepEqual(
      (await readLogs(dir, { ...base, limit: 10, sources: ['wayfinderr'], from: Date.parse('2026-11-05T00:00:00Z'), to: Date.parse('2026-11-05T23:59:59Z') })).entries.map((e) => e.msg),
      ['own 4', 'own 2', 'own 0']
    );
  }));
