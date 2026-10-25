/**
 * Release of an uploaded file on its server, in two steps:
 *  1. rename: once the user confirms the name (see name.ts), the file is moved
 *     over SFTP into <releaseDir>/<name>/<name>.mkv, as moverr.py does;
 *  2. tracker: the server's trackerCommand (Unit3Dup) runs on that file over SSH,
 *     inside tmux so it survives a dropped connection or a restart of Wayfinderr.
 *     Its output goes through `tee` into ~/.wayfinderr/<id>.log, read every second
 *     over SFTP; its questions (see output.ts) are answered from the upload page
 *     with `tmux send-keys`. One command at a time per server; a re-upload whose .torrent
 *     is already in the archive (made by an earlier run, see madeTorrent) has a second
 *     queue of its own: the file is not hashed again, so it does not wait for the others.
 * Once the tracker accepts it, the .torrent it gives back is read from the Unit3Dup
 * archive (<archive>/<TRACKER>/<file name>.torrent) and kept with its info hash.
 * Releases made before, or by hand, are linked to their file and .torrent by link().
 *
 * Local release: a file not uploaded yet can be released on the machine of a download
 * client instead (localRelease). The same two steps run there over SSH: the file is
 * moved from the watch folder (hostWatchDir, as that machine sees it) into the client's
 * releaseDir, then its trackerCommand (ITTUP) uploads it and seeds it from that client.
 */
import { EventEmitter } from 'events';
import { existsSync } from 'fs';
import path from 'path';
import { StringDecoder } from 'string_decoder';
import { setTimeout as sleep } from 'timers/promises';
import { Client as SSHClient, SFTPWrapper, Stats } from 'ssh2';
import { Server, TorrentClient, Upload } from '@prisma/client';
import { config } from '../../config/index.js';
import logger from '../../config/logger.js';
import { db } from '../database.js';
import { fromProbe, mediaInfoParser, ProbeData } from '../mediaInfo.js';
import { jobQueue } from '../jobQueue.js';
import { remoteDirOf, sftpCall, SshLogin, uploadManager } from '../uploadManager.js';
import { parseReleaseName } from '../ripper/releaseName.js';
import { MediaInfo } from '../../types/index.js';
import { analyze, buildReleaseName, isAutoHybrid, ReleaseAnalysis, ReleaseFlags, validateFlags, VERSIONS } from './name.js';
import { appendOutput, detectPrompt, exitCode, EXIT_MARKER, hashedFor, parseOutcome, Prompt, tmdbIdOf, withoutMarker } from './output.js';
import { parseTorrent, TorrentFile, trackerHost } from './torrentFile.js';

const POLL_MS = 1000;
const SAVE_EVERY_MS = 5000;
const SESSION_CHECK_EVERY = 10; // polls
const STOP_GRACE_MS = 10_000;
const RECONNECT_DELAY_MS = 10_000;
const MAX_RECONNECTS = 30; // ~5 minutes without the server
const READ_CHUNK = 256 * 1024;
const MAX_TORRENT_BYTES = 20 * 1024 * 1024;
const MAX_LINK_CANDIDATES = 50;

// The configuration and default .torrent archive of ITTUP and of Unit3Dup (which ITTUP
// is a fork of), in the SSH home (Linux)
const TRACKER_TOOLS = [
  { config: 'ittup_config/ittup.json', archive: 'ittup_config/torrent_archive_path' },
  { config: 'Unit3Dup_config/Unit3Dbot.json', archive: 'Unit3Dup_config/torrent_archive_path' },
];
// Printed by both when they start: [*.torrent Archive] '/home/u/ittup_config/torrent_archive_path'
const ARCHIVE_LINE = /\[\*\.torrent Archive\]\s*'([^'\n]+)'/;
// The tracker that accepted the upload: [RESPONSE]-> 'ITT'.....TORRENT UPLOADED
const ACCEPTED_BY = /\[RESPONSE\]->\s*'([^'\n]+)'\.{2,}/;

const ACTIVE = ['QUEUED', 'RUNNING', 'NEEDS_INPUT'];
// Wrapper scripts and their logs, relative to the SSH home (where SFTP and exec start)
const WORK_DIR = '.wayfinderr';
// The tracker command can run again from these
const RERUNNABLE = ['RENAMED', 'DONE', 'SKIPPED', 'UNKNOWN', 'FAILED', 'CANCELLED'];

/** An error meant for the user, with the HTTP status the route answers with */
export class ReleaseError extends Error {
  constructor(message: string, public status = 409, public code?: string) {
    super(message);
  }
}

/**
 * Where a file is released over SSH: its server, or the machine of a download client
 * (local: sshPath is then the watch folder as that machine sees it)
 */
export type ReleaseTarget = Pick<
  Server,
  'id' | 'name' | 'sshHost' | 'sshPort' | 'sshUsername' | 'sshPassword' | 'sshPath' | 'releaseDir' | 'releaseTag' | 'trackerCommand'
> & { local: boolean };

const serverTarget = (server: Server): ReleaseTarget => ({ ...server, local: false });

/** A client's machine as a release target; its SSH login and folders must be set */
export const localTarget = (client: TorrentClient): ReleaseTarget => {
  const missing = [
    !client.sshHost && 'SSH host',
    !client.sshUsername && 'SSH username',
    !client.hostWatchDir && 'watch folder',
    !client.releaseDir && 'release folder',
  ].filter(Boolean);
  if (missing.length) throw new ReleaseError(`Local release on ${client.name} is missing: ${missing.join(', ')}`);
  return {
    id: client.id,
    name: client.name,
    sshHost: client.sshHost!,
    sshPort: client.sshPort,
    sshUsername: client.sshUsername!,
    sshPassword: client.sshPassword,
    sshPath: client.hostWatchDir!,
    releaseDir: client.releaseDir!,
    releaseTag: client.releaseTag,
    trackerCommand: client.trackerCommand,
    local: true,
  };
};

/** The path of a local file on a client's machine, which sees the watch folder as hostWatchDir (null: not in it) */
export const hostPathOf = (filepath: string, watchDir: string, hostWatchDir: string): string | null => {
  const relative = path.relative(path.resolve(watchDir), path.resolve(filepath));
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return null;
  return path.posix.join(hostWatchDir.replace(/\\/g, '/'), ...relative.split(path.sep));
};

export interface Proposal {
  analysis: ReleaseAnalysis;
  defaults: ReleaseFlags;
  versions: string[];
  rip: { tmdbId: number | null; title: string | null; year: number | null } | null;
  remotePath: string;
  releaseDir: string;
  releaseTag: string | null;
  hasTrackerCommand: boolean;
  target: { name: string; local: boolean };
}

export interface Preview {
  filename: string;
  folder: string;
  path: string; // as configured (releaseDir may be relative to the SSH home)
  autoHybrid: boolean;
  error: string | null;
}

