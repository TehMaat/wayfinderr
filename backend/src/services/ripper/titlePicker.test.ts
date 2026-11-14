import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DiscTitle } from './makemkv.js';
import { otherAudioLanguages, pickMainTitle } from './titlePicker.js';

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

const audio = (...langs: string[]) =>
  title(0, 128, { streams: langs.map((lang) => ({ type: 'audio' as const, lang, forced: false, commentary: false })) });

test('original language missing on the disc: the other audio languages to choose from', () => {
  assert.deepEqual(otherAudioLanguages(audio('ita', 'eng', 'eng', 'fre'), ITA, ['jpn']), ['eng', 'fre']);
});

test('original language on the disc, unknown or the kept one: nothing to choose', () => {
  assert.deepEqual(otherAudioLanguages(audio('ita', 'eng', 'jpn'), ITA, ['jpn']), []);
  assert.deepEqual(otherAudioLanguages(audio('ita', 'eng'), ITA, []), []);
  assert.deepEqual(otherAudioLanguages(audio('ita', 'eng'), ITA, ['ita']), []);
});

test('only the kept language, commentaries or no language: nothing to choose', () => {
  const streams = [
    { type: 'audio' as const, lang: 'ita', forced: false, commentary: false },
    { type: 'audio' as const, lang: 'eng', forced: false, commentary: true },
    { type: 'audio' as const, forced: false, commentary: false },
    { type: 'subtitle' as const, lang: 'eng', forced: false, commentary: false },
  ];
  assert.deepEqual(otherAudioLanguages(title(0, 128, { streams }), ITA, ['jpn']), []);
});

test('merging on, a film without the kept language is ripped all the same', () => {
  const foreign = title(0, 128, {
    streams: [
      { type: 'video', forced: false, commentary: false },
      { type: 'audio', lang: 'deu', forced: false, commentary: false },
      { type: 'audio', lang: 'eng', forced: false, commentary: false },
    ],
  });
  assert.equal(pickMainTitle([foreign], ITA).title, null);
  assert.equal(pickMainTitle([foreign], ITA, true).title?.index, 0);
  // Not a reason to guess between several films
  assert.equal(pickMainTitle([foreign, { ...foreign, index: 1, durationSec: 120 * 60, segmentsMap: '1' }], ITA, true).title, null);
});

test('English kept for a merge is never offered in place of the original language', () => {
  const english = title(0, 128, {
    streams: [
      { type: 'video', forced: false, commentary: false },
      { type: 'audio', lang: 'eng', forced: false, commentary: false },
    ],
  });
  assert.deepEqual(otherAudioLanguages(english, ['ita'], ['jpn']), ['eng']);
  assert.deepEqual(otherAudioLanguages(english, ['ita', 'eng'], ['jpn']), []);
});

const streams = (audio: string[], subtitles: string[] = []): DiscTitle['streams'] => [
  { type: 'video', forced: false, commentary: false },
  ...audio.map((lang) => ({ type: 'audio' as const, lang, forced: false, commentary: false })),
  ...subtitles.map((lang) => ({ type: 'subtitle' as const, lang, forced: false, commentary: false })),
];

test('two cuts, only the shorter one dubbed in the kept language: that one', () => {
  const extended = title(0, 128, { streams: streams(['eng']) });
  const choice = pickMainTitle([extended, title(1, 112)], ITA);
  assert.equal(choice.title?.index, 1);
});

test('two cuts, the longer one with kept subtitles only: the dubbed one', () => {
  const extended = title(0, 128, { streams: streams(['eng'], ['ita']) });
  assert.equal(pickMainTitle([extended, title(1, 112)], ITA).title?.index, 1);
  // The same with merging on
  assert.equal(pickMainTitle([extended, title(1, 112)], ITA, true).title?.index, 1);
});

test('two cuts, both dubbed or neither: ask', () => {
  assert.equal(pickMainTitle([title(0, 128), title(1, 112)], ITA).title, null);
  const eng = (index: number, minutes: number) => title(index, minutes, { streams: streams(['eng'], ['ita']) });
  assert.equal(pickMainTitle([eng(0, 128), eng(1, 112)], ITA).title, null);
});

test('several dubbed cuts among others: ask between those', () => {
  const choice = pickMainTitle([title(0, 128, { streams: streams(['eng']) }), title(1, 120), title(2, 112)], ITA);
  assert.equal(choice.title, null);
  assert.match('reason' in choice ? choice.reason : '', /Several long titles \(2h00, 1h52\)/);
});

test('look-alikes of the same video: the dubbed one, even if smaller', () => {
  const choice = pickMainTitle(
    [title(0, 128, { segmentsMap: '1-9', streams: streams(['eng', 'jpn']) }), title(1, 128, { segmentsMap: '1-9', sizeBytes: 1 })],
    ITA
  );
  assert.equal(choice.title?.index, 1);
});

test('2-in-1 disc with region playlists: the only cut dubbed in the kept language', () => {
  // Horrible Bosses EUR: theatrical and extended cut, each also as a Japanese playlist
  const theatrical = '4,17,9,18,10,11,19,20';
  const extended = '4,33,9,34,10,35,19,36';
  const titles = [
    title(0, 98, { segmentsMap: theatrical, streams: streams(['eng', 'eng', 'eng', 'fra', 'ita', 'spa', 'tha'], ['eng', 'ita']) }),
    title(1, 106, { segmentsMap: extended, streams: streams(['eng', 'eng'], ['eng', 'fra', 'ita']) }),
    title(2, 98, { segmentsMap: theatrical, streams: streams(['eng', 'eng', 'jpn'], ['jpn', 'eng']) }),
    title(3, 106, { segmentsMap: extended, streams: streams(['eng', 'eng'], ['jpn', 'eng']) }),
  ];
  assert.equal(pickMainTitle(titles, ITA).title?.index, 0);
});
