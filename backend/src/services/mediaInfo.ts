import { execFile } from 'child_process';
import { promisify } from 'util';
import logger from '../config/logger.js';
import { MediaInfo, AudioTrack, SubtitleTrack, VideoTrack, ContainerInfo } from '../types/index.js';

const execFileAsync = promisify(execFile);

interface ProbeStream {
  index: number;
  codec_type?: string;
  codec_name?: string;
  profile?: string;
  width?: number;
  height?: number;
  display_aspect_ratio?: string;
  avg_frame_rate?: string;
  r_frame_rate?: string;
  pix_fmt?: string;
  color_space?: string;
  color_transfer?: string;
  bits_per_raw_sample?: string;
  sample_rate?: string;
  channels?: number;
  channel_layout?: string;
  bit_rate?: string;
  disposition?: Record<string, number>;
  side_data_list?: { side_data_type?: string; dv_profile?: number }[];
  tags?: Record<string, string>;
}

export interface ProbeData {
  streams?: ProbeStream[];
  chapters?: unknown[];
  format?: {
    format_name?: string;
    format_long_name?: string;
    duration?: string;
    bit_rate?: string;
    tags?: Record<string, string>;
  };
}

const isItalian = (language: string): boolean => {
  const lang = language.toLowerCase();
  return lang === 'ita' || lang === 'it' || lang === 'it-it' || lang.startsWith('ital');
};

/** A tag in any case; mkvmerge writes its statistics as BPS or BPS-eng */
const tag = (tags: Record<string, string> | undefined, name: string): string | undefined => {
  if (!tags) return undefined;
  const wanted = name.toLowerCase();
  const key = Object.keys(tags).find((k) => k.toLowerCase() === wanted || k.toLowerCase().startsWith(`${wanted}-`));
  return key ? tags[key] : undefined;
};

/** A positive number, or null ("N/A", "0", missing) */
const positive = (value: string | number | undefined): number | null => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** "24000/1001" -> 23.976 */
const frameRate = (value: string | undefined): number | null => {
  const [num, den] = (value ?? '').split('/').map(Number);
  if (!num || !den) return null;
  return Math.round((num / den) * 1000) / 1000;
};

/** HDR format from the transfer function and the Dolby Vision configuration */
const hdrFormat = (stream: ProbeStream): string | null => {
  const dovi = stream.side_data_list?.find((d) => d.side_data_type === 'DOVI configuration record');
  const base =
    stream.color_transfer === 'smpte2084' ? 'HDR10' : stream.color_transfer === 'arib-std-b67' ? 'HLG' : null;
  if (dovi) {
    const dv = dovi.dv_profile !== undefined ? `Dolby Vision P${dovi.dv_profile}` : 'Dolby Vision';
    return base ? `${dv} + ${base}` : dv;
  }
  return base;
};

const flags = (stream: ProbeStream) => ({
  title: tag(stream.tags, 'title') || null,
  default: stream.disposition?.default === 1,
  forced: stream.disposition?.forced === 1,
  bitrate: positive(stream.bit_rate) ?? positive(tag(stream.tags, 'BPS')),
});

/** Tracks and container details from ffprobe's JSON (-show_format -show_streams -show_chapters) */
export function fromProbe(probeData: ProbeData): MediaInfo {
  const videoTracks: VideoTrack[] = [];
  const audioTracks: AudioTrack[] = [];
  const subtitles: SubtitleTrack[] = [];

  for (const stream of probeData.streams ?? []) {
    const language = tag(stream.tags, 'language') || 'unknown';
    const codec = stream.codec_name || 'unknown';

    if (stream.codec_type === 'video') {
      // Cover art attached to the file is not a video track
      if (stream.disposition?.attached_pic === 1) continue;
      const depth = positive(stream.bits_per_raw_sample) ?? positive(/p(\d+)(le|be)$/.exec(stream.pix_fmt ?? '')?.[1]) ?? (stream.pix_fmt ? 8 : null);
      const aspect = stream.display_aspect_ratio;
      videoTracks.push({
        index: stream.index,
        codec,
        profile: stream.profile || null,
        width: stream.width ?? 0,
        height: stream.height ?? 0,
        aspectRatio: aspect && !aspect.startsWith('0:') && aspect !== 'N/A' ? aspect : null,
        frameRate: frameRate(stream.avg_frame_rate) ?? frameRate(stream.r_frame_rate),
        bitDepth: depth,
        pixelFormat: stream.pix_fmt || null,
        colorSpace: stream.color_space || null,
        hdr: hdrFormat(stream),
        language,
        ...flags(stream),
      });
    } else if (stream.codec_type === 'audio') {
      const profile = stream.profile || null;
      const base = flags(stream);
      audioTracks.push({
        language,
        codec,
        index: stream.index,
        profile,
        channels: stream.channels ?? null,
        channelLayout: stream.channel_layout || null,
        sampleRate: positive(stream.sample_rate),
        bitDepth: positive(stream.bits_per_raw_sample),
        atmos: /atmos/i.test(profile ?? '') || /atmos/i.test(base.title ?? ''),
        ...base,
      });
    } else if (stream.codec_type === 'subtitle') {
      const base = flags(stream);
      subtitles.push({
        language,
        codec,
        index: stream.index,
        hearingImpaired: stream.disposition?.hearing_impaired === 1 || /\bSDH\b/i.test(base.title ?? ''),
        elements: positive(tag(stream.tags, 'NUMBER_OF_FRAMES')),
        ...base,
      });
    }
  }

  const format = probeData.format ?? {};
  const container: ContainerInfo = {
    format: format.format_long_name || format.format_name || 'unknown',
    title: tag(format.tags, 'title') || null,
    duration: positive(format.duration),
    bitrate: positive(format.bit_rate),
    chapters: probeData.chapters?.length ?? 0,
  };

  return {
    container,
    videoTracks,
    audioTracks,
    subtitles,
    hasItalianAudio: audioTracks.some((t) => isItalian(t.language)),
    hasItalianSubtitles: subtitles.some((t) => isItalian(t.language)),
  };
}

export class MediaInfoParser {
  async parseFile(filepath: string): Promise<MediaInfo> {
    try {
      logger.info({ filepath }, 'Parsing media file');

      // Language lives in the stream tags, not in the stream itself.
      // execFile (no shell) so file names with quotes or spaces are safe.
      const { stdout } = await execFileAsync(
        'ffprobe',
        ['-v', 'error', '-show_format', '-show_streams', '-show_chapters', '-of', 'json', filepath],
        { maxBuffer: 10 * 1024 * 1024 }
      );
      const mediaInfo = fromProbe(JSON.parse(stdout) as ProbeData);

      logger.info(
        { filepath, mediaInfo },
        'Media file parsed successfully'
      );

      return mediaInfo;
    } catch (error) {
      logger.error({ filepath, error }, 'Failed to parse media file');
      throw error;
    }
  }

  hasRequiredLanguage(mediaInfo: MediaInfo): boolean {
    return mediaInfo.hasItalianAudio || mediaInfo.hasItalianSubtitles;
  }
}

export const mediaInfoParser = new MediaInfoParser();
