/**
 * makemkvcon robot output (-r): parsing of `info` and `mkv` runs, and the track
 * selection rule for a rip. Attribute ids and flags come from apdefs.h in
 * makemkv-oss: they never change between versions.
 */

// AP_ItemAttributeId
const ATTR = {
  type: 1,
  name: 2,
  langCode: 3,
  langName: 4,
  codecShort: 6,
  chapters: 8,
  duration: 9,
  sizeBytes: 11,
  channels: 14,
  angle: 15,
  sourceFile: 16,
  streamFlags: 22,
  segmentsMap: 26,
  outputFileName: 27,
  treeInfo: 30,
  volumeName: 32,
};

// APP_TTREE_* codes of the stream type attribute
const STREAM_TYPES: Record<number, DiscStream['type']> = { 6201: 'video', 6202: 'audio', 6203: 'subtitle' };

// AP_AVStreamFlag_*
const FLAG_COMMENTARY = 1 | 2;
const FLAG_FORCED = 4096;

// AP_UIMSG_*: the box type of a message
const BOX_MASK = 3854;
const BOX_ERROR = [516, 1288];
const BOX_REGISTRATION = 1544;
// Messages that mean the source could not be read, even with exit code 0
// (5010 "Failed to open disc"), or a registration problem (5020 invalid key,
// 5021 version too old, 5073 temporary key expired: exit code 253)
const FAILURE_CODES = new Set([5010, 5020, 5021, 5073]);

export const PROGRESS_MAX = 65536;

export interface DiscStream {
  type: 'video' | 'audio' | 'subtitle';
  lang?: string; // ISO 639-2, as MakeMKV reports it
  langName?: string;
  codec?: string;
  channels?: number;
  forced: boolean;
  commentary: boolean;
}

export interface DiscTitle {
  index: number;
  name?: string;
  durationSec: number;
  sizeBytes: number;
  chapters: number;
  segmentsMap?: string;
  sourceFile?: string;
  outputFileName?: string;
  angle?: string;
  streams: DiscStream[];
}

export interface DiscInfo {
  name?: string;
  titles: DiscTitle[];
  errors: string[];
}

export interface RobotMessage {
  code: number;
  flags: number;
  text: string;
}

/** Splits `KEY:a,"b, \"c\"",3` into the key and its fields (quotes removed). */
export const parseRobotLine = (line: string): { key: string; fields: string[] } | null => {
  const colon = line.indexOf(':');
  if (colon <= 0) return null;
  const key = line.slice(0, colon);
  const fields: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = colon + 1; i < line.length; i++) {
    const char = line[i];
    if (quoted) {
      if (char === '\\' && i + 1 < line.length) field += line[++i];
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      fields.push(field);
      field = '';
    } else {
      field += char;
    }
  }
  fields.push(field.replace(/\r$/, ''));
  return { key, fields };
};

const robotLines = function* (output: string) {
  for (const line of output.split('\n')) {
    const parsed = parseRobotLine(line);
    if (parsed) yield parsed;
  }
};

/** "1:58:32" -> 7112 */
export const parseDuration = (value: string): number =>
  value.split(':').reduce((total, part) => total * 60 + (Number(part) || 0), 0);

const isError = (flags: number) => BOX_ERROR.includes(flags & BOX_MASK) || (flags & BOX_MASK) === BOX_REGISTRATION;

export const parseMessages = (output: string): RobotMessage[] => {
  const messages: RobotMessage[] = [];
  for (const { key, fields } of robotLines(output)) {
    if (key === 'MSG') messages.push({ code: Number(fields[0]), flags: Number(fields[1]), text: fields[3] ?? '' });
  }
  return messages;
};

