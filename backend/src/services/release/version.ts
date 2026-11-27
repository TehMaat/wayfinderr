/**
 * The version (Extended, Director's Cut...) a release name starts from, chosen
 * beforehand (issue #108). Each value is null when not chosen and "" for none on
 * purpose. Several places can say it:
 *
 * - the upload itself, by hand (or the last name confirmed in the rename dialog): it wins;
 * - its rip, chosen on the Rips page;
 * - its source .torrent, sent by bookrr with the film's version;
 * - its merge plan (sent by bookrr), and for a merged file the versions of its two files.
 *
 * When those agree the version is theirs; when they disagree nothing wins: the
 * upload has a version to choose, and the rename waits for it. What the file
 * name says is only a suggestion (never one of the sources).
 */
import { sameVersion, versionTag } from './name.js';

export const MAX_VERSION = 60;

export type VersionOrigin = 'upload' | 'rip' | 'torrent' | 'plan' | 'merge';

export interface VersionSource {
  origin: VersionOrigin;
  version: string; // "" none
  from: string | null; // the rip's download, who sent the .torrent or the plan, the merged file's input
}

export interface ReleaseVersion {
  version: string | null; // what the rename starts from: null not known, or to choose
  origin: VersionOrigin | null;
  from: string | null;
  toChoose: boolean; // the sources disagree: chosen by hand before the rename
  sources: VersionSource[]; // what each source says (not the upload's own choice)
}

/**
 * A version from a request: a string (trimmed, capped; "" none) or null (not chosen).
 * undefined when it is neither.
 */
export const parseVersion = (value: unknown): string | null | undefined => {
  if (value === null) return null;
  if (typeof value !== 'string') return undefined;
  return value.trim().replace(/\s+/g, ' ').slice(0, MAX_VERSION);
};

/** The same source saying the same version once */
export const uniqueSources = (sources: VersionSource[]): VersionSource[] => {
  const seen = new Set<string>();
  return sources.filter((s) => {
    const key = `${s.origin}\u0000${versionTag(s.version)}\u0000${s.from ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

export const resolveVersion = (chosen: string | null, sources: VersionSource[]): ReleaseVersion => {
  const all = uniqueSources(sources);
  if (chosen !== null) return { version: chosen, origin: 'upload', from: null, toChoose: false, sources: all };
  const distinct: VersionSource[] = [];
  for (const source of all) {
    if (!distinct.some((d) => sameVersion(d.version, source.version))) distinct.push(source);
  }
  if (distinct.length === 0) return { version: null, origin: null, from: null, toChoose: false, sources: all };
  if (distinct.length > 1) return { version: null, origin: null, from: null, toChoose: true, sources: all };
  const [only] = distinct;
  return { version: only.version, origin: only.origin, from: only.from, toChoose: false, sources: all };
};

/**
 * A source changed its version: an upload's own choice that differs goes, so the
 * upload follows its sources again (or has a version to choose when they disagree).
 */
export const keepsChoice = (chosen: string | null, changed: string | null): boolean =>
  chosen === null || changed === null || sameVersion(chosen, changed);
