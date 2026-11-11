import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeSide, sameDownload, sideMatches } from './plans.js';
import { holdRefusal } from './manual.js';

const HASH = 'edfb378dedd9bc772ded2f449f4b9219a41b5a32';
const OTHER = '0123456789abcdef0123456789abcdef01234567';

test('a new file is the side with its info hash, whatever the case', () => {
  assert.equal(sideMatches({ infoHash: HASH, name: null }, { infoHash: HASH.toUpperCase(), names: [] }), true);
  assert.equal(sideMatches({ infoHash: HASH, name: null }, { infoHash: OTHER, names: [] }), false);
});

test("a new file is the side with its download's name, exactly", () => {
  const side = { infoHash: null, name: 'Dune.2021.1080p.BluRay' };
  assert.equal(sideMatches(side, { infoHash: null, names: ['Dune.2021.1080p.BluRay'] }), true);
  assert.equal(sideMatches(side, { infoHash: null, names: ['Dune.2021.1080p.BluRay.Extended'] }), false);
});

test("a side known by its hash only matches through its torrent's names in the clients", () => {
  const side = { infoHash: HASH, name: null };
  const file = { infoHash: null, names: ['Dune.2021.2160p.UHD'] };
  assert.equal(sideMatches(side, file), false);
  assert.equal(sideMatches(side, file, ['Dune.2021.2160p.UHD']), true);
});

test('two sides are the same download with a hash, a name or an upload in common', () => {
  const a = { infoHash: HASH, name: 'Dune', uploadId: null };
  assert.equal(sameDownload(a, { infoHash: HASH, name: null, uploadId: null }), true);
  assert.equal(sameDownload(a, { infoHash: OTHER, name: 'Dune', uploadId: null }), true);
  assert.equal(sameDownload(a, { infoHash: OTHER, name: 'Dune.ITA', uploadId: null }), false);
  assert.equal(sameDownload({ infoHash: null, name: null, uploadId: 'u1' }, { infoHash: null, name: null, uploadId: 'u1' }), true);
  // Nothing given on either side is not "the same"
  assert.equal(sameDownload({ infoHash: null, name: null, uploadId: null }, { infoHash: null, name: null, uploadId: null }), false);
});

test('a side is named by its label, then its name or hash', () => {
  assert.equal(describeSide({ infoHash: HASH, name: null, label: 'audio ITA', uploadId: null }), 'audio ITA (the torrent edfb378d…)');
  assert.equal(describeSide({ infoHash: HASH, name: 'Dune.2021', label: null, uploadId: null }), '"Dune.2021"');
});

test('only a file not on a server yet can be held by hand', () => {
  for (const status of ['PENDING', 'QUEUED', 'FAILED', 'SKIPPED', 'CANCELLED']) {
    assert.equal(holdRefusal({ status, filename: 'Dune.mkv' }), null, status);
  }
  assert.match(holdRefusal({ status: 'UPLOADING', filename: 'Dune.mkv' })!, /stop it first/);
  assert.match(holdRefusal({ status: 'COMPLETED', filename: 'Dune.mkv' })!, /already on a server/);
  assert.match(holdRefusal({ status: 'HELD', filename: 'Dune.mkv' })!, /already held/);
  assert.equal(holdRefusal({ status: 'HELD', filename: 'Dune.mkv' }, true), null);
});
