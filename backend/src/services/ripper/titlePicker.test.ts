import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DiscTitle } from './makemkv.js';
import { pickMainTitle } from './titlePicker.js';

const title = (index: number, minutes: number, extra: Partial<DiscTitle> = {}): DiscTitle => ({
  index,
  durationSec: minutes * 60,
  sizeBytes: minutes * 200_000_000,
  chapters: 20,
  segmentsMap: `${index}`,
  streams: [
    { type: 'video', forced: false, commentary: false },
    { type: 'audio', lang: 'ita', forced: false, commentary: false },
    { type: 'audio', lang: 'eng', forced: false, commentary: false },
  ],
  ...extra,
});

const ITA = ['ita'];

test('one long title and short extras: the film', () => {
  const choice = pickMainTitle([title(0, 47), title(1, 128), title(2, 50)], ITA);
  assert.equal(choice.title?.index, 1);
});

test('no title at all', () => {
  assert.equal(pickMainTitle([], ITA).title, null);
});

test('two long titles: more than one film or cut, ask', () => {
  const choice = pickMainTitle([title(0, 112), title(1, 128)], ITA);
  assert.equal(choice.title, null);
  assert.match('reason' in choice ? choice.reason : '', /Several long titles/);
});

test('identical duplicates (same segments) are the same film', () => {
  const choice = pickMainTitle([title(0, 128, { segmentsMap: '1-9' }), title(1, 128, { segmentsMap: '1-9', sizeBytes: 1 })], ITA);
  assert.equal(choice.title?.index, 0);
});

test('many look-alike playlists: obfuscation, ask', () => {
  const titles = [0, 1, 2, 3, 4].map((i) => title(i, 128, { segmentsMap: `${i},1-9` }));
  const choice = pickMainTitle(titles, ITA);
  assert.equal(choice.title, null);
  assert.match('reason' in choice ? choice.reason : '', /same length/);
});

test('no Italian track: ask', () => {
  const noIta = title(0, 128, { streams: [{ type: 'audio', lang: 'eng', forced: false, commentary: false }] });
  const choice = pickMainTitle([noIta], ITA);
  assert.equal(choice.title, null);
});

test('Italian subtitles alone are enough', () => {
  const subs = title(0, 128, {
    streams: [
      { type: 'audio', lang: 'eng', forced: false, commentary: false },
      { type: 'subtitle', lang: 'ita', forced: false, commentary: false },
    ],
  });
  assert.equal(pickMainTitle([subs], ITA).title?.index, 0);
});
