import { config } from '../../config/index.js';
import { ParsedName } from './releaseName.js';

/**
 * TMDB (themoviedb.org) client: identifies the film of a download, for the file
 * name and the original language. TMDB_API_KEY can be the v3 API key or the v4
 * read access token (a JWT, sent as a Bearer token).
 */

export interface TmdbMovie {
  id: number;
  title: string; // in TMDB_LANGUAGE
  originalTitle: string;
  originalLanguage: string; // ISO 639-1
  year: number | null;
}

export interface TmdbMatch {
  movie: TmdbMovie | null; // null when unsure: the user picks among the candidates
  candidates: TmdbMovie[];
  reason?: string;
}

interface ApiMovie {
  id: number;
  title?: string;
  original_title?: string;
  original_language?: string;
  release_date?: string;
}

const toMovie = (m: ApiMovie): TmdbMovie => ({
  id: m.id,
  title: m.title || m.original_title || '',
  originalTitle: m.original_title || m.title || '',
  originalLanguage: m.original_language || '',
  year: m.release_date ? Number(m.release_date.slice(0, 4)) || null : null,
});

export const tmdbConfigured = () => Boolean(config.RIP.TMDB_API_KEY);

const request = async <T>(endpoint: string, params: Record<string, string | number | undefined>): Promise<T> => {
  const key = config.RIP.TMDB_API_KEY;
  if (!key) throw new Error('TMDB_API_KEY is not set');
  const bearer = key.startsWith('eyJ');
  const url = new URL(config.RIP.TMDB_API_URL.replace(/\/$/, '') + endpoint);
  for (const [name, value] of Object.entries({ ...params, ...(bearer ? {} : { api_key: key }) })) {
    if (value !== undefined && value !== '') url.searchParams.set(name, String(value));
  }
  const response = await fetch(url, {
    headers: { accept: 'application/json', ...(bearer ? { authorization: `Bearer ${key}` } : {}) },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { status_message?: string } | null;
    throw new Error(`TMDB ${response.status}: ${body?.status_message ?? response.statusText}`);
  }
  return (await response.json()) as T;
};

export const searchMovies = async (query: string, year?: number | null): Promise<TmdbMovie[]> => {
  const data = await request<{ results: ApiMovie[] }>('/search/movie', {
    query,
    year: year ?? undefined,
    language: config.RIP.TMDB_LANGUAGE,
    include_adult: 'false',
  });
  return data.results.map(toMovie);
};

export const getMovie = async (id: number): Promise<TmdbMovie> =>
  toMovie(await request<ApiMovie>(`/movie/${id}`, { language: config.RIP.TMDB_LANGUAGE }));

// Letters that have no accent to strip, as release names write them
const LETTERS: Record<string, string> = { ß: 'ss', æ: 'ae', œ: 'oe', ø: 'o', ł: 'l', đ: 'd', ð: 'd', þ: 'th', ı: 'i' };

/**
 * Only the letters and digits of a title, lower case and without accents: release
 * names drop, keep or replace with a dot any sign, space included.
 * "L'Odio" -> "lodio", "Spider-Man" -> "spiderman", "S.W.A.T." -> "swat", "Alien³" -> "alien3".
 */
export const normalizeTitle = (title: string) =>
  title
    .replace(/\p{So}/gu, ' ') // ™, ©, ★...: NFKD would turn some into letters
    .normalize('NFKD') // accents apart, "³" -> "3", "ﬁ" -> "fi"
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[ßæœøłđðþı]/g, (letter) => LETTERS[letter])
    .replace(/[^\p{L}\p{N}]+/gu, '');

// "&" or "+" written as a word or left out: "Fast & Furious", "Fast.and.Furious", "Stanlio.e.Ollio", "Fast.Furious"
const CONJUNCTION = /\s*[&+]\s*/g;
// A possessive 's, with or without the s: "Bridget Jones's Baby", "Bridget.Joness.Baby", "Bridget.Jones.Baby"
const POSSESSIVE = /(?<=\p{L})['‘’`´ʼ]s(?![\p{L}\p{N}])/gu;

/** Every way a release name can write the title, normalized. */
const titleKeys = (title: string) => {
  const forms = [' and ', ' e ', ' '].map((word) => title.replace(CONJUNCTION, word));
  return forms.flatMap((form) => [form, form.replace(POSSESSIVE, '')]).map(normalizeTitle).filter(Boolean);
};

const sameTitle = (movie: TmdbMovie, title: string) => {
  const wanted = new Set(titleKeys(title));
  return [movie.title, movie.originalTitle].some((t) => titleKeys(t).some((key) => wanted.has(key)));
};

/**
 * Conservative match: automatic only when exactly one film has the same title
 * (localized or original, signs and spaces apart) and, when the name has a year,
 * a release year within one year of it. Anything else is left to the user, with
 * the candidates.
 */
export const matchMovie = async (name: ParsedName): Promise<TmdbMatch> => {
  if (!name.title) return { movie: null, candidates: [], reason: 'No title in the download name' };

  const withYear = name.year ? await searchMovies(name.title, name.year) : [];
  const anyYear = await searchMovies(name.title);
  const candidates = [...new Map([...withYear, ...anyYear].map((m) => [m.id, m])).values()].slice(0, 10);

  let matches = candidates.filter((m) => sameTitle(m, name.title));
  if (name.year) {
    const exact = matches.filter((m) => m.year === name.year);
    matches = exact.length ? exact : matches.filter((m) => m.year !== null && Math.abs(m.year - name.year!) <= 1);
  }

  if (matches.length === 1) return { movie: await getMovie(matches[0].id), candidates };
  if (matches.length > 1) {
    return { movie: null, candidates, reason: `${matches.length} films on TMDB match "${name.title}": choose the right one` };
  }
  return {
    movie: null,
    candidates,
    reason: candidates.length
      ? `No TMDB film matches "${name.title}${name.year ? ` (${name.year})` : ''}" exactly: choose the right one`
      : `"${name.title}" not found on TMDB: search it by hand`,
  };
};
