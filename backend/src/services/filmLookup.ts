import logger from '../config/logger.js';
import { normalize } from './nameMatch.js';
import { ParsedName } from './ripper/releaseName.js';
import { getMovieTitles, matchMovie, tmdbConfigured } from './ripper/tmdb.js';

/**
 * A film's TMDB titles in every language (titles, original title, translations,
 * alternative titles), normalized for name matching: an Italian disc name matches
 * an English or German release name of the same film. Cached for the whole run.
 */
export interface FilmTitles {
  id: number;
  titles: string[];
  year?: number;
  label: string; // "Title (Year)", for messages
  originalLanguage?: string; // ISO 639-1, when TMDB said it
}

// Per parsed name (null: no film found) and per TMDB id
const byName = new Map<string, FilmTitles | null>();
const byId = new Map<number, FilmTitles>();

const titlesOf = async (
  id: number,
  title: string,
  year: number | null | undefined,
  originalLanguage?: string | null
): Promise<FilmTitles> => {
  const cached = byId.get(id);
  if (cached) {
    if (!cached.originalLanguage && originalLanguage) cached.originalLanguage = originalLanguage;
    return cached;
  }
  const film = {
    id,
    titles: [...new Set([title, ...(await getMovieTitles(id))].map(normalize).filter(Boolean))],
    year: year ?? undefined,
    label: `${title}${year ? ` (${year})` : ''}`,
    originalLanguage: originalLanguage || undefined,
  };
  byId.set(id, film);
  return film;
};

/**
 * The film of a name, with the ripper's conservative TMDB match: a film only when
 * exactly one has this title and year. Null without TMDB or when unsure.
 */
export const filmByName = async (name: ParsedName): Promise<FilmTitles | null> => {
  if (!tmdbConfigured() || !name.title) return null;
  const key = `${name.title}|${name.year ?? ''}`;
  if (byName.has(key)) return byName.get(key) ?? null;
  try {
    const { movie } = await matchMovie(name);
    const film = movie ? await titlesOf(movie.id, movie.title, movie.year, movie.originalLanguage) : null;
    byName.set(key, film);
    return film;
  } catch (error) {
    // Not cached: a network error should not hide the film for the whole run
    logger.warn({ name: name.title, error: (error as Error).message }, 'TMDB lookup failed');
    return null;
  }
};

/** The titles of a film already identified (a rip's TMDB id); null when TMDB does not answer. */
export const filmById = async (
  id: number,
  title: string,
  year?: number | null,
  originalLanguage?: string | null
): Promise<FilmTitles | null> => {
  if (!tmdbConfigured()) return null;
  try {
    return await titlesOf(id, title, year, originalLanguage);
  } catch (error) {
    logger.warn({ tmdbId: id, error: (error as Error).message }, 'TMDB titles lookup failed');
    return null;
  }
};
