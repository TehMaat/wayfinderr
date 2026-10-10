import { test } from 'node:test';
import assert from 'node:assert/strict';
import { QbitTorrent } from './qbittorrent.js';
import { scoreAgainst, topLevelName } from './torrentCleanup.js';
import { parseName } from './nameMatch.js';

const torrent = (name: string, save_path: string, content_path: string) =>
  ({ hash: 'a'.repeat(40), name, save_path, content_path }) as QbitTorrent;

test('top-level entry of a torrent: its folder, or its file', () => {
  assert.equal(topLevelName(torrent('Dune.2021', '/downloads', '/downloads/Dune.2021')), 'Dune.2021');
  assert.equal(topLevelName(torrent('Dune.2021.iso', '/downloads/', '/downloads/Dune.2021.iso')), 'Dune.2021.iso');
  // Renamed in qBittorrent: the folder on disk wins over the torrent name
  assert.equal(topLevelName(torrent('Dune', 'D:\\Downloads', 'D:\\Downloads\\Dune.2021.BDMV\\BDMV')), 'Dune.2021.BDMV');
});

test('a year far from the torrent year is another film', () => {
  const names = [parseName('Dune (1984).mkv')];
  assert.equal(scoreAgainst(names, { titles: ['dune'], year: 2021 }).score, 0);
  assert.equal(scoreAgainst(names, { titles: ['dune'], year: 1984 }).score, 100);
});

test('a match is dated only when both names have a year', () => {
  assert.equal(scoreAgainst([parseName('Dune (1984).mkv')], { titles: ['dune'], year: 1984 }).dated, true);
  // No year on the MKV: it could be the 1984 or the 2021 film
  assert.equal(scoreAgainst([parseName('DUNE_t00.mkv')], { titles: ['dune'], year: 2021 }).dated, false);
  assert.equal(scoreAgainst([parseName('Dune (2021).mkv')], { titles: ['dune'] }).dated, false);
  // The folder's year confirms the film even when the file name has none
  const names = [parseName('DUNE_t00.mkv'), parseName('Dune (2021)')];
  assert.deepEqual(scoreAgainst(names, { titles: ['dune'], year: 2021 }), { score: 100, matched: 'dune', dated: true });
});

test('the best of the MKV names and torrent titles counts', () => {
  const names = [parseName('IL_PADRINO_t00.mkv')];
  const match = scoreAgainst(names, { titles: ['the godfather', 'il padrino', 'der pate'], year: 1972 });
  assert.deepEqual(match, { score: 100, matched: 'il padrino', dated: false });
});
