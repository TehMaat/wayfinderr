import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ffmpegMapArgs,
  missingTools,
  mkvmergeTrackArgs,
  mkvmergeTracks,
  parseFfmpegProgress,
  parseMkvmergeProgress,
  parseSevenZipListing,
  pickTracks,
  Track,
} from './remux.js';

const ITA_ENG = [['ita'], ['eng']];

const tracks: Track[] = [
  { id: 0, type: 'video' },
  { id: 1, type: 'audio', lang: 'eng' },
  { id: 2, type: 'audio', lang: 'fre' },
  { id: 3, type: 'audio', lang: 'ita' },
  { id: 4, type: 'subtitle', lang: 'eng' },
  { id: 5, type: 'subtitle', lang: 'ita' },
  { id: 6, type: 'subtitle', lang: 'ger' },
  { id: 7, type: 'subtitle' },
];

const ids = (list: Track[]) => list.map((t) => t.id);

test('Italian and the original language, Italian first and default', () => {
  const choice = pickTracks(tracks, ITA_ENG, false);
  assert.deepEqual(ids(choice.video), [0]);
  assert.deepEqual(ids(choice.audio), [3, 1]);
  // Tracks without a language are kept, after the languages
  assert.deepEqual(ids(choice.subtitles), [5, 4, 7]);
  assert.equal(choice.defaultAudio, 3);
  assert.equal(choice.defaultSubtitle, null);
});

test('no Italian audio: the Italian subtitles are the default', () => {
  const choice = pickTracks(tracks.filter((t) => t.id !== 3), ITA_ENG, false);
  assert.deepEqual(ids(choice.audio), [1]);
  assert.equal(choice.defaultAudio, 1);
  assert.equal(choice.defaultSubtitle, 5);
});

test('original language unknown: every language, Italian first', () => {
  const choice = pickTracks(tracks, [['ita']], true);
  assert.deepEqual(ids(choice.audio), [3, 1, 2]);
  assert.deepEqual(ids(choice.subtitles), [5, 4, 6, 7]);
});

test('the only track of its kind is kept whatever its language', () => {
  const choice = pickTracks([{ id: 0, type: 'video' }, { id: 1, type: 'audio', lang: 'jpn' }, { id: 2, type: 'subtitle', lang: 'kor' }], ITA_ENG, false);
  assert.deepEqual(ids(choice.audio), [1]);
  assert.deepEqual(ids(choice.subtitles), [2]);
});

test('never without audio: none in the kept languages keeps them all', () => {
  const choice = pickTracks(
    [{ id: 0, type: 'video' }, { id: 1, type: 'audio', lang: 'fre' }, { id: 2, type: 'audio', lang: 'ger' }],
    ITA_ENG,
    false
  );
  assert.deepEqual(ids(choice.audio), [1, 2]);
});

test("the AC-3 core of a TrueHD track is dropped, mkvmerge's languages are read", () => {
  const found = mkvmergeTracks({
    tracks: [
      { id: 0, type: 'video', codec: 'AVC/H.264/MPEG-4p10', properties: { language: 'und' } },
      { id: 1, type: 'audio', codec: 'TrueHD Atmos', properties: { language: 'eng', multiplexed_tracks: [1, 2] } },
      { id: 2, type: 'audio', codec: 'AC-3', properties: { language: 'eng', multiplexed_tracks: [1, 2] } },
      { id: 3, type: 'audio', codec: 'AC-3', properties: { language: 'ita' } },
      { id: 4, type: 'subtitles', codec: 'HDMV PGS', properties: { language: 'ita' } },
      { id: 5, type: 'buttons', codec: 'HDMV IG' },
    ],
  });
  assert.deepEqual(found, [
    { id: 0, type: 'video' },
    { id: 1, type: 'audio', lang: 'eng' },
    { id: 2, type: 'audio', lang: 'eng', core: true },
    { id: 3, type: 'audio', lang: 'ita' },
    { id: 4, type: 'subtitle', lang: 'ita' },
  ]);
  assert.deepEqual(ids(pickTracks(found, ITA_ENG, false).audio), [3, 1]);
});

