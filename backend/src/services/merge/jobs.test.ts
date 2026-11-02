import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { currentProgress, DyadrrJobs, jobOutcome, parseLog, type DyadrrReport } from './jobs.js';

const withJobs = async (run: (jobs: DyadrrJobs, root: string) => Promise<void>) => {
  const root = await mkdtemp(path.join(tmpdir(), 'wayfinderr-dyadrr-'));
  try {
    const watch = path.join(root, 'watch');
    const jobs = new DyadrrJobs(path.join(watch, '.wayfinderr', 'dyadrr', 'jobs'), [
      { name: 'watch', dir: watch },
      { name: 'downloads', dir: path.join(root, 'downloads') },
    ]);
    await run(jobs, root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
};

const fakeJobs = (watch = '/makemkv-output', downloads = '/downloads') =>
  new DyadrrJobs('/unused', [
    { name: 'watch', dir: watch },
    { name: 'downloads', dir: downloads },
  ]);

test('paths become relative to /data, starting with the folder name', () => {
  const jobs = fakeJobs();
  assert.equal(jobs.toJobPath('/makemkv-output/Film (2).mkv'), 'watch/Film (2).mkv');
  assert.equal(jobs.toJobPath('/makemkv-output/Sub/Film = 2.mkv'), 'watch/Sub/Film = 2.mkv');
  assert.equal(jobs.toJobPath('/downloads/Film/Film.mkv'), 'downloads/Film/Film.mkv');
  assert.equal(jobs.toJobPath('/downloads/.wayfinderr/Film/Film.mkv'), 'downloads/.wayfinderr/Film/Film.mkv');
});

test('a path outside the shared folders, or a folder itself, is refused', () => {
  const jobs = fakeJobs();
  assert.throws(() => jobs.toJobPath('/tmp/Film.mkv'), /Not in a folder shared/);
  assert.throws(() => jobs.toJobPath('/makemkv-output'), /Not in a folder shared/);
  assert.throws(() => jobs.toJobPath('/makemkv-output-2/Film.mkv'), /Not in a folder shared/);
  assert.throws(() => jobs.toJobPath('/makemkv-output/a\nb.mkv'), /line break/);
});

test('the most specific folder wins when one is inside the other', () => {
  const jobs = fakeJobs('/media', '/media/downloads');
  assert.equal(jobs.toJobPath('/media/downloads/Film.mkv'), 'downloads/Film.mkv');
  assert.equal(jobs.toJobPath('/media/Film.mkv'), 'watch/Film.mkv');
});

test("the report's container paths map back to this container's", () => {
  const jobs = fakeJobs();
  assert.equal(jobs.fromJobPath('/data/watch/Film (2001).mkv'), path.join('/makemkv-output', 'Film (2001).mkv'));
  assert.equal(jobs.fromJobPath('downloads/Film/Film.mkv'), path.join('/downloads', 'Film', 'Film.mkv'));
  assert.equal(jobs.fromJobPath('/data/other/Film.mkv'), null);
  assert.equal(jobs.fromJobPath('/data/watch'), null);
  assert.equal(jobs.fromJobPath('/data/watch/../etc/passwd'), null);
});

test('an analyze job has the command, the two inputs and the given options', () => {
  const lines = fakeJobs().jobLines({
    command: 'analyze',
    inputs: ['/makemkv-output/Film (2).mkv', '/downloads/Film/Film.mkv'],
    originalLanguage: 'en',
  });
  assert.deepEqual(lines, [
    'command=analyze',
    'input=watch/Film (2).mkv',
    'input=downloads/Film/Film.mkv',
    'original-language=en',
  ]);
});

test('a merge job always keeps the inputs: Wayfinderr deletes them itself', () => {
  const lines = fakeJobs().jobLines({
    command: 'merge',
    inputs: ['/makemkv-output/A.mkv', '/makemkv-output/B.mkv'],
    output: '/makemkv-output/Film (2001).mkv',
    expect: '/makemkv-output/.wayfinderr/dyadrr/jobs/3f2a.json',
    tail: 'trim',
    italian: 'main',
    referenceItalianSubs: 'drop',
    edgeMismatch: 'drop',
  });
  assert.deepEqual(lines, [
    'command=merge',
    'input=watch/A.mkv',
    'input=watch/B.mkv',
    'output=watch/Film (2001).mkv',
    'expect=watch/.wayfinderr/dyadrr/jobs/3f2a.json',
    'tail=trim',
    'italian=main',
    'reference-italian-subs=drop',
    'edge-mismatch=drop',
    'inputs=keep',
  ]);
});

test('a job is written under a dot name and renamed, with a UUID id', async () => {
  await withJobs(async (jobs, root) => {
    const id = await jobs.submit({
      command: 'analyze',
      inputs: [path.join(root, 'watch', 'A.mkv'), path.join(root, 'downloads', 'B.mkv')],
    });
    assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    assert.deepEqual(await readdir(jobs.jobsDir), [`${id}.job`]);
    assert.equal(
      await readFile(path.join(jobs.jobsDir, `${id}.job`), 'utf8'),
      'command=analyze\ninput=watch/A.mkv\ninput=downloads/B.mkv\n'
    );
    assert.deepEqual(await jobs.state(id), { state: 'queued' });
  });
});

test('the job state follows the files the runner writes', async () => {
  await withJobs(async (jobs, root) => {
    const id = await jobs.submit({ command: 'analyze', inputs: [path.join(root, 'watch', 'A.mkv'), path.join(root, 'watch', 'B.mkv')] });
    const file = (ext: string) => path.join(jobs.jobsDir, `${id}.${ext}`);

    await rm(file('job'));
    await writeFile(file('run'), '');
    assert.deepEqual(await jobs.state(id), { state: 'running' });
    // The report alone is not the end: .exit is always written last
    await writeFile(file('json'), '{"decision":"refused"}');
    assert.deepEqual(await jobs.state(id), { state: 'running' });

    await writeFile(file('exit'), '20\n');
    assert.deepEqual(await jobs.state(id), { state: 'done', exitCode: 20 });
    assert.equal((await jobs.report(id))?.decision, 'refused');

    await writeFile(file('exit'), 'garbage\n');
    assert.deepEqual(await jobs.state(id), { state: 'done', exitCode: 255 });
    await writeFile(file('exit'), '');
    assert.deepEqual(await jobs.state(id), { state: 'done', exitCode: 255 });

    await jobs.cancel(id);
    await writeFile(file('log'), '');
    await jobs.remove(id);
    assert.deepEqual(await readdir(jobs.jobsDir), []);
    assert.deepEqual(await jobs.state(id), { state: 'missing' });
  });
});

test('an unreadable report is null, and its outcome an error', async () => {
  await withJobs(async (jobs) => {
    await jobs.ensureJobsDir();
    const id = 'job-1';
    assert.equal(await jobs.report(id), null);
    await writeFile(path.join(jobs.jobsDir, `${id}.json`), '{"decision":');
    assert.equal(await jobs.report(id), null);
  });
  assert.equal(jobOutcome(null), 'error');
  assert.equal(jobOutcome({ decision: 'eligible' } as DyadrrReport), 'eligible');
  assert.equal(jobOutcome({ decision: 'cancelled' } as DyadrrReport), 'cancelled');
  assert.equal(jobOutcome({ decision: 'maybe' } as unknown as DyadrrReport), 'error');
});

test('job ids that the runner would ignore are refused', async () => {
  const jobs = fakeJobs();
  await assert.rejects(() => jobs.state('../x'), /Invalid job id/);
  await assert.rejects(() => jobs.state('.hidden'), /Invalid job id/);
  await assert.rejects(() => jobs.state('x'.repeat(65)), /Invalid job id/);
});

test('the log gives the progress events and the lines that are not JSON', () => {
  const { events, messages } = parseLog(
    [
      '{"event":"phase","phase":"read","elapsedMs":1}',
      '{"event":"phase","phase":"checkpoints","elapsedMs":900}',
      '{"event":"progress","phase":"checkpoints","done":3,"total":30,"elapsedMs":1200}\r',
      'Error: cannot write the report',
      '',
      '[1,2]',
    ].join('\n')
  );
  assert.equal(events.length, 3);
  assert.deepEqual(messages, ['Error: cannot write the report', '[1,2]']);
  const now = currentProgress(events);
  assert.equal(now.phase, 'checkpoints');
  assert.equal(now.progress?.done, 3);
  assert.equal(now.end, null);
});

test('a new phase clears the progress of the one before', () => {
  const now = currentProgress(
    parseLog(
      [
        '{"event":"progress","phase":"intermediate","step":1,"steps":2,"percent":40}',
        '{"event":"phase","phase":"merge"}',
        '{"event":"end","decision":"eligible","exitCode":0}',
      ].join('\n')
    ).events
  );
  assert.equal(now.phase, 'merge');
  assert.equal(now.progress, null);
  assert.equal(now.end?.decision, 'eligible');
});

test('the container is alive when dyadrr.alive is at most 30 s old', async () => {
  await withJobs(async (jobs) => {
    assert.equal(await jobs.lastSeen(), null);
    assert.equal(await jobs.alive(), false);
    await jobs.ensureJobsDir();
    const now = 1_800_000_000_000;
    await writeFile(path.join(jobs.jobsDir, 'dyadrr.alive'), `${now / 1000 - 12}\n`);
    assert.equal(await jobs.lastSeen(now), 12);
    assert.equal(await jobs.alive(now), true);
    assert.equal(await jobs.alive(now + 18_000), true);
    assert.equal(await jobs.alive(now + 19_000), false);
    await writeFile(path.join(jobs.jobsDir, 'dyadrr.alive'), 'nothing\n');
    assert.equal(await jobs.lastSeen(now), null);
  });
});

test('a job still queued is withdrawn; one the runner claimed is not', async () => {
  await withJobs(async (jobs, root) => {
    const inputs: [string, string] = [path.join(root, 'watch', 'A.mkv'), path.join(root, 'watch', 'B.mkv')];
    const queued = await jobs.submit({ command: 'analyze', inputs });
    assert.equal(await jobs.withdraw(queued), true);
    assert.deepEqual(await jobs.state(queued), { state: 'missing' });

    const claimed = await jobs.submit({ command: 'analyze', inputs });
    const file = (ext: string) => path.join(jobs.jobsDir, `${claimed}.${ext}`);
    await rm(file('job'));
    await writeFile(file('run'), '');
    assert.equal(await jobs.withdraw(claimed), false);
    assert.deepEqual(await jobs.state(claimed), { state: 'running' });
    assert.deepEqual(await readdir(jobs.jobsDir), [`${claimed}.run`]);
  });
});
