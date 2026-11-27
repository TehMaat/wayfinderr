import { uploadMedia } from './media';
import type { ReleaseVersion, Upload, VersionSource } from './store';

/** Where the file went: its server, or the download client it was released on */
export const destinationName = (u: Pick<Upload, 'server' | 'localClient'>) =>
  u.server?.name ?? (u.localClient ? `${u.localClient.name} (local)` : null);

/** The name the file has now: the release name once renamed on the server */
export const uploadName = (u: Pick<Upload, 'filename' | 'releaseName'>) => u.releaseName ?? u.filename;

/** Search by any name it is known by (file, release, torrents) or by a torrent hash */
export const matchesSearch = (u: Upload, query: string) =>
  [u.filename, u.releaseName, u.torrentName, u.releaseTorrentName, u.torrentHash, u.releaseTorrentHash].some((name) =>
    name?.toLowerCase().includes(query)
  );

/** What could not be found for a finished upload: shown as "Missing …" */
export function missingInfo(u: Upload): string[] {
  if (u.status !== 'COMPLETED') return [];
  const missing: string[] = [];
  if (u.remoteFound === false) missing.push('file on the server');
  if (u.releaseStatus === 'DONE' && !u.releaseTorrentHash) missing.push('.torrent');
  const media = uploadMedia(u);
  if (!media.detailed) missing.push(media.parsed ? 'video details' : 'media info');
  if (u.torrentStatus === 'REMOVED') {
    if (!u.torrentHash) missing.push('source hash');
    if (!u.torrentTracker) missing.push('source tracker');
    if (!u.torrentFileName) missing.push('source .torrent');
  }
  return missing;
}

/** The versions offered (the same as the backend's release/name.ts VERSIONS, moverr's list) */
export const VERSIONS = [
  'Theatrical',
  'Extended',
  "Director's Cut",
  'Unrated',
  'Special Edition',
  'Remastered',
  'IMAX',
  'Final Cut',
  'Uncut',
  'Anniversary Edition',
];

/** "" is the standard version, on purpose */
export const versionLabel = (version: string) => version || 'None';

/** Theatrical: asked every time whether it goes in the name (backend isTheatrical) */
export const isTheatrical = (version: string) =>
  /^theatrical( (cut|edition|version))?$/.test(version.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim());

/** The same in the name: "Director's Cut" and "directors cut" */
export const sameVersion = (a: string, b: string) => {
  const norm = (v: string) => v.toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  return norm(a) === norm(b);
};

/** Where a version comes from, as shown next to it */
export function versionOrigin(source: Pick<VersionSource, 'origin' | 'from'>): string {
  switch (source.origin) {
    case 'upload':
      return 'chosen on this file';
    case 'rip':
      return 'from the rip';
    case 'torrent':
      return source.from === 'bookrr' ? 'from bookrr' : 'from the source .torrent';
    case 'plan':
      return source.from === 'bookrr' ? 'from bookrr (merge plan)' : 'from the merge plan';
    case 'merge':
      return source.from ? `from ${source.from}` : 'from a merged file';
  }
}

/** The version of an upload in a few words: null when nothing was chosen */
export function versionSummary(v: ReleaseVersion | undefined): string | null {
  if (!v) return null;
  if (v.toChoose) return 'To choose';
  if (v.version === null) return null;
  return versionLabel(v.version);
}
