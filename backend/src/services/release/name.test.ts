import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MediaInfo } from '../../types/index.js';
import { analyze, buildReleaseName, dotted, isAutoHybrid, pythonTitle, validateFlags, versionTag } from './name.js';

const video = (width: number, height: number, hdr: string | null = null) => ({
  index: 0,
  codec: 'hevc',
  profile: null,
  width,
  height,
  aspectRatio: null,
  frameRate: null,
  bitDepth: null,
  pixelFormat: null,
  colorSpace: null,
  hdr,
  language: 'und',
});

const media = (overrides: Partial<MediaInfo> = {}): MediaInfo => ({
  container: { format: 'Matroska / WebM', title: null, duration: 7200, bitrate: null, chapters: 10 },
  videoTracks: [video(1920, 1080)],
  audioTracks: [
    { index: 1, language: 'ita', codec: 'dts', profile: 'DTS-HD MA', bitrate: 3_000_000 },
    { index: 2, language: 'eng', codec: 'truehd', profile: 'Dolby TrueHD + Dolby Atmos', bitrate: 4_000_000 },
    { index: 3, language: 'eng', codec: 'ac3', profile: null, bitrate: 640_000 },
  ],
  subtitles: [
    { index: 4, language: 'eng', codec: 'hdmv_pgs_subtitle' },
    { index: 5, language: 'ita', codec: 'hdmv_pgs_subtitle' },
    { index: 6, language: 'ita', codec: 'hdmv_pgs_subtitle', forced: true },
  ],
  hasItalianAudio: true,
  hasItalianSubtitles: true,
  ...overrides,
});

const flags = { title: 'il padrino', year: '1972', version: '', remux: true };

test('moverr name of a 1080p remux', () => {
  const analysis = analyze(media());
  assert.deepEqual(analysis.audio, [
    { codec: 'DTSHD.MA', language: 'ITA' },
    { codec: 'TRUEHD.ATMOS', language: 'ENG' },
  ]);
  assert.deepEqual(analysis.subtitles, ['ITA', 'ENG']);
  assert.equal(
    buildReleaseName(flags, analysis, 'mkv', 'MaTiTa'),
    'Il.Padrino.1972.REMUX.1080P.VU.DTSHD.MA.ITA.TRUEHD.ATMOS.ENG.SUBS.ITA.ENG-MaTiTa.mkv'
  );
});

test('not a remux: no REMUX and no VU; no tag', () => {
  assert.equal(
    buildReleaseName({ ...flags, remux: false }, analyze(media()), 'mkv', null),
    'Il.Padrino.1972.1080P.DTSHD.MA.ITA.TRUEHD.ATMOS.ENG.SUBS.ITA.ENG.mkv'
  );
});

test('Dolby Vision profile 8 on a remux is HYBRID, not VU', () => {
  const analysis = analyze(media({ videoTracks: [video(3840, 2160, 'Dolby Vision P8 + HDR10')] }));
  assert.equal(analysis.video.dvProfile, 8);
  assert.equal(isAutoHybrid(flags, analysis), true);
  assert.equal(
    buildReleaseName({ ...flags, version: 'Extended' }, analysis, 'mkv', 'TAG'),
    'Il.Padrino.1972.EXTENDED.HYBRID.REMUX.2160P.DV.P8.HDR10.DTSHD.MA.ITA.TRUEHD.ATMOS.ENG.SUBS.ITA.ENG-TAG.mkv'
  );
});

test('Dolby Vision profile 7 remux keeps VU; HLG and plain HDR10', () => {
  const p7 = analyze(media({ videoTracks: [video(3840, 2160, 'Dolby Vision P7 + HDR10')] }));
  assert.match(buildReleaseName(flags, p7, 'mkv'), /\.REMUX\.2160P\.VU\.DV\.P7\.HDR10\./);
  const hlg = analyze(media({ videoTracks: [video(3840, 2160, 'HLG')] }));
  assert.match(buildReleaseName(flags, hlg, 'mkv'), /\.2160P\.VU\.HLG\./);
  const p5 = analyze(media({ videoTracks: [video(3840, 2160, 'Dolby Vision P5')] }));
  assert.match(buildReleaseName(flags, p5, 'mkv'), /\.VU\.DV\.P5\.DTSHD/);
});

