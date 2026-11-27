/**
 * Demo data for the documentation screenshots (scripts/screenshots/run.mjs).
 *
 * Every name here is made up: films, torrents, release groups, servers, trackers.
 * Never put real titles, torrent or tracker names in it (issue #41).
 *
 * Run by run.mjs from backend/ (npx tsx ../scripts/screenshots/seed.ts), with
 * DATABASE_URL pointing at a throwaway database.
 */
import { createHash } from 'crypto';
import { createRequire } from 'module';
import path from 'path';
import { fromProbe, type ProbeData } from '../../backend/src/services/mediaInfo';

// @prisma/client lives in backend/node_modules
const backendRequire = createRequire(path.resolve(__dirname, '../../backend/package.json'));
const { PrismaClient } = backendRequire('@prisma/client') as typeof import('@prisma/client');
const prisma = new PrismaClient();

const GB = 1024 ** 3;
const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000);
const watch = (name: string) => path.join(process.env.WATCH_DIR ?? '/makemkv-output', name);

/** A plausible ffprobe result: HEVC or AVC video, Italian first, the original language, subtitles */
const media = (opts: {
  uhd?: boolean;
  hdr?: boolean;
  minutes: number;
  original?: string;
  italian?: boolean;
  title: string;
}): string => {
  const audio = [
    ...(opts.italian === false ? [] : [{ lang: 'ita', codec: 'eac3', channels: 6, layout: '5.1(side)', title: 'Italiano' }]),
    ...(opts.original && opts.original !== 'ita'
      ? [{ lang: opts.original, codec: opts.uhd ? 'truehd' : 'dts', channels: 8, layout: '7.1', title: 'Original', profile: opts.uhd ? undefined : 'DTS-HD MA' }]
      : []),
  ];
  const subs = [
    ...(opts.italian === false ? [] : [{ lang: 'ita', forced: true, title: 'Forced' }, { lang: 'ita', forced: false, title: 'Italiano' }]),
    { lang: 'eng', forced: false, title: 'English SDH' },
  ];
  let index = 0;
  const probe: ProbeData = {
    streams: [
      {
        index: index++,
        codec_type: 'video',
        codec_name: opts.uhd ? 'hevc' : 'h264',
        profile: opts.uhd ? 'Main 10' : 'High',
        width: opts.uhd ? 3840 : 1920,
        height: opts.uhd ? 2160 : 1080,
        display_aspect_ratio: '16:9',
        avg_frame_rate: '24000/1001',
        pix_fmt: opts.uhd ? 'yuv420p10le' : 'yuv420p',
        color_space: opts.uhd ? 'bt2020nc' : 'bt709',
        color_transfer: opts.hdr ? 'smpte2084' : 'bt709',
        disposition: { default: 1 },
        tags: { language: 'und', BPS: String(opts.uhd ? 58_000_000 : 28_000_000) },
      },
      ...audio.map((a, i) => ({
        index: index++,
        codec_type: 'audio',
        codec_name: a.codec,
        profile: a.profile,
        channels: a.channels,
        channel_layout: a.layout,
        sample_rate: '48000',
        disposition: { default: i === 0 ? 1 : 0 },
        tags: { language: a.lang, title: a.title, BPS: '1536000' },
      })),
      ...subs.map((s) => ({
        index: index++,
        codec_type: 'subtitle',
        codec_name: 'hdmv_pgs_subtitle',
        disposition: { default: 0, forced: s.forced ? 1 : 0 },
        tags: { language: s.lang, title: s.title, NUMBER_OF_FRAMES: s.forced ? '42' : '1480' },
      })),
    ],
    chapters: new Array(24).fill({}),
    format: {
      format_name: 'matroska,webm',
      format_long_name: 'Matroska / WebM',
      duration: String(opts.minutes * 60),
      bit_rate: String(opts.uhd ? 62_000_000 : 32_000_000),
      tags: { title: opts.title },
    },
  };
  return JSON.stringify(fromProbe(probe));
};

