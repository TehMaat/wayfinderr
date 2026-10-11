import { uploadMedia } from './media';
import type { Upload } from './store';

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