test('mkvmerge options: chosen tracks in order, explicit default flags', () => {
  const args = mkvmergeTrackArgs(pickTracks(tracks, ITA_ENG, false));
  assert.deepEqual(args, [
    '-d', '0',
    '-a', '3,1',
    '-s', '5,4,7',
    '-B',
    '-M',
    '--track-order', '0:0,0:3,0:1,0:5,0:4,0:7',
    '--default-track-flag', '3:1',
    '--default-track-flag', '1:0',
    '--default-track-flag', '5:0',
    '--default-track-flag', '4:0',
    '--default-track-flag', '7:0',
  ]);
});

test('mkvmerge options without subtitles', () => {
  const args = mkvmergeTrackArgs(pickTracks(tracks.filter((t) => t.type !== 'subtitle'), ITA_ENG, false));
  assert.ok(args.includes('-S'));
  assert.ok(!args.includes('-s'));
});

test('ffmpeg options: streams mapped in order, dispositions per output stream', () => {
  const args = ffmpegMapArgs(pickTracks(tracks.filter((t) => t.id !== 3), ITA_ENG, false));
  assert.deepEqual(args, [
    '-map', '0:0',
    '-map', '0:1',
    '-map', '0:5',
    '-map', '0:4',
    '-map', '0:7',
    '-disposition:v:0', 'default',
    '-disposition:a:0', 'default',
    '-disposition:s:0', 'default',
    '-disposition:s:1', '0',
    '-disposition:s:2', '0',
  ]);
});

test('mkvmerge progress: the scan of the playlist clips is not the mux', () => {
  assert.equal(parseMkvmergeProgress('#GUI#begin_scanning_playlists#num_playlists=1\n#GUI#progress 50%\n'), null);
  assert.equal(parseMkvmergeProgress('#GUI#begin_scanning_playlists\n#GUI#progress 100%\n#GUI#end_scanning_playlists\n'), null);
  assert.equal(
    parseMkvmergeProgress('#GUI#begin_scanning_playlists\n#GUI#progress 100%\n#GUI#end_scanning_playlists\n#GUI#progress 0%\n#GUI#progress 37%\n'),
    37
  );
  // A plain file: no playlist scan
  assert.equal(parseMkvmergeProgress('#GUI#progress 12%\n#GUI#progress 13%\n'), 13);
});

test('ffmpeg progress from out_time_us', () => {
  assert.equal(parseFfmpegProgress('frame=10\nout_time_us=30000000\nprogress=continue\nout_time_us=45000000\n', 90), 50);
  assert.equal(parseFfmpegProgress('progress=continue\n', 90), null);
  assert.equal(parseFfmpegProgress('out_time_us=95000000\n', 90), 100);
});

test('7-Zip technical listing', () => {
  const output = [
    '7-Zip (z) 26.02 (x64)',
    '',
    'Listing archive: /downloads/film.iso',
    '',
    '--',
    'Path = /downloads/film.iso',
    'Type = Udf',
    '',
    '----------',
    'Path = BDMV',
    'Folder = +',
    'Size = 0',
    '',
    'Path = BDMV/index.bdmv',
    'Folder = -',
    'Size = 278',
    '',
    'Path = BDMV/STREAM/00012.m2ts',
    'Folder = -',
    'Size = 30000000000',
    '',
  ].join('\n');
  assert.deepEqual(parseSevenZipListing(output), [
    { path: 'BDMV', size: 0, folder: true },
    { path: 'BDMV/index.bdmv', size: 278, folder: false },
    { path: 'BDMV/STREAM/00012.m2ts', size: 30_000_000_000, folder: false },
  ]);
});

test('the tools each disc needs', () => {
  const all = { mkvmerge: true, sevenZip: true, dvd: true };
  assert.equal(missingTools(all, 'ISO'), null);
  assert.equal(missingTools({ ...all, dvd: false }, 'BDMV'), null);
  assert.equal(missingTools({ ...all, dvd: false }, 'DVD'), 'ffmpeg with DVD support (DVD)');
  assert.equal(missingTools({ ...all, mkvmerge: false }, 'BDMV'), 'mkvmerge (Blu-ray)');
  // An ISO may be either: one of the two will do until it is opened
  assert.equal(missingTools({ ...all, dvd: false }, 'ISO'), null);
  assert.equal(missingTools({ ...all, sevenZip: false }, 'ISO'), '7-Zip (ISO images)');
});
