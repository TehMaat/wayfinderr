import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { DyadrrReport } from './jobs.js';
import { attachmentHeader, reportDay, reportFileName, reportOutcome } from './reportName.js';

const report = (fields: Partial<DyadrrReport> & Record<string, unknown>): DyadrrReport => ({
  format: 1,
  dyadrr: '0.21.1',
  mode: 'analyze',
  decision: 'eligible',
  reasons: [],
  ...fields,
});

test('an analyze report is named after the film, the step, its decision and the day', () => {
  const refused = report({ decision: 'refused', startedAt: '2026-11-17T09:58:00Z', finishedAt: '2026-11-17T10:04:12Z' });
  assert.equal(reportFileName('Sample Film (2004)', 'analyze', refused), 'Sample Film (2004) - analyze - refused - 2026-11-17.json');
  for (const decision of ['eligible', 'error', 'cancelled'] as const) {
    assert.equal(reportOutcome('analyze', report({ decision })), decision);
  }
  // A decision Dyadrr does not give counts as an error, as for the pair
  assert.equal(reportOutcome('analyze', report({ decision: 'maybe' as never })), 'error');
});

test('a merge report is merged, cancelled or failed', () => {
  const merged = report({ mode: 'merge', finishedAt: '2026-11-18T20:00:00Z', output: { delivered: true } });
  assert.equal(reportFileName('Sample Film (2004)', 'merge', merged), 'Sample Film (2004) - merge - merged - 2026-11-18.json');
  // Eligible but not delivered (the verification failed), refused again, an error: failed
  assert.equal(reportOutcome('merge', report({ mode: 'merge', output: { delivered: false } })), 'failed');
  assert.equal(reportOutcome('merge', report({ mode: 'merge', output: null })), 'failed');
  assert.equal(reportOutcome('merge', report({ mode: 'merge', decision: 'refused' })), 'failed');
  assert.equal(reportOutcome('merge', report({ mode: 'merge', decision: 'error' })), 'failed');
  assert.equal(reportOutcome('merge', report({ mode: 'merge', decision: 'cancelled' })), 'cancelled');
});

test('the day: finishedAt, else startedAt, in UTC; left out without a date', () => {
  assert.equal(reportDay(report({ startedAt: '2026-11-17T23:50:00Z', finishedAt: '2026-11-18T00:10:00Z' })), '2026-11-18');
  assert.equal(reportDay(report({ startedAt: '2026-11-17T23:50:00+02:00' })), '2026-11-17');
  assert.equal(reportDay(report({ finishedAt: 'not a date', startedAt: '2026-11-16T08:00:00Z' })), '2026-11-16');
  assert.equal(reportDay(report({})), null);
  assert.equal(reportFileName('Sample Film (2004)', 'analyze', report({ decision: 'error' })), 'Sample Film (2004) - analyze - error.json');
});

test('a film name a file system refuses is made safe; without one, the step comes first', () => {
  const day = { finishedAt: '2026-11-17T10:00:00Z' };
  assert.equal(reportFileName('Mondo: Atto/Secondo', 'analyze', report(day)), 'Mondo - Atto - Secondo - analyze - eligible - 2026-11-17.json');
  assert.equal(reportFileName('', 'analyze', report(day)), 'analyze - eligible - 2026-11-17.json');
});

test('the header keeps the accents in filename* and gives an ASCII filename', () => {
  assert.equal(
    attachmentHeader("La Città dell'Ombra (2010) - analyze - eligible - 2026-11-17.json"),
    `attachment; filename="La Citta dell'Ombra (2010) - analyze - eligible - 2026-11-17.json"; ` +
      `filename*=UTF-8''La%20Citt%C3%A0%20dell%27Ombra%20%282010%29%20-%20analyze%20-%20eligible%20-%202026-11-17.json`
  );
  // A character with no ASCII letter under it becomes "_" in the fallback
  assert.match(attachmentHeader('Ōkami 狼 (2001).json'), /^attachment; filename="Okami _ \(2001\)\.json"; filename\*=UTF-8''/);
});
