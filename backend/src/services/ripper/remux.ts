import { spawn } from 'child_process';
import { mkdir, readdir, readFile, rm, stat } from 'fs/promises';
import path from 'path';
import { config } from '../../config/index.js';
import { DiscType } from './downloads.js';
import { DiscStream, DiscTitle } from './makemkv.js';
import { parseMpls, Playlist, playlistNumber } from './mpls.js';

/**
 * Ripping without MakeMKV, for when it fails (a makemkvcon crash, an expired
 * key): the disc's film is remuxed by the backend itself, without decrypting
 * anything, so only unencrypted discs work.
 *
 *   Blu-ray folder   mkvmerge on the film's playlist (.mpls): it joins the clips,
 *                    takes the languages from CLIPINF and the chapters from the playlist
 *   Blu-ray ISO      the playlist's files extracted with 7-Zip, then the same
 *                    (mkvmerge can't read an ISO): twice the film's size on disk
 *   DVD (folder/ISO) ffmpeg's dvdvideo input (libdvdnav): languages, VobSub and
 *                    chapters from the IFO files
 *
 * The tracks kept are those of a MakeMKV rip (see selectionRule in makemkv.ts).
 * Neither tool reports a damaged source (both exit 0 on a truncated clip), so
 * the clips are checked before and the file's length after.
 */

export type RemuxKind = 'bluray' | 'dvd';

export interface IsoEntry {
  path: string; // inside the image, with "/" separators
  size: number;
  folder: boolean;
}

export interface RemuxSource {
  kind: RemuxKind;
  path: string; // the folder holding BDMV or VIDEO_TS, or the .iso
  iso: boolean;
  entries?: IsoEntry[]; // a Blu-ray ISO: its files
  root?: string; // a Blu-ray ISO: the folder holding BDMV inside it ("" or "DISC/")
}

export interface RemuxTools {
  mkvmerge: boolean;
  sevenZip: boolean;
  dvd: boolean; // ffmpeg with the dvdvideo input
}

export interface RemuxJob {
  source: RemuxSource;
  title: DiscTitle;
  languages: string[][]; // ISO 639-2 codes, by priority (the first one first and default)
  keepAll: boolean; // original language unknown: every language is kept
  dir: string; // empty work folder, on the watch folder's disk
  name: string; // file name without .mkv
  signal: AbortSignal;
  onProgress: (percent: number) => void;
}

export class RemuxError extends Error {}

const TOOL_CHECK_MS = 60_000;
const SCAN_TIMEOUT_MS = 5 * 60_000;
const PROBE_TIMEOUT_MS = 2 * 60_000;
const MAX_DVD_TITLES = 99;
// Titles in a row ffmpeg can't read: the others won't be either
const MAX_DVD_FAILURES = 3;
// The ripped file may be this much shorter than the title (rounding, a last frame)
const LENGTH_TOLERANCE_SECONDS = 2;
const LENGTH_TOLERANCE_RATIO = 0.005;
// DVD-Video's highest bitrate: what a title takes at most
const DVD_MAX_BYTES_PER_SECOND = 10_080_000 / 8;
// 192-byte packets: a clip of another size was cut short
const M2TS_PACKET = 192;

const ENV_NAMES: Record<string, string> = {
  [config.RIP.MKVMERGE_PATH]: 'MKVMERGE_PATH',
  [config.RIP.SEVENZIP_PATH]: 'SEVENZIP_PATH',
  [config.RIP.FFMPEG_PATH]: 'FFMPEG_PATH',
  [config.RIP.FFPROBE_PATH]: 'FFPROBE_PATH',
};

export interface RunResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

