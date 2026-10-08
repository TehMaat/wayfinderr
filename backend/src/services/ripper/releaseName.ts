/**
 * Title and year of a film from a release or disc name, e.g.
 * "Il.Padrino.1972.1080p.BluRay.ISO-GRP" -> { title: "Il Padrino", year: 1972 }.
 * The title ends at the year or at the first technical tag, whichever comes first.
 */

export interface ParsedName {
  title: string;
  year: number | null;
}

// Tokens that never belong to a title: they end it wherever they appear
const TECHNICAL = new Set([
  '4k', 'uhd', 'bluray', 'blu-ray', 'bdrip', 'brrip', 'bdremux', 'remux', 'bdmv', 'bdiso', 'iso', 'img',
  'bd25', 'bd50', 'bd66', 'bd100', 'untouched', 'dvd5', 'dvd9', 'dvdr', 'dvdrip', 'dvdiso', 'pal', 'ntsc',
  'webrip', 'webdl', 'web-dl', 'hdtv', 'hdr', 'hdr10', 'hdr10+', 'dovi', 'sdr', '3d', 'hsbs', 'hou',
  'x264', 'x265', 'h264', 'h265', 'hevc', 'avc', 'vc-1', 'vc1', 'mpeg2', 'mpeg-2', 'av1',
  'dts', 'dts-hd', 'dtshd', 'dts-x', 'dtsx', 'truehd', 'atmos', 'ac3', 'eac3', 'ddp', 'aac', 'flac', 'lpcm',
]);

// Words that usually follow the title (languages, editions): only removed from its end,
// since a few of them can also be part of a title ("The Full Monty", "A Complete Unknown")
const TRAILING = new Set([
  'ita', 'eng', 'fre', 'ger', 'spa', 'jpn', 'multi', 'dual', 'italian', 'english', 'multisub', 'sub', 'subs',
  'subbed', 'extended', 'unrated', 'uncut', 'remastered', 'directors', "director's", 'cut', 'criterion',
  'limited', 'repack', 'proper', 'internal', 'readnfo', 'retail', 'hybrid', 'complete', 'full', 'imax',
  'custom', 'dvd', 'bd', 'web', 'disc', 'disk',
]);

const YEAR = /^(19|20)\d{2}$/;
const DISC = /^(disc|disk|cd|dvd|bd|d)[-_ ]?\d{1,2}$/i;

const bare = (token: string) => token.replace(/^[[({]+|[\])}]+$/g, '');
const lower = (token: string) => bare(token).toLowerCase();

const isTechnical = (token: string) => {
  const t = lower(token);
  // The release group rides on the last tag: "BluRay-GROUP"
  return [t, t.replace(/-[^-]+$/, '')].some(
    (candidate) => TECHNICAL.has(candidate) || /^\d{3,4}[pi]$/.test(candidate) || /^[xh]\.?26[45]$/.test(candidate)
  );
};

export const parseReleaseName = (input: string): ParsedName => {
  const name = input
    .trim()
    .replace(/\.(iso|img)$/i, '')
    .replace(/^\[[^\]]*\]\s*/, ''); // "[site] Title..."
  const tokens = name
    .replace(/\b(\d)\.(\d)\b/g, '$1\u0000$2') // keep "5.1" and "H.264" together
    .replace(/\b([hx])\.(26[45])\b/gi, '$1\u0000$2')
    .replace(/[._]/g, ' ')
    .replace(/\u0000/g, '.')
    .split(/\s+/)
    .filter(Boolean);

  let end = tokens.findIndex((token, i) => i > 0 && isTechnical(token));
  if (end < 0) end = tokens.length;

  // The year is the last year-like token before the tags, never the first token
  // (so "1917.2019" and "2001.A.Space.Odyssey.1968" keep their titles)
  let yearIndex = -1;
  for (let i = end - 1; i >= 1; i--) {
    if (YEAR.test(bare(tokens[i]))) {
      yearIndex = i;
      break;
    }
  }

  const titleTokens = tokens.slice(0, yearIndex > 0 ? yearIndex : end).map(bare).filter(Boolean);
  while (titleTokens.length > 1 && (TRAILING.has(titleTokens.at(-1)!.toLowerCase()) || DISC.test(titleTokens.at(-1)!))) {
    titleTokens.pop();
  }
  const title = titleTokens.join(' ').replace(/\s+-$/, '').trim();
  return {
    title: title || bare(tokens[0] ?? input),
    year: yearIndex > 0 ? Number(bare(tokens[yearIndex])) : null,
  };
};

/** Disc labels are upper case with underscores, often with a disc number: "THE_MATRIX_DISC1". */
export const parseDiscLabel = (label: string): ParsedName =>
  parseReleaseName(
    label
      .replace(/[_.]/g, ' ')
      .toLowerCase()
      .replace(/(^|\s)\p{L}/gu, (letter) => letter.toUpperCase())
  );