/** Titles and streams of an `info` run. */
export const parseInfo = (output: string): DiscInfo => {
  const info: DiscInfo = { titles: [], errors: [] };
  const titles = new Map<number, DiscTitle>();
  const title = (index: number) => {
    let t = titles.get(index);
    if (!t) {
      t = { index, durationSec: 0, sizeBytes: 0, chapters: 0, streams: [] };
      titles.set(index, t);
    }
    return t;
  };
  const streamsByTitle = new Map<number, Map<number, Partial<DiscStream> & { flags?: number }>>();

  for (const { key, fields } of robotLines(output)) {
    if (key === 'CINFO') {
      const [attr, , value] = [Number(fields[0]), fields[1], fields[2]];
      if (attr === ATTR.name) info.name = value;
      else if (attr === ATTR.volumeName && !info.name) info.name = value;
    } else if (key === 'TINFO') {
      const t = title(Number(fields[0]));
      const attr = Number(fields[1]);
      const value = fields[3] ?? '';
      if (attr === ATTR.name) t.name = value;
      else if (attr === ATTR.duration) t.durationSec = parseDuration(value);
      else if (attr === ATTR.sizeBytes) t.sizeBytes = Number(value) || 0;
      else if (attr === ATTR.chapters) t.chapters = Number(value) || 0;
      else if (attr === ATTR.segmentsMap) t.segmentsMap = value;
      else if (attr === ATTR.sourceFile) t.sourceFile = value;
      else if (attr === ATTR.outputFileName) t.outputFileName = value;
      else if (attr === ATTR.angle) t.angle = value;
    } else if (key === 'SINFO') {
      const index = Number(fields[0]);
      title(index);
      const streams = streamsByTitle.get(index) ?? new Map();
      streamsByTitle.set(index, streams);
      const streamIndex = Number(fields[1]);
      const stream = streams.get(streamIndex) ?? {};
      streams.set(streamIndex, stream);
      const attr = Number(fields[2]);
      const code = Number(fields[3]);
      const value = fields[4] ?? '';
      if (attr === ATTR.type) stream.type = STREAM_TYPES[code];
      else if (attr === ATTR.langCode) stream.lang = value.toLowerCase();
      else if (attr === ATTR.langName) stream.langName = value;
      else if (attr === ATTR.codecShort) stream.codec = value;
      else if (attr === ATTR.channels) stream.channels = Number(value) || undefined;
      else if (attr === ATTR.streamFlags) stream.flags = Number(value) || 0;
    } else if (key === 'MSG') {
      if (isError(Number(fields[1])) || FAILURE_CODES.has(Number(fields[0]))) info.errors.push(fields[3] ?? '');
    }
  }

  for (const [index, streams] of streamsByTitle) {
    const t = title(index);
    t.streams = [...streams.entries()]
      .sort(([a], [b]) => a - b)
      .filter(([, s]) => s.type)
      .map(([, { flags = 0, ...s }]) => ({
        ...(s as DiscStream),
        forced: (flags & FLAG_FORCED) !== 0,
        commentary: (flags & FLAG_COMMENTARY) !== 0,
      }));
  }
  info.titles = [...titles.values()].sort((a, b) => a.index - b.index);
  return info;
};

/** Progress of a running `mkv` job, 0-100, from its last PRGV line. */
export const parseProgress = (output: string): number | null => {
  const last = output.lastIndexOf('PRGV:');
  if (last < 0) return null;
  const end = output.indexOf('\n', last);
  const parsed = parseRobotLine(output.slice(last, end < 0 ? undefined : end));
  const total = Number(parsed?.fields[1]);
  const max = Number(parsed?.fields[2]) || PROGRESS_MAX;
  return Number.isFinite(total) ? Math.min(100, Math.floor((total / max) * 100)) : null;
};

/**
 * Outcome of an `mkv` run. The exit code alone is not enough: makemkvcon can
 * exit 0 after a partial failure, so a rip only succeeds with 5036 ("Copy
 * complete") and without 5037 (some titles failed).
 */
