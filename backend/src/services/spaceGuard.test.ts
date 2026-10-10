import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resumeAtBytes, spaceAction } from './spaceGuard.js';

const GB = 1024 ** 3;
const disk = (freeGB: number) => ({ mountPoint: '/data', freeBytes: BigInt(Math.round(freeGB * GB)) });
const client = (minFreeGB: number | null, paused = false, enabled = true) => ({
  enabled,
  minFreeGB,
  spacePausedAt: paused ? new Date() : null,
});

test('pauses below the threshold, paused or not yet', () => {
  assert.equal(spaceAction(client(20), disk(19.9))?.pause, true);
  // Torrents started meanwhile are paused again
  assert.equal(spaceAction(client(20, true), disk(5))?.pause, true);
  assert.match(spaceAction(client(20), disk(4))!.why, /\/data has 4\.0 GB free, less than 20 GB/);
});

test('nothing to do above the threshold when not paused', () => {
  assert.equal(spaceAction(client(20), disk(20)), null);
  assert.equal(spaceAction(client(20), disk(500)), null);
});

test('resumes only past the margin, so it does not flap around the threshold', () => {
  // 20 GB: 10% margin is 2 GB
  assert.equal(resumeAtBytes(20), 22 * GB);
  assert.equal(spaceAction(client(20, true), disk(21)), null);
  assert.equal(spaceAction(client(20, true), disk(22))?.pause, false);
  // At least 1 GB of margin on a small threshold
  assert.equal(resumeAtBytes(2), 3 * GB);
});

test('turned off or disabled while paused: resumes; never paused: nothing', () => {
  assert.equal(spaceAction(client(null, true), disk(1))?.pause, false);
  assert.equal(spaceAction(client(20, true, false), disk(1))?.pause, false);
  assert.equal(spaceAction(client(null), disk(1)), null);
  assert.equal(spaceAction(client(20, false, false), disk(1)), null);
});

test('disks unreadable: changes nothing', () => {
  assert.equal(spaceAction(client(20), null), null);
  assert.equal(spaceAction(client(20, true), null), null);
});
