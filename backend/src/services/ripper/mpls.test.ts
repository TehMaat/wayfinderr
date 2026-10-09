import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMpls, playlistNumber } from './mpls.js';

// A playlist laid out as libbluray parses it (bdnav/mpls_parse.c)
const u8 = (v: number) => Buffer.from([v]);
const u16 = (v: number) => {
  const b = Buffer.alloc(2);
  b.writeUInt16BE(v);
  return b;
};
const u32 = (v: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(v);
  return b;
};
const withLength16 = (body: Buffer) => Buffer.concat([u16(body.length), body]);
const withLength32 = (body: Buffer) => Buffer.concat([u32(body.length), body]);

// Stream entry: stream_type 1 (in the play item's clip) + PID; then the attributes
const stream = (pid: number, attributes: Buffer, streamType = 1) =>
  Buffer.concat([
    u8(9),
    streamType === 1 ? Buffer.concat([u8(1), u16(pid), Buffer.alloc(6)]) : Buffer.concat([u8(streamType), u8(0), u16(pid), Buffer.alloc(5)]),
    u8(attributes.length),
    attributes,
  ]);
const video = (pid: number) => stream(pid, Buffer.from([0x1b, 0x61, 0, 0, 0]));
const audio = (pid: number, lang: string, coding = 0x81) => stream(pid, Buffer.concat([Buffer.from([coding, 0x31]), Buffer.from(lang)]));
const pgs = (pid: number, lang: string) => stream(pid, Buffer.concat([Buffer.from([0x90]), Buffer.from(lang), Buffer.alloc(1)]));

interface Item {
  clip: string;
  inTime: number;
  outTime: number;
  angles?: string[];
}

const stn = (streams: { video: Buffer[]; audio: Buffer[]; pg: Buffer[] }) =>
  withLength16(
    Buffer.concat([
      u16(0),
      Buffer.from([streams.video.length, streams.audio.length, streams.pg.length, 0, 0, 0, 0, 0]),
      Buffer.alloc(4),
      ...streams.video,
      ...streams.audio,
      ...streams.pg,
    ])
  );

const playItem = (item: Item, table: Buffer) => {
  const multiAngle = (item.angles?.length ?? 0) > 0;
  return withLength16(
    Buffer.concat([
      Buffer.from(`${item.clip}M2TS`),
      u16((multiAngle ? 0x10 : 0) | 1), // is_multi_angle, connection_condition 1
      u8(0),
      u32(item.inTime),
      u32(item.outTime),
      Buffer.alloc(8), // UO mask
      Buffer.alloc(4), // random access, still mode, still time
      ...(multiAngle
        ? [u8(item.angles!.length + 1), u8(0), ...item.angles!.map((clip) => Buffer.concat([Buffer.from(`${clip}M2TS`), u8(0)]))]
        : []),
      table,
    ])
  );
};

const mpls = (items: Item[], marks: number[], table: Buffer) => {
  const appInfo = withLength32(Buffer.concat([Buffer.from([0, 1]), u16(0), Buffer.alloc(8), u16(0x4000)]));
  const playlist = withLength32(Buffer.concat([u16(0), u16(items.length), u16(0), ...items.map((item) => playItem(item, table))]));
  const markEntries = marks.map((type, i) => Buffer.concat([u8(0), u8(type), u16(0), u32(i * 45_000), u16(0xffff), u32(0)]));
  const playlistMarks = withLength32(Buffer.concat([u16(marks.length), ...markEntries]));
  const listPos = 40 + appInfo.length;
  const header = Buffer.concat([Buffer.from('MPLS0200'), u32(listPos), u32(listPos + playlist.length), u32(0), Buffer.alloc(20)]);
  return Buffer.concat([header, appInfo, playlist, playlistMarks]);
};

const TABLE = stn({
  video: [video(0x1011)],
  audio: [audio(0x1100, 'eng', 0x83), audio(0x1101, 'ita')],
  pg: [pgs(0x1200, 'ita'), pgs(0x1201, 'eng')],
});

test('play items, length, chapters and streams', () => {
  const playlist = parseMpls(
    mpls(
      [
        { clip: '00001', inTime: 0, outTime: 45_000 * 60 },
        { clip: '00002', inTime: 45_000 * 10, outTime: 45_000 * 40 },
      ],
      [1, 1, 2, 1],
      TABLE
    )
  );
  assert.deepEqual(
    playlist.playItems.map((item) => item.clipId),
    ['00001', '00002']
  );
  assert.equal(playlist.durationSec, 90);
  // Entry marks only (type 2 is a link point)
  assert.equal(playlist.chapters, 3);
  assert.deepEqual(
    playlist.streams.map((s) => `${s.type}:${s.lang ?? '-'}:${s.codec}:${s.pid.toString(16)}`),
    ['video:-:H.264:1011', 'audio:eng:TrueHD:1100', 'audio:ita:AC-3:1101', 'subtitle:ita:PGS:1200', 'subtitle:eng:PGS:1201']
  );
});

test('a multi-angle play item: the streams after the other angles are still read', () => {
  const playlist = parseMpls(mpls([{ clip: '00010', inTime: 0, outTime: 45_000, angles: ['00011', '00012'] }], [], TABLE));
  assert.deepEqual(
    playlist.playItems.map((item) => item.clipId),
    ['00010']
  );
  assert.equal(playlist.streams.length, 5);
  assert.equal(playlist.streams[2].lang, 'ita');
});

test('streams of a sub path are left out', () => {
  const table = stn({ video: [video(0x1011)], audio: [audio(0x1100, 'ita'), stream(0x1a00, Buffer.from([0x81, 0x31, 0x65, 0x6e, 0x67]), 3)], pg: [] });
  const playlist = parseMpls(mpls([{ clip: '00001', inTime: 0, outTime: 45_000 }], [], table));
  assert.deepEqual(
    playlist.streams.map((s) => s.lang ?? '-'),
    ['-', 'ita']
  );
});

test('not a playlist', () => {
  assert.throws(() => parseMpls(Buffer.from('MOBJ0200'.padEnd(64, '\0'))), /Not a Blu-ray playlist/);
});

test('playlist numbers', () => {
  assert.equal(playlistNumber('00800.mpls'), 800);
  assert.equal(playlistNumber('00800.MPLS'), 800);
  assert.equal(playlistNumber('800.mpls'), null);
});