interface Run {
  uploadId: string;
  serverId: string; // where it runs: the server, or the client of a local release
  session: string;
  logPath: string;
  scriptPath: string;
  ssh: SSHClient | null;
  sftp: SFTPWrapper | null;
  offset: number;
  log: string;
  decoder: StringDecoder;
  lastOutputAt: number;
  savedAt: number;
  status: 'RUNNING' | 'NEEDS_INPUT';
  prompt: Prompt | null;
  tmdbId: number | null; // the rip's: answers the TMDB question once on its own
  tmdbAnswered: boolean;
  skipped: boolean;
  quit: boolean;
  stopping: boolean;
  done: Promise<void>;
}

const runPaths = (uploadId: string) => ({
  session: `wf-${uploadId}`,
  logPath: `${WORK_DIR}/${uploadId}.log`,
  scriptPath: `${WORK_DIR}/${uploadId}.sh`,
});

/** A shell word: 'it'\''s' */
export const shellQuote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;

/** The command with {path}, {folder} and {name} replaced (the path is appended when none is there) */
export const trackerCommandFor = (template: string, remotePath: string) => {
  const values: Record<string, string> = {
    path: remotePath,
    folder: path.posix.dirname(remotePath),
    name: path.posix.basename(remotePath),
  };
  const replaced = template.replace(/\{(path|folder|name)\}/g, (_, key: string) => shellQuote(values[key]));
  return replaced === template ? `${template} ${shellQuote(remotePath)}` : replaced;
};

const exec = (ssh: SSHClient, command: string): Promise<{ code: number; stdout: string; stderr: string }> =>
  new Promise((resolve, reject) => {
    ssh.exec(command, (err, stream) => {
      if (err) return reject(err);
      let stdout = '';
      let stderr = '';
      stream.on('data', (d: Buffer) => (stdout += d.toString()));
      stream.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
      stream.on('close', (code: number | null) => resolve({ code: code ?? -1, stdout, stderr }));
    });
  });

const parseMedia = (upload: Upload): MediaInfo | null => {
  try {
    return upload.mediaInfo ? (JSON.parse(upload.mediaInfo) as MediaInfo) : null;
  } catch {
    return null;
  }
};

// Uploads probed before the video details were stored have no videoTracks
const isDetailed = (media: MediaInfo | null): media is MediaInfo => Array.isArray(media?.videoTracks);

/** Where the file is on the target: before a local release, the local file as the client's machine sees it */
const remotePathOf = (upload: Upload, server: ReleaseTarget) => {
  if (server.local && !upload.localClientId) {
    const hostPath = hostPathOf(upload.filepath, config.WATCH_DIR, server.sshPath);
    if (!hostPath) throw new ReleaseError(`Only files in the watch folder can be released locally: ${upload.filepath}`);
    return hostPath;
  }
  return upload.remotePath ?? path.posix.join(remoteDirOf(server), upload.filename);
};

const releaseDirOf = (server: Pick<Server, 'releaseDir'>) => server.releaseDir.replace(/\\/g, '/').replace(/\/+$/, '') || '.';

const probe = async (ssh: SSHClient, remotePath: string): Promise<MediaInfo> => {
  const result = await exec(ssh, `ffprobe -v error -show_format -show_streams -show_chapters -of json ${shellQuote(remotePath)}`);
  if (result.code !== 0) {
    throw new ReleaseError(`ffprobe failed on the server: ${result.stderr.trim() || `exit code ${result.code}`}`, 502);
  }
  return fromProbe(JSON.parse(result.stdout) as ProbeData);
};

const mediaFields = (media: MediaInfo) => ({
  mediaInfo: JSON.stringify(media),
  hasItalianAudio: media.hasItalianAudio,
  hasItalianSubtitles: media.hasItalianSubtitles,
});

interface FoundTorrent {
  path: string;
  tracker: string | null; // the archive folder it is in
  infoHash: string;
  data: Buffer;
  mtime: number;
}

/** The .torrent fields of an upload: the one found, or none (cleared) */
const torrentFields = (found: FoundTorrent | null) => ({
  releaseTracker: found?.tracker ?? null,
  releaseTorrentName: found ? path.posix.basename(found.path) : null,
  releaseTorrentPath: found?.path ?? null,
  releaseTorrentHash: found?.infoHash ?? null,
  releaseTorrentData: found?.data ?? null,
});

const isDir = (attrs: { mode: number }) => (attrs.mode & 0o170000) === 0o040000;

const statOf = (sftp: SFTPWrapper, p: string) => sftpCall<Stats>((cb) => sftp.stat(p, cb)).catch(() => null);

/**
 * The folders ITTUP or Unit3Dup may archive their .torrent files in: the one the
 * output names, the ones in their configuration, and their default ones. Absolute paths.
 */
export const archiveDirs = async (sftp: SFTPWrapper, home: string, log: string): Promise<string[]> => {
  const dirs = [ARCHIVE_LINE.exec(log)?.[1]];
  for (const tool of TRACKER_TOOLS) {
    try {
      const settings = JSON.parse((await sftpCall<Buffer>((cb) => sftp.readFile(tool.config, cb))).toString('utf8'));
      dirs.push(settings?.user_preferences?.TORRENT_ARCHIVE_PATH);
    } catch {
      // Not configured in this home: its default folder only
    }
  }
  dirs.push(...TRACKER_TOOLS.map((tool) => path.posix.join(home, tool.archive)));
  return [
    ...new Set(
      dirs
        .filter((d): d is string => typeof d === 'string' && path.posix.isAbsolute(d) && !d.includes('no_path'))
        .map((d) => d.replace(/\/+$/, ''))
    ),
  ];
};

/**
 * The .torrent of this file in the archive folders, in one of their tracker
 * folders (<archive>/<TRACKER>/<name>.torrent) or right in them. Unit3Dup names it
 * after the file without its extension (or after its folder, when given one):
 * only one made for this very file counts, holding it with the same name and size,
 * alone or in its folder. The tracker that accepted the upload wins, else the newest.
 */
