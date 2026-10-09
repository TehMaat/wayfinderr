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
