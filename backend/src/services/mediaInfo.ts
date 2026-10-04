import { execSync } from 'child_process';
import logger from '../config/logger.js';
import { MediaInfo, AudioTrack, SubtitleTrack } from '../types/index.js';

export class MediaInfoParser {
  async parseFile(filepath: string): Promise<MediaInfo> {
    try {
      logger.info({ filepath }, 'Parsing media file');

      // Run ffprobe to get stream information
      const command = `ffprobe -v error -select_streams a:0 -select_streams s:0 -show_entries stream=index,codec_type,language -of json "${filepath}"`;
      const output = execSync(command, { encoding: 'utf-8' });
      const probeData = JSON.parse(output);

      const audioTracks: AudioTrack[] = [];
      const subtitles: SubtitleTrack[] = [];
      let hasItalianAudio = false;
      let hasItalianSubtitles = false;

      if (probeData.streams && Array.isArray(probeData.streams)) {
        for (const stream of probeData.streams) {
          if (stream.codec_type === 'audio') {
            const language = stream.language || 'unknown';
            audioTracks.push({
              language,
              codec: stream.codec_name || 'unknown',
              index: stream.index,
            });
            if (language.toLowerCase().includes('ita') || language === 'it') {
              hasItalianAudio = true;
            }
          } else if (stream.codec_type === 'subtitle') {
            const language = stream.language || 'unknown';
            subtitles.push({
              language,
              codec: stream.codec_name || 'unknown',
              index: stream.index,
            });
            if (language.toLowerCase().includes('ita') || language === 'it') {
              hasItalianSubtitles = true;
            }
          }
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
