import { parseReleaseName } from './ripper/releaseName.js';

/**
 * Comparable titles for matching an MKV to the torrent it was ripped from:
 *   "The.Godfather.1972.1080p.BluRay.AVC-FGT" -> { title: "the godfather", year: 1972 }
 *   "IL_PADRINO_t00.mkv", "Il padrino (1972).mkv" -> { title: "il padrino" (, year: 1972) }
 * Title and year come from the ripper's release name parser; this adds the MakeMKV
 * suffixes and a word-based similarity score.
 */

export interface MatchName {
  title: string; // normalized words
  year?: number;
}

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

export const parseName = (raw: string): MatchName => {
  const cleaned = raw
    .replace(/\.(mkv|iso|m2ts|mp4)$/i, '')
    // MakeMKV title suffix: Movie_t00, Movie_t01
    .replace(/[_ .-]t\d{2,3}$/i, '')
    // Disc labels: "GODFATHER_DISC_1", "MOVIE_D2"
    .replace(/[_ .-](disc|disk|cd|d)[_ .-]?\d{1,2}$/i, '');
  const parsed = parseReleaseName(cleaned);
  return { title: normalize(parsed.title), year: parsed.year ?? undefined };
};

/** A title that can identify a movie (not "title", "b1", "disc 1"...) */
export const isMeaningfulTitle = (title: string): boolean => {
  if (title.replace(/ /g, '').length < 3) return false;
  if (GENERIC_NAMES.has(title)) return false;
  return !/^(disc|disk|d|b|title|vol|volume) ?\d*$/.test(title);
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
