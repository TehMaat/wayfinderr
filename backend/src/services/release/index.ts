/**
 * Release of an uploaded file on its server, in two steps:
 *  1. rename: once the user confirms the name (see name.ts), the file is moved
 *     over SFTP into <releaseDir>/<name>/<name>.mkv, as moverr.py does;
 *  2. tracker: the server's trackerCommand (Unit3Dup) runs on that file over SSH,
 *     inside tmux so it survives a dropped connection or a restart of Wayfinderr.
 *     Its output goes through `tee` into ~/.wayfinderr/<id>.log, read every second
 *     over SFTP; its questions (see output.ts) are answered from the upload page
 *     with `tmux send-keys`. One command at a time per server.
 */
import { EventEmitter } from 'events';
import { existsSync } from 'fs';
import path from 'path';
import { StringDecoder } from 'string_decoder';
import { setTimeout as sleep } from 'timers/promises';
import { Client as SSHClient, SFTPWrapper } from 'ssh2';
import { Server, Upload } from '@prisma/client';
import logger from '../../config/logger.js';
import { db } from '../database.js';
import { fromProbe, mediaInfoParser, ProbeData } from '../mediaInfo.js';
import { remoteDirOf, sftpCall, uploadManager } from '../uploadManager.js';
import { parseReleaseName } from '../ripper/releaseName.js';
import { MediaInfo } from '../../types/index.js';
import { analyze, buildReleaseName, isAutoHybrid, ReleaseAnalysis, ReleaseFlags, validateFlags, VERSIONS } from './name.js';
import { appendOutput, detectPrompt, exitCode, EXIT_MARKER, parseOutcome, Prompt, withoutMarker } from './output.js';

const POLL_MS = 1000;
const SAVE_EVERY_MS = 5000;
const SESSION_CHECK_EVERY = 10; // polls
const STOP_GRACE_MS = 10_000;
const RECONNECT_DELAY_MS = 10_000;
const MAX_RECONNECTS = 30; // ~5 minutes without the server
const READ_CHUNK = 256 * 1024;

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

export interface Proposal {
  analysis: ReleaseAnalysis;
  defaults: ReleaseFlags;
  versions: string[];
  rip: { tmdbId: number | null; title: string | null; year: number | null } | null;
  remotePath: string;
  releaseDir: string;
  releaseTag: string | null;
  hasTrackerCommand: boolean;
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
  serverId: string;
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

const remotePathOf = (upload: Upload, server: Server) =>
  upload.remotePath ?? path.posix.join(remoteDirOf(server), upload.filename);

const releaseDirOf = (server: Server) => server.releaseDir.replace(/\\/g, '/').replace(/\/+$/, '') || '.';

class ReleaseManager extends EventEmitter {
  private runs = new Map<string, Run>();
  // The last command of each server: the next one waits for it
  private chains = new Map<string, Promise<void>>();
  private stopped = false;

  private async load(uploadId: string): Promise<{ upload: Upload; server: Server }> {
    const upload = await db.getUploadById(uploadId);
    if (!upload) throw new ReleaseError('Upload not found', 404);
    if (upload.status !== 'COMPLETED') throw new ReleaseError('The file is not on a server yet');
    const server = upload.serverId ? await db.getServerById(upload.serverId) : null;
    if (!server) throw new ReleaseError('The server of this upload no longer exists');
    return { upload, server };
  }

  private update(uploadId: string, data: Parameters<typeof db.updateUpload>[1], prompt?: Prompt | null) {
    return db.updateUpload(uploadId, data).then((upload) => {
      if (data.releaseStatus !== undefined) {
        this.emit('release-updated', { uploadId, releaseStatus: upload.releaseStatus, prompt: prompt ?? null });
      }
      return upload;
    });
  }

  private async connect(server: Server) {
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
  private async media(upload: Upload, server: Server): Promise<MediaInfo> {
    const stored = parseMedia(upload);
    if (isDetailed(stored)) return stored;

    let media: MediaInfo;
    if (existsSync(upload.filepath)) {
      media = await mediaInfoParser.parseFile(upload.filepath);
    } else {
      const { ssh } = await this.connect(server);
      try {
        const remote = remotePathOf(upload, server);
        const result = await exec(ssh, `ffprobe -v error -show_format -show_streams -show_chapters -of json ${shellQuote(remote)}`);
        if (result.code !== 0) {
          throw new ReleaseError(`ffprobe failed on the server: ${result.stderr.trim() || `exit code ${result.code}`}`, 502);
        }
        media = fromProbe(JSON.parse(result.stdout) as ProbeData);
      } finally {
        ssh.end();
      }
    }
    await db.updateUpload(upload.id, {
      mediaInfo: JSON.stringify(media),
      hasItalianAudio: media.hasItalianAudio,
      hasItalianSubtitles: media.hasItalianSubtitles,
    });
    return media;
  }

  /** What the rename dialog shows: the analysis and the name's prefilled parts */
  async proposal(uploadId: string): Promise<Proposal> {
    const { upload, server } = await this.load(uploadId);
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
    };
  }

  private async name(upload: Upload, server: Server, flags: ReleaseFlags) {
    const media = parseMedia(upload);
    if (!isDetailed(media)) throw new ReleaseError('Open the rename dialog first: the media details are missing');
    const analysis = analyze(media);
    const extension = path.posix.extname(upload.filename).slice(1) || 'mkv';
    const filename = buildReleaseName(flags, analysis, extension, server.releaseTag);
    const folder = filename.slice(0, filename.length - extension.length - 1);
    return { analysis, filename, folder };
  }

