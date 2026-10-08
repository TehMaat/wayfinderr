import { DiscTitle, hasLanguage } from './makemkv.js';

/**
 * Picks the film among the titles of a disc (all at least RIP_MIN_LENGTH long),
 * or says why a person has to choose. Discs with more than one film, several
 * cuts of the film, or many look-alike playlists (copy protection) are never
 * guessed.
 */

export type TitleChoice = { title: DiscTitle } | { title: null; reason: string };

// Other titles at least this fraction of the longest one may be another film or cut
const OTHER_FEATURE_RATIO = 0.6;
// Titles this close in length are the same film (duplicate playlists, angles)
const SAME_LENGTH_SECONDS = 60;
// More look-alikes than this: playlist obfuscation, the real one can't be told apart
const MAX_DUPLICATES = 2;

const formatDuration = (seconds: number) =>
  `${Math.floor(seconds / 3600)}h${String(Math.floor((seconds % 3600) / 60)).padStart(2, '0')}`;

export const pickMainTitle = (titles: DiscTitle[], italianCodes: string[]): TitleChoice => {
  if (titles.length === 0) return { title: null, reason: 'No title long enough to be the film' };

  const byLength = [...titles].sort((a, b) => b.durationSec - a.durationSec);
  const longest = byLength[0];
  const sameLength = byLength.filter((t) => longest.durationSec - t.durationSec <= SAME_LENGTH_SECONDS);
  const others = byLength.filter(
    (t) => !sameLength.includes(t) && t.durationSec >= longest.durationSec * OTHER_FEATURE_RATIO
  );

  if (others.length > 0) {
    const lengths = [longest, ...others].map((t) => formatDuration(t.durationSec)).join(', ');
    return { title: null, reason: `Several long titles (${lengths}): more than one film or cut, choose one` };
  }

  // Look-alikes with the same segments are the same video: any of them will do
  const distinct = new Map(sameLength.map((t) => [t.segmentsMap ?? `#${t.index}`, t]));
  if (distinct.size > MAX_DUPLICATES) {
    return {
      title: null,
      reason: `${distinct.size} titles with the same length (${formatDuration(longest.durationSec)}): choose the right playlist`,
    };
  }
  if (distinct.size > 1) {
    return { title: null, reason: `${distinct.size} versions of the film with the same length: choose one` };
  }

  // Prefer the biggest of identical titles (more streams), then the first
  const title = [...sameLength].sort((a, b) => b.sizeBytes - a.sizeBytes || a.index - b.index)[0];
  if (!hasLanguage(title, 'audio', italianCodes) && !hasLanguage(title, 'subtitle', italianCodes)) {
    return { title: null, reason: `The film has no audio or subtitles in the kept language (${italianCodes[0]}) on this disc` };
  }
  return { title };
};