/** The files of the demo: title, year, original language, size in GB, quality */
const films = [
  { title: 'Orbita Silenziosa', year: 2023, lang: 'eng', gb: 61.4, uhd: true, hdr: true, minutes: 128 },
  { title: 'Le Lanterne di Brenna', year: 2018, lang: 'fra', gb: 28.7, minutes: 112 },
  { title: 'Codice Aurora', year: 2016, lang: 'eng', gb: 33.9, minutes: 121 },
  { title: 'Il Guardiano del Faro Spento', year: 2021, lang: 'ita', gb: 24.2, minutes: 104 },
  { title: 'Notte sul Lago Ferro', year: 1998, lang: 'deu', gb: 19.6, minutes: 97 },
  { title: 'La Casa dei Gelsi', year: 2004, lang: 'ita', gb: 22.1, minutes: 109 },
  { title: 'Sabbia e Rame', year: 2012, lang: 'spa', gb: 27.3, minutes: 118 },
  { title: 'Il Mercante di Nuvole', year: 2010, lang: 'jpn', gb: 31.8, minutes: 126 },
  { title: 'Il Treno delle Sei', year: 1987, lang: 'ita', gb: 21.5, minutes: 101 },
];
const fileOf = (f: (typeof films)[number]) => `${f.title} (${f.year}).mkv`;
const torrentOf = (f: (typeof films)[number], tag = 'DEMO') =>
  `${f.title.replace(/ /g, '.')}.${f.year}.${f.uhd ? '2160p.UHD' : '1080p'}.BluRay.${f.uhd ? 'HEVC' : 'AVC'}-${tag}`;