  async preview(uploadId: string, flags: ReleaseFlags): Promise<Preview> {
    const { upload, server } = await this.load(uploadId);
    const { analysis, filename, folder } = await this.name(upload, server, flags);
    return {
      filename,
      folder,
      path: path.posix.join(releaseDirOf(server), folder, filename),
      autoHybrid: isAutoHybrid(flags, analysis),
      error: validateFlags(flags),
    };
  }

  /** Renames the file on the server, then queues the tracker command (if the server has one) */
  async confirm(uploadId: string, flags: ReleaseFlags, overwrite = false): Promise<Upload> {
    const { upload, server } = await this.load(uploadId);
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
      if (!(await exists(source))) throw new ReleaseError(`The file is no longer on the server: ${source}`);

      if (source !== target) {
        if (await exists(target)) {
          if (!overwrite) throw new ReleaseError(`${filename} is already in ${dir}`, 409, 'exists');
          await sftpCall((cb) => sftp.unlink(target, cb));
        }
        await uploadManager.ensureRemoteDir(sftp, dir);
        await sftpCall((cb) => sftp.rename(source, target, cb));
        logger.info({ uploadId, source, target }, 'Renamed on the server');
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
      remotePath: target,
      releaseName: filename,
      releaseStatus: hasCommand ? 'QUEUED' : 'RENAMED',
      releaseMessage: hasCommand ? null : 'Renamed on the server',
      releaseLog: null,
      releasePrompt: null,
      releaseOffset: 0,
      releaseStartedAt: null,
      releaseCompletedAt: hasCommand ? null : new Date(),
    });
    if (hasCommand) this.enqueue(updated.id, server.id);
    return updated;
  }

  /** The tracker command again, on the file already renamed */
  async rerun(uploadId: string): Promise<Upload> {
    const { upload, server } = await this.load(uploadId);
    if (!upload.releaseStatus || !RERUNNABLE.includes(upload.releaseStatus) || !upload.releaseName) {
      throw new ReleaseError('Rename the file first');
    }
    if (!server.trackerCommand?.trim()) throw new ReleaseError('The server has no tracker command');
    const updated = await this.update(uploadId, {
      releaseStatus: 'QUEUED',
      releaseMessage: null,
      releaseLog: null,
      releasePrompt: null,
      releaseOffset: 0,
      releaseStartedAt: null,
      releaseCompletedAt: null,
    });
    this.enqueue(uploadId, server.id);
    return updated;
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

  private enqueue(uploadId: string, serverId: string) {
    const previous = this.chains.get(serverId) ?? Promise.resolve();
    const next = previous
      .then(() => (this.stopped ? undefined : this.start(uploadId)))
      .catch((error) => logger.error({ uploadId, error }, 'Tracker command failed'));
    this.chains.set(serverId, next);
  }

  /** Writes the wrapper script and starts it in a detached tmux session, then follows it */
  private async start(uploadId: string): Promise<void> {
    const upload = await db.getUploadById(uploadId);
    if (!upload || upload.releaseStatus !== 'QUEUED') return; // stopped while queued
    const server = upload.serverId ? await db.getServerById(upload.serverId) : null;
    const fail = (message: string) =>
      this.update(uploadId, { releaseStatus: 'FAILED', releaseMessage: message, releaseCompletedAt: new Date() });
    if (!server?.trackerCommand?.trim() || !upload.remotePath) {
      await fail(server ? 'The server has no tracker command' : 'The server no longer exists');
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
      serverId: upload.serverId!,
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
            const server = await db.getServerById(run.serverId);
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

    // The wrapper script, its log and its session (kept with tmux's remain-on-exit) are no longer needed
    if (run.ssh && run.sftp) {
      await exec(run.ssh, `tmux kill-session -t ${run.session} 2>/dev/null`).catch(() => undefined);
      for (const file of [run.scriptPath, run.logPath]) {
        await sftpCall((cb) => run.sftp!.unlink(file, cb)).catch(() => undefined);
      }
    }
    run.ssh?.end();
    this.runs.delete(run.uploadId);

    logger.info({ uploadId: run.uploadId, code, ...outcome }, 'Tracker command ended');
    this.emit('release-output', { uploadId: run.uploadId, log });
    await this.update(run.uploadId, {
      releaseStatus: outcome.status,
      releaseMessage: outcome.message,
      releaseLog: log,
      releaseOffset: run.offset,
      releasePrompt: null,
      releaseCompletedAt: new Date(),
    });
  }

  /** At start: follow the commands still running in tmux, then the queued ones */
  async resumePending(): Promise<void> {
    for (const status of ['RUNNING', 'NEEDS_INPUT']) {
      for (const upload of await db.getUploadsByReleaseStatus(status)) {
        if (!upload.serverId) {
          await this.update(upload.id, { releaseStatus: 'FAILED', releaseMessage: 'The server no longer exists' });
          continue;
        }
        const rip = await db.getRipByOutputFile(upload.filepath);
        const run = this.newRun(upload, rip?.tmdbId ?? null);
        run.tmdbAnswered = true; // already asked before the restart, maybe answered
        logger.info({ uploadId: upload.id }, 'Following the tracker command again');
        this.chains.set(upload.serverId, this.follow(run).catch(() => undefined));
      }
    }
    for (const upload of await db.getUploadsByReleaseStatus('QUEUED')) {
      if (upload.serverId) this.enqueue(upload.id, upload.serverId);
    }
  }

  /** Stops following: the commands go on in tmux on the servers */
  shutdown(): void {
    this.stopped = true;
    for (const run of this.runs.values()) run.ssh?.end();
  }
}

export const releaseManager = new ReleaseManager();
