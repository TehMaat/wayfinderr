import type { Rip, RipStatus, UnpackDisk } from './store';
import { basename } from './utils';

export type RipFilter = 'ALL' | 'ATTENTION' | 'ACTIVE' | 'DONE' | 'FAILED' | 'SKIPPED';

export const RIP_FILTERS: { value: RipFilter; label: string; statuses: RipStatus[] | null }[] = [
  { value: 'ALL', label: 'All', statuses: null },
  { value: 'ATTENTION', label: 'Needs attention', statuses: ['NEEDS_ATTENTION'] },
  { value: 'ACTIVE', label: 'In progress', statuses: ['WAITING', 'QUEUED', 'UNPACKING', 'SCANNING', 'RIPPING', 'JOINING'] },
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

export const UNPACK_DISKS: Record<UnpackDisk, string> = {
  downloads: 'the downloads disk',
  watch: 'the watch folder disk',
};

/** A RAR archive holding an .mkv: unpacked and uploaded, never ripped */
export const isArchivedMkv = (rip: Pick<Rip, 'sourceType' | 'contentType'>) =>
  rip.sourceType === 'RAR' && rip.contentType === 'MKV';

/** The disc's path from the download on ("Movie.2001.BluRay/BDMV"), which tells several discs apart */
export const sourceLabel = (rip: Pick<Rip, 'sourcePath' | 'downloadName'>) => {
  const at = rip.sourcePath.lastIndexOf(rip.downloadName);
  return at >= 0 ? rip.sourcePath.slice(at) : basename(rip.sourcePath);
};

// Joining the discs of one film: not being ripped nor ripped (same as the backend)
export const JOINABLE: RipStatus[] = ['QUEUED', 'NEEDS_ATTENTION', 'FAILED', 'SKIPPED'];

/** The disc number in its path ("Film/Disc 2/BDMV" -> 2, "Film.CD1.iso" -> 1), or null */
export const discNumber = (sourcePath: string): number | null => {
  const matches = [...sourcePath.matchAll(/(?:^|[^a-z])(?:disc|disk|cd|d|part|pt)[\s._-]*(\d{1,2})(?!\d)/gi)];
  return matches.length > 0 ? Number(matches[matches.length - 1][1]) : null;
};

const byDisc = (a: Rip, b: Rip) =>
  (discNumber(a.sourcePath) ?? Infinity) - (discNumber(b.sourcePath) ?? Infinity) ||
  a.sourcePath.localeCompare(b.sourcePath, undefined, { numeric: true, sensitivity: 'base' });

/** The discs of the rip's download that can be joined with it, in disc order */
export const joinCandidates = (rip: Rip, rips: Rip[]) =>
  rips
    .filter((r) => r.downloadName === rip.downloadName && JOINABLE.includes(r.status) && !isArchivedMkv(r))
    .sort(byDisc);

export const canJoin = (rip: Rip, rips: Rip[]) =>
  JOINABLE.includes(rip.status) && !isArchivedMkv(rip) && joinCandidates(rip, rips).length > 1;

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

// Ignored folders: never searched (same as the backend)
// Nothing made of them yet: a new ignored folder removes them from the list
export const REMOVABLE: RipStatus[] = [...EXCLUDABLE, 'FAILED', 'SKIPPED'];

const isInside = (folder: string, relativePath: string) => {
  const a = folder.toLowerCase();
  const b = relativePath.toLowerCase();
  return b === a || b.startsWith(`${a}/`);
};

/** The ignored folder holding the disc path, or null */
export const ignoredFolder = (folders: string[], sourcePath: string): string | null =>
  folders.find((folder) => isInside(folder, sourcePath)) ?? null;

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
