/**
 * Release name of a film on the server, as moverr.py builds it:
 * NAME.YEAR.{VERSION}.{HYBRID}.{REMUX}.RESOLUTION.{VU}.{DV}.{P#}.{HDR}.AUDIO.SUBS-TAG.ext
 * e.g. "Il.Padrino.1972.REMUX.1080P.VU.DTSHD.MA.ITA.DTSHD.MA.ENG.SUBS.ITA.ENG-TAG.mkv".
 * Video, audio and subtitles come from the stored media info; name, year,
 * version and REMUX from the user (prefilled from the rip or the file name).
 */
import { MediaInfo } from '../../types/index.js';

// Editions offered in the dialog (moverr's VERSIONI_NOTE)
export const VERSIONS = [
  'Theatrical',
  'Extended',
  "Director's Cut",
  'Unrated',
  'Special Edition',
  'Remastered',
  'IMAX',
  'Final Cut',
  'Uncut',
  'Anniversary Edition',
];

const AUDIO_CODECS: Record<string, string> = {
  truehd: 'TRUEHD', mlp: 'TRUEHD',
  dts: 'DTS', dca: 'DTS',
  ac3: 'AC3', eac3: 'EAC3',
  aac: 'AAC', flac: 'FLAC',
  pcm_s16le: 'PCM', pcm_s24le: 'PCM', pcm_s32le: 'PCM', pcm_bluray: 'PCM',
  opus: 'OPUS', vorbis: 'VORBIS',
  mp3: 'MP3', mp2: 'MP2', lpcm: 'LPCM',
};

// The best track of each language goes in the name
const AUDIO_PRIORITY: Record<string, number> = {
  'TRUEHD.ATMOS': 103, TRUEHD: 100,
  'DTSHD.MA': 95, PCM: 93, LPCM: 92, FLAC: 90,
  'DTSHD.HRA': 80, 'DTS-ES': 72, DTS: 70,
  'EAC3.ATMOS': 68, EAC3: 65, AC3: 60,
  AAC: 50, OPUS: 45, VORBIS: 40, MP3: 30, MP2: 20,
};

const LANGUAGES: Record<string, string> = {
  ita: 'ITA', it: 'ITA', eng: 'ENG', en: 'ENG',
  fre: 'FRE', fra: 'FRE', fr: 'FRE',
  ger: 'GER', deu: 'GER', de: 'GER',
  spa: 'SPA', es: 'SPA', por: 'POR', pt: 'POR',
  jpn: 'JPN', ja: 'JPN', kor: 'KOR', ko: 'KOR',
  chi: 'CHI', zho: 'CHI', zh: 'CHI',
  rus: 'RUS', ru: 'RUS', ara: 'ARA', ar: 'ARA',
  hin: 'HIN', hi: 'HIN', pol: 'POL', pl: 'POL',
  dut: 'DUT', nld: 'DUT', nl: 'DUT',
  swe: 'SWE', sv: 'SWE', nor: 'NOR', no: 'NOR',
  dan: 'DAN', da: 'DAN', fin: 'FIN', fi: 'FIN',
  tur: 'TUR', tr: 'TUR', gre: 'GRE', ell: 'GRE', el: 'GRE',
  heb: 'HEB', he: 'HEB', tha: 'THA', th: 'THA',
  vie: 'VIE', vi: 'VIE', rum: 'RUM', ron: 'RUM', ro: 'RUM',
  hun: 'HUN', hu: 'HUN', cze: 'CZE', ces: 'CZE', cs: 'CZE',
  und: 'UND', unknown: 'UND',
};

// Any other language is shown as a warning before the rename
const EXPECTED = new Set(['ITA', 'ENG', 'UND']);
const LANGUAGE_ORDER: Record<string, number> = { ITA: 0, ENG: 1 };

export interface AudioStream {
  index: number;
  codec: string; // name label: DTSHD.MA, TRUEHD.ATMOS...
  language: string; // ITA, ENG...
  channels: number | null;
  bitrate: number | null;
  title: string | null;
}

