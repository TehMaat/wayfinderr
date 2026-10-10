import { DiscStream } from './makemkv.js';

/**
 * Blu-ray playlists (BDMV/PLAYLIST/*.mpls): what the rip without MakeMKV needs
 * to choose the film's playlist on its own, as MakeMKV's scan would. Layout as
 * parsed by libbluray (src/libbluray/bdnav/mpls_parse.c); times are in 45 kHz
 * ticks.
 */

export interface PlayItem {
  clipId: string; // "00012": BDMV/STREAM/00012.m2ts, BDMV/CLIPINF/00012.clpi
  inTime: number;
  outTime: number;
}

export interface Playlist {
  playItems: PlayItem[];
  durationSec: number;
  chapters: number; // entry marks
  // Streams of the first play item (STN table): languages as on the disc (ISO 639-2)
  streams: (DiscStream & { pid: number })[];
}

const TICKS_PER_SECOND = 45_000;
const ENTRY_MARK = 1;

// STN coding types: PG (0x90) and text subtitles (0x92) share the subtitle list
const VIDEO_CODINGS = new Set([0x01, 0x02, 0x1b, 0x20, 0x24, 0xea]);
const AUDIO_CODINGS = new Set([0x03, 0x04, 0x80, 0x81, 0x82, 0x83, 0x84, 0x85, 0x86, 0xa1, 0xa2]);
const SUBTITLE_CODINGS = new Set([0x90, 0x92]);

const CODECS: Record<number, string> = {
  0x01: 'MPEG-1', 0x02: 'MPEG-2', 0x1b: 'H.264', 0x20: 'MVC', 0x24: 'HEVC', 0xea: 'VC-1',
  0x03: 'MPEG audio', 0x04: 'MPEG audio', 0x80: 'LPCM', 0x81: 'AC-3', 0x82: 'DTS', 0x83: 'TrueHD',
  0x84: 'E-AC-3', 0x85: 'DTS-HD HRA', 0x86: 'DTS-HD MA', 0xa1: 'E-AC-3', 0xa2: 'DTS-HD',
  0x90: 'PGS', 0x92: 'TextST',
};

const text = (buf: Buffer, start: number, length: number) => buf.toString('latin1', start, start + length);

/** One stream entry of the STN table, at offset; returns it and the offset after it. */
const parseStream = (buf: Buffer, offset: number) => {
  const entryLength = buf.readUInt8(offset);
  const entryStart = offset + 1;
  const streamType = buf.readUInt8(entryStart);
  // stream_type 1: in the play item's clip; 2-4: in a sub path
  const pid =
    streamType === 1 ? buf.readUInt16BE(entryStart + 1) : streamType === 2 ? buf.readUInt16BE(entryStart + 3) : buf.readUInt16BE(entryStart + 2);
  let at = entryStart + entryLength;
  const attrLength = buf.readUInt8(at);
  const attrStart = at + 1;
  const coding = buf.readUInt8(attrStart);
  let lang: string | undefined;
  if (AUDIO_CODINGS.has(coding)) lang = text(buf, attrStart + 2, 3);
  else if (coding === 0x90 || coding === 0x91) lang = text(buf, attrStart + 1, 3);
  else if (coding === 0x92) lang = text(buf, attrStart + 2, 3);
  at = attrStart + attrLength;
  return { stream: { pid, coding, streamType, lang: lang?.replace(/\0/g, '').trim().toLowerCase() || undefined }, next: at };
};

/** Video, audio and subtitle streams of a play item's STN table. */
const parseStn = (buf: Buffer, offset: number): Playlist['streams'] => {
  // length (16), reserved (16), then the number of streams of each kind
  const counts = offset + 4;
  const video = buf.readUInt8(counts);
  const audio = buf.readUInt8(counts + 1);
  const pg = buf.readUInt8(counts + 2);
  const pipPg = buf.readUInt8(counts + 6);
  let at = counts + 8 + 4;

  const streams: Playlist['streams'] = [];
  const read = (n: number, type: DiscStream['type'], codings: Set<number>) => {
    for (let i = 0; i < n; i++) {
      const { stream, next } = parseStream(buf, at);
      at = next;
      // Only streams of the main clip: a sub path's are not in its m2ts
      if (stream.streamType !== 1 || !codings.has(stream.coding)) continue;
      streams.push({
        type,
        pid: stream.pid,
        codec: CODECS[stream.coding],
        ...(type !== 'video' && stream.lang ? { lang: stream.lang } : {}),
        forced: false,
        commentary: false,
      });
    }
  };
  read(video, 'video', VIDEO_CODINGS);
  read(audio, 'audio', AUDIO_CODINGS);
  // Picture-in-picture subtitles follow the main ones in the same list
  read(pg, 'subtitle', SUBTITLE_CODINGS);
  read(pipPg, 'subtitle', new Set());
  return streams;
};

/** The play items, length, chapters and streams of an .mpls file; throws on anything else. */
export const parseMpls = (buf: Buffer): Playlist => {
  if (buf.length < 40 || text(buf, 0, 4) !== 'MPLS') throw new Error('Not a Blu-ray playlist');
  const listPos = buf.readUInt32BE(8);
  const markPos = buf.readUInt32BE(12);

  // PlayList(): length (32), reserved (16), play items (16), sub paths (16)
  const itemCount = buf.readUInt16BE(listPos + 6);
  let at = listPos + 10;
  const playItems: PlayItem[] = [];
  let streams: Playlist['streams'] = [];
  for (let i = 0; i < itemCount; i++) {
    const length = buf.readUInt16BE(at);
    const start = at + 2;
    const clipId = text(buf, start, 5);
    // reserved (11 bits), is_multi_angle (1), connection_condition (4)
    const multiAngle = (buf.readUInt16BE(start + 9) & 0x10) !== 0;
    const inTime = buf.readUInt32BE(start + 12);
    const outTime = buf.readUInt32BE(start + 16);
    // UO mask (64), random access (8), still mode (8), still time (16)
    let stn = start + 32;
    if (multiAngle) {
      // angle count (8), flags (8), then 10 bytes for every angle after the first
      const angles = Math.max(1, buf.readUInt8(stn));
      stn += 2 + (angles - 1) * 10;
    }
    if (i === 0) streams = parseStn(buf, stn);
    playItems.push({ clipId, inTime, outTime });
    at = start + length;
  }

  // PlayListMark(): length (32), count (16), then 14 bytes per mark
  const markCount = buf.readUInt16BE(markPos + 4);
  let chapters = 0;
  for (let i = 0; i < markCount; i++) {
    if (buf.readUInt8(markPos + 6 + i * 14 + 1) === ENTRY_MARK) chapters++;
  }

  const ticks = playItems.reduce((total, item) => total + Math.max(0, item.outTime - item.inTime), 0);
  return { playItems, durationSec: ticks / TICKS_PER_SECOND, chapters, streams };
};

/** "00800.mpls" -> 800 */
export const playlistNumber = (file: string): number | null => {
  const match = /^(\d{5})\.mpls$/i.exec(file);
  return match ? Number(match[1]) : null;
};