async function main() {
  const alpha = await prisma.server.create({
    data: {
      name: 'Seedbox Alpha',
      type: 'ULTRA',
      apiEndpoint: 'https://demo.alpha.example.invalid/ultra-api/get_diskquota',
      apiToken: 'demo-token',
      sshHost: 'alpha.example.invalid',
      sshHostKey: 'SHA256:Xb3Kc0lYw1AqEnmz0ZcVpT9u7oRfX2gD4hJ8sLkQaM0',
      sshUsername: 'demo',
      sshPassword: 'demo',
      sshPath: '/home/demo/media/movies',
      releaseDir: 'downloads/qbittorrent',
      releaseTag: '-DEMO',
      trackerCommand: 'release-tool -u {path}',
      lastSpaceCheckAt: ago(0),
      cachedFreeSpaceBytes: BigInt(Math.round(1240 * GB)),
    },
  });
  const beta = await prisma.server.create({
    data: {
      name: 'Seedbox Beta',
      type: 'SEEDBOX',
      sshHost: 'beta.example.invalid',
      sshUsername: 'demo',
      sshPassword: 'demo',
      sshPath: '/home/demo/files/movies',
      lastSpaceCheckAt: ago(0),
      cachedFreeSpaceBytes: BigInt(Math.round(612 * GB)),
    },
  });
  await prisma.server.create({
    data: {
      name: 'Home NAS',
      type: 'SSH',
      sshHost: 'nas.example.invalid',
      sshUsername: 'media',
      sshPassword: 'demo',
      sshPath: '/volume1/movies',
      mediaCheckPolicy: 'ALWAYS_UPLOAD',
      lastSpaceCheckAt: ago(0),
      cachedFreeSpaceBytes: BigInt(Math.round(3480 * GB)),
    },
  });

  const client = await prisma.torrentClient.create({
    data: {
      name: 'qBittorrent',
      url: 'http://qbittorrent.example.invalid:8080',
      username: 'admin',
      password: 'demo',
      category: 'rip',
      autoRemove: true,
      minFreeGB: 50,
      localRelease: true,
      sshHost: 'downloads.example.invalid',
      sshUsername: 'demo',
      hostWatchDir: '/mnt/data/extracted-mkv',
      releaseDir: '/mnt/data/downloads/releases',
      releaseTag: '-DEMO',
      trackerCommand: 'release-tool -u {path}',
    },
  });

  const [orbita, lanterne, aurora, faro, lago, gelsi, sabbia, mercante, treno] = films;
  const hash = (seed: number) => createHash('sha1').update(`wayfinderr-demo-${seed}`).digest('hex');

  // Uploaded, torrent removed, released on the tracker
  const done = async (f: (typeof films)[number], server: string, minutesAgo: number, seed: number, extra = {}) =>
    prisma.upload.create({
      data: {
        filename: fileOf(f),
        filepath: watch(fileOf(f)),
        size: BigInt(Math.round(f.gb * GB)),
        progress: 100,
        progressBytes: BigInt(Math.round(f.gb * GB)),
        mediaInfo: media({ ...f, original: f.lang, title: f.title }),
        hasItalianAudio: true,
        hasItalianSubtitles: true,
        serverId: server,
        status: 'COMPLETED',
        startedAt: ago(minutesAgo + 25),
        completedAt: ago(minutesAgo),
        remotePath: `/home/demo/media/movies/${fileOf(f)}`,
        remoteFound: true,
        torrentStatus: 'REMOVED',
        torrentClientId: client.id,
        torrentHash: hash(seed),
        torrentName: torrentOf(f),
        torrentScore: 100,
        torrentMessage: 'Removed: the rip of its download is uploaded',
        torrentTracker: 'tracker.example.invalid',
        torrentFileName: `${torrentOf(f)}.torrent`,
        torrentFileData: Buffer.from('d4:infod4:name4:demoee'),
        createdAt: ago(minutesAgo + 40),
        ...extra,
      },
    });

  const orbitaUpload = await done(orbita, alpha.id, 35, 1, {
    releaseStatus: 'DONE',
    releaseName: `${torrentOf(orbita)}`,
    releaseMessage: 'Uploaded to the tracker, seeding',
    releaseStartedAt: ago(30),
    releaseCompletedAt: ago(22),
    releaseTracker: 'DEMO',
    releaseTorrentName: `${torrentOf(orbita)}.torrent`,
    releaseTorrentHash: hash(11),
    tmdbId: 900001,
  });
  await done(lanterne, beta.id, 180, 2);
  const auroraUpload = await done(aurora, alpha.id, 420, 3);
  await done(gelsi, beta.id, 1500, 4, { torrentStatus: 'REVIEW', torrentScore: 82, torrentMessage: 'Two torrents could be its source: choose one' });
  await prisma.upload.create({
    data: {
      filename: fileOf(treno),
      filepath: watch(fileOf(treno)),
      size: BigInt(Math.round(treno.gb * GB)),
      mediaInfo: media({ ...treno, original: treno.lang, title: treno.title }),
      hasItalianAudio: true,
      hasItalianSubtitles: true,
      serverId: beta.id,
      status: 'FAILED',
      currentRetryCount: 3,
      startedAt: ago(95),
      error: 'SSH connection timed out after 3 attempts',
      createdAt: ago(100),
    },
  });
  await prisma.upload.create({
    data: {
      filename: 'Promo Trailer Collection.mkv',
      filepath: watch('Promo Trailer Collection.mkv'),
      size: BigInt(Math.round(4.2 * GB)),
      mediaInfo: media({ minutes: 14, original: 'eng', italian: false, title: 'Promo Trailer Collection' }),
      status: 'SKIPPED',
      error: 'No Italian audio or subtitles',
      createdAt: ago(2600),
    },
  });

  // Held for a merge: the UHD without Italian and the Italian Blu-ray of the same film
  const lagoUhd = await prisma.upload.create({
    data: {
      filename: `${lago.title.replace(/ /g, '.')}.${lago.year}.2160p.UHD.BluRay.HEVC-EXAMPLE.mkv`,
      filepath: watch(`${lago.title.replace(/ /g, '.')}.${lago.year}.2160p.UHD.BluRay.HEVC-EXAMPLE.mkv`),
      size: BigInt(Math.round(58.3 * GB)),
      mediaInfo: media({ ...lago, uhd: true, hdr: true, original: 'deu', italian: false, title: lago.title }),
      status: 'HELD',
      holdKind: 'NO_ITALIAN',
      holdMessage: 'No Italian audio: it may be the better video of a merge',
      createdAt: ago(55),
    },
  });
  const lagoIta = await prisma.upload.create({
    data: {
      filename: fileOf(lago),
      filepath: watch(fileOf(lago)),
      size: BigInt(Math.round(lago.gb * GB)),
      mediaInfo: media({ ...lago, original: 'deu', title: lago.title }),
      hasItalianAudio: true,
      hasItalianSubtitles: true,
      status: 'HELD',
      holdKind: 'TWIN',
      holdMessage: `Twin found: ${lagoUhd.filename}`,
      createdAt: ago(50),
    },
  });
  await prisma.mergePair.create({
    data: {
      uploadAId: lagoUhd.id,
      uploadBId: lagoIta.id,
      fileA: lagoUhd.filepath,
      fileB: lagoIta.filepath,
      originalLanguage: 'de',
      status: 'ANALYZING',
      phase: 'checkpoints',
      progress: 58,
      startedAt: ago(4),
    },
  });

  // A refused pair: its held UHD is followed on the pair's card (not listed twice), with what it can still do
  const auroraUhdName = `${aurora.title.replace(/ /g, '.')}.${aurora.year}.2160p.UHD.BluRay.HEVC-EXAMPLE.mkv`;
  const auroraUhd = await prisma.upload.create({
    data: {
      filename: auroraUhdName,
      filepath: watch(auroraUhdName),
      size: BigInt(Math.round(64.8 * GB)),
      mediaInfo: media({ ...aurora, uhd: true, hdr: true, original: 'eng', italian: false, title: aurora.title }),
      status: 'HELD',
      holdKind: 'NO_ITALIAN',
      holdMessage: `No Italian audio: kept as the better video of a merge. Its twin may be the file "${fileOf(aurora)}"`,
      createdAt: ago(140),
    },
  });
  await prisma.mergePair.create({
    data: {
      uploadAId: auroraUhd.id,
      uploadBId: auroraUpload.id,
      fileA: auroraUhd.filepath,
      fileB: auroraUpload.filepath,
      originalLanguage: 'en',
      status: 'REFUSED',
      reasonCode: 'CHECKPOINT_CONTRADICTION',
      reasonMessage: 'Checkpoints contradict the offset: first at 3761412 ms',
      dyadrrVersion: '0.21.1',
      startedAt: ago(130),
      completedAt: ago(118),
    },
  });

  // Held and not paired yet: waiting for its twin, the rip still to choose
  const mercanteUhdName = `${mercante.title.replace(/ /g, '.')}.${mercante.year}.2160p.UHD.BluRay.HEVC-EXAMPLE.mkv`;
  await prisma.upload.create({
    data: {
      filename: mercanteUhdName,
      filepath: watch(mercanteUhdName),
      size: BigInt(Math.round(71.2 * GB)),
      mediaInfo: media({ ...mercante, uhd: true, hdr: true, original: 'jpn', italian: false, title: mercante.title }),
      status: 'HELD',
      holdKind: 'NO_ITALIAN',
      holdMessage: `No Italian audio: kept as the better video of a merge. Its twin may be the rip of "${torrentOf(mercante)}"`,
      createdAt: ago(20),
    },
  });

  // Rips: done (their uploads above), one waiting for a choice, one skipped by a rule
  const rip = (f: (typeof films)[number], data: Record<string, unknown>) =>
    prisma.rip.create({
      data: {
        sourcePath: `${torrentOf(f)}/${torrentOf(f)}.iso`,
        sourceType: 'ISO',
        downloadName: torrentOf(f),
        tmdbId: 900000 + f.year,
        title: f.title,
        originalTitle: f.title,
        originalLanguage: ({ eng: 'en', fra: 'fr', ita: 'it', deu: 'de', spa: 'es', jpn: 'ja' } as Record<string, string>)[f.lang],
        year: f.year,
        discName: f.title.toUpperCase().replace(/ /g, '_'),
        ...data,
      },
    });
  const titles = (f: (typeof films)[number]) =>
    JSON.stringify([
      { index: 0, name: f.title, durationSec: f.minutes * 60, sizeBytes: Math.round(f.gb * GB), chapters: 24, streams: [
        { type: 'video', forced: false, commentary: false },
        { type: 'audio', lang: 'ita', langName: 'Italian', codec: 'DD', channels: 6, forced: false, commentary: false },
        { type: 'audio', lang: f.lang, codec: 'DTS-HD MA', channels: 8, forced: false, commentary: false },
        { type: 'subtitle', lang: 'ita', forced: false, commentary: false },
      ] },
      { index: 1, name: `${f.title} (extended)`, durationSec: f.minutes * 60 + 780, sizeBytes: Math.round((f.gb + 3.1) * GB), chapters: 26, streams: [
        { type: 'video', forced: false, commentary: false },
        { type: 'audio', lang: 'ita', langName: 'Italian', codec: 'DD', channels: 6, forced: false, commentary: false },
        { type: 'audio', lang: f.lang, codec: 'DTS-HD MA', channels: 8, forced: false, commentary: false },
      ] },
      { index: 2, name: 'Extras', durationSec: 1260, sizeBytes: Math.round(2.4 * GB), chapters: 4, streams: [{ type: 'video', forced: false, commentary: false }] },
    ]);
  await rip(orbita, { status: 'DONE', titles: titles(orbita), titleIndex: 0, progress: 100, outputFile: orbitaUpload.filepath, startedAt: ago(110), completedAt: ago(75) });
  // Its version disagrees with bookrr's (below): the rename waits for a choice
  await rip(aurora, { status: 'DONE', titles: titles(aurora), titleIndex: 1, progress: 100, outputFile: watch(fileOf(aurora)), startedAt: ago(520), completedAt: ago(470), version: 'Extended' });
  await rip(faro, { status: 'DONE', titles: titles(faro), titleIndex: 0, progress: 100, outputFile: watch(fileOf(faro)), startedAt: ago(30), completedAt: ago(3), version: "Director's Cut" });
  // Shown as ripping by the screenshots (fixtures.mjs)
  await rip(sabbia, { status: 'DONE', titles: titles(sabbia), titleIndex: 0, progress: 100, startedAt: ago(12), completedAt: ago(1) });
  await rip(mercante, {
    status: 'NEEDS_ATTENTION',
    titles: titles(mercante),
    reason: 'Two long titles with Italian audio: choose the film’s one',
  });
  await prisma.rip.create({
    data: {
      sourcePath: 'Serie TV/Demo.Series.S01.COMPLETE.BluRay-EXAMPLE/DISC_1/BDMV',
      sourceType: 'BDMV',
      downloadName: 'Serie TV',
      status: 'SKIPPED',
      reason: 'Excluded by the rule “Serie TV/”',
    },
  });

  // The file of the last rip, still waiting for its upload
  await prisma.upload.create({
    data: {
      filename: fileOf(faro),
      filepath: watch(fileOf(faro)),
      size: BigInt(Math.round(faro.gb * GB)),
      mediaInfo: media({ ...faro, original: 'ita', title: faro.title }),
      hasItalianAudio: true,
      hasItalianSubtitles: true,
      serverId: alpha.id,
      status: 'CANCELLED',
      createdAt: ago(3),
    },
  });

  // .torrent files sent by bookrr, with the film's version
  const versions = ['', 'Extended', 'Theatrical'];
  for (const [i, f] of [orbita, lago, aurora].entries()) {
    await prisma.sourceTorrent.create({
      data: {
        infoHash: hash(i + 1),
        name: torrentOf(f),
        fileName: `${torrentOf(f)}.torrent`,
        data: Buffer.from('d4:infod4:name4:demoee'),
        size: BigInt(Math.round(f.gb * GB)),
        tracker: 'tracker.example.invalid',
        tmdbId: 900000 + f.year,
        label: i === 1 ? 'audio ITA' : null,
        version: versions[i],
        origin: 'bookrr',
        attachedAt: i === 1 ? null : ago(75),
      },
    });
  }

  console.log('Demo data seeded');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
