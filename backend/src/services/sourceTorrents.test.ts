import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import { parseTmdbId, pickByName, torrentFileName, watchTopLevel } from './sourceTorrents.js';
import { apiKeyOf } from './auth.js';

const watch = path.resolve('/watch');

test('the entry at the top of the watch folder: its folder, or the file itself', () => {
  assert.equal(watchTopLevel(path.join(watch, 'Dune.2021.1080p', 'Dune (2021).mkv'), watch), 'Dune.2021.1080p');
  assert.equal(watchTopLevel(path.join(watch, 'Dune.2021.1080p', 'Sub', 'Dune (2021).mkv'), watch), 'Dune.2021.1080p');
  assert.equal(watchTopLevel(path.join(watch, 'Dune (2021).mkv'), watch), 'Dune (2021).mkv');
  // Outside the watch folder (an archive unpacked next to the downloads)
  assert.equal(watchTopLevel(path.resolve('/downloads/Dune/Dune.mkv'), watch), null);
  assert.equal(watchTopLevel(watch, watch), null);
});

test('a download name picks a torrent only when exactly one has it', () => {
  const torrents = [{ name: 'Dune.2021.BluRay' }, { name: 'Dune.2021.WEB-DL' }];
  assert.deepEqual(pickByName(torrents, ['Dune.2021.BluRay']), { name: 'Dune.2021.BluRay' });
  // Exact names only: no partial or case-insensitive match
  assert.equal(pickByName(torrents, ['Dune.2021']), null);
  assert.equal(pickByName(torrents, ['dune.2021.bluray']), null);
  // Two with the same name: which one is it?
  assert.equal(pickByName([...torrents, { name: 'Dune.2021.BluRay' }], ['Dune.2021.BluRay']), null);
  assert.equal(pickByName(torrents, []), null);
});

test('a TMDB id is a positive integer', () => {
  assert.equal(parseTmdbId('438631'), 438631);
  assert.equal(parseTmdbId(' 603 '), 603);
  for (const bad of ['0', '-1', '12a', '', '1.5', undefined, ['603']]) assert.equal(parseTmdbId(bad), null);
});

test('the .torrent file name: the one sent, without folders, else the torrent name', () => {
  assert.equal(torrentFileName('C:\\Users\\me\\Dune.torrent', 'Dune.2021'), 'Dune.torrent');
  assert.equal(torrentFileName('  ', 'Dune: Part Two/2024'), 'Dune_ Part Two_2024.torrent');
  assert.equal(torrentFileName(undefined, 'Dune.2021'), 'Dune.2021.torrent');
});

test('the API key header, trimmed; none when missing or blank', () => {
  assert.equal(apiKeyOf({ 'x-api-key': ' abc ' }), 'abc');
  assert.equal(apiKeyOf({}), null);
  assert.equal(apiKeyOf({ 'x-api-key': '  ' }), null);
});