export interface ReleaseAnalysis {
  video: {
    resolution: string | null; // 1080P
    width: number;
    height: number;
    codec: string | null;
    dv: boolean;
    dvProfile: number | null;
    hdr: string | null; // HDR10, HLG
  };
  audio: { codec: string; language: string }[]; // the best track of each language, ITA and ENG first
  audioStreams: AudioStream[];
  subtitles: string[]; // languages, ITA and ENG first
  extraLanguages: { audio: string[]; subtitles: string[] }; // not ITA or ENG: "FRE (DTS)"
}

export interface ReleaseFlags {
  title: string; // in Italian
  year: string;
  version: string; // "", one of VERSIONS or free text
  remux: boolean;
}

const languageLabel = (language: string | undefined) => {
  const lang = (language || 'und').trim().toLowerCase();
  return LANGUAGES[lang] ?? lang.toUpperCase().slice(0, 3);
};

const byLanguage = (a: string, b: string) =>
  (LANGUAGE_ORDER[a] ?? 99) - (LANGUAGE_ORDER[b] ?? 99) || (a < b ? -1 : a > b ? 1 : 0);

/** moverr's resolution from the height; a film cropped to a wide ratio (1920×800) counts by its width */
const resolutionOf = (width: number, height: number): string | null => {
  if (!width && !height) return null;
  if (height >= 2160 || width >= 3200) return '2160P';
  if (height >= 1080 || width >= 1800) return '1080P';
  if (height >= 720 || width >= 1200) return '720P';
  if (height >= 576) return '576P';
  if (height >= 480) return '480P';
  return `${height}P`;
};

type Audio = MediaInfo['audioTracks'][number];

const audioLabel = (track: Audio): string => {
  const codec = track.codec.toLowerCase();
  const profile = (track.profile ?? '').toLowerCase();
  const title = (track.title ?? '').toLowerCase();
  if (codec === 'dts' || codec === 'dca') {
    if (['dts-hd ma', 'ma', 'master'].some((x) => profile.includes(x))) return 'DTSHD.MA';
    if (['dts-hd ma', 'master audio'].some((x) => title.includes(x))) return 'DTSHD.MA';
    if (['dts-hd hra', 'hra', 'high resolution'].some((x) => profile.includes(x))) return 'DTSHD.HRA';
    if (profile.includes('dts-es') || title.includes('dts-es')) return 'DTS-ES';
    return 'DTS';
  }
  if (codec === 'truehd' || codec === 'mlp') {
    return title.includes('atmos') || profile.includes('atmos') ? 'TRUEHD.ATMOS' : 'TRUEHD';
  }
  if (codec === 'eac3') {
    return title.includes('atmos') || title.includes('joc') || profile.includes('atmos') ? 'EAC3.ATMOS' : 'EAC3';
  }
  return AUDIO_CODECS[codec] ?? codec.toUpperCase();
};

const audioScore = (label: string, bitrate: number | null) =>
  (AUDIO_PRIORITY[label] || AUDIO_PRIORITY[label.split('.')[0]] || 0) + (bitrate && bitrate > 0 ? bitrate / 10_000_000 : 0);

