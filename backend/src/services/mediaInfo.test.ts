import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fromProbe } from './mediaInfo.js';

// Trimmed ffprobe output of an mkvmerge file (-show_format -show_streams -show_chapters)
const probe = {
  streams: [
    {
      index: 0,
      codec_name: 'hevc',
      profile: 'Main 10',
      codec_type: 'video',
      width: 3840,
      height: 1600,
      display_aspect_ratio: '12:5',
      pix_fmt: 'yuv420p10le',
      color_space: 'bt2020nc',
      color_transfer: 'smpte2084',
      avg_frame_rate: '24000/1001',
      disposition: { default: 1, forced: 0, attached_pic: 0 },
      side_data_list: [{ side_data_type: 'DOVI configuration record', dv_profile: 8 }],
      tags: { BPS: '58000000', NUMBER_OF_FRAMES: '172000' },
    },
    {
      index: 1,
      codec_name: 'truehd',
      profile: 'Dolby TrueHD + Dolby Atmos',
      codec_type: 'audio',
      sample_rate: '48000',
      channels: 8,
      channel_layout: '7.1',
      bits_per_raw_sample: '24',
      disposition: { default: 1, forced: 0 },
      tags: { language: 'eng', title: 'TrueHD Atmos 7.1', 'BPS-eng': '4500000' },
    },
    {
      index: 2,
      codec_name: 'ac3',
      codec_type: 'audio',
      sample_rate: '48000',
      channels: 6,
      channel_layout: '5.1(side)',
      bit_rate: '640000',
      disposition: { default: 0, forced: 0 },
      tags: { language: 'ita' },
    },
    {
      index: 3,
      codec_name: 'hdmv_pgs_subtitle',
      codec_type: 'subtitle',
      disposition: { default: 0, forced: 1, hearing_impaired: 0 },
      tags: { language: 'ita', title: 'Forced', NUMBER_OF_FRAMES: '42' },
    },
    {
      index: 4,
      codec_name: 'subrip',
      codec_type: 'subtitle',
      disposition: { default: 0, forced: 0 },
      tags: { language: 'eng', title: 'English SDH' },
    },
    {
      index: 5,
      codec_name: 'mjpeg',
      codec_type: 'video',
      width: 600,
      height: 900,
      pix_fmt: 'yuvj420p',
      disposition: { attached_pic: 1 },
    },
  ],
  chapters: [{}, {}, {}],
  format: {
    format_name: 'matroska,webm',
    format_long_name: 'Matroska / WebM',
    duration: '7845.123000',
    bit_rate: '64000000',
    tags: { title: 'Il padrino' },
  },
};

test('container: format, title, duration, bitrate and chapters', () => {
  assert.deepEqual(fromProbe(probe).container, {
    format: 'Matroska / WebM',
    title: 'Il padrino',
    duration: 7845.123,
    bitrate: 64000000,
    chapters: 3,
  });
});

test('video: resolution, frame rate, bit depth and HDR; cover art is skipped', () => {
  const { videoTracks } = fromProbe(probe);
  assert.equal(videoTracks?.length, 1);
  assert.deepEqual(videoTracks?.[0], {
    index: 0,
    codec: 'hevc',
    profile: 'Main 10',
    width: 3840,
    height: 1600,
    aspectRatio: '12:5',
    frameRate: 23.976,
    bitDepth: 10,
    pixelFormat: 'yuv420p10le',
    colorSpace: 'bt2020nc',
    hdr: 'Dolby Vision P8 + HDR10',
    language: 'unknown',
    title: null,
    default: true,
    forced: false,
    bitrate: 58000000,
  });
});

test('audio: channels, Atmos and the bitrate from the statistics tags', () => {
  const [truehd, ac3] = fromProbe(probe).audioTracks;
  assert.equal(truehd.channels, 8);
  assert.equal(truehd.channelLayout, '7.1');
  assert.equal(truehd.bitDepth, 24);
  assert.equal(truehd.atmos, true);
  assert.equal(truehd.bitrate, 4500000);
  assert.equal(truehd.default, true);
  assert.equal(ac3.atmos, false);
  assert.equal(ac3.bitrate, 640000);
  assert.equal(ac3.bitDepth, null);
});

test('subtitles: forced, SDH and the number of captions', () => {
  const [pgs, srt] = fromProbe(probe).subtitles;
  assert.equal(pgs.forced, true);
  assert.equal(pgs.elements, 42);
  assert.equal(pgs.hearingImpaired, false);
  assert.equal(srt.hearingImpaired, true);
  assert.equal(srt.elements, null);
});

test('Italian audio and subtitles are still detected', () => {
  const info = fromProbe(probe);
  assert.equal(info.hasItalianAudio, true);
  assert.equal(info.hasItalianSubtitles, true);
  assert.equal(fromProbe({ streams: [] }).hasItalianAudio, false);
});

test('8-bit video without bits_per_raw_sample, no HDR', () => {
  const [video] = fromProbe({ streams: [{ index: 0, codec_type: 'video', codec_name: 'h264', pix_fmt: 'yuv420p', avg_frame_rate: '0/0', r_frame_rate: '25/1' }] }).videoTracks ?? [];
  assert.equal(video.bitDepth, 8);
  assert.equal(video.frameRate, 25);
  assert.equal(video.hdr, null);
});
