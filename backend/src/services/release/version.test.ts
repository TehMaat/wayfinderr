import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keepsChoice, parseVersion, resolveVersion, VersionSource } from './version.js';

const rip = (version: string): VersionSource => ({ origin: 'rip', version, from: 'Orbita.Silenziosa.2010.BluRay' });
const torrent = (version: string): VersionSource => ({ origin: 'torrent', version, from: 'bookrr' });

test('resolveVersion: nothing chosen anywhere', () => {
  assert.deepEqual(resolveVersion(null, []), { version: null, origin: null, from: null, toChoose: false, sources: [] });
});

test('resolveVersion: one source gives the version', () => {
  const r = resolveVersion(null, [torrent('Extended')]);
  assert.equal(r.version, 'Extended');
  assert.equal(r.origin, 'torrent');
  assert.equal(r.from, 'bookrr');
  assert.equal(r.toChoose, false);
});

test('resolveVersion: sources that agree (same name in the release) give the first one', () => {
  const r = resolveVersion(null, [rip("Director's Cut"), torrent('directors cut')]);
  assert.equal(r.version, "Director's Cut");
  assert.equal(r.origin, 'rip');
  assert.equal(r.toChoose, false);
});

test('resolveVersion: sources that disagree leave it to choose', () => {
  const r = resolveVersion(null, [rip('Extended'), torrent('Theatrical')]);
  assert.equal(r.version, null);
  assert.equal(r.toChoose, true);
  assert.equal(r.sources.length, 2);
});

test('resolveVersion: none on purpose disagrees with a version', () => {
  assert.equal(resolveVersion(null, [rip(''), torrent('Extended')]).toChoose, true);
  assert.equal(resolveVersion(null, [rip('')]).version, '');
});

test("resolveVersion: the upload's own choice wins, also over a disagreement", () => {
  const r = resolveVersion('Extended', [rip('Extended'), torrent('Theatrical')]);
  assert.equal(r.version, 'Extended');
  assert.equal(r.origin, 'upload');
  assert.equal(r.toChoose, false);
  assert.equal(r.sources.length, 2);
  assert.equal(resolveVersion('', [torrent('Extended')]).version, '');
});

test('resolveVersion: the same source saying it twice counts once', () => {
  assert.equal(resolveVersion(null, [rip('Extended'), rip('Extended')]).sources.length, 1);
});

test('parseVersion: string, none, not chosen, invalid', () => {
  assert.equal(parseVersion('  Extended   Cut '), 'Extended Cut');
  assert.equal(parseVersion(''), '');
  assert.equal(parseVersion(null), null);
  assert.equal(parseVersion(3), undefined);
  assert.equal(parseVersion(undefined), undefined);
  assert.equal(parseVersion('x'.repeat(80))!.length, 60);
});

test("keepsChoice: a source's new version drops an upload's different choice", () => {
  assert.equal(keepsChoice('Extended', 'Theatrical'), false);
  assert.equal(keepsChoice('Extended', 'extended'), true);
  assert.equal(keepsChoice(null, 'Theatrical'), true);
  assert.equal(keepsChoice('Extended', null), true);
  assert.equal(keepsChoice('', 'Extended'), false);
});
