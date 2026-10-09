import { spawn } from 'child_process';
import { constants } from 'fs';
import { access, lstat, mkdir, readdir, stat, statfs } from 'fs/promises';
import path from 'path';
import { config } from '../../config/index.js';
import { DiscType } from './downloads.js';

/**
 * RAR archives in the downloads folder (scene releases), listed and unpacked
 * with RARLAB's unrar. An archive is handled when it holds one film: a disc
 * (ISO, BDMV or VIDEO_TS folder) that is then ripped, or an .mkv that is then
 * uploaded. It is unpacked on whichever disk has more free space:
 *
 *   <downloads>/.wayfinderr/unpack/<rip id>/   next to the downloads (only when that folder is writable)
 *   <work folder>/unpack/<rip id>/             next to the watch folder
 */

export type FilmType = DiscType | 'MKV';
export type UnpackDisk = 'downloads' | 'watch';

export interface ArchiveEntry {
  path: string; // inside the archive, with "/" separators
  size: number;
  kind: 'file' | 'folder' | 'link';
  encrypted: boolean;
}

export interface ArchiveFilm {
  type: FilmType;
  path: string; // the .iso or .mkv file, or the folder holding BDMV/VIDEO_TS ("." = the archive root)
}

export type ArchiveContent = { film: ArchiveFilm; size: number } | { film: null; reason: string };

export class ArchiveError extends Error {
  // Trying again changes nothing (a password): the archive is skipped, not failed
  constructor(
    message: string,
    readonly permanent = false
  ) {
    super(message);
  }
}

export interface UnpackTarget {
  disk: UnpackDisk;
  freeBytes: number;
}

const LIST_TIMEOUT_MS = 5 * 60_000;
const UNRAR_CHECK_MS = 60_000;

// unrar exit codes
const EXIT_CODES: Record<number, string> = {
  1: 'warning',
  2: 'fatal error',
  3: 'checksum error, the archive is damaged',
  4: 'the archive is locked',
  5: 'write error (is the disk full?)',
  6: 'cannot open a file',
  7: 'wrong command line',
  8: 'not enough memory',
  9: 'cannot create a file',
  10: 'no files to extract',
  11: 'wrong password',
  255: 'interrupted',
};

const describeCode = (code: number | null) =>
  code === null ? 'unrar was stopped' : `unrar exit code ${code}${EXIT_CODES[code] ? ` (${EXIT_CODES[code]})` : ''}`;

/** unrar's own message: the distinct lines it wrote on stderr */
const errorText = (stderr: string) =>
  [...new Set(stderr.split(/\r?\n/).map((line) => line.replace(/\s+/g, ' ').trim()).filter(Boolean))]
    .slice(0, 3)
    .join(' · ');

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** Runs unrar; with onOutput the standard output goes there instead of the result. */
const run = (args: string[], options: { signal?: AbortSignal; onOutput?: (chunk: string) => void } = {}) =>
  new Promise<RunResult>((resolve, reject) => {
    const { signal, onOutput } = options;
    // unrar writes the names in the locale's charset: without UTF-8 every accent is a "?"
    const child = spawn(config.RIP.UNRAR_PATH, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, LC_ALL: 'C.UTF-8' },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => (onOutput ? onOutput(chunk) : (stdout += chunk)));
    child.stderr.on('data', (chunk: string) => (stderr = (stderr + chunk).slice(-16_384)));

    const abort = () => child.kill();
    signal?.addEventListener('abort', abort, { once: true });
    child.on('error', (error: NodeJS.ErrnoException) => {
      signal?.removeEventListener('abort', abort);
      reject(
        error.code === 'ENOENT'
          ? new ArchiveError(`${config.RIP.UNRAR_PATH} not found: install unrar, or set UNRAR_PATH`)
          : error
      );
    });
    child.on('close', (code) => {
      signal?.removeEventListener('abort', abort);
      resolve({ code, stdout, stderr });
    });
  });

let unrarCheck: { at: number; ok: boolean } | null = null;

/** Whether the unrar command can be run (checked at most once a minute). */
export const unrarAvailable = async (): Promise<boolean> => {
  if (unrarCheck && Date.now() - unrarCheck.at < UNRAR_CHECK_MS) return unrarCheck.ok;
  // Without arguments it prints its help
  const ok = await run([]).then(
    () => true,
    () => false
  );
  unrarCheck = { at: Date.now(), ok };
  return ok;
};

/**
 * The entries of `unrar lt -v` (technical listing of every volume): blocks of
 * "Name:", "Type:", "Size:", "Flags:" lines. A file split over several volumes
 * is listed in each one, always with its whole size.
 */
