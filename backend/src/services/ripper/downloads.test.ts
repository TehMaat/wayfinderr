import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, utimes, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { findDiscs, isDownloadComplete, isFirstRarVolume, rarSetName } from './downloads.js';

test('isFirstRarVolume: .rar and .part1.rar, not the other volumes', () => {
  for (const name of ['film.rar', 'Film.RAR', 'film.part1.rar', 'film.part01.rar', 'film.part001.rar']) {
    assert.equal(isFirstRarVolume(name), true, name);
  }
  for (const name of ['film.part2.rar', 'film.part10.rar', 'film.r00', 'film.r01', 'film.s00', 'film.rar.!qB', 'film.mkv']) {
    assert.equal(isFirstRarVolume(name), false, name);
  }
});

test('rarSetName: the volumes of an archive share it, incomplete ones too', () => {
  assert.equal(rarSetName('Film.rar'), 'film');
  assert.equal(rarSetName('film.r00'), 'film');
  assert.equal(rarSetName('film.s01'), 'film');
  assert.equal(rarSetName('Film.part1.rar'), 'film');
  assert.equal(rarSetName('Film.part2.rar.!qB'), 'film');
  assert.equal(rarSetName('Film.mkv'), null);
});

const tree = async (files: string[]) => {
  const root = await mkdtemp(path.join(tmpdir(), 'wayfinderr-downloads-'));
  for (const file of files) {
    await mkdir(path.join(root, path.dirname(file)), { recursive: true });
    await writeFile(path.join(root, file), 'x');
  }
  return root;
};

test('findDiscs: the first volume of each archive, ignoring the unpack folder', async () => {
  const root = await tree([
    'Film.2001.1080p.BluRay.x264-GRP/grp-film.rar',
    'Film.2001.1080p.BluRay.x264-GRP/grp-film.r00',
    'Film.2001.1080p.BluRay.x264-GRP/Subs/grp-film.subs.rar',
    'Other.2002.COMPLETE.BLURAY-GRP/other.part1.rar',
    'Other.2002.COMPLETE.BLURAY-GRP/other.part2.rar',
    'Top.2003.part1.rar',
    'Top.2003.part2.rar',
    'Disc.2004.iso',
    '.wayfinderr/unpack/abc/film.iso',
  ]);
  try {
    const found = (await findDiscs(root)).sort((a, b) => a.path.localeCompare(b.path));
    assert.deepEqual(found, [
      { path: 'Disc.2004.iso', type: 'ISO', downloadName: 'Disc.2004.iso' },
      { path: 'Film.2001.1080p.BluRay.x264-GRP/grp-film.rar', type: 'RAR', downloadName: 'Film.2001.1080p.BluRay.x264-GRP' },
      { path: 'Film.2001.1080p.BluRay.x264-GRP/Subs/grp-film.subs.rar', type: 'RAR', downloadName: 'Film.2001.1080p.BluRay.x264-GRP' },
      { path: 'Other.2002.COMPLETE.BLURAY-GRP/other.part1.rar', type: 'RAR', downloadName: 'Other.2002.COMPLETE.BLURAY-GRP' },
      { path: 'Top.2003.part1.rar', type: 'RAR', downloadName: 'Top.2003.part1.rar' },
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('isDownloadComplete: an archive in the downloads folder waits for all its volumes', async () => {
  const root = await tree(['Top.part1.rar', 'Top.part2.rar.!qB', 'Other.part1.rar']);
  const old = new Date(Date.now() - 3600_000);
  for (const name of ['Top.part1.rar', 'Top.part2.rar.!qB', 'Other.part1.rar']) await utimes(path.join(root, name), old, old);
  try {
    assert.equal(await isDownloadComplete(root, 'Top.part1.rar', 60_000), false);
    assert.equal(await isDownloadComplete(root, 'Other.part1.rar', 60_000), true);
    await rm(path.join(root, 'Top.part2.rar.!qB'));
    await writeFile(path.join(root, 'Top.part2.rar'), 'x');
    // Just written: not quiet yet
    assert.equal(await isDownloadComplete(root, 'Top.part1.rar', 60_000), false);
    await utimes(path.join(root, 'Top.part2.rar'), old, old);
    assert.equal(await isDownloadComplete(root, 'Top.part1.rar', 60_000), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