export const findTorrent = async (
  sftp: SFTPWrapper,
  dirs: string[],
  file: { path: string; size: number },
  preferTracker?: string | null
): Promise<FoundTorrent | null> => {
  const found: FoundTorrent[] = [];
  const name = path.posix.basename(file.path);
  const torrentNames = [
    ...new Set([name, path.posix.basename(name, path.posix.extname(name)), path.posix.basename(path.posix.dirname(file.path))]),
  ]
    .filter((n) => n && n !== '.' && n !== '/')
    .map((n) => `${n}.torrent`);
  for (const dir of dirs) {
    const entries = await sftpCall<{ filename: string; attrs: Stats }[]>((cb) => sftp.readdir(dir, cb)).catch(() => []);
    const places = [
      { folder: dir, tracker: null },
      ...entries.filter((e) => isDir(e.attrs)).map((e) => ({ folder: path.posix.join(dir, e.filename), tracker: e.filename })),
    ];
    for (const { folder, tracker } of places) {
      for (const torrentName of torrentNames) {
        const candidate = path.posix.join(folder, torrentName);
        const stats = await statOf(sftp, candidate);
        if (!stats || isDir(stats) || stats.size > MAX_TORRENT_BYTES) continue;
        try {
          const data = await sftpCall<Buffer>((cb) => sftp.readFile(candidate, cb));
          const torrent = parseTorrent(data);
          if (!torrent.files.some((f) => f.path === name && f.length === file.size)) continue;
          found.push({ path: candidate, tracker, infoHash: torrent.infoHash, data, mtime: stats.mtime });
        } catch (error) {
          logger.warn({ path: candidate, error: (error as Error).message }, 'Unreadable .torrent');
        }
      }
    }
  }
  const preferred = preferTracker
    ? found.filter((f) => f.tracker?.toLowerCase() === preferTracker.toLowerCase())
    : [];
  return (preferred.length ? preferred : found).sort((a, b) => b.mtime - a.mtime)[0] ?? null;
};

class ReleaseManager extends EventEmitter {
  private runs = new Map<string, Run>();
  // The last command of each server (or client machine): the next one waits for it
  private chains = new Map<string, Promise<void>>();
  // The same for the re-uploads with their .torrent already made, beside the other queue
  private reuploads = new Map<string, Promise<void>>();
  private stopped = false;

  /**
   * The upload and where it is released: its server, the client it was released on,
   * or (local) the client to release a file not uploaded yet on
   */
  private async load(uploadId: string, local = false): Promise<{ upload: Upload; server: ReleaseTarget }> {
    const upload = await db.getUploadById(uploadId);
    if (!upload) throw new ReleaseError('Upload not found', 404);
    if (upload.localClientId) {
      const client = await db.getTorrentClientById(upload.localClientId);
      if (!client) throw new ReleaseError('The client of this release no longer exists');
      return { upload, server: localTarget(client) };
    }
    if (local) {
      if (upload.status === 'COMPLETED') throw new ReleaseError('The file is already on a server: release it from there');
      if (upload.status === 'PENDING') throw new ReleaseError('The file is still being read: try again in a moment');
      if (!existsSync(upload.filepath)) throw new ReleaseError(`The file is no longer here: ${upload.filepath}`);
      return { upload, server: localTarget(await this.localClientFor(upload)) };
    }
    if (upload.status !== 'COMPLETED') throw new ReleaseError('The file is not on a server yet');
    const server = upload.serverId ? await db.getServerById(upload.serverId) : null;
    if (!server) throw new ReleaseError('The server of this upload no longer exists');
    return { upload, server: serverTarget(server) };
  }

  /** The client to release a file on: the one its source torrent is in, else the first set up for it */
  private async localClientFor(upload: Upload): Promise<TorrentClient> {
    const clients = (await db.getTorrentClients()).filter((c) => c.enabled && c.localRelease);
    const client = clients.find((c) => c.id === upload.torrentClientId) ?? clients[0];
    if (!client) throw new ReleaseError('No download client is set up for local release (Clients page)');
    return client;
  }

  /** Where a released file is: the machine of its client (local release), else its server */
  private async targetOfUpload(upload: Upload): Promise<ReleaseTarget | null> {
    if (upload.localClientId) {
      const client = await db.getTorrentClientById(upload.localClientId);
      return client ? localTarget(client) : null;
    }
    const server = upload.serverId ? await db.getServerById(upload.serverId) : null;
    return server ? serverTarget(server) : null;
  }

  /** linked: the status comes from link(), not from a tracker run (no toast for it) */
  private update(uploadId: string, data: Parameters<typeof db.updateUpload>[1], prompt?: Prompt | null, linked = false) {
    return db.updateUpload(uploadId, data).then((upload) => {
      if (data.releaseStatus !== undefined) {
        this.emit('release-updated', { uploadId, releaseStatus: upload.releaseStatus, prompt: prompt ?? null, linked });
      }
      return upload;
    });
  }

  private async connect(server: SshLogin) {
    const ssh = await uploadManager.connect(server);
    try {
      const sftp = await sftpCall<SFTPWrapper>((cb) => ssh.sftp(cb));
      const home = await sftpCall<string>((cb) => sftp.realpath('.', cb));
      return { ssh, sftp, home };
    } catch (error) {
      ssh.end();
      throw error;
    }
  }

  /**
   * The stored media info, with the video details: uploads probed by earlier
   * versions are probed again, from the local file or else on the server.
   */
  private async media(upload: Upload, server: ReleaseTarget): Promise<MediaInfo> {
    const stored = parseMedia(upload);
    if (isDetailed(stored)) return stored;

    const media = existsSync(upload.filepath)
      ? await mediaInfoParser.parseFile(upload.filepath)
      : await this.probeOnServer(upload, server);
    await db.updateUpload(upload.id, mediaFields(media));
    return media;
  }

  private async probeOnServer(upload: Upload, server: ReleaseTarget): Promise<MediaInfo> {
    const { ssh } = await this.connect(server);
    try {
      return await probe(ssh, remotePathOf(upload, server));
    } finally {
      ssh.end();
    }
  }

  /** The media info read again from the copy on the server (the local file is gone) */
  async reprobe(uploadId: string): Promise<Upload> {
    const { upload, server } = await this.load(uploadId);
    return db.updateUpload(upload.id, mediaFields(await this.probeOnServer(upload, server)));
  }