export const parseListing = (output: string): ArchiveEntry[] => {
  const entries = new Map<string, ArchiveEntry>();
  let current: ArchiveEntry | null = null;
  const flush = () => {
    if (current && !entries.has(current.path)) entries.set(current.path, current);
    current = null;
  };

  for (const line of output.split(/\r?\n/)) {
    const field = /^\s*([A-Za-z][\w -]*?):\s?(.*)$/.exec(line);
    if (!field) continue;
    const [, key, value] = field;
    if (key === 'Name') {
      flush();
      current = { path: value.replace(/\\/g, '/'), size: 0, kind: 'file', encrypted: false };
    } else if (!current) {
      continue;
    } else if (key === 'Type') {
      // Anything else is a link of some sort (symbolic, hard, junction, file reference)
      current.kind = value === 'File' ? 'file' : value === 'Directory' ? 'folder' : 'link';
    } else if (key === 'Size') {
      current.size = Number(value) || 0;
    } else if (key === 'Flags') {
      current.encrypted ||= /\bencrypted\b/.test(value);
    }
  }
  flush();
  return [...entries.values()];
};

/** Every entry of the archive (every volume is read, nothing is unpacked). */
export const listArchive = async (file: string): Promise<ArchiveEntry[]> => {
  // -c-: no archive comment, whose text could pass for entries
  const { code, stdout, stderr } = await run(['lt', '-v', '-c-', '-p-', '-idc', file], {
    signal: AbortSignal.timeout(LIST_TIMEOUT_MS),
  });
  if (code === 11 || /password/i.test(stderr)) throw new ArchiveError('Password-protected archive', true);
  // A missing volume is only told on stderr, with exit code 0
  if (code !== 0 || stderr.trim()) throw new ArchiveError(`Cannot read the archive: ${errorText(stderr) || describeCode(code)}`);
  if (/is not RAR archive/i.test(stdout)) throw new ArchiveError('Not a RAR archive, or a damaged one');
  return parseListing(stdout);
};

const SAMPLE_FOLDER = /^samples?$/i;
const SAMPLE_FILE = /(^|[._ -])sample$|^sample[._ -]/i;

// Scene releases put a short sample next to the film: "Sample/grp-film.sample.mkv"
const isSample = (file: string) => {
  const parts = file.split('/');
  const stem = parts[parts.length - 1].replace(/\.[^.]+$/, '');
  return parts.slice(0, -1).some((part) => SAMPLE_FOLDER.test(part)) || SAMPLE_FILE.test(stem);
};

// unrar never writes outside the destination, but such an archive is not a release
const isSafePath = (file: string) => !file.startsWith('/') && !/^[a-z]:/i.test(file) && !file.split('/').includes('..');

/** The films among some files: discs (BDMV or VIDEO_TS folders, .iso files) and .mkv files. */
export const findFilms = (files: string[]): ArchiveFilm[] => {
  const discs = new Map<string, DiscType>();
  for (const file of files) {
    const bluRay = /^(?:(.*)\/)?BDMV\/index\.bdmv$/i.exec(file);
    const dvd = /^(?:(.*)\/)?VIDEO_TS\/VIDEO_TS\.IFO$/i.exec(file);
    const match = bluRay ?? dvd;
    if (match) discs.set(match[1] ?? '.', bluRay ? 'BDMV' : 'DVD');
  }
  const inDisc = (file: string) => [...discs.keys()].some((root) => root === '.' || file.startsWith(`${root}/`));

  const films: ArchiveFilm[] = [...discs].map(([root, type]) => ({ type, path: root }));
  for (const file of files) {
    if (inDisc(file) || isSample(file)) continue;
    if (/\.iso$/i.test(file)) films.push({ type: 'ISO', path: file });
    else if (/\.mkv$/i.test(file)) films.push({ type: 'MKV', path: file });
  }
  return films;
};

const listNames = (files: string[]) =>
  files
    .slice(0, 3)
    .map((file) => path.posix.basename(file))
    .join(', ') + (files.length > 3 ? ` and ${files.length - 3} more` : '');

/** The film in the archive and the space it takes unpacked, or why it is not handled. */
export const classifyArchive = (entries: ArchiveEntry[]): ArchiveContent => {
  if (entries.some((entry) => entry.encrypted)) return { film: null, reason: 'Password-protected archive' };
  if (entries.some((entry) => entry.kind === 'link')) {
    return { film: null, reason: 'The archive holds links: unpack it by hand' };
  }
  if (entries.some((entry) => !isSafePath(entry.path))) {
    return { film: null, reason: 'The archive holds paths outside its folder: unpack it by hand' };
  }

  const files = entries.filter((entry) => entry.kind === 'file');
  const films = findFilms(files.map((file) => file.path));
  if (films.length === 1) return { film: films[0], size: files.reduce((total, file) => total + file.size, 0) };
  if (films.length > 1) {
    return {
      film: null,
      reason: `The archive holds ${films.length} films (${listNames(films.map((film) => film.path))}): unpack it by hand`,
    };
  }
  return {
    film: null,
    reason: files.length > 0 ? `No film in the archive: ${listNames(files.map((file) => file.path))}` : 'The archive is empty',
  };
};

