/**
 * Turns release/file names into comparable titles:
 *   "The.Godfather.1972.1080p.BluRay.AVC-FGT"  -> { title: "the godfather", year: 1972 }
 *   "IL_PADRINO_t00.mkv"                       -> { title: "il padrino" }
 */

export interface ParsedName {
  title: string; // normalized
  year?: number;
  season?: number; // set for TV releases ("S01", "Stagione 1")
}

// Words that end the title part of a release name
const RELEASE_TAGS = new Set([
  '480p', '576p', '720p', '1080p', '1080i', '2160p', '4k', 'uhd', 'hdr', 'hdr10', 'dv', 'dovi',
  'bluray', 'bdmv', 'bdrip', 'brrip', 'bd25', 'bd50', 'bd66', 'bd100', 'remux', 'iso', 'dvd', 'dvd5', 'dvd9',
  'dvdrip', 'webdl', 'webrip', 'web', 'hdtv', 'avc', 'hevc', 'x264', 'x265', 'h264', 'h265', 'mpeg2', 'vc1',
  'dts', 'dtshd', 'truehd', 'atmos', 'ac3', 'eac3', 'ddp', 'aac', 'flac', 'lpcm', 'ma',
  'ita', 'eng', 'multi', 'sub', 'subs', 'complete', 'full', 'disc', 'proper', 'repack', 'extended',
  'remastered', 'unrated', 'criterion', 'custom', 'untouched', 'hybrid',
]);

// MakeMKV names that say nothing about the movie
const GENERIC_NAMES = new Set(['title', 'titles', 'disc', 'bdmv', 'video', 'movie', 'main', 'feature', 'dvd', 'bluray']);

/** Lowercase, no accents, "&" -> "and", only letters/digits separated by single spaces */
export const normalize = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

export const parseReleaseName = (raw: string): ParsedName => {
  let name = raw
    .replace(/\.(mkv|iso|m2ts|mp4|avi)$/i, '')
    // MakeMKV title suffix: Movie_t00, Movie_t01
    .replace(/[_ .-]t\d{2,3}$/i, '')
    // [tags] and {tags}; (year) is kept to be found below
    .replace(/\[[^\]]*\]|\{[^}]*\}/g, ' ')
    .replace(/[._]+/g, ' ');

  const tokens = normalize(name).split(' ').filter(Boolean);
  name = tokens.join(' ');

  let season: number | undefined;
  let end = tokens.length;

  // TV: S01, S01E02, "stagione 1", "season 1"
  for (let i = 0; i < tokens.length; i++) {
    const se = /^s(\d{1,2})(e\d{1,3})*$/.exec(tokens[i]);
    if (se && i > 0) {
      season = parseInt(se[1], 10);
      end = Math.min(end, i);
      break;
    }
    if ((tokens[i] === 'season' || tokens[i] === 'stagione') && /^\d{1,2}$/.test(tokens[i + 1] ?? '') && i > 0) {
      season = parseInt(tokens[i + 1], 10);
      end = Math.min(end, i);
      break;
    }
  }

  // Year: the last plausible one that is not the first word ("2001 A Space Odyssey 1968")
  let year: number | undefined;
  const maxYear = new Date().getFullYear() + 1;
  for (let i = end - 1; i > 0; i--) {
    const value = parseInt(tokens[i], 10);
    if (/^(19|20)\d{2}$/.test(tokens[i]) && value >= 1900 && value <= maxYear) {
      year = value;
      end = i;
      break;
    }
  }

  // Without a year the title ends at the first release tag
  const tagAt = tokens.slice(0, end).findIndex((t, i) => i > 0 && RELEASE_TAGS.has(t));
  if (tagAt > 0) end = tagAt;

  // Disc labels: "GODFATHER_DISC_1", "MOVIE_D2"
  if (end > 1 && /^(disc|disk|cd|d)\d{1,2}$/.test(tokens[end - 1])) {
    end -= 1;
  } else if (end > 2 && /^\d{1,2}$/.test(tokens[end - 1]) && /^(disc|disk|cd)$/.test(tokens[end - 2])) {
    end -= 2;
  }

  return { title: tokens.slice(0, end).join(' '), year, season };
};

/** A title that can identify a movie (not "title", "b1", "disc 1"...) */
export const isMeaningfulTitle = (title: string): boolean => {
  const compact = title.replace(/ /g, '');
  if (compact.length < 3) return false;
  if (GENERIC_NAMES.has(title)) return false;
  if (/^(disc|disk|d|b|title|vol|volume) ?\d*$/.test(title)) return false;
  return true;
};

const tokenSet = (value: string) => new Set(value.split(' ').filter(Boolean));

// Disc labels often drop the article: "GODFATHER" for "The Godfather"
const ARTICLES = /^(the|a|an|il|lo|la|l|i|gli|le|un|uno|una|les|der|die|das|el|los|las) /;
const withoutArticle = (value: string) => value.replace(ARTICLES, '');

/**
 * 0-100 similarity between two normalized titles.
 * 100 same title, 95 same letters without spaces ("thegodfather") or without
 * the leading article, 75 all words of the shorter title inside the longer one
 * (never enough for an automatic removal: "blade runner" vs "blade runner 2049"),
 * else word overlap.
 */
export const titleSimilarity = (a: string, b: string): number => {
  if (!a || !b) return 0;
  if (a === b) return 100;
  const compact = (value: string) => withoutArticle(value).replace(/ /g, '');
  if (a.replace(/ /g, '') === b.replace(/ /g, '') || compact(a) === compact(b)) return 95;

  const ta = tokenSet(a);
  const tb = tokenSet(b);
  const [small, large] = ta.size <= tb.size ? [ta, tb] : [tb, ta];
  let common = 0;
  for (const token of small) if (large.has(token)) common++;

  // "padrino" inside "il padrino parte ii" is not enough: the shorter
  // title must have some substance and cover most of the longer one
  const smallLength = [...small].join('').length;
  if (common === small.size && smallLength >= 5 && small.size / large.size >= 0.6) return 75;

  const union = ta.size + tb.size - common;
  return Math.round((common / union) * 80);
};
