import { languageCodes, languageName } from './rips';
import type { Rip, Upload } from './store';

export interface Track {
  language: string;
  codec: string;
  index: number;
}

// Same matching as the backend (services/mediaInfo.ts)
export const isItalian = (lang: string) =>
  ['ita', 'it', 'it-it'].includes(lang.toLowerCase()) || lang.toLowerCase().startsWith('ital');

const UNKNOWN = ['', 'und', 'unknown', 'zxx', 'mis', 'mul'];

/** Audio and subtitle tracks of an upload (parsed: false when the file was not probed) */
export function uploadTracks(upload: Pick<Upload, 'mediaInfo'>): { audio: Track[]; subs: Track[]; parsed: boolean } {
  try {
    const parsed = upload.mediaInfo ? JSON.parse(upload.mediaInfo) : null;
    return { audio: (parsed?.audioTracks ?? []) as Track[], subs: (parsed?.subtitles ?? []) as Track[], parsed: Boolean(parsed) };
  } catch {
    return { audio: [], subs: [], parsed: false };
  }
}

export interface LanguageTracks {
  label: string; // "ITA", "ENG"
  name: string; // "Italian", "English"
  audio: number;
  subs: number;
}

/** The rip that produced the upload, if any */
export const ripOfUpload = (rips: Rip[], upload: Pick<Upload, 'id' | 'filepath'>) =>
  rips.find((r) => (r.upload ? r.upload.id === upload.id : r.outputFile !== null && r.outputFile === upload.filepath));

/**
 * Italian tracks and tracks in the film's original language.
 * The original language comes from the rip (TMDB) when the file was ripped here,
 * otherwise it is the first other language among the audio (then subtitle) tracks.
 */
export function uploadLanguages(upload: Upload, rip?: Rip): { italian: LanguageTracks; original: LanguageTracks | null } {
  const { audio, subs, parsed } = uploadTracks(upload);
  const italian: LanguageTracks = parsed
    ? { label: 'ITA', name: 'Italian', audio: audio.filter((t) => isItalian(t.language)).length, subs: subs.filter((t) => isItalian(t.language)).length }
    : { label: 'ITA', name: 'Italian', audio: upload.hasItalianAudio ? 1 : 0, subs: upload.hasItalianSubtitles ? 1 : 0 };

  let codes: string[];
  let name: string | null = null;
  if (rip?.originalLanguage) {
    if (rip.originalLanguage.toLowerCase() === 'it') return { italian, original: null };
    codes = [rip.originalLanguage.toLowerCase(), ...languageCodes(rip.originalLanguage)];
    name = languageName(rip.originalLanguage);
  } else {
    const other = [...audio, ...subs].find((t) => !isItalian(t.language) && !UNKNOWN.includes(t.language.toLowerCase()));
    if (!other) return { italian, original: null };
    codes = [other.language.toLowerCase()];
  }

  const inOriginal = (t: Track) => codes.includes(t.language.toLowerCase());
  const first = [...audio, ...subs].find(inOriginal);
  if (!first) return { italian, original: null };
  const label = first.language.toUpperCase();
  return {
    italian,
    original: { label, name: name ?? label, audio: audio.filter(inOriginal).length, subs: subs.filter(inOriginal).length },
  };
}
