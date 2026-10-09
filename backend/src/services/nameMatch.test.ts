import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isMeaningfulTitle, parseName, titleSimilarity } from './nameMatch.js';

test('release names: title and year, tags dropped', () => {
  assert.deepEqual(parseName('The.Godfather.1972.1080p.BluRay.AVC.DTS-HD.MA.5.1-FGT'), { title: 'the godfather', year: 1972 });
  assert.deepEqual(parseName('Il Padrino (1972) [BDMV] ITA ENG'), { title: 'il padrino', year: 1972 });
  assert.deepEqual(parseName('Blade.Runner.2049.2017.COMPLETE.UHD.BLURAY-TERMiNAL'), { title: 'blade runner 2049', year: 2017 });
});

test('MakeMKV names: title suffix and disc labels dropped', () => {
  assert.equal(parseName('IL_PADRINO_t00.mkv').title, 'il padrino');
  assert.equal(parseName('THE_GODFATHER_D2_t01.mkv').title, 'the godfather');
  assert.equal(parseName('GODFATHER_DISC_1_t00.mkv').title, 'godfather');
  assert.deepEqual(parseName('Il padrino (1972).mkv'), { title: 'il padrino', year: 1972 });
  assert.equal(parseName('Rocky 2_t00.mkv').title, 'rocky 2');
});

test('generic MakeMKV names never identify a film', () => {
  assert.equal(isMeaningfulTitle(parseName('title_t00.mkv').title), false);
  assert.equal(isMeaningfulTitle(parseName('B1_t00.mkv').title), false);
  assert.equal(isMeaningfulTitle(parseName('IL_PADRINO_t00.mkv').title), true);
});

test('similarity: only the same title is certain', () => {
  assert.equal(titleSimilarity('il padrino', 'il padrino'), 100);
  assert.equal(titleSimilarity('thegodfather', 'the godfather'), 95);
  assert.equal(titleSimilarity('godfather', 'the godfather'), 95);
  assert.equal(titleSimilarity('padrino', 'il padrino'), 95);
  // A sequel or a longer title is at most a suggestion
  assert.ok(titleSimilarity('blade runner', 'blade runner 2049') < 85);
  assert.ok(titleSimilarity('il padrino', 'il padrino parte ii') < 60);
  assert.ok(titleSimilarity('the godfather part ii', 'the godfather part iii') < 60);
});