/** Runs a tool; with onOutput its standard output goes there instead of the result. */
export const run = (
  command: string,
  args: string[],
  options: { signal?: AbortSignal; timeoutMs?: number; onOutput?: (chunk: string) => void } = {}
) =>
  new Promise<RunResult>((resolve, reject) => {
    const signals = [options.signal, options.timeoutMs ? AbortSignal.timeout(options.timeoutMs) : undefined].filter(
      (s): s is AbortSignal => s !== undefined
    );
    const signal = signals.length > 0 ? AbortSignal.any(signals) : undefined;
    if (signal?.aborted) {
      reject(new RemuxError('Stopped'));
      return;
    }
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, LC_ALL: 'C.UTF-8' } });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => (options.onOutput ? options.onOutput(chunk) : (stdout += chunk)));
    child.stderr.on('data', (chunk: string) => (stderr = (stderr + chunk).slice(-16_384)));

    const abort = () => child.kill();
    signal?.addEventListener('abort', abort, { once: true });
    child.on('error', (error: NodeJS.ErrnoException) => {
      signal?.removeEventListener('abort', abort);
      reject(
        error.code === 'ENOENT'
          ? new RemuxError(`${command} not found: install it, or set ${ENV_NAMES[command] ?? 'its path'}`)
          : error
      );
    });
    child.on('close', (code, killedBy) => {
      signal?.removeEventListener('abort', abort);
      if (options.signal?.aborted) reject(new RemuxError('Stopped'));
      else if (signal?.aborted) reject(new RemuxError(`${path.basename(command)} took too long`));
      else resolve({ code, signal: killedBy, stdout, stderr });
    });
  });

/** A tool's own message: the last distinct lines it wrote (libdvdread's chatter about devices left out) */
export const errorText = (text: string) =>
  [...new Set(text.split(/\r?\n/).map((line) => line.replace(/\s+/g, ' ').trim()))]
    .filter((line) => line && !/libdvd(read|nav): /.test(line))
    .slice(-3)
    .join(' · ');

export const describeEnd = (tool: string, result: RunResult) =>
  result.signal || (result.code ?? 0) > 128
    ? `${tool} crashed (${result.signal ?? `exit code ${result.code}`})`
    : `${tool} exit code ${result.code}`;

// --- Tools ---

let toolCheck: { at: number; tools: RemuxTools } | null = null;

const succeeds = (command: string, args: string[], expect?: RegExp) =>
  run(command, args, { timeoutMs: 30_000 }).then(
    (result) => result.code === 0 && (!expect || expect.test(result.stdout + result.stderr)),
    () => false
  );

/** Which tools of the rip without MakeMKV can be run (checked at most once a minute). */
export const remuxTools = async (): Promise<RemuxTools> => {
  if (toolCheck && Date.now() - toolCheck.at < TOOL_CHECK_MS) return toolCheck.tools;
  const [mkvmerge, sevenZip, dvd] = await Promise.all([
    succeeds(config.RIP.MKVMERGE_PATH, ['--version']),
    succeeds(config.RIP.SEVENZIP_PATH, ['i']),
    // ffmpeg 7.0+ built with libdvdnav/libdvdread
    succeeds(config.RIP.FFMPEG_PATH, ['-hide_banner', '-h', 'demuxer=dvdvideo'], /Demuxer dvdvideo/),
  ]);
  toolCheck = { at: Date.now(), tools: { mkvmerge, sevenZip, dvd } };
  return toolCheck.tools;
};

/** What a disc needs to be ripped without MakeMKV that is missing, or null. */
export const missingTools = (tools: RemuxTools, type: DiscType): string | null => {
  const missing = [
    type !== 'DVD' && !tools.mkvmerge ? 'mkvmerge (Blu-ray)' : null,
    type === 'ISO' && !tools.sevenZip ? '7-Zip (ISO images)' : null,
    type !== 'BDMV' && !tools.dvd ? 'ffmpeg with DVD support (DVD)' : null,
  ].filter(Boolean);
  // An ISO is a Blu-ray or a DVD: one of the two is enough until it is opened
  if (type === 'ISO' && tools.sevenZip && (tools.mkvmerge || tools.dvd)) return null;
  return missing.length > 0 ? missing.join(', ') : null;
};

// --- 7-Zip (ISO images) ---

/** The entries of `7zz l -slt`: blocks of "Key = value" lines, after the "----------" line. */
export const parseSevenZipListing = (output: string): IsoEntry[] => {
  const lines = output.split(/\r?\n/);
  const start = lines.findIndex((line) => /^-{5,}$/.test(line.trim()));
  const entries: IsoEntry[] = [];
  let current: IsoEntry | null = null;
  for (const line of lines.slice(start + 1)) {
    const field = /^(\w[\w ]*?) = (.*)$/.exec(line);
    if (!field) continue;
    const [, key, value] = field;
    if (key === 'Path') {
      current = { path: value.replace(/\\/g, '/'), size: 0, folder: false };
      entries.push(current);
    } else if (current && key === 'Size') {
      current.size = Number(value) || 0;
    } else if (current && key === 'Folder') {
      current.folder = value === '+';
    }
  }
  return entries;
};