/** Needs the detailed media info (video tracks, audio profiles and titles) */
export const analyze = (media: MediaInfo): ReleaseAnalysis => {
  const video = media.videoTracks?.[0];
  const dv = /Dolby Vision(?: P(\d+))?/.exec(video?.hdr ?? '');
  const hdr = /HDR10\+|HDR10|HLG/.exec(video?.hdr ?? '')?.[0] ?? null;

  const audioStreams: AudioStream[] = media.audioTracks.map((t) => ({
    index: t.index,
    codec: audioLabel(t),
    language: languageLabel(t.language),
    channels: t.channels ?? null,
    bitrate: t.bitrate ?? null,
    title: t.title ?? null,
  }));

  // Per language, the best codec (the first one on a tie, like Python's stable sort)
  const best = new Map<string, { codec: string; score: number }>();
  for (const s of audioStreams) {
    const score = audioScore(s.codec, s.bitrate);
    const current = best.get(s.language);
    if (!current || score > current.score) best.set(s.language, { codec: s.codec, score });
  }
  const audio = [...best.keys()].sort(byLanguage).map((language) => ({ codec: best.get(language)!.codec, language }));

  const subtitles = [...new Set(media.subtitles.map((t) => languageLabel(t.language)))].sort(byLanguage);

  return {
    video: {
      resolution: video ? resolutionOf(video.width, video.height) : null,
      width: video?.width ?? 0,
      height: video?.height ?? 0,
      codec: video?.codec.toUpperCase() ?? null,
      dv: Boolean(dv),
      dvProfile: dv?.[1] ? Number(dv[1]) : null,
      hdr,
    },
    audio,
    audioStreams,
    subtitles,
    extraLanguages: {
      audio: audio.filter((a) => !EXPECTED.has(a.language)).map((a) => `${a.language} (${a.codec})`),
      subtitles: subtitles.filter((l) => !EXPECTED.has(l)),
    },
  };
};

/** Python's str.title(): upper case after a character without case, lower case after a letter */
export const pythonTitle = (text: string) => {
  let previousCased = false;
  let out = '';
  for (const ch of text) {
    const cased = ch.toLowerCase() !== ch.toUpperCase();
    out += cased ? (previousCased ? ch.toLowerCase() : ch.toUpperCase()) : ch;
    previousCased = cased;
  }
  return out;
};

/** "Director's Cut" -> "DIRECTORS.CUT" */
export const versionTag = (version: string) =>
  version.trim().toUpperCase().replace(/'/g, '').replace(/\s+/g, '.');

const sanitize = (name: string) => name.replace(/[<>:"/\\|?*]/g, '').replace(/\.{2,}/g, '.');

/** REMUX with a Dolby Vision profile 8 layer is a hybrid (moverr's auto-HYBRID), and not VU */
export const isAutoHybrid = (flags: Pick<ReleaseFlags, 'remux'>, analysis: ReleaseAnalysis) =>
  flags.remux && analysis.video.dv && analysis.video.dvProfile === 8;

export const validateFlags = (flags: ReleaseFlags): string | null => {
  if (!flags.title.trim()) return 'The film name is missing';
  if (!/^\d{4}$/.test(flags.year.trim())) return 'The year must have 4 digits';
  return null;
};

export const buildReleaseName = (
  flags: ReleaseFlags,
  analysis: ReleaseAnalysis,
  extension: string,
  tag?: string | null
): string => {
  const hybrid = isAutoHybrid(flags, analysis);
  const vu = flags.remux && !hybrid;
  const { video } = analysis;

  const parts = [pythonTitle(flags.title.trim().replace(/\s+/g, '.')), flags.year.trim()];
  if (flags.version.trim()) parts.push(versionTag(flags.version));
  if (hybrid) parts.push('HYBRID');
  if (flags.remux) parts.push('REMUX');
  if (video.resolution) parts.push(video.resolution);
  if (vu) parts.push('VU');
  if (video.dv) {
    parts.push('DV');
    if (video.dvProfile !== null) parts.push(`P${video.dvProfile}`);
  }
  if (video.hdr) parts.push(video.hdr);

  const audio = analysis.audio.length > 2 ? analysis.audio.slice(0, 2) : analysis.audio;
  for (const a of audio) parts.push(a.codec, a.language);
  if (analysis.audio.length > 2) parts.push('MULTI');

  if (analysis.subtitles.length) {
    parts.push('SUBS', ...analysis.subtitles.slice(0, 2));
    if (analysis.subtitles.length > 2) parts.push('MULTI');
  }

  let name = parts.join('.');
  if (tag?.trim()) name += `-${tag.trim()}`;
  return sanitize(`${name}.${extension.replace(/^\./, '')}`);
};
