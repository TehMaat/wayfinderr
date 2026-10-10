import { languageCodes, languageName } from './rips';
import type { Rip, Upload } from './store';

export interface Track {
  language: string;
  codec: string;
  index: number;
  // Not in uploads probed by earlier versions
  title?: string | null;
  default?: boolean;
  forced?: boolean;
  bitrate?: number | null; // bits per second
  profile?: string | null;
  channels?: number | null;
  channelLayout?: string | null;
  sampleRate?: number | null;
  bitDepth?: number | null;
  atmos?: boolean;
  hearingImpaired?: boolean;
  elements?: number | null;
}

export interface VideoTrack {
  index: number;
  codec: string;
  profile: string | null;
  width: number;
  height: number;
  aspectRatio: string | null;
  frameRate: number | null;
  bitDepth: number | null;
  pixelFormat: string | null;
  colorSpace: string | null;
  hdr: string | null;
  language: string;
  title: string | null;
  default: boolean;
  forced: boolean;
  bitrate: number | null;
}

export interface ContainerInfo {
  format: string;
  title: string | null;
  duration: number | null;
  bitrate: number | null;
  chapters: number;
}

// Same matching as the backend (services/mediaInfo.ts)
export const isItalian = (lang: string) =>
  ['ita', 'it', 'it-it'].includes(lang.toLowerCase()) || lang.toLowerCase().startsWith('ital');

const UNKNOWN = ['', 'und', 'unknown', 'zxx', 'mis', 'mul'];

export interface UploadMedia {
  audio: Track[];
  subs: Track[];
  video: VideoTrack[];
  container: ContainerInfo | null;
  parsed: boolean; // false when the file was not probed
  detailed: boolean; // false when probed before video and container details were stored
}

/** Everything ffprobe told about the upload's file */
export function uploadMedia(upload: Pick<Upload, 'mediaInfo'>): UploadMedia {
  try {
    const parsed = upload.mediaInfo ? JSON.parse(upload.mediaInfo) : null;
    return {
      audio: (parsed?.audioTracks ?? []) as Track[],
      subs: (parsed?.subtitles ?? []) as Track[],
      video: (parsed?.videoTracks ?? []) as VideoTrack[],
      container: (parsed?.container ?? null) as ContainerInfo | null,
      parsed: Boolean(parsed),
      detailed: Boolean(parsed?.container),
    };
  } catch {
    return { audio: [], subs: [], video: [], container: null, parsed: false, detailed: false };
  }
}

/** Audio and subtitle tracks of an upload (parsed: false when the file was not probed) */
export function uploadTracks(upload: Pick<Upload, 'mediaInfo'>): { audio: Track[]; subs: Track[]; parsed: boolean } {
  const { audio, subs, parsed } = uploadMedia(upload);
  return { audio, subs, parsed };
}

const VIDEO_CODECS: Record<string, string> = {
  hevc: 'HEVC', h264: 'AVC', av1: 'AV1', vc1: 'VC-1', mpeg2video: 'MPEG-2', mpeg4: 'MPEG-4', vp9: 'VP9',
};
const AUDIO_CODECS: Record<string, string> = {
  truehd: 'TrueHD', eac3: 'E-AC-3', ac3: 'AC-3', dts: 'DTS', aac: 'AAC', flac: 'FLAC', opus: 'Opus', mp3: 'MP3', mp2: 'MP2', vorbis: 'Vorbis', alac: 'ALAC',
};
const SUBTITLE_CODECS: Record<string, string> = {
  hdmv_pgs_subtitle: 'PGS', subrip: 'SRT', ass: 'ASS', ssa: 'SSA', dvd_subtitle: 'VobSub', dvb_subtitle: 'DVB', mov_text: 'TX3G', webvtt: 'WebVTT',
};

/** "HEVC Main 10", "AVC High" */
export function videoCodecLabel(track: Pick<VideoTrack, 'codec' | 'profile'>): string {
  const name = VIDEO_CODECS[track.codec] ?? track.codec.toUpperCase();
  return track.profile ? `${name} ${track.profile}` : name;
}

/** "TrueHD Atmos", "DTS-HD MA", "E-AC-3 Atmos", "PCM" */
export function audioCodecLabel(track: Pick<Track, 'codec' | 'profile' | 'atmos'>): string {
  let name: string;
  if (track.codec === 'dts' && track.profile?.startsWith('DTS')) name = track.profile; // DTS-HD MA (+ DTS:X)
  else if (track.codec.startsWith('pcm_')) name = 'PCM';
  else name = AUDIO_CODECS[track.codec] ?? track.codec.toUpperCase();
  return track.atmos && !name.includes('Atmos') ? `${name} Atmos` : name;
}

export const subtitleCodecLabel = (codec: string) => SUBTITLE_CODECS[codec] ?? codec.toUpperCase();

const CHANNELS: Record<number, string> = { 1: '1.0', 2: '2.0', 3: '2.1', 6: '5.1', 7: '6.1', 8: '7.1' };

/** "5.1", "2.0", "7.1"; null when unknown */
export function channelsLabel(track: Pick<Track, 'channels' | 'channelLayout'>): string | null {
  const layout = track.channelLayout ?? '';
  if (layout === 'mono') return '1.0';
  if (layout === 'stereo') return '2.0';
  const fromLayout = /^(\d+\.\d+)/.exec(layout)?.[1];
  if (fromLayout) return fromLayout;
  if (!track.channels) return null;
  return CHANNELS[track.channels] ?? `${track.channels} ch`;
}

/** "4K", "1080p", "720p", "576p" */
export function resolutionLabel(width: number, height: number): string {
  if (width >= 3800 || height >= 2000) return '4K';
  if (width >= 1900 || height >= 1000) return '1080p';
  if (width >= 1260 || height >= 700) return '720p';
  return `${height}p`;
}

/** "12:5" -> "2.40:1", "16:9" -> "1.78:1"; from the frame when no ratio is stored */
export function aspectLabel(track: Pick<VideoTrack, 'aspectRatio' | 'width' | 'height'>): string | null {
  const [w, h] = (track.aspectRatio ?? '').split(':').map(Number);
  const ratio = w && h ? w / h : track.width && track.height ? track.width / track.height : null;
  return ratio ? `${ratio.toFixed(2)}:1` : null;
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
