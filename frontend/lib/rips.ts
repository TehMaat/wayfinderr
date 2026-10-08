import type { Rip, RipStatus } from './store';

export type RipFilter = 'ALL' | 'ATTENTION' | 'ACTIVE' | 'DONE' | 'FAILED' | 'SKIPPED';

export const RIP_FILTERS: { value: RipFilter; label: string; statuses: RipStatus[] | null }[] = [
  { value: 'ALL', label: 'All', statuses: null },
  { value: 'ATTENTION', label: 'Needs attention', statuses: ['NEEDS_ATTENTION'] },
  { value: 'ACTIVE', label: 'In progress', statuses: ['WAITING', 'QUEUED', 'SCANNING', 'RIPPING'] },
  { value: 'DONE', label: 'Done', statuses: ['DONE'] },
  { value: 'FAILED', label: 'Failed', statuses: ['FAILED'] },
  { value: 'SKIPPED', label: 'Skipped', statuses: ['SKIPPED'] },
];

export const matchesRipFilter = (rip: Rip, filter: RipFilter) =>
  RIP_FILTERS.find((f) => f.value === filter)?.statuses?.includes(rip.status) ?? true;

/** "Il padrino (1972)", or the download name until the film is identified */
export const ripName = (rip: Pick<Rip, 'title' | 'year' | 'downloadName'>) =>
  rip.title ? `${rip.title}${rip.year ? ` (${rip.year})` : ''}` : rip.downloadName;

export const tmdbUrl = (tmdbId: number) => `https://www.themoviedb.org/movie/${tmdbId}`;

// Exclusion rules: same matching as the backend (services/ripper/exclusions.ts)
export const EXCLUDED_PREFIX = 'Excluded by the rule ';
// Not started yet: a new rule skips them
export const EXCLUDABLE: RipStatus[] = ['WAITING', 'QUEUED', 'NEEDS_ATTENTION'];

const escapeRegExp = (text: string) => text.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
const exclusionRegExp = (pattern: string) =>
  new RegExp(pattern.replace(/\\/g, '/').split('*').map(escapeRegExp).join('.*'), 'i');

/** The first rule matching the disc path (relative to the downloads folder), or null */
export const matchExclusion = (patterns: string[], sourcePath: string): string | null =>
  patterns.find((pattern) => exclusionRegExp(pattern).test(sourcePath)) ?? null;

// ISO 639-1 -> the ISO 639-2 codes MakeMKV may report (same table as the backend)
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

/** ISO 639-2 codes of an ISO 639-1 language (empty when unknown) */
export const languageCodes = (iso6391: string | null | undefined): string[] =>
  iso6391 ? (LANGUAGES[iso6391.toLowerCase()] ?? []) : [];

/** "it" -> "Italian" */
export const languageName = (iso6391: string | null | undefined): string => {
  if (!iso6391) return 'Unknown';
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(iso6391) ?? iso6391.toUpperCase();
  } catch {
    return iso6391.toUpperCase();
  }
};
