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
// Typed for an apostrophe: quotes, accents, primes, modifier letters ("Lʼultimo"), fullwidth
const APOSTROPHES = /[‘’‛`´ʹʻʼʽˈˊˋꞋꞌ′‵＇՚׳]/gu;

/**
 * The words of a title, lower case, without accents or signs:
 * "L'Odio" -> "l odio", "S.W.A.T." -> "s w a t", "Alien³" -> "alien3".
 */
const titleWords = (title: string) =>
  title
    .replace(APOSTROPHES, "'")
    .replace(/[\p{So}ºª]/gu, ' ') // ™, ©, ★, "IIº": NFKD would turn some into letters
    .normalize('NFKD') // accents apart, "³" -> "3", "ﬁ" -> "fi"
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[ßæœøłđðþı]/g, (letter) => LETTERS[letter])
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/**
 * Only the letters and digits of a title: release names drop, keep or replace with
 * a dot any sign, space included. "L'Odio" -> "lodio", "Spider-Man" -> "spiderman".
 */
export const normalizeTitle = (title: string) => titleWords(title).replace(/ /g, '');

// "&" or "+" written as a word or left out: "Fast & Furious", "Fast.and.Furious", "Stanlio.e.Ollio", "Fast.Furious"
const CONJUNCTION = /\s*[&+]\s*/g;
// A possessive 's, with or without the s: "Bridget Jones's Baby", "Bridget.Joness.Baby", "Bridget.Jones.Baby"
const POSSESSIVE = /(?<=\p{L})'s(?![\p{L}\p{N}])/giu;

// The signs a release name may spell out or leave out, each giving the title's other forms
const VARIANTS: ((title: string) => string[])[] = [
  (title) => [' and ', ' e ', ' '].map((word) => title.replace(CONJUNCTION, word)),
  (title) => [title, title.replace(POSSESSIVE, '')],
  (title) => [title, title.replace(/º/g, 'o').replace(/ª/g, 'a')], // "La 25ª ora": "La 25 ora", "La 25a ora"
  (title) => [title, title.replace(/(?<=\p{L})\$(?=\p{L})/gu, 's')], // "Ca$h": "Cah", "Cash"
];

/** Every way a release name can write the title: its words, or only its letters and digits. */
const titleKeys = (title: string, lettersOnly: boolean) =>
  VARIANTS.reduce((forms, variant) => forms.flatMap(variant), [title.replace(APOSTROPHES, "'")])
    .map((form) => (lettersOnly ? normalizeTitle(form) : titleWords(form)))
    .filter(Boolean);

const sameTitle = (movie: TmdbMovie, title: string, lettersOnly: boolean) => {
  const wanted = new Set(titleKeys(title, lettersOnly));
  return [movie.title, movie.originalTitle].some((t) => titleKeys(t, lettersOnly).some((key) => wanted.has(key)));
};

/**
 * Conservative match: automatic only when exactly one film has the same title
 * (localized or original, signs apart) and, when the name has a year, a release
 * year within one year of it. The release year counts first, then the same words
 * over the same letters ("I.T." is not "It"); when the same letters give the
 * release year and the same words a year off, it asks. Anything else is left to
 * the user, with the candidates.
 */
export const matchMovie = async (name: ParsedName): Promise<TmdbMatch> => {
  if (!name.title) return { movie: null, candidates: [], reason: 'No title in the download name' };

  const withYear = name.year ? await searchMovies(name.title, name.year) : [];
  const anyYear = await searchMovies(name.title);
  const found = [...new Map([...withYear, ...anyYear].map((m) => [m.id, m])).values()];
  const candidates = found.slice(0, 10);

  const words = found.filter((m) => sameTitle(m, name.title, false));
  const letters = found.filter((m) => sameTitle(m, name.title, true)); // the same words have the same letters too
  let matches: TmdbMovie[];
  if (!name.year) {
    matches = words.length ? words : letters;
  } else {
    const exact = (movies: TmdbMovie[]) => movies.filter((m) => m.year === name.year);
    const near = (movies: TmdbMovie[]) => movies.filter((m) => m.year !== null && Math.abs(m.year - name.year!) <= 1);
    if (exact(words).length) matches = exact(words);
    else if (exact(letters).length) matches = [...new Set([...exact(letters), ...near(words)])];
    else matches = near(words).length ? near(words) : near(letters);
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

interface ApiTitles {
  title?: string;
  original_title?: string;
  alternative_titles?: { titles?: { title: string }[] };
  translations?: { translations?: { data?: { title?: string } }[] };
}

/**
 * Every title the film is known by: original, localized, translations, alternative
 * titles. Used to recognize a torrent named in another language than the MKV
 * ("The.Godfather.1972.BluRay" for "Il padrino (1972).mkv").
 */
export const getMovieTitles = async (id: number): Promise<string[]> => {
  const data = await request<ApiTitles>(`/movie/${id}`, {
    language: config.RIP.TMDB_LANGUAGE,
    append_to_response: 'alternative_titles,translations',
  });
  const titles = [
    data.title,
    data.original_title,
    ...(data.alternative_titles?.titles ?? []).map((t) => t.title),
    ...(data.translations?.translations ?? []).map((t) => t.data?.title),
  ];
  return [...new Set(titles.filter((t): t is string => Boolean(t)))];
};