test('more than two languages: the first two, then MULTI; others are flagged', () => {
  const analysis = analyze(
    media({
      audioTracks: [
        { index: 1, language: 'fre', codec: 'ac3' },
        { index: 2, language: 'eng', codec: 'eac3', title: 'English Atmos' },
        { index: 3, language: 'ita', codec: 'eac3' },
        { index: 4, language: 'ger', codec: 'dts', profile: 'DTS-HD HRA' },
      ],
      subtitles: [
        { index: 5, language: 'spa', codec: 'subrip' },
        { index: 6, language: 'ita', codec: 'subrip' },
        { index: 7, language: 'unknown', codec: 'subrip' },
      ],
    })
  );
  assert.deepEqual(analysis.extraLanguages, { audio: ['FRE (AC3)', 'GER (DTSHD.HRA)'], subtitles: ['SPA'] });
  assert.match(
    buildReleaseName({ ...flags, remux: false }, analysis, 'mkv'),
    /\.1080P\.EAC3\.ITA\.EAC3\.ATMOS\.ENG\.MULTI\.SUBS\.ITA\.SPA\.MULTI\.mkv$/
  );
});

test('the best codec of a language wins, the first one on a tie', () => {
  const analysis = analyze(
    media({
      audioTracks: [
        { index: 1, language: 'ita', codec: 'ac3', bitrate: 448_000 },
        { index: 2, language: 'ita', codec: 'ac3', bitrate: 640_000 },
        { index: 3, language: 'ita', codec: 'flac' },
      ],
    })
  );
  assert.deepEqual(analysis.audio, [{ codec: 'FLAC', language: 'ITA' }]);
});

test('a film cropped to a wide ratio counts by its width; no subtitles, no SUBS', () => {
  const analysis = analyze(media({ videoTracks: [video(1920, 800)], subtitles: [] }));
  assert.equal(analysis.video.resolution, '1080P');
  assert.doesNotMatch(buildReleaseName(flags, analysis, 'mkv'), /SUBS/);
  assert.equal(analyze(media({ videoTracks: [video(720, 576)] })).video.resolution, '576P');
});

test('title case, edition and signs like Python', () => {
  assert.equal(pythonTitle("l'uomo.DEL.treno"), "L'Uomo.Del.Treno");
  assert.equal(pythonTitle('2001.odissea.nello.spazio'), '2001.Odissea.Nello.Spazio');
  assert.equal(versionTag("Director's Cut"), 'DIRECTORS.CUT');
  assert.equal(versionTag('  director  cut '), 'DIRECTOR.CUT');
  assert.equal(
    buildReleaseName({ ...flags, title: 'Mission: Impossible  ', remux: false }, analyze(media({ audioTracks: [], subtitles: [] })), 'mkv'),
    'Mission.Impossible.1972.1080P.mkv'
  );
});

test('the title keeps only letters and digits', () => {
  assert.equal(dotted("Stuber - Autista D'Assalto"), 'Stuber.Autista.D.Assalto');
  assert.equal(dotted('La città & il mare!'), 'La.citta.il.mare');
  assert.equal(versionTag('Director’s Cut (4K)'), 'DIRECTORS.CUT.4K');
  assert.equal(
    buildReleaseName({ ...flags, title: "Stuber - Autista D'Assalto", year: '2019', remux: false }, analyze(media({ audioTracks: [], subtitles: [] })), 'mkv'),
    'Stuber.Autista.D.Assalto.2019.1080P.mkv'
  );
});

test('name and year are required', () => {
  assert.equal(validateFlags(flags), null);
  assert.equal(validateFlags({ ...flags, title: ' ' }), 'The film name is missing');
  assert.equal(validateFlags({ ...flags, year: '72' }), 'The year must have 4 digits');
});