/** What was really unpacked, as archive entries (links included, to refuse them). */
export const scanFolder = async (dir: string): Promise<ArchiveEntry[]> => {
  const entries: ArchiveEntry[] = [];
  const walk = async (relative: string) => {
    for (const entry of await readdir(path.join(dir, relative), { withFileTypes: true })) {
      const file = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        entries.push({ path: file, size: 0, kind: 'folder', encrypted: false });
        await walk(file);
      } else {
        const size = entry.isFile() ? (await lstat(path.join(dir, file))).size : 0;
        entries.push({ path: file, size, kind: entry.isFile() ? 'file' : 'link', encrypted: false });
      }
    }
  };
  await walk('');
  return entries;
};

// Each disk's unpack folder, from the downloads folder or from the work folder
const UNPACK_FOLDERS: Record<UnpackDisk, string[]> = {
  downloads: ['.wayfinderr', 'unpack'],
  watch: ['unpack'],
};

const unpackRoot = (disk: UnpackDisk) => (disk === 'downloads' ? config.RIP.SOURCE_DIR : config.RIP.WORK_DIR);

/** The folder a rip's archive is unpacked into. */
export const unpackDir = (disk: UnpackDisk, ripId: string) => path.join(unpackRoot(disk), ...UNPACK_FOLDERS[disk], ripId);

/**
 * A path in the folder a rip's archive is unpacked into, relative to the
 * downloads folder (downloads) or to the work folder (watch): what the MakeMKV
 * runner is given.
 */
export const unpackRelativePath = (disk: UnpackDisk, ripId: string, inner: string) =>
  path.posix.join(...UNPACK_FOLDERS[disk], ripId, inner);

/** The folder itself, or the closest parent that exists */
const closestExisting = async (dir: string): Promise<string> => {
  for (let current = dir; ; current = path.dirname(current)) {
    if (await stat(current).then(() => true, () => false)) return current;
    if (path.dirname(current) === current) return current;
  }
};

/** A disk's unpack folder (created with create): device and free space; throws when it can't be written. */
const probe = async (disk: UnpackDisk, create: boolean) => {
  const dir = path.join(unpackRoot(disk), ...UNPACK_FOLDERS[disk]);
  if (create) await mkdir(dir, { recursive: true });
  const existing = create ? dir : await closestExisting(dir);
  await access(existing, constants.W_OK);
  const [info, space] = await Promise.all([stat(existing), statfs(existing)]);
  return { disk, dev: info.dev, freeBytes: space.bavail * space.bsize };
};

/**
 * Where archives can be unpacked, with the free space: next to the watch folder,
 * and next to the downloads when that folder can be written (with Docker the
 * downloads are read-only but for <downloads>/.wayfinderr). One entry per disk.
 * Without create, the unpack folders are not created (their parents are checked).
 */
export const unpackTargets = async (create = true): Promise<UnpackTarget[]> => {
  const targets: UnpackTarget[] = [];
  const devices = new Set<number>();
  for (const disk of ['watch', 'downloads'] as const) {
    // Read-only or missing: not a choice
    const found = await probe(disk, create).catch(() => null);
    if (!found || devices.has(found.dev)) continue;
    devices.add(found.dev);
    targets.push({ disk, freeBytes: found.freeBytes });
  }
  return targets;
};

/** Whether archives can be unpacked next to the downloads (maybe on the watch folder's disk). */
export const downloadsUnpackWritable = () =>
  probe('downloads', false).then(
    () => true,
    () => false
  );

/** Space an archive takes on a disk: a disc unpacked next to the watch folder is ripped there too. */
export const unpackNeeds = (disk: UnpackDisk, sizeBytes: number, disc: boolean) =>
  disk === 'watch' && disc ? 2 * sizeBytes : sizeBytes;

/** The disk with the most space left once the archive is unpacked, or null if none can hold it. */
export const pickUnpackTarget = (
  targets: UnpackTarget[],
  sizeBytes: number,
  disc: boolean,
  marginBytes: number
): UnpackTarget | null => {
  let best: { target: UnpackTarget; left: number } | null = null;
  for (const target of targets) {
    const left = target.freeBytes - unpackNeeds(target.disk, sizeBytes, disc);
    if (left >= marginBytes && (!best || left > best.left)) best = { target, left };
  }
  return best?.target ?? null;
};

/**
 * Unpacks the archive into dir (which must exist), reporting the progress
 * (0-100). Rejects with unrar's message; aborting the signal stops it.
 */
export const unpackArchive = async (
  archive: string,
  dir: string,
  signal: AbortSignal,
  onProgress: (percent: number) => void
): Promise<void> => {
  // unrar redraws "  42%" with backspaces: a percentage may be split across chunks
  let tail = '';
  // -ai: default permissions, so the MakeMKV container's user can read the files
  const { code, stderr } = await run(['x', '-p-', '-o+', '-y', '-ai', '-idc', archive, `${dir}${path.sep}`], {
    signal,
    onOutput: (chunk) => {
      tail = (tail + chunk).slice(-64);
      const percents = [...tail.matchAll(/(\d{1,3})%/g)];
      if (percents.length > 0) onProgress(Math.min(100, Number(percents[percents.length - 1][1])));
    },
  });
  if (signal.aborted) throw new ArchiveError('Stopped');
  if (code !== 0) throw new ArchiveError(errorText(stderr) || describeCode(code));
};
