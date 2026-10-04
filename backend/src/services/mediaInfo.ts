import { execFile } from 'child_process';
import { promisify } from 'util';
import logger from '../config/logger.js';
import { MediaInfo, AudioTrack, SubtitleTrack } from '../types/index.js';

const execFileAsync = promisify(execFile);

interface ProbeStream {
  index: number;
  codec_type?: string;
  codec_name?: string;
  tags?: { language?: string };
}

const isItalian = (language: string): boolean => {
  const lang = language.toLowerCase();
  return lang === 'ita' || lang === 'it' || lang === 'it-it' || lang.startsWith('ital');
};

export class MediaInfoParser {
  async parseFile(filepath: string): Promise<MediaInfo> {
    try {
      logger.info({ filepath }, 'Parsing media file');

      // Language lives in the stream tags, not in the stream itself.
      // execFile (no shell) so file names with quotes or spaces are safe.
      const { stdout } = await execFileAsync(
        'ffprobe',
        [
          '-v', 'error',
          '-show_entries', 'stream=index,codec_type,codec_name:stream_tags=language',
          '-of', 'json',
          filepath,
        ],
        { maxBuffer: 10 * 1024 * 1024 }
      );
      const probeData = JSON.parse(stdout) as { streams?: ProbeStream[] };

      const audioTracks: AudioTrack[] = [];
      const subtitles: SubtitleTrack[] = [];
      let hasItalianAudio = false;
      let hasItalianSubtitles = false;

      for (const stream of probeData.streams ?? []) {
        const language = stream.tags?.language || 'unknown';
        const track = {
          language,
          codec: stream.codec_name || 'unknown',
          index: stream.index,
        };

        if (stream.codec_type === 'audio') {
          audioTracks.push(track);
          if (isItalian(language)) hasItalianAudio = true;
        } else if (stream.codec_type === 'subtitle') {
          subtitles.push(track);
          if (isItalian(language)) hasItalianSubtitles = true;
        }
      }

      const mediaInfo: MediaInfo = {
        audioTracks,
        subtitles,
        hasItalianAudio,
        hasItalianSubtitles,
      };

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