  /**
   * Links a file already released (renamed on the server and uploaded to the tracker,
   * before Wayfinderr did it or by hand): finds it on the server by its exact size, its
   * .torrent in the Unit3Dup archive, and reads its media info again from there.
   * What cannot be found is left empty, and shows as missing.
   */
  async link(uploadId: string): Promise<Upload> {
    const { upload, server } = await this.load(uploadId);
    if (this.isActive(upload)) throw new ReleaseError('The tracker upload of this file is still running');
    const size = Number(upload.size);

    const { ssh, sftp, home } = await this.connect(server);
    const absolute = (p: string) => (path.posix.isAbsolute(p) ? p : path.posix.join(home, p));
    let file = '';
    let torrent: FoundTorrent | null = null;
    let media: MediaInfo | null = null;
    const problems: string[] = [];
    try {
      const located = await this.locate(ssh, sftp, upload, server, absolute);
      if (!located) {
        await db.updateUpload(uploadId, { remoteFound: false });
        throw new ReleaseError(
          `No file of ${size} bytes on the server, in ${absolute(releaseDirOf(server))} or ${absolute(remoteDirOf(server))}`,
          404
        );
      }
      file = located;

      const dirs = await archiveDirs(sftp, home, upload.releaseLog ?? '');
      const accepted = upload.releaseLog ? ACCEPTED_BY.exec(upload.releaseLog)?.[1] : null;
      torrent = await findTorrent(sftp, dirs, { path: file, size }, accepted);
      if (!torrent) problems.push(`no .torrent of it in ${dirs.join(', ') || 'the ITTUP/Unit3Dup archive'}`);

      media = await probe(ssh, file).catch((error: Error) => {
        problems.push(`media info: ${error.message}`);
        return null;
      });
    } finally {
      ssh.end();
    }

    const renamed = file !== absolute(path.posix.join(remoteDirOf(server), upload.filename));
    const known = upload.releaseStatus === 'CONFIRM' ? null : upload.releaseStatus;
    const found = [`file found: ${file}`, torrent && `.torrent from ${torrent.tracker ?? path.posix.dirname(torrent.path)}`];
    logger.info({ uploadId, file, torrent: torrent?.path, problems }, 'Release linked');
    return this.update(
      uploadId,
      {
        ...torrentFields(torrent),
        ...(media ? mediaFields(media) : {}),
        remotePath: file,
        remoteFound: true,
        releaseName: renamed ? path.posix.basename(file) : upload.releaseName,
        // Found with its .torrent, or released by hand (renamed, no tracker run known): on the
        // tracker, the .torrent then shows as missing. Else the tracker outcome known stays
        releaseStatus: torrent || (renamed && (!known || known === 'RENAMED')) ? 'DONE' : known,
        releaseMessage: `Linked: ${[...found, ...problems].filter(Boolean).join('; ')}`,
        releaseCompletedAt: upload.releaseCompletedAt ?? new Date(),
      },
      null,
      true
    );
  }