const listIso = async (iso: string, signal?: AbortSignal): Promise<IsoEntry[]> => {
  const result = await run(config.RIP.SEVENZIP_PATH, ['l', '-slt', '-sccUTF-8', '--', iso], { signal, timeoutMs: SCAN_TIMEOUT_MS });
  if (result.code !== 0) {
    throw new RemuxError(`7-Zip cannot read the image: ${errorText(result.stderr) || describeEnd('7-Zip', result)}`);
  }
  return parseSevenZipListing(result.stdout);
};

/** Extracts files of the image into dir, keeping their folders; progress 0-100. */
const extractIso = async (iso: string, files: string[], dir: string, signal: AbortSignal, onProgress?: (percent: number) => void) => {
  await mkdir(dir, { recursive: true });
  // 7-Zip redraws "  42% 3 - BDMV/STREAM/00012.m2ts" with backspaces
  let tail = '';
  const result = await run(
    config.RIP.SEVENZIP_PATH,
    ['x', '-y', '-bsp1', '-bso0', '-sccUTF-8', `-o${dir}`, '--', iso, ...files],
    {
      signal,
      onOutput: (chunk) => {
        tail = (tail + chunk).slice(-64);
        const percents = [...tail.matchAll(/(\d{1,3})%/g)];
        if (percents.length > 0) onProgress?.(Math.min(100, Number(percents[percents.length - 1][1])));
      },
    }
  );
  if (result.code !== 0) {
    throw new RemuxError(`7-Zip could not extract the image: ${errorText(result.stderr) || describeEnd('7-Zip', result)}`);
  }
};

// --- Sources ---

const findEntry = (entries: IsoEntry[], file: string) => {
  const wanted = file.toLowerCase();
  return entries.find((entry) => !entry.folder && entry.path.toLowerCase() === wanted);
};

/** What the disc is (an ISO is opened to tell a Blu-ray from a DVD). */
export const openSource = async (file: string, type: DiscType, signal?: AbortSignal): Promise<RemuxSource> => {
  if (type === 'BDMV') return { kind: 'bluray', path: file, iso: false };
  if (type === 'DVD') return { kind: 'dvd', path: file, iso: false };

  const entries = await listIso(file, signal);
  // The disc's own index, not one in a BACKUP or extras folder: the shallowest
  const index = entries
    .filter((entry) => !entry.folder && /(^|\/)BDMV\/index\.bdmv$/i.test(entry.path))
    .sort((a, b) => a.path.split('/').length - b.path.split('/').length)[0];
  if (index) return { kind: 'bluray', path: file, iso: true, entries, root: index.path.slice(0, -'BDMV/index.bdmv'.length) };
  if (entries.some((entry) => /(^|\/)VIDEO_TS\/VIDEO_TS\.IFO$/i.test(entry.path))) return { kind: 'dvd', path: file, iso: true };
  throw new RemuxError('The image holds neither a Blu-ray (BDMV) nor a DVD (VIDEO_TS)');
};

// --- Blu-ray ---

const PLAYLIST = /^(\d{5})\.mpls$/i;

/** Clip file sizes, by clip id. */
const clipSizes = async (source: RemuxSource): Promise<(clipId: string) => Promise<number | null>> => {
  const cache = new Map<string, number | null>();
  return async (clipId: string) => {
    if (cache.has(clipId)) return cache.get(clipId)!;
    const size = source.iso
      ? (findEntry(source.entries!, `${source.root}BDMV/STREAM/${clipId}.m2ts`)?.size ?? null)
      : await stat(path.join(source.path, 'BDMV', 'STREAM', `${clipId}.m2ts`)).then(
          (info) => info.size,
          () => null
        );
    cache.set(clipId, size);
    return size;
  };
};