export const parseRipResult = (output: string, exitCode: number): { ok: boolean; error?: string } => {
  const messages = parseMessages(output);
  const failed = messages.find((m) => m.code === 5037);
  const done = messages.some((m) => m.code === 5036);
  if (exitCode === 0 && done && !failed) return { ok: true };
  const error =
    failed?.text ||
    [...messages].reverse().find((m) => isError(m.flags))?.text ||
    (exitCode !== 0 ? `makemkvcon exited with code ${exitCode}` : 'MakeMKV did not report a completed copy');
  return { ok: false, error };
};

// --- Languages ---

/**
 * ISO 639-1 (TMDB) -> ISO 639-2 codes. MakeMKV reports the bibliographic
 * variant (fre, ger, chi...); the terminology one is listed too, just in case.
 * TMDB uses "cn" for Cantonese.
 */
const LANGUAGES: Record<string, string[]> = {
  ar: ['ara'], bg: ['bul'], bn: ['ben'], bs: ['bos'], ca: ['cat'], cn: ['chi', 'zho', 'yue'],
  cs: ['cze', 'ces'], cy: ['wel', 'cym'], da: ['dan'], de: ['ger', 'deu'], el: ['gre', 'ell'],
  en: ['eng'], es: ['spa'], et: ['est'], eu: ['baq', 'eus'], fa: ['per', 'fas'], fi: ['fin'],
  fr: ['fre', 'fra'], ga: ['gle'], gl: ['glg'], he: ['heb'], hi: ['hin'], hr: ['hrv'],
  hu: ['hun'], hy: ['arm', 'hye'], id: ['ind'], is: ['ice', 'isl'], it: ['ita'], ja: ['jpn'],
  ka: ['geo', 'kat'], kn: ['kan'], ko: ['kor'], la: ['lat'], lt: ['lit'], lv: ['lav'],
  mk: ['mac', 'mkd'], ml: ['mal'], mr: ['mar'], ms: ['may', 'msa'], nb: ['nob', 'nor'],
  nl: ['dut', 'nld'], nn: ['nno', 'nor'], no: ['nor'], pa: ['pan'], pl: ['pol'], pt: ['por'],
  ro: ['rum', 'ron'], ru: ['rus'], sk: ['slo', 'slk'], sl: ['slv'], sq: ['alb', 'sqi'],
  sr: ['srp'], sv: ['swe'], ta: ['tam'], te: ['tel'], th: ['tha'], tl: ['tgl', 'fil'],
  tr: ['tur'], uk: ['ukr'], ur: ['urd'], vi: ['vie'], zh: ['chi', 'zho'],
};

/** ISO 639-2 codes of an ISO 639-1 language (empty for unknown or "xx"). */
export const languageCodes = (iso6391: string | null | undefined): string[] =>
  iso6391 ? (LANGUAGES[iso6391.toLowerCase()] ?? []) : [];

export const hasLanguage = (title: DiscTitle, type: DiscStream['type'], codes: string[]) =>
  title.streams.some((s) => s.type === type && s.lang !== undefined && codes.includes(s.lang));

/**
 * MakeMKV track selection rule (app_DefaultSelectionString) for a rip: the
 * video, audio and subtitles in the kept languages (codes of the first one get
 * priority, so they come first and are the default tracks), without lossy
 * cores of lossless tracks; if no track has one of those languages, the only
 * track of its kind is kept anyway. With `keepAll` (original language unknown)
 * every language is kept, the first one still first.
 */
export const selectionRule = (languages: string[][], keepAll = false): string => {
  const codes = [...new Set(languages.flat())];
  const first = languages[0] ?? [];
  return [
    '-sel:all',
    keepAll ? '+sel:all' : `+sel:(${[...codes, 'nolang', 'single'].join('|')})`,
    '-sel:(havemulti|havecore)',
    '-sel:mvcvideo',
    '=100:all',
    ...first.map((code) => `-10:${code}`),
  ].join(',');
};