  /**
   * A .torrent given by hand (downloaded from the tracker), when it is not in the
   * Unit3Dup archive: kept as if found there, once it holds a file of this size.
   * The file is then on the tracker.
   */
  async attachTorrent(uploadId: string, data: Buffer, filename: string): Promise<Upload> {
    const upload = await db.getUploadById(uploadId);
    if (!upload) throw new ReleaseError('Upload not found', 404);
    if (this.isActive(upload)) throw new ReleaseError('The tracker upload of this file is still running');
    if (!data.length || data.length > MAX_TORRENT_BYTES) throw new ReleaseError('Not a .torrent file', 400);

    let torrent: TorrentFile;
    try {
      torrent = parseTorrent(data);
    } catch (error) {
      throw new ReleaseError((error as Error).message, 400);
    }
    const size = Number(upload.size);
    // By size only: the file may have been renamed since the .torrent was made
    if (!torrent.files.some((f) => f.length === size)) {
      throw new ReleaseError(`This .torrent is not of this file: none of its files is ${size} bytes`, 400);
    }

    const name = path.posix.basename(filename.replace(/\\/g, '/')).replace(/[\x00-\x1f"]/g, '').trim();
    const torrentName = /\.torrent$/i.test(name) ? name : `${torrent.name}.torrent`;
    logger.info({ uploadId, torrent: torrentName, infoHash: torrent.infoHash }, '.torrent added by hand');
    return this.update(
      uploadId,
      {
        releaseTracker: trackerHost(torrent.announce),
        releaseTorrentName: torrentName,
        releaseTorrentPath: null,
        releaseTorrentHash: torrent.infoHash,
        releaseTorrentData: data,
        releaseStatus: 'DONE',
        releaseMessage: `.torrent added by hand: ${torrentName}`,
        releaseCompletedAt: upload.releaseCompletedAt ?? new Date(),
      },
      null,
      true
    );
  }

  /**
   * The file of this upload on the server: where it was last seen, else the one
   * file of the same size (and type) in the release or upload folder.
   */
  private async locate(
    ssh: SSHClient,
    sftp: SFTPWrapper,
    upload: Upload,
    server: ReleaseTarget,
    absolute: (p: string) => string
  ): Promise<string | null> {
    const size = Number(upload.size);
    for (const known of [upload.remotePath, path.posix.join(remoteDirOf(server), upload.filename)]) {
      if (!known) continue;
      const stats = await statOf(sftp, absolute(known));
      if (stats && !isDir(stats) && stats.size === size) return absolute(known);
    }

    const roots = [...new Set([absolute(releaseDirOf(server)), absolute(remoteDirOf(server))])];
    // A missing folder makes find exit with 1: what it printed still counts
    const listed = await exec(ssh, `find ${roots.map(shellQuote).join(' ')} -maxdepth 3 -type f -size ${size}c 2>/dev/null`);
    const extension = path.posix.extname(upload.filename).toLowerCase();
    const candidates = listed.stdout
      .split('\n')
      .filter((p) => p && !path.posix.basename(p).startsWith('.') && path.posix.extname(p).toLowerCase() === extension)
      .slice(0, MAX_LINK_CANDIDATES);
    if (candidates.length <= 1) return candidates[0] ?? null;

    // Several: the released one is in a folder of its own name
    const released = candidates.filter(
      (p) => path.posix.basename(path.posix.dirname(p)) === path.posix.basename(p, path.posix.extname(p))
    );
    if (released.length === 1) return released[0];
    throw new ReleaseError(
      `${candidates.length} files of ${size} bytes on the server, cannot tell which one it is: ${candidates.slice(0, 3).join(', ')}`
    );
  }

  /** After the tracker accepted the upload: its .torrent from the Unit3Dup archive (null when not there) */
  private async collectTorrent(run: Run, log: string): Promise<FoundTorrent | null> {
    const upload = await db.getUploadById(run.uploadId);
    if (!run.sftp || !upload?.remotePath) return null;
    const sftp = run.sftp;
    const home = await sftpCall<string>((cb) => sftp.realpath('.', cb));
    const dirs = await archiveDirs(sftp, home, log);
    const file = { path: upload.remotePath, size: Number(upload.size) };
    return findTorrent(sftp, dirs, file, ACCEPTED_BY.exec(log)?.[1]);
  }

  /** What the rename dialog shows: the analysis and the name's prefilled parts */
  async proposal(uploadId: string, local = false): Promise<Proposal> {
    const { upload, server } = await this.load(uploadId, local);
    const analysis = analyze(await this.media(upload, server));

    // A ripped disc: its TMDB title (in TMDB_LANGUAGE) and year, and a remux.
    // Otherwise what the file name says.
    const rip = await db.getRipByOutputFile(upload.filepath);
    const parsed = parseReleaseName(upload.releaseName ?? upload.filename);
    const remux = rip ? rip.contentType !== 'MKV' : /\bremux\b/i.test(upload.filename.replace(/[._]/g, ' '));

    return {
      analysis,
      defaults: {
        title: rip?.title ?? parsed.title,
        year: String(rip?.year ?? parsed.year ?? ''),
        version: '',
        remux,
      },
      versions: VERSIONS,
      rip: rip ? { tmdbId: rip.tmdbId, title: rip.title, year: rip.year } : null,
      remotePath: remotePathOf(upload, server),
      releaseDir: releaseDirOf(server),
      releaseTag: server.releaseTag,
      hasTrackerCommand: Boolean(server.trackerCommand?.trim()),
      target: { name: server.name, local: server.local },
    };
  }

  private async name(upload: Upload, server: ReleaseTarget, flags: ReleaseFlags) {
    const media = parseMedia(upload);
    if (!isDetailed(media)) throw new ReleaseError('Open the rename dialog first: the media details are missing');
    const analysis = analyze(media);
    const extension = path.posix.extname(upload.filename).slice(1) || 'mkv';
    const filename = buildReleaseName(flags, analysis, extension, server.releaseTag);
    const folder = filename.slice(0, filename.length - extension.length - 1);
    return { analysis, filename, folder };
  }

  async preview(uploadId: string, flags: ReleaseFlags, local = false): Promise<Preview> {
    const { upload, server } = await this.load(uploadId, local);
    const { analysis, filename, folder } = await this.name(upload, server, flags);
    return {
      filename,
      folder,
      path: path.posix.join(releaseDirOf(server), folder, filename),
      autoHybrid: isAutoHybrid(flags, analysis),
      error: validateFlags(flags),
    };
  }

  /**
   * Renames the file on the server, then queues the tracker command (if the server has one).
   * Local: the file not uploaded yet is moved on the client's machine instead (its upload
   * stops), and is released from there from then on.
   */
  async confirm(uploadId: string, flags: ReleaseFlags, overwrite = false, local = false): Promise<Upload> {
    const { upload, server } = await this.load(uploadId, local);
    const moving = server.local && !upload.localClientId;
    if (upload.releaseStatus && ACTIVE.includes(upload.releaseStatus)) {
      throw new ReleaseError('The tracker upload of this file is still running');
    }
    const invalid = validateFlags(flags);
    if (invalid) throw new ReleaseError(invalid, 400);

    const { filename, folder } = await this.name(upload, server, flags);
    const { ssh, sftp, home } = await this.connect(server);
    let target = '';
    try {
      const absolute = (p: string) => (path.posix.isAbsolute(p) ? p : path.posix.join(home, p));
      const source = absolute(remotePathOf(upload, server));
      const dir = path.posix.join(absolute(releaseDirOf(server)), folder);
      target = path.posix.join(dir, filename);

      const exists = (p: string) =>
        sftpCall<unknown>((cb) => sftp.stat(p, cb))
          .then(() => true)
          .catch(() => false);
      if (!(await exists(source))) {
        throw new ReleaseError(
          moving
            ? `${server.name} does not see the file at ${source}: check the watch folder of its local release`
            : `The file is no longer on the server: ${source}`
        );
      }

      if (source !== target) {
        const taken = await exists(target);
        if (taken && !overwrite) throw new ReleaseError(`${filename} is already in ${dir}`, 409, 'exists');
        // Before anything is replaced: it may still be stopping
        if (moving) await this.stopUpload(uploadId);
        if (taken) await sftpCall((cb) => sftp.unlink(target, cb));
        await uploadManager.ensureRemoteDir(sftp, dir);
        await sftpCall((cb) => sftp.rename(source, target, cb)).catch((error: Error) => {
          // A rename only moves within one disk
          if (!moving) throw error;
          throw new ReleaseError(`Cannot move the file on ${server.name} (the watch and release folders must be on the same disk): ${error.message}`, 502);
        });
        logger.info({ uploadId, source, target, on: server.name }, 'Renamed on the server');
        // Renamed again: the folder of the earlier name goes if it is now empty
        if (upload.releaseName && path.posix.basename(path.posix.dirname(source)) === upload.releaseName.replace(/\.[^.]+$/, '')) {
          await sftpCall((cb) => sftp.rmdir(path.posix.dirname(source), cb)).catch(() => undefined);
        }
      }
    } finally {
      ssh.end();
    }

    const hasCommand = Boolean(server.trackerCommand?.trim());
    const updated = await this.update(uploadId, {
      ...torrentFields(null),
      // Released on the client's machine instead of uploaded: done, it is there
      ...(moving
        ? {
            status: 'COMPLETED',
            serverId: null,
            localClientId: server.id,
            progress: 100,
            progressBytes: upload.size,
            error: null,
            completedAt: new Date(),
          }
        : {}),
      remotePath: target,
      remoteFound: true,
      releaseName: filename,
      releaseStatus: hasCommand ? 'QUEUED' : 'RENAMED',
      releaseMessage: hasCommand ? null : server.local ? `Moved on ${server.name}` : 'Renamed on the server',
      releaseLog: null,
      releasePrompt: null,
      releaseOffset: 0,
      releaseStartedAt: null,
      releaseCompletedAt: hasCommand ? null : new Date(),
    });
    if (moving) this.emit('released-locally', { uploadId });
    if (hasCommand) this.enqueue(updated.id, server.id);
    return updated;
  }

  /** A file released locally is not uploaded: its queued or running upload stops first */
  private async stopUpload(uploadId: string) {
    if (!jobQueue.hasJob(uploadId)) return;
    await jobQueue.cancelUpload(uploadId);
    if (jobQueue.hasJob(uploadId)) throw new ReleaseError('The upload is still stopping: try again in a moment');
  }

  /**
   * The .torrent an earlier run of the tracker command made for this file, still in a
   * tracker folder of the ITTUP/Unit3Dup archive: run again, the command uses it instead
   * of hashing the file. When the earlier output says which tracker it hashed it for,
   * only that tracker's folder counts.
   */
  private async madeTorrent(upload: Upload, server: ReleaseTarget): Promise<FoundTorrent | null> {
    if (!upload.remotePath) return null;
    const log = upload.releaseLog ?? '';
    const tracker = hashedFor(log);
    const { sftp, ssh, home } = await this.connect(server);
    try {
      const dirs = await archiveDirs(sftp, home, log);
      const found = await findTorrent(sftp, dirs, { path: upload.remotePath, size: Number(upload.size) }, tracker);
      if (!found?.tracker) return null; // right in the archive folder: the command does not look there
      return !tracker || found.tracker.toLowerCase() === tracker.toLowerCase() ? found : null;
    } finally {
      ssh.end();
    }
  }

  /** madeTorrent, null when the server cannot be reached: the re-upload then waits in the queue */
  private madeTorrentOrNull(upload: Upload, server: ReleaseTarget) {
    return this.madeTorrent(upload, server).catch((error: Error) => {
      logger.warn({ uploadId: upload.id, error: error.message }, 'Cannot look for the .torrent made before');
      return null;
    });
  }

  /**
   * The tracker command again, on the file already renamed. With its .torrent already
   * made (a tracker error after the hashing, e.g. HTTP 403/404), it runs right away,
   * beside the queue of the server.
   */
  async rerun(uploadId: string): Promise<Upload> {
    const { upload, server } = await this.load(uploadId);
    if (!upload.releaseStatus || !RERUNNABLE.includes(upload.releaseStatus) || !upload.releaseName) {
      throw new ReleaseError('Rename the file first');
    }
    if (!server.trackerCommand?.trim()) throw new ReleaseError(`${server.name} has no tracker command`);
    const made = await this.madeTorrentOrNull(upload, server);
    if (made) logger.info({ uploadId, torrent: made.path }, 'Re-upload with the .torrent made before');
    const updated = await this.update(uploadId, {
      releaseStatus: 'QUEUED',
      releaseMessage: made
        ? `Its .torrent is already made (${made.tracker}): uploaded again without waiting for the queue of ${server.name}`
        : null,
      releaseLog: null,
      releasePrompt: null,
      releaseOffset: 0,
      releaseStartedAt: null,
      releaseCompletedAt: null,
    });
    this.enqueue(uploadId, server.id, Boolean(made));
    return updated;
  }

  /**
   * Checks a client's local release: the SSH login, the watch folder on that machine,
   * the release folder (created if missing), tmux and the tracker command
   */
  async testLocal(client: TorrentClient): Promise<void> {
    const server = localTarget(client);
    const { ssh, sftp, home } = await this.connect(server);
    try {
      const absolute = (p: string) => (path.posix.isAbsolute(p) ? p : path.posix.join(home, p));
      const watch = absolute(remoteDirOf(server));
      const stats = await statOf(sftp, watch);
      if (!stats || !isDir(stats)) throw new ReleaseError(`No folder ${watch} on ${client.name}`, 502);
      await uploadManager.ensureRemoteDir(sftp, absolute(releaseDirOf(server)));
      // The command's program, when it starts with one (not e.g. VAR=value or cd)
      const program = server.trackerCommand?.trim().split(/\s+/)[0];
      for (const tool of ['tmux', program && /^[\w./~-]+$/.test(program) ? program : null]) {
        if (!tool) continue;
        const found = await exec(ssh, `bash -lc ${shellQuote(`command -v ${shellQuote(tool)}`)}`);
        if (found.code !== 0) throw new ReleaseError(`${tool} is not installed on ${client.name}`, 502);
      }
    } finally {
      ssh.end();
    }
  }

  /** Types an answer to the command's question (then Enter) */
  async answer(uploadId: string, text: string): Promise<void> {
    const run = this.runs.get(uploadId);
    if (!run?.ssh) throw new ReleaseError('The tracker command is not running');
    const answer = text.replace(/[\r\n]+/g, ' ').trim();
    await this.sendKeys(run, answer);

    if (run.prompt?.kind === 'duplicate') {
      if (answer.toLowerCase() === 's') run.skipped = true;
      if (answer.toLowerCase() === 'q') run.quit = true;
    }
    run.log = appendOutput(run.log, `${answer}\n`);
    run.lastOutputAt = Date.now();
    await this.setPrompt(run, null);
    this.emitOutput(run);
  }

  private async sendKeys(run: Run, text: string) {
    const ssh = run.ssh!;
    if (text) {
      const typed = await exec(ssh, `tmux send-keys -t ${run.session} -l -- ${shellQuote(text)}`);
      if (typed.code !== 0) throw new ReleaseError(`tmux: ${typed.stderr.trim() || 'send-keys failed'}`, 502);
    }
    await exec(ssh, `tmux send-keys -t ${run.session} Enter`);
  }

  /** Ctrl-C to the command (Unit3Dup quits cleanly), then the session is closed */
  async stop(uploadId: string): Promise<Upload> {
    const upload = await db.getUploadById(uploadId);
    if (!upload) throw new ReleaseError('Upload not found', 404);
    const run = this.runs.get(uploadId);
    if (!run) {
      if (upload.releaseStatus !== 'QUEUED') throw new ReleaseError('The tracker command is not running');
      return this.update(uploadId, { releaseStatus: 'CANCELLED', releaseMessage: 'Stopped before it started', releaseCompletedAt: new Date() });
    }
    run.stopping = true;
    if (run.ssh) {
      await exec(run.ssh, `tmux send-keys -t ${run.session} C-c`).catch(() => undefined);
      setTimeout(() => {
        if (this.runs.get(uploadId) === run && run.ssh) {
          exec(run.ssh, `tmux kill-session -t ${run.session}`).catch(() => undefined);
        }
      }, STOP_GRACE_MS).unref();
    }
    return (await db.getUploadById(uploadId))!;
  }

  /** The name is not wanted now (asked on its own after an upload) */
  async dismiss(uploadId: string): Promise<Upload> {
    const upload = await db.getUploadById(uploadId);
    if (!upload) throw new ReleaseError('Upload not found', 404);
    if (upload.releaseStatus !== 'CONFIRM') throw new ReleaseError('Nothing to dismiss');
    return this.update(uploadId, { releaseStatus: null });
  }

  isActive(upload: Upload) {
    return this.runs.has(upload.id) || (upload.releaseStatus !== null && ACTIVE.includes(upload.releaseStatus));
  }

  /** A finished upload: on a server with releaseAuto, the name is asked right away */
  async handleUploadCompleted(uploadId: string): Promise<void> {
    if (this.runs.has(uploadId)) return;
    const upload = await db.getUploadById(uploadId);
    const server = upload?.serverId ? await db.getServerById(upload.serverId) : null;
    if (!upload || !server) return;
    if (!server.releaseAuto && !upload.releaseStatus && !upload.releaseName) return;
    // A file uploaded again (rip again) starts over from its new copy
    await this.update(uploadId, {
      ...torrentFields(null),
      remoteFound: null,
      releaseStatus: server.releaseAuto ? 'CONFIRM' : null,
      releaseName: null,
      releaseMessage: null,
      releaseLog: null,
      releasePrompt: null,
      releaseOffset: 0,
      releaseStartedAt: null,
      releaseCompletedAt: null,
    });
  }

  /** In the queue of the server, or (reupload) in the one of the re-uploads with their .torrent made */
  private enqueue(uploadId: string, serverId: string, reupload = false) {
    const chains = reupload ? this.reuploads : this.chains;
    const previous = chains.get(serverId) ?? Promise.resolve();
    const next = previous
      .then(() => (this.stopped ? undefined : this.start(uploadId)))
      .catch((error) => logger.error({ uploadId, error }, 'Tracker command failed'));
    chains.set(serverId, next);
  }

  /** Writes the wrapper script and starts it in a detached tmux session, then follows it */
  private async start(uploadId: string): Promise<void> {
    const upload = await db.getUploadById(uploadId);
    if (!upload || upload.releaseStatus !== 'QUEUED') return; // stopped while queued
    const fail = (message: string) =>
      this.update(uploadId, { releaseStatus: 'FAILED', releaseMessage: message, releaseCompletedAt: new Date() });
    let server: ReleaseTarget | null;
    try {
      server = await this.targetOfUpload(upload);
    } catch (error) {
      await fail((error as Error).message);
      return;
    }
    if (!server?.trackerCommand?.trim() || !upload.remotePath) {
      await fail(server ? `${server.name} has no tracker command` : 'The server no longer exists');
      return;
    }

    let conn: Awaited<ReturnType<ReleaseManager['connect']>>;
    try {
      conn = await this.connect(server);
    } catch (error) {
      await fail(`SSH: ${(error as Error).message}`);
      return;
    }
    const { ssh, sftp } = conn;
    const { session, logPath, scriptPath } = runPaths(uploadId);
    const command = trackerCommandFor(server.trackerCommand.trim(), upload.remotePath);

    // stdout and stderr through tee into the log; stdin stays the tmux terminal, for the
    // answers. tee ignores Ctrl-C so the command's last words still reach the log
    const script = [
      '#!/bin/bash',
      '# Written by Wayfinderr: uploads one file to the tracker (removed once it ends)',
      'cd "$HOME"',
      'export PYTHONUNBUFFERED=1 NO_COLOR=1 COLUMNS=160',
      `{ ${command}\n} 2>&1 | (trap '' INT; exec tee -a ${shellQuote(logPath)})`,
      `echo "${EXIT_MARKER} \${PIPESTATUS[0]}" >> ${shellQuote(logPath)}`,
      '',
    ].join('\n');

    try {
      await uploadManager.ensureRemoteDir(sftp, WORK_DIR);
      await sftpCall((cb) => sftp.unlink(logPath, cb)).catch(() => undefined);
      await sftpCall((cb) => sftp.writeFile(scriptPath, script, cb));
      // A session left over from an earlier run of this file
      await exec(ssh, `tmux kill-session -t ${session} 2>/dev/null`);
      const started = await exec(ssh, `tmux new-session -d -s ${session} -x 160 -y 50 ${shellQuote(`bash -l ${shellQuote(scriptPath)}`)}`);
      if (started.code !== 0) {
        const reason = started.code === 127 ? 'tmux is not installed on the server' : started.stderr.trim() || `exit code ${started.code}`;
        throw new Error(`tmux: ${reason}`);
      }
    } catch (error) {
      ssh.end();
      await fail((error as Error).message);
      return;
    }

    logger.info({ uploadId, session, command }, 'Tracker command started');
    const rip = await db.getRipByOutputFile(upload.filepath);
    await this.update(uploadId, { releaseStatus: 'RUNNING', releaseStartedAt: new Date(), releaseOffset: 0, releaseLog: '' });
    const run = this.newRun(upload, rip?.tmdbId ?? null);
    this.attach(run, ssh, sftp);
    await this.follow(run);
  }

  private newRun(upload: Upload, tmdbId: number | null): Run {
    const run: Run = {
      uploadId: upload.id,
      serverId: (upload.localClientId ?? upload.serverId)!,
      ...runPaths(upload.id),
      ssh: null,
      sftp: null,
      offset: upload.releaseOffset,
      log: upload.releaseLog ?? '',
      decoder: new StringDecoder('utf8'),
      lastOutputAt: Date.now(),
      savedAt: Date.now(),
      status: upload.releaseStatus === 'NEEDS_INPUT' ? 'NEEDS_INPUT' : 'RUNNING',
      prompt: upload.releasePrompt ? (JSON.parse(upload.releasePrompt) as Prompt) : null,
      tmdbId,
      tmdbAnswered: false,
      skipped: false,
      quit: false,
      stopping: false,
      done: Promise.resolve(),
    };
    this.runs.set(upload.id, run);
    return run;
  }

  /** The run's connection; dropped from it when it closes (follow() connects again) */
  private attach(run: Run, ssh: SSHClient, sftp: SFTPWrapper) {
    run.ssh = ssh;
    run.sftp = sftp;
    ssh.once('close', () => {
      if (run.ssh === ssh) run.ssh = run.sftp = null;
    });
  }

  /** Reads the log every second until the command ends (reconnecting when the connection drops) */
  private follow(run: Run): Promise<void> {
    run.done = (async () => {
      let polls = 0;
      let failures = 0;
      while (!this.stopped) {
        try {
          if (!run.ssh || !run.sftp) {
            const upload = await db.getUploadById(run.uploadId);
            const server = upload && (await this.targetOfUpload(upload));
            if (!server) throw new Error('The server no longer exists');
            const conn = await this.connect(server);
            this.attach(run, conn.ssh, conn.sftp);
          }
          const changed = await this.read(run);
          failures = 0;

          const code = exitCode(run.log);
          if (code !== null) {
            await this.finish(run, code);
            return;
          }
          // Gone without its exit line: killed (stop, or the server restarted)
          if (++polls % SESSION_CHECK_EVERY === 0 || run.stopping) {
            const alive = await exec(run.ssh!, `tmux has-session -t ${run.session}`);
            if (alive.code !== 0) {
              await this.read(run);
              const late = exitCode(run.log);
              await this.finish(run, late ?? -1);
              return;
            }
          }

          await this.checkPrompt(run);
          if (changed) this.emitOutput(run);
          if (Date.now() - run.savedAt > SAVE_EVERY_MS) await this.save(run);
          await sleep(POLL_MS);
        } catch (error) {
          run.ssh?.end();
          run.ssh = run.sftp = null;
          if (this.stopped) return;
          logger.warn({ uploadId: run.uploadId, error: (error as Error).message }, 'Lost the tracker command, reconnecting');
          if (++failures > MAX_RECONNECTS) {
            await this.save(run);
            await this.update(run.uploadId, {
              releaseStatus: 'UNKNOWN',
              releasePrompt: null,
              releaseMessage: `Lost the connection to the server: the command may still be running there (tmux session ${run.session})`,
              releaseCompletedAt: new Date(),
            });
            this.runs.delete(run.uploadId);
            return;
          }
          await sleep(RECONNECT_DELAY_MS);
        }
      }
      // Wayfinderr is stopping: the command goes on in tmux, followed again at the next start
      await this.save(run).catch(() => undefined);
      run.ssh?.end();
    })();
    return run.done;
  }

  /** New bytes of the remote log; true when there were some */
  private async read(run: Run): Promise<boolean> {
    const sftp = run.sftp!;
    const handle = await sftpCall<Buffer>((cb) => sftp.open(run.logPath, 'r', cb)).catch((error: Error & { code?: number }) => {
      if (error.code === 2) return null; // no output yet
      throw error;
    });
    if (!handle) return false;
    let text = '';
    try {
      for (;;) {
        const buffer = Buffer.alloc(READ_CHUNK);
        const read = await sftpCall<number>((cb) =>
          sftp.read(handle, buffer, 0, READ_CHUNK, run.offset, (err, bytes) => cb(err, bytes))
        ).catch((error: Error & { code?: number }) => {
          if (error.code === 1) return 0; // end of file
          throw error;
        });
        if (!read) break;
        run.offset += read;
        text += run.decoder.write(buffer.subarray(0, read));
        if (read < READ_CHUNK) break;
      }
    } finally {
      await sftpCall((cb) => sftp.close(handle, cb)).catch(() => undefined);
    }
    if (!text) return false;
    run.log = appendOutput(run.log, text);
    run.lastOutputAt = Date.now();
    return true;
  }

  private async checkPrompt(run: Run) {
    const prompt = run.stopping ? null : detectPrompt(run.log, Date.now() - run.lastOutputAt);
    if (prompt?.text === run.prompt?.text && prompt?.kind === run.prompt?.kind) return;

    // The rip's TMDB id answers the TMDB question once, without asking
    if (prompt?.kind === 'tmdb' && run.tmdbId && !run.tmdbAnswered) {
      run.tmdbAnswered = true;
      logger.info({ uploadId: run.uploadId, tmdbId: run.tmdbId }, 'Answering the TMDB question with the rip\'s id');
      await this.sendKeys(run, String(run.tmdbId));
      run.log = appendOutput(run.log, `${run.tmdbId}    [answered by Wayfinderr: the rip's TMDB id]\n`);
      run.lastOutputAt = Date.now();
      this.emitOutput(run);
      return;
    }
    await this.setPrompt(run, prompt);
  }

  private async setPrompt(run: Run, prompt: Prompt | null) {
    run.prompt = prompt;
    run.status = prompt ? 'NEEDS_INPUT' : 'RUNNING';
    run.savedAt = Date.now();
    await this.update(
      run.uploadId,
      {
        releaseStatus: run.status,
        releasePrompt: prompt ? JSON.stringify(prompt) : null,
        releaseLog: run.log,
        releaseOffset: run.offset,
      },
      prompt
    );
  }

  private async save(run: Run) {
    run.savedAt = Date.now();
    await db.updateUpload(run.uploadId, { releaseLog: run.log, releaseOffset: run.offset });
  }

  private emitOutput(run: Run) {
    this.emit('release-output', { uploadId: run.uploadId, log: withoutMarker(run.log) });
  }

  private async finish(run: Run, code: number) {
    const log = withoutMarker(run.log).trimEnd();
    const outcome =
      run.stopping || run.quit
        ? { status: 'CANCELLED', message: run.quit ? 'Quit at the duplicate question' : 'Stopped' }
        : code < 0
          ? { status: 'FAILED', message: 'The command stopped without finishing' }
          : parseOutcome(log, code, run.skipped);

    // Accepted by the tracker: the .torrent it gave back, from the ITTUP/Unit3Dup archive
    let torrent = {};
    if (outcome.status === 'DONE') {
      const found = await this.collectTorrent(run, log).catch((error: Error) => {
        logger.warn({ uploadId: run.uploadId, error: error.message }, 'Cannot read the .torrent');
        return null;
      });
      torrent = torrentFields(found);
      if (!found) outcome.message += ' (its .torrent was not found in the ITTUP/Unit3Dup archive)';
    }

    // The wrapper script, its log and its session (kept with tmux's remain-on-exit) are no longer needed
    if (run.ssh && run.sftp) {
      await exec(run.ssh, `tmux kill-session -t ${run.session} 2>/dev/null`).catch(() => undefined);
      for (const file of [run.scriptPath, run.logPath]) {
        await sftpCall((cb) => run.sftp!.unlink(file, cb)).catch(() => undefined);
      }
    }
    run.ssh?.end();
    this.runs.delete(run.uploadId);

    // The film on TMDB, found by the command or typed in: kept for its link
    const tmdbId = tmdbIdOf(log);

    logger.info({ uploadId: run.uploadId, code, ...outcome }, 'Tracker command ended');
    this.emit('release-output', { uploadId: run.uploadId, log });
    await this.update(run.uploadId, {
      ...torrent,
      ...(tmdbId ? { tmdbId } : {}),
      releaseStatus: outcome.status,
      releaseMessage: outcome.message,
      releaseLog: log,
      releaseOffset: run.offset,
      releasePrompt: null,
      releaseCompletedAt: new Date(),
    });
  }

  /**
   * At start: follow the commands still running in tmux, then the queued ones (those with
   * their .torrent already made in the queue of the re-uploads, once checked on the server)
   */
  async resumePending(): Promise<void> {
    for (const status of ['RUNNING', 'NEEDS_INPUT']) {
      for (const upload of await db.getUploadsByReleaseStatus(status)) {
        const targetId = upload.localClientId ?? upload.serverId;
        if (!targetId) {
          await this.update(upload.id, { releaseStatus: 'FAILED', releaseMessage: 'The server no longer exists' });
          continue;
        }
        const rip = await db.getRipByOutputFile(upload.filepath);
        const run = this.newRun(upload, rip?.tmdbId ?? null);
        run.tmdbAnswered = true; // already asked before the restart, maybe answered
        logger.info({ uploadId: upload.id }, 'Following the tracker command again');
        this.chains.set(targetId, this.follow(run).catch(() => undefined));
      }
    }
    // Released before the TMDB id was kept: read it from their output
    for (const upload of await db.getUploadsWithUnreadTmdb()) {
      const tmdbId = tmdbIdOf(upload.releaseLog ?? '');
      if (tmdbId) await db.updateUpload(upload.id, { tmdbId });
    }
    const queued = await db.getUploadsByReleaseStatus('QUEUED');
    // Checked in the background, in order: an unreachable server does not hold up the start
    void (async () => {
      for (const upload of queued) {
        const target = await this.targetOfUpload(upload).catch(() => null);
        const targetId = upload.localClientId ?? upload.serverId;
        if (!targetId || this.stopped) continue;
        const made = target?.trackerCommand?.trim() ? await this.madeTorrentOrNull(upload, target) : null;
        this.enqueue(upload.id, targetId, Boolean(made));
      }
    })();
  }

  /** Stops following: the commands go on in tmux on the servers */
  shutdown(): void {
    this.stopped = true;
    for (const run of this.runs.values()) run.ssh?.end();
  }
}

export const releaseManager = new ReleaseManager();