/** A playlist as a title, like MakeMKV's: indexed by its number ("00800.mpls" is title 800). */
const playlistTitle = async (file: string, playlist: Playlist, sizeOf: (clipId: string) => Promise<number | null>): Promise<DiscTitle> => {
  let sizeBytes = 0;
  for (const item of playlist.playItems) sizeBytes += (await sizeOf(item.clipId)) ?? 0;
  return {
    index: playlistNumber(file)!,
    name: file,
    sourceFile: file,
    durationSec: Math.round(playlist.durationSec),
    sizeBytes,
    chapters: playlist.chapters,
    // The same clips are the same video: what tells duplicate playlists apart
    segmentsMap: playlist.playItems.map((item) => Number(item.clipId)).join(','),
    streams: playlist.streams.map(({ pid: _pid, ...stream }) => stream),
  };
};

/** Every playlist of the Blu-ray as a title (tmp: a scratch folder for an ISO). */
const scanBluray = async (source: RemuxSource, tmp: string, signal?: AbortSignal): Promise<DiscTitle[]> => {
  const playlists = new Map<string, Buffer>();
  if (source.iso) {
    const files = source.entries!.filter(
      (entry) => !entry.folder && entry.path.toLowerCase().startsWith(`${source.root}BDMV/PLAYLIST/`.toLowerCase()) && PLAYLIST.test(path.posix.basename(entry.path))
    );
    if (files.length === 0) throw new RemuxError('The image has no playlists (BDMV/PLAYLIST)');
    try {
      await extractIso(source.path, files.map((file) => file.path), tmp, signal ?? AbortSignal.timeout(SCAN_TIMEOUT_MS));
      for (const file of files) playlists.set(path.posix.basename(file.path), await readFile(path.join(tmp, file.path)));
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  } else {
    const dir = path.join(source.path, 'BDMV', 'PLAYLIST');
    const names = await readdir(dir).catch(() => {
      throw new RemuxError('The disc has no playlists (BDMV/PLAYLIST)');
    });
    for (const name of names.filter((n) => PLAYLIST.test(n))) playlists.set(name, await readFile(path.join(dir, name)));
  }

  const sizeOf = await clipSizes(source);
  const titles: DiscTitle[] = [];
  for (const [file, data] of playlists) {
    let playlist: Playlist;
    try {
      playlist = parseMpls(data);
    } catch {
      continue; // A damaged or decoy playlist is not a title
    }
    if (playlist.playItems.length > 0) titles.push(await playlistTitle(file, playlist, sizeOf));
  }
  return titles.sort((a, b) => a.index - b.index);
};

// --- DVD ---

interface ProbeStream {
  index: number;
  codec_type?: string;
  codec_name?: string;
  tags?: { language?: string };
}

interface Probe {
  format?: { duration?: string };
  streams?: ProbeStream[];
  chapters?: unknown[];
}

const probeDvdTitle = async (input: string, title: number, signal?: AbortSignal) => {
  const result = await run(
    config.RIP.FFPROBE_PATH,
    ['-v', 'error', '-f', 'dvdvideo', '-title', String(title), '-show_format', '-show_streams', '-show_chapters', '-of', 'json', input],
    { signal, timeoutMs: PROBE_TIMEOUT_MS }
  );
  if (result.code !== 0) return { probe: null, error: errorText(result.stderr) || describeEnd('ffprobe', result) };
  return { probe: JSON.parse(result.stdout) as Probe, error: '' };
};

const probeStreamType = (stream: ProbeStream): DiscStream['type'] | null =>
  stream.codec_type === 'video' ? 'video' : stream.codec_type === 'audio' ? 'audio' : stream.codec_type === 'subtitle' ? 'subtitle' : null;

const probeLanguage = (stream: ProbeStream) => {
  const lang = stream.tags?.language?.toLowerCase();
  return lang && lang !== 'und' ? lang : undefined;
};

/** Every title of the DVD (titles that can't be read are left out). */
const scanDvd = async (source: RemuxSource, signal?: AbortSignal): Promise<DiscTitle[]> => {
  // The disc's size bounds what a title takes
  const discBytes = source.iso
    ? (await stat(source.path)).size
    : await readdir(path.join(source.path, 'VIDEO_TS'))
        .then((names) => Promise.all(names.filter((n) => /\.vob$/i.test(n)).map((n) => stat(path.join(source.path, 'VIDEO_TS', n)))))
        .then((infos) => infos.reduce((total, info) => total + info.size, 0))
        .catch(() => 0);

  const titles: DiscTitle[] = [];
  let firstError = '';
  let failures = 0;
  for (let number = 1; number <= MAX_DVD_TITLES; number++) {
    const { probe, error } = await probeDvdTitle(source.path, number, signal);
    if (!probe) {
      // Past the last title ("Title 9 not found"), or a disc ffmpeg can't read at all
      if (/title \d+ not found/i.test(error) || ++failures === MAX_DVD_FAILURES) break;
      firstError ||= error;
      continue;
    }
    failures = 0;
    const durationSec = Number(probe.format?.duration) || 0;
    const streams = (probe.streams ?? []).flatMap((stream): DiscStream[] => {
      const type = probeStreamType(stream);
      return type ? [{ type, codec: stream.codec_name, lang: probeLanguage(stream), forced: false, commentary: false }] : [];
    });
    const chapters = probe.chapters?.length ?? 0;
    titles.push({
      index: number,
      name: `Title ${number}`,
      durationSec: Math.round(durationSec),
      sizeBytes: Math.round(Math.min(discBytes || Infinity, durationSec * DVD_MAX_BYTES_PER_SECOND)),
      chapters,
      // DVDs list the same video under several titles: same length, chapters and tracks is the same film
      segmentsMap: `${Math.round(durationSec)}:${chapters}:${streams.map((s) => `${s.type[0]}${s.lang ?? ''}`).join('')}`,
      streams,
    });
  }
  if (titles.length === 0) throw new RemuxError(`ffmpeg cannot read the DVD: ${firstError || 'no titles'}`);
  return titles;
};

/** The disc's titles, read without MakeMKV (tmp: a scratch folder, removed afterwards). */
export const scanDisc = (source: RemuxSource, tmp: string, signal?: AbortSignal): Promise<DiscTitle[]> =>
  source.kind === 'bluray' ? scanBluray(source, tmp, signal) : scanDvd(source, signal);

/** Free space the rip needs: the film, and an ISO's extracted clips too. */
export const remuxNeeds = (source: RemuxSource, title: DiscTitle) =>
  source.kind === 'bluray' && source.iso ? 2 * title.sizeBytes : title.sizeBytes;

// --- Tracks ---

export interface Track {
  id: number;
  type: DiscStream['type'];
  lang?: string; // ISO 639-2, undefined when unknown
  core?: boolean; // the AC-3 core of a TrueHD track
}

export interface TrackChoice {
  video: Track[];
  audio: Track[];
  subtitles: Track[];
  defaultAudio: number | null;
  defaultSubtitle: number | null;
}

/**
 * The tracks of a MakeMKV rip (selectionRule in makemkv.ts): video, audio and
 * subtitles in the kept languages, those without a language, and the only one
 * of its kind; lossy cores dropped. The first language comes first and is the
 * default audio (its subtitles are the default when there is no audio in it).
 * Unlike MakeMKV, a film is never left without audio: with none in the kept
 * languages, every audio track is kept.
 */
export const pickTracks = (tracks: Track[], languages: string[][], keepAll: boolean): TrackChoice => {
  const codes = new Set(languages.flat());
  const rank = (track: Track) => {
    const group = languages.findIndex((group) => track.lang !== undefined && group.includes(track.lang));
    return group < 0 ? languages.length : group;
  };
  const choose = (type: DiscStream['type']) => {
    const all = tracks.filter((track) => track.type === type && !track.core);
    const kept = keepAll ? all : all.filter((track) => all.length === 1 || track.lang === undefined || codes.has(track.lang));
    const chosen = kept.length === 0 && type === 'audio' ? all : kept;
    // Stable: same rank keeps the disc's order
    return chosen.map((track, i) => ({ track, i })).sort((a, b) => rank(a.track) - rank(b.track) || a.i - b.i).map(({ track }) => track);
  };

  const audio = choose('audio');
  const subtitles = choose('subtitle');
  const first = languages[0] ?? [];
  const inFirst = (track: Track) => track.lang !== undefined && first.includes(track.lang);
  return {
    video: tracks.filter((track) => track.type === 'video'),
    audio,
    subtitles,
    defaultAudio: audio[0]?.id ?? null,
    defaultSubtitle: audio.some(inFirst) ? null : (subtitles.find(inFirst)?.id ?? null),
  };
};

// --- mkvmerge ---

export interface MkvmergeTrack {
  id: number;
  type: 'video' | 'audio' | 'subtitles' | string;
  codec?: string;
  properties?: { language?: string; multiplexed_tracks?: number[] };
}

export interface MkvmergeIdentification {
  container?: { recognized?: boolean; supported?: boolean; properties?: { duration?: number; playlist?: boolean } };
  errors?: string[];
  tracks?: MkvmergeTrack[];
}

export const identify = async (file: string, signal: AbortSignal): Promise<MkvmergeIdentification> => {
  const result = await run(config.RIP.MKVMERGE_PATH, ['-J', file], { signal, timeoutMs: SCAN_TIMEOUT_MS });
  let info: MkvmergeIdentification;
  try {
    info = JSON.parse(result.stdout);
  } catch {
    throw new RemuxError(`mkvmerge cannot read ${path.basename(file)}: ${errorText(result.stderr) || describeEnd('mkvmerge', result)}`);
  }
  if (!info.container?.recognized || !info.container.supported) {
    throw new RemuxError(`mkvmerge cannot read ${path.basename(file)}: ${info.errors?.join(' · ') || 'unsupported file'}`);
  }
  return info;
};

/** mkvmerge's tracks as Tracks: the AC-3 core of a TrueHD track is marked. */
export const mkvmergeTracks = (info: MkvmergeIdentification): Track[] => {
  const tracks = info.tracks ?? [];
  const trueHd = new Set(tracks.filter((t) => /truehd/i.test(t.codec ?? '')).map((t) => t.id));
  return tracks.flatMap((t): Track[] => {
    const type = t.type === 'video' ? 'video' : t.type === 'audio' ? 'audio' : t.type === 'subtitles' ? 'subtitle' : null;
    if (!type) return [];
    const lang = t.properties?.language?.toLowerCase();
    const core = type === 'audio' && /^ac-?3/i.test(t.codec ?? '') && (t.properties?.multiplexed_tracks ?? []).some((id) => trueHd.has(id));
    return [{ id: t.id, type, ...(lang && lang !== 'und' ? { lang } : {}), ...(core ? { core } : {}) }];
  });
};

/** mkvmerge's options for the chosen tracks of file 0 (the playlist). */
export const mkvmergeTrackArgs = (choice: TrackChoice): string[] => {
  const list = (tracks: Track[]) => tracks.map((track) => track.id).join(',');
  const args = [
    ...(choice.video.length > 0 ? ['-d', list(choice.video)] : ['-D']),
    ...(choice.audio.length > 0 ? ['-a', list(choice.audio)] : ['-A']),
    ...(choice.subtitles.length > 0 ? ['-s', list(choice.subtitles)] : ['-S']),
    // Menus (interactive graphics) and attachments are not part of the film
    '-B',
    '-M',
  ];
  const ordered = [...choice.video, ...choice.audio, ...choice.subtitles];
  if (ordered.length > 0) args.push('--track-order', ordered.map((track) => `0:${track.id}`).join(','));
  // A transport stream has no default flags: without these every track would be a default
  for (const track of choice.audio) args.push('--default-track-flag', `${track.id}:${track.id === choice.defaultAudio ? 1 : 0}`);
  for (const track of choice.subtitles) args.push('--default-track-flag', `${track.id}:${track.id === choice.defaultSubtitle ? 1 : 0}`);
  return args;
};

/**
 * The last "#GUI#progress 42%" of mkvmerge --gui-mode output, once muxing: for a
 * playlist it first reports the scan of its clips from 0 to 100%.
 */
export const parseMkvmergeProgress = (text: string): number | null => {
  const scanEnd = text.lastIndexOf('#GUI#end_scanning_playlists');
  if (text.lastIndexOf('#GUI#begin_scanning_playlists') > scanEnd) return null;
  const matches = [...text.slice(Math.max(0, scanEnd)).matchAll(/#GUI#progress (\d{1,3})%/g)];
  return matches.length > 0 ? Math.min(100, Number(matches[matches.length - 1][1])) : null;
};

/** mkvmerge's "#GUI#error ..." or "#GUI#warning ..." lines of --gui-mode output. */
export const guiMessages = (text: string, kind: 'error' | 'warning') =>
  [...text.matchAll(new RegExp(`#GUI#${kind} (.*)`, 'g'))].map((m) => m[1].trim());

/** The ripped file is the title's length (a damaged clip makes it shorter, with exit code 0). */
export const checkLength = (seconds: number, expected: number, what = 'The ripped file') => {
  const tolerance = Math.max(LENGTH_TOLERANCE_SECONDS, expected * LENGTH_TOLERANCE_RATIO);
  if (seconds < expected - tolerance) {
    const format = (s: number) => `${Math.floor(s / 60)}m${String(Math.round(s % 60)).padStart(2, '0')}s`;
    throw new RemuxError(`${what} is ${format(seconds)} long instead of ${format(expected)}: is the download damaged?`);
  }
};

const remuxBluray = async (job: RemuxJob): Promise<{ file: string; warnings: string[] }> => {
  const { source, title, dir, signal, onProgress } = job;
  const playlistName = title.sourceFile ?? '';
  if (!PLAYLIST.test(playlistName)) throw new RemuxError(`Not a playlist: ${playlistName}`);

  // An ISO: the playlist, its clips and the files mkvmerge looks for, extracted first
  let root = source.path;
  const extracted = path.join(dir, 'disc');
  const weight = source.iso ? 0.5 : 0;
  try {
    if (source.iso) {
      const entries = source.entries!;
      const playlistEntry = findEntry(entries, `${source.root}BDMV/PLAYLIST/${playlistName}`);
      if (!playlistEntry) throw new RemuxError(`The playlist ${playlistName} is not on the image`);
      const tmp = path.join(dir, 'playlist');
      await extractIso(source.path, [playlistEntry.path], tmp, signal);
      const playlist = parseMpls(await readFile(path.join(tmp, playlistEntry.path)));
      await rm(tmp, { recursive: true, force: true });

      const clips = [...new Set(playlist.playItems.map((item) => item.clipId))];
      const files = [`${source.root}BDMV/index.bdmv`, `${source.root}BDMV/MovieObject.bdmv`, playlistEntry.path];
      for (const clip of clips) {
        const m2ts = findEntry(entries, `${source.root}BDMV/STREAM/${clip}.m2ts`);
        if (!m2ts) throw new RemuxError(`The clip ${clip}.m2ts of the playlist is missing from the image`);
        files.push(m2ts.path);
        const clpi = findEntry(entries, `${source.root}BDMV/CLIPINF/${clip}.clpi`);
        if (clpi) files.push(clpi.path);
      }
      const present = files.map((file) => findEntry(entries, file)?.path).filter((file): file is string => Boolean(file));
      await extractIso(source.path, present, extracted, signal, (percent) => onProgress(Math.floor(percent * weight)));
      root = path.join(extracted, source.root ?? '');
    }

    const playlistPath = path.join(root, 'BDMV', 'PLAYLIST', playlistName);
    const playlist = parseMpls(await readFile(playlistPath));
    // Before mkvmerge, which would skip a missing clip and cut a short one without a word
    for (const clip of new Set(playlist.playItems.map((item) => item.clipId))) {
      const info = await stat(path.join(root, 'BDMV', 'STREAM', `${clip}.m2ts`)).catch(() => null);
      if (!info) throw new RemuxError(`The clip ${clip}.m2ts of the playlist is missing`);
      if (info.size === 0 || info.size % M2TS_PACKET !== 0) throw new RemuxError(`The clip ${clip}.m2ts is incomplete: is the download damaged?`);
    }

    const tracks = mkvmergeTracks(await identify(playlistPath, signal));
    const choice = pickTracks(tracks, job.languages, job.keepAll);
    if (choice.video.length === 0) throw new RemuxError('mkvmerge found no video in the playlist');

    const output = path.join(dir, `${job.name}.mkv`);
    let tail = '';
    const result = await run(
      config.RIP.MKVMERGE_PATH,
      ['--gui-mode', '--flush-on-close', '-o', output, ...mkvmergeTrackArgs(choice), playlistPath],
      {
        signal,
        onOutput: (chunk) => {
          // Small: a line per percent and per message
          tail = (tail + chunk).slice(-65_536);
          const percent = parseMkvmergeProgress(tail);
          if (percent !== null) onProgress(Math.floor(weight * 100 + percent * (1 - weight)));
        },
      }
    );
    // 0: done, 1: done with warnings, 2: failed; above 128 a crash
    const messages = (kind: 'error' | 'warning') => guiMessages(tail, kind);
    if (result.code !== 0 && result.code !== 1) {
      throw new RemuxError(`mkvmerge failed: ${messages('error').join(' · ') || errorText(result.stderr) || describeEnd('mkvmerge', result)}`);
    }

    const ripped = await identify(output, signal);
    const kinds = new Set((ripped.tracks ?? []).map((t) => t.type));
    if (!kinds.has('video') || !kinds.has('audio')) throw new RemuxError('The ripped file has no video or no audio');
    checkLength((ripped.container?.properties?.duration ?? 0) / 1e9, playlist.durationSec);
    return { file: output, warnings: messages('warning') };
  } finally {
    await rm(extracted, { recursive: true, force: true });
  }
};

// --- ffmpeg (DVD) ---

/** ffmpeg's options for the chosen streams, in order, with the default flags. */
export const ffmpegMapArgs = (choice: TrackChoice): string[] => {
  const args: string[] = [];
  for (const track of [...choice.video, ...choice.audio, ...choice.subtitles]) args.push('-map', `0:${track.id}`);
  choice.video.forEach((_track, i) => args.push(`-disposition:v:${i}`, i === 0 ? 'default' : '0'));
  choice.audio.forEach((track, i) => args.push(`-disposition:a:${i}`, track.id === choice.defaultAudio ? 'default' : '0'));
  choice.subtitles.forEach((track, i) => args.push(`-disposition:s:${i}`, track.id === choice.defaultSubtitle ? 'default' : '0'));
  return args;
};

/** Progress (0-100) from ffmpeg's last "out_time_us=" line. */
export const parseFfmpegProgress = (text: string, durationSec: number): number | null => {
  const matches = [...text.matchAll(/out_time_us=(\d+)/g)];
  if (matches.length === 0 || durationSec <= 0) return null;
  return Math.min(100, Math.floor(Number(matches[matches.length - 1][1]) / 1e6 / durationSec * 100));
};

const remuxDvd = async (job: RemuxJob): Promise<{ file: string; warnings: string[] }> => {
  const { source, title, dir, signal, onProgress } = job;
  const { probe, error } = await probeDvdTitle(source.path, title.index, signal);
  if (!probe) throw new RemuxError(`ffmpeg cannot read title ${title.index}: ${error}`);
  const durationSec = Number(probe.format?.duration) || title.durationSec;
  const tracks = (probe.streams ?? []).flatMap((stream): Track[] => {
    const type = probeStreamType(stream);
    const lang = probeLanguage(stream);
    return type ? [{ id: stream.index, type, ...(lang ? { lang } : {}) }] : [];
  });
  const choice = pickTracks(tracks, job.languages, job.keepAll);
  if (choice.video.length === 0) throw new RemuxError(`Title ${title.index} has no video`);

  const output = path.join(dir, `${job.name}.mkv`);
  let tail = '';
  const result = await run(
    config.RIP.FFMPEG_PATH,
    [
      '-hide_banner', '-nostdin', '-v', 'error', '-nostats', '-progress', 'pipe:1',
      // -preindex: an accurate length and chapters, from a first pass over the title
      '-f', 'dvdvideo', '-preindex', 'true', '-title', String(title.index), '-i', source.path,
      ...ffmpegMapArgs(choice),
      '-c', 'copy',
      // The default flags as chosen, not inferred by the muxer
      '-default_mode', 'passthrough',
      output,
    ],
    {
      signal,
      onOutput: (chunk) => {
        tail = (tail + chunk).slice(-4096);
        const percent = parseFfmpegProgress(tail, durationSec);
        if (percent !== null) onProgress(percent);
      },
    }
  );
  if (result.code !== 0) throw new RemuxError(`ffmpeg failed: ${errorText(result.stderr) || describeEnd('ffmpeg', result)}`);

  const check = await run(config.RIP.FFPROBE_PATH, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', output], {
    signal,
    timeoutMs: PROBE_TIMEOUT_MS,
  });
  const ripped = check.code === 0 ? Number((JSON.parse(check.stdout) as Probe).format?.duration) || 0 : 0;
  checkLength(ripped, durationSec);
  return { file: output, warnings: [] };
};

/** Rips the title into job.dir: the .mkv file and what the tool warned about. */
export const remuxTitle = (job: RemuxJob): Promise<{ file: string; warnings: string[] }> =>
  job.source.kind === 'bluray' ? remuxBluray(job) : remuxDvd(job);
