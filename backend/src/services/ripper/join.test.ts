import { test } from 'node:test';
import assert from 'node:assert/strict';
import { joinArgs, PartTrack, partTracks, trackMismatch } from './join.js';

const part: PartTrack[] = [
  { type: 'video', codec: 'AVC/H.264/MPEG-4p10' },
  { type: 'audio', codec: 'DTS-HD Master Audio', lang: 'ita' },
  { type: 'audio', codec: 'AC-3', lang: 'eng' },
  { type: 'subtitles', codec: 'HDMV PGS', lang: 'ita' },
];

test('joinArgs appends the parts in order', () => {
  assert.deepEqual(joinArgs(['/w/part1.mkv', '/w/part2.mkv', '/w/part3.mkv'], '/w/film.mkv'), [
    '--gui-mode',
    '--flush-on-close',
    '-o',
    '/w/film.mkv',
    '/w/part1.mkv',
    '+',
    '/w/part2.mkv',
    '+',
    '/w/part3.mkv',
  ]);
});

test('partTracks keeps type, codec and a known language', () => {
  assert.deepEqual(
    partTracks([
      { id: 0, type: 'video', codec: 'AVC', properties: { language: 'und' } },
      { id: 1, type: 'audio', codec: 'AC-3', properties: { language: 'ITA' } },
    ]),
    [
      { type: 'video', codec: 'AVC' },
      { type: 'audio', codec: 'AC-3', lang: 'ita' },
    ]
  );
});

test('trackMismatch accepts parts with the same tracks', () => {
  assert.equal(trackMismatch([part, part.map((t) => ({ ...t }))]), null);
  assert.equal(trackMismatch([part, part, part]), null);
});

test('trackMismatch refuses a different number of tracks', () => {
  assert.equal(
    trackMismatch([part, part.slice(0, 3)]),
    "The parts have different tracks (part 1: 1 video, 2 audio, 1 subtitles; part 2: 1 video, 2 audio): they can't be joined"
  );
});

test('trackMismatch refuses languages in another order', () => {
  const swapped = [part[0], part[2], part[1], part[3]];
  assert.equal(
    trackMismatch([part, part, swapped]),
    "Track 2 is audio DTS-HD Master Audio ita in part 1, audio AC-3 eng in part 3: the parts can't be joined"
  );
});

test('trackMismatch refuses another codec', () => {
  const other = part.map((t, i) => (i === 0 ? { ...t, codec: 'HEVC/H.265/MPEG-H' } : t));
  assert.match(trackMismatch([part, other])!, /^Track 1 is video AVC\/H.264\/MPEG-4p10 in part 1, video HEVC/);
});
