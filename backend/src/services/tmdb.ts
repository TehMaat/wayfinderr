import axios from 'axios';
import logger from '../config/logger.js';
import { config } from '../config/index.js';
import { db } from './database.js';
import { normalize } from './releaseName.js';

const TMDB_API = 'https://api.themoviedb.org/3';
export const TMDB_KEY_SETTING = 'tmdbApiKey';

export interface TmdbTitles {
  id: number;
  type: 'movie' | 'tv';
  title: string; // display title
  year?: number;
  titles: string[]; // normalized: original, translations, alternative titles
}

interface SearchResult {
  id: number;
  title?: string;
  name?: string;
  release_date?: string;
  first_air_date?: string;
}

interface Details extends SearchResult {
  original_title?: string;
  original_name?: string;
  alternative_titles?: { titles?: { title: string }[]; results?: { title: string }[] };
  translations?: { translations?: { data?: { title?: string; name?: string } }[] };
}

// The key from the UI wins over the environment variable
const getApiKey = async (): Promise<string | null> =>
  (await db.getSetting(TMDB_KEY_SETTING)) || config.TMDB_API_KEY || null;

// v4 "API Read Access Token" (a JWT) goes in the header, v3 "API Key" in the query
const authFor = (key: string) =>
  key.startsWith('eyJ') ? { headers: { Authorization: `Bearer ${key}` } } : { params: { api_key: key } };

const get = async <T>(key: string, path: string, params: Record<string, string | number> = {}) => {
  const auth = authFor(key);
  const response = await axios.get<T>(`${TMDB_API}${path}`, {
    timeout: 10000,
    headers: auth.headers,
    params: { ...auth.params, ...params },
  });
  return response.data;
};

export class TmdbService {
  // Lookups never change during a run: cache them (null = not found)
  private cache = new Map<string, TmdbTitles | null>();

  async isConfigured(): Promise<boolean> {
    return Boolean(await getApiKey());
  }

  /** Checks the key; throws with a readable message */
  async test(key?: string): Promise<void> {
    const apiKey = key || (await getApiKey());
    if (!apiKey) throw new Error('No TMDB API key configured');
    try {
      await get(apiKey, '/configuration');
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 401) throw new Error('TMDB rejected the API key');
      throw new Error(`TMDB unreachable: ${(error as Error).message}`);
    }
  }

  /**
   * Finds the movie (or show, for season releases) and returns all its known titles.
   * Returns null when TMDB is not configured or nothing is found.
   */
  async lookup(title: string, year?: number, isTv = false): Promise<TmdbTitles | null> {
    const cacheKey = `${isTv ? 'tv' : 'movie'}|${title}|${year ?? ''}`;
    if (this.cache.has(cacheKey)) return this.cache.get(cacheKey) ?? null;

    const apiKey = await getApiKey();
    if (!apiKey || !title) return null;

    try {
      const order: ('movie' | 'tv')[] = isTv ? ['tv', 'movie'] : ['movie', 'tv'];
      let found: { type: 'movie' | 'tv'; result: SearchResult } | null = null;

      for (const type of order) {
        const yearParam: Record<string, number> = year ? { [type === 'movie' ? 'year' : 'first_air_date_year']: year } : {};
        const data = await get<{ results: SearchResult[] }>(apiKey, `/search/${type}`, { query: title, ...yearParam });
        if (data.results?.length) {
          found = { type, result: data.results[0] };
          break;
        }
      }

      if (!found) {
        this.cache.set(cacheKey, null);
        return null;
      }

      const details = await get<Details>(apiKey, `/${found.type}/${found.result.id}`, {
        append_to_response: 'alternative_titles,translations',
      });

      const names = [
        details.title,
        details.name,
        details.original_title,
        details.original_name,
        ...(details.alternative_titles?.titles ?? details.alternative_titles?.results ?? []).map((t) => t.title),
        ...(details.translations?.translations ?? []).map((t) => t.data?.title || t.data?.name),
      ];
      const titles = [...new Set(names.filter((n): n is string => Boolean(n)).map(normalize).filter(Boolean))];
      const date = details.release_date || details.first_air_date;

      const result: TmdbTitles = {
        id: details.id,
        type: found.type,
        title: details.title || details.name || title,
        year: date ? parseInt(date.slice(0, 4), 10) : undefined,
        titles,
      };
      this.cache.set(cacheKey, result);
      return result;
    } catch (error) {
      // Not cached: a network error should not hide the movie for the whole run
      logger.warn(
        { title, year, error: (error as Error).message, status: axios.isAxiosError(error) ? error.response?.status : undefined },
        'TMDB lookup failed'
      );
      return null;
    }
  }

  clearCache(): void {
    this.cache.clear();
  }
}

export const tmdb = new TmdbService();
