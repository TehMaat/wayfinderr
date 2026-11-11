import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { DyadrrReport } from './jobs.js';
import { DEFAULT_CHOICES, fixedChoices, parseChoiceSettings, progressPercent, reportSummary } from './pairs.js';

test('choice settings: "ask" by default, invalid stored values dropped', () => {
  assert.deepEqual(parseChoiceSettings(undefined), DEFAULT_CHOICES);
  assert.deepEqual(parseChoiceSettings('not json'), DEFAULT_CHOICES);
  assert.deepEqual(parseChoiceSettings(JSON.stringify({ tail: 'trim', italian: 'some', edgeMismatch: 'keep', other: 'x' })), {
    tail: 'trim',
    italian: 'ask',
    referenceItalianSubs: 'ask',
    edgeMismatch: 'keep',
  });
});

test('only the fixed choices are passed to Dyadrr: the others stay pending', () => {
  assert.deepEqual(fixedChoices(DEFAULT_CHOICES), {});
  assert.deepEqual(fixedChoices({ tail: 'trim', italian: 'ask', referenceItalianSubs: 'drop', edgeMismatch: 'ask' }), {
    tail: 'trim',
    referenceItalianSubs: 'drop',
  });
});

test('progress within a phase: percent, done of total, or step of steps', () => {
  assert.equal(progressPercent(null), null);
  assert.equal(progressPercent({ event: 'progress', phase: 'checkpoints', done: 6, total: 30 }), 20);
  assert.equal(progressPercent({ event: 'progress', phase: 'anchors', done: 1, total: null }), null);
  assert.equal(progressPercent({ event: 'progress', phase: 'merge', step: 1, steps: 1, percent: 42.4 }), 42);
  assert.equal(progressPercent({ event: 'progress', phase: 'intermediate', step: 2, steps: 4, percent: null }), 25);
});

test('the report summary keeps what the page shows', () => {
  const report = {
    format: 1,
    dyadrr: '0.21.1',
    mode: 'analyze',
    decision: 'eligible',
    reasons: [],
    roles: { reference: 1, donor: 0, reason: 'Italian audio in file 1' },
    measurement: {
      language: 'eng',
      offset: { anchorMs: 667, medianMs: 667.2, offsetMs: 667, dispersionMs: 0.4 },
      commonMaterial: { startMs: 0, endMs: 5625000, coverage: 0.98 },
      checkpoints: [
        { requestedMs: 60000, positionMs: 60120, energyDbfs: -22.4, outcome: 'consistent', offsetMs: 667, deviationMs: 0, ncc: 0.91, ratio: 3.2, local: null, wide: null, alternates: [] },
        { requestedMs: 4700000, positionMs: 4704000, energyDbfs: -18.1, outcome: 'unmatched', offsetMs: null, deviationMs: null, ncc: null, ratio: null, local: null, wide: null, alternates: [] },
      ],
    },
    checks: [
      { name: 'checkpoints', result: 'pass', blocking: true },
      { name: 'transfer', result: 'fail', blocking: false, code: 'ITALIAN_TRANSFER_OFFSET', detail: '27 ms' },
    ],
    choices: [
      { name: 'tail', needed: false, status: 'not-needed' },
      {
        name: 'edgeMismatch',
        needed: true,
        status: 'pending',
        effects: [
          { value: 'drop', italianStartMs: 39000, italianEndMs: 5625000, audioTrackIds: [2], warnings: [] },
          { value: 'keep', italianStartMs: 0, italianEndMs: 5625000, audioTrackIds: [2], warnings: ['INTRO_MISMATCH'] },
        ],
      },
    ],
    plan: {
      offsetMs: 667,
      film: { startMs: 0, endMs: 5766000 },
      commonMaterial: { startMs: 0, endMs: 5625000 },
      italian: { startMs: null, endMs: 5625000 },
      audio: [{ id: 2, name: 'Italiano', role: 'main', reason: 'default', taken: true, startMs: 0, endMs: 5625000 }],
    },
    warnings: [{ code: 'EDGE_CONTINUES_ELSEWHERE', message: 'The film goes on elsewhere', source: 'analysis' }],
  } as unknown as DyadrrReport;

  const summary = reportSummary(report)!;
  assert.equal(summary.decision, 'eligible');
  assert.deepEqual(summary.roles, { reference: 1, donor: 0 });
  assert.equal(summary.offsetMs, 667);
  assert.equal(summary.coverage, 0.98);
  assert.deepEqual(summary.failedChecks, [{ name: 'transfer', code: 'ITALIAN_TRANSFER_OFFSET', blocking: false, detail: '27 ms' }]);
  assert.deepEqual(summary.warnings, [{ code: 'EDGE_CONTINUES_ELSEWHERE', message: 'The film goes on elsewhere' }]);
  assert.deepEqual(summary.audio, [{ id: 2, name: 'Italiano', role: 'main', taken: true }]);
  const pending = summary.choices.find((c: { name: string }) => c.name === 'edgeMismatch');
  assert.equal(pending.status, 'pending');
  assert.deepEqual(pending.effects[1], { value: 'keep', italianStartMs: 0, italianEndMs: 5625000, warnings: ['INTRO_MISMATCH'] });
  // The checkpoints: only where and how, for the strip on the card (the page reads the full report)
  assert.deepEqual(summary.checkpoints, [
    { positionMs: 60120, outcome: 'consistent' },
    { positionMs: 4704000, outcome: 'unmatched' },
  ]);
});

test('a refused report, and one written by the runner with the outcome only', () => {
  const refused = reportSummary({
    format: 1,
    dyadrr: '0.21.1',
    mode: 'analyze',
    decision: 'refused',
    reasons: [{ code: 'CHECKPOINT_CONTRADICTION', message: 'The offset changes along the film' }],
  } as DyadrrReport)!;
  assert.deepEqual(refused.reasons, [{ code: 'CHECKPOINT_CONTRADICTION', message: 'The offset changes along the film' }]);
  assert.equal(refused.offsetMs, null);
  assert.deepEqual(refused.choices, []);
  assert.deepEqual(refused.checkpoints, []);
  assert.equal(reportSummary(null), null);
});

test('the merge summary: the delivered file, the --expect check, the warnings', async () => {
  const { mergeSummary } = await import('./pairs.js');
  const summary = mergeSummary({
    format: 1,
    dyadrr: '0.21.1',
    mode: 'merge',
    decision: 'eligible',
    reasons: [],
    expect: { path: '/data/watch/.wayfinderr/dyadrr/expect/p.json', result: 'pass', differences: [] },
    output: { path: '/data/watch/Up (2009).mkv', delivered: true, sizeBytes: 60000000000, durationMs: 5766000, build: { droppedSubtitles: [] } },
    warnings: [{ code: 'OUTPUT_TRANSFER_OFFSET', message: '−18.6 ms', source: 'verify' }],
  } as unknown as DyadrrReport)!;
  assert.equal(summary.delivered, true);
  assert.equal(summary.sizeBytes, 60000000000);
  assert.deepEqual(summary.expect, { result: 'pass', differences: [] });
  assert.deepEqual(summary.warnings, [{ code: 'OUTPUT_TRANSFER_OFFSET', message: '−18.6 ms', source: 'verify' }]);
  assert.equal(mergeSummary(null), null);
});
