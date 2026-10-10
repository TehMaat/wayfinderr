/**
 * Exclusion rules, edited in the UI: a disc whose path in the downloads folder
 * contains one of them is not ripped. Case doesn't matter and `*` matches any
 * text, so "Serie TV/" excludes a folder and "S0*E" the episodes.
 */

export const MAX_EXCLUSIONS = 100;
export const MAX_EXCLUSION_LENGTH = 200;

// Reason of the rips skipped by a rule: tells them apart from the ones skipped by hand
export const EXCLUDED_PREFIX = 'Excluded by the rule ';

export const excludedReason = (pattern: string) => `${EXCLUDED_PREFIX}“${pattern}”`;

const escape = (text: string) => text.replace(/[.+?^${}()|[\]\\]/g, '\\$&');

// Paths use "/" separators: a rule typed with Windows "\" works the same
const toRegExp = (pattern: string) => new RegExp(pattern.replace(/\\/g, '/').split('*').map(escape).join('.*'), 'i');

/** The first rule matching the disc path (relative to the downloads folder), or null */
export const matchExclusion = (patterns: string[], sourcePath: string): string | null =>
  patterns.find((pattern) => toRegExp(pattern).test(sourcePath)) ?? null;

/** Trimmed, without blanks and duplicates (case-insensitive); throws on invalid input */
export const normalizeExclusions = (input: unknown): string[] => {
  if (!Array.isArray(input) || input.some((p) => typeof p !== 'string')) {
    throw new Error('patterns must be an array of strings');
  }
  const seen = new Set<string>();
  const patterns: string[] = [];
  for (const raw of input as string[]) {
    const pattern = raw.trim();
    if (!pattern || seen.has(pattern.toLowerCase())) continue;
    if (pattern.length > MAX_EXCLUSION_LENGTH) throw new Error(`A rule can be at most ${MAX_EXCLUSION_LENGTH} characters`);
    seen.add(pattern.toLowerCase());
    patterns.push(pattern);
  }
  if (patterns.length > MAX_EXCLUSIONS) throw new Error(`At most ${MAX_EXCLUSIONS} rules`);
  return patterns;
};

/** The stored setting (JSON array); a broken value counts as no rules */
export const parseExclusions = (value: string | undefined): string[] => {
  try {
    return normalizeExclusions(JSON.parse(value ?? '[]'));
  } catch {
    return [];
  }
};

/**
 * Ignored folders, picked in the UI: folders of the downloads that are never
 * searched (the torrent client's folder for the downloads in progress). Paths
 * relative to the downloads folder, with "/" separators.
 */

export const MAX_FOLDERS = 20;

/** "torrents", "Film/Extras": no leading or trailing "/", no "." or ".." parts; throws on invalid input */
export const normalizeFolder = (raw: string): string => {
  const parts = raw.replace(/\\/g, '/').split('/').map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) throw new Error('A folder cannot be empty');
  if (parts.some((part) => part === '.' || part === '..')) throw new Error(`Invalid folder: ${raw}`);
  const folder = parts.join('/');
  if (folder.length > MAX_EXCLUSION_LENGTH) throw new Error(`A folder can be at most ${MAX_EXCLUSION_LENGTH} characters`);
  return folder;
};

/** Normalized, without duplicates (case-insensitive) and folders inside another one */
export const normalizeFolders = (input: unknown): string[] => {
  if (!Array.isArray(input) || input.some((f) => typeof f !== 'string')) {
    throw new Error('folders must be an array of strings');
  }
  const folders = (input as string[]).filter((raw) => raw.trim()).map(normalizeFolder);
  const kept: string[] = [];
  for (const folder of folders) {
    // Already ignored with a folder holding it
    if (folders.some((other) => other.length < folder.length && isInside(other, folder))) continue;
    if (kept.some((k) => k.toLowerCase() === folder.toLowerCase())) continue;
    kept.push(folder);
  }
  if (kept.length > MAX_FOLDERS) throw new Error(`At most ${MAX_FOLDERS} folders`);
  return kept;
};

/** The stored setting (JSON array); a broken value counts as no folders */
export const parseFolders = (value: string | undefined): string[] => {
  try {
    return normalizeFolders(JSON.parse(value ?? '[]'));
  } catch {
    return [];
  }
};

/** Whether the path (relative to the downloads folder) is the folder or inside it, ignoring case */
export const isInside = (folder: string, relativePath: string) => {
  const a = folder.toLowerCase();
  const b = relativePath.toLowerCase();
  return b === a || b.startsWith(`${a}/`);
};

/** The ignored folder holding the path, or null */
export const ignoredFolder = (folders: string[], relativePath: string): string | null =>
  folders.find((folder) => isInside(folder, relativePath)) ?? null;
