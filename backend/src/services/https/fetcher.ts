import fs from 'fs';
import path from 'path';
import { Client as SSHClient } from 'ssh2';
import {
  certificateOf,
  checkCertificate,
  daysLeft,
  generateSshKey,
  hostKeyFingerprint,
  parseFetched,
  publicKeyOf,
  retryDelayMs,
} from './certificate.js';

/**
 * Fetches the certificate of the frontend's built-in HTTPS from another host over SSH
 * (issue #98), e.g. the wildcard Pangolin keeps in Traefik's acme.json, and writes it
 * where the frontend reads it (fullchain.pem, privkey.pem): the frontend takes it up
 * without a restart. Checked at start and every 6 hours, sooner after a failure.
 *
 * On the host, a dedicated user may run one command only (authorized_keys: restrict and
 * command=…), which prints that certificate and its key as JSON: Wayfinderr never sees
 * the other certificates or the ACME account (scripts/https/pangolin-cert-setup.sh).
 *
 * Wayfinderr's SSH key is made at the first start, in the data volume. The host key is
 * checked: against HTTPS_CERT_SSH_HOST_KEY when set, else the one seen the first time,
 * kept there too.
 */

const CHECK_EVERY_MS = 6 * 3_600_000;
const WARN_DAYS = 21;
const WARN_EVERY_MS = 24 * 3_600_000;
const MAX_OUTPUT = 256 * 1024;
const TIMEOUT_MS = 60_000;
const CERT_FILE = 'fullchain.pem';
const KEY_FILE = 'privkey.pem';
// The command is set on the host (command= in authorized_keys): this name is only shown there
const REMOTE_COMMAND = 'wayfinderr-cert';

type LogFn = (obj: object, msg: string) => void;
export interface FetcherLog {
  debug: LogFn;
  info: LogFn;
  warn: LogFn;
  error: LogFn;
}

export interface FetcherOptions {
  domain: string;
  certDir: string;
  host: string;
  port: number;
  user: string;
  hostKey: string; // pinned SHA256:…, or '' to keep the first one seen
  keyDir: string;
  log: FetcherLog;
  now?: () => Date;
}

export type FetchOutcome = 'saved' | 'unchanged' | 'failed';

class HostKeyMismatch extends Error {}

const writeAtomic = (file: string, content: string, mode: number) => {
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.tmp`);
  fs.writeFileSync(tmp, content, { mode });
  fs.chmodSync(tmp, mode);
  fs.renameSync(tmp, file);
};

export class CertFetcher {
  private timer: NodeJS.Timeout | null = null;
  private failures = 0;
  private lastWarnAt = 0;
  private stopped = false;
  private running: Promise<FetchOutcome> | null = null;
  private readonly now: () => Date;

  constructor(private readonly options: FetcherOptions) {
    this.now = options.now || (() => new Date());
  }

  private get where(): string {
    const { user, host, port } = this.options;
    return `${user}@${host}${port === 22 ? '' : `:${port}`}`;
  }

  /** Wayfinderr's SSH key: made the first time, then kept in the data volume */
  ensureKey(): { privateKey: string; publicKey: string } {
    const { keyDir } = this.options;
    const keyFile = path.join(keyDir, 'ssh-key');
    fs.mkdirSync(keyDir, { recursive: true, mode: 0o700 });
    if (fs.existsSync(keyFile)) {
      const privateKey = fs.readFileSync(keyFile, 'utf8');
      return { privateKey, publicKey: publicKeyOf(privateKey) };
    }
    const key = generateSshKey();
    writeAtomic(keyFile, key.privateKey, 0o600);
    writeAtomic(`${keyFile}.pub`, `${key.publicKey}\n`, 0o644);
    return key;
  }

  /** Whether the host key is the expected one; the first one seen is kept when none is set */
  private checkHostKey(key: Buffer): boolean {
    const { host, port, keyDir, hostKey, log } = this.options;
    const seen = hostKeyFingerprint(key);
    if (hostKey) return seen === hostKey;
    const file = path.join(keyDir, 'host-key');
    const id = `${host}:${port}`;
    let kept: Record<string, string> = {};
    try {
      kept = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      // none yet
    }
    if (kept[id]) return kept[id] === seen;
    kept[id] = seen;
    writeAtomic(file, `${JSON.stringify(kept, null, 2)}\n`, 0o600);
    log.info(
      { host, port, hostKey: seen },
      `HTTPS certificate: first connection to ${host}, its host key ${seen} is kept from now on (compare it with ssh-keygen -lf /etc/ssh/ssh_host_ecdsa_key.pub, or the ed25519 one, on that host)`
    );
    return true;
  }

  /** Runs the command on the host and returns what it printed */
  private fetch(privateKey: string): Promise<string> {
    const { host, port, user } = this.options;
    return new Promise((resolve, reject) => {
      const conn = new SSHClient();
      let seenKey = '';
      let settled = false;
      const done = (err: Error | null, out?: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        conn.end();
        if (err) reject(err);
        else resolve(out ?? '');
      };
      const timeout = setTimeout(() => done(new Error(`no answer from ${host} in ${TIMEOUT_MS / 1000} s`)), TIMEOUT_MS);

      conn.on('ready', () => {
        conn.exec(REMOTE_COMMAND, (err, stream) => {
          if (err) return done(err);
          let out = '';
          let errOut = '';
          stream.on('data', (chunk: Buffer) => {
            out += chunk.toString('utf8');
            if (out.length > MAX_OUTPUT) done(new Error('the host answered too much: is the command the certificate one?'));
          });
          stream.stderr.on('data', (chunk: Buffer) => {
            if (errOut.length < 2000) errOut += chunk.toString('utf8');
          });
          stream.on('close', (code: number | null) => {
            if (code && code !== 0) {
              const reason = errOut.trim().split('\n').pop() || `exit code ${code}`;
              done(new Error(`the command on ${host} failed: ${reason}`));
            } else {
              done(null, out);
            }
          });
        });
      });
      conn.on('error', (err: Error & { level?: string }) => {
        if (seenKey) return done(new HostKeyMismatch(seenKey));
        if (err.level === 'client-authentication') {
          return done(new Error(`${host} refused Wayfinderr's SSH key: the host is not set up for it yet (see the setup line logged at start)`));
        }
        done(err);
      });
      conn.connect({
        host,
        port,
        username: user,
        privateKey,
        readyTimeout: 20_000,
        hostVerifier: (key: Buffer) => {
          let ok = false;
          try {
            ok = this.checkHostKey(key);
          } catch (error) {
            this.options.log.error({ error }, 'HTTPS certificate: cannot keep the host key');
          }
          if (!ok) seenKey = hostKeyFingerprint(key);
          return ok;
        },
      });
    });
  }

  private currentFile(): { serial: string; validTo: Date } | null {
    try {
      return certificateOf(fs.readFileSync(path.join(this.options.certDir, CERT_FILE), 'utf8'));
    } catch {
      return null;
    }
  }

  private warnIfExpiring(): void {
    const current = this.currentFile();
    if (!current) return;
    const left = daysLeft(current.validTo, this.now());
    const now = this.now().getTime();
    if (left < WARN_DAYS && now - this.lastWarnAt >= WARN_EVERY_MS) {
      this.lastWarnAt = now;
      this.options.log.warn(
        { daysLeft: left, validTo: current.validTo.toISOString(), host: this.options.host },
        `HTTPS certificate: it expires in ${left} days and ${this.options.host} has no newer one: is it renewing it?`
      );
    }
  }

  /** One fetch: saves the certificate when it is new and valid for the domain */
  async runOnce(): Promise<FetchOutcome> {
    if (this.running) return this.running;
    this.running = this.doRun().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async doRun(): Promise<FetchOutcome> {
    const { domain, certDir, host, log } = this.options;
    try {
      const { privateKey } = this.ensureKey();
      const { cert, key } = parseFetched(await this.fetch(privateKey));
      const info = checkCertificate(cert, key, domain, this.now());
      this.failures = 0;
      const current = this.currentFile();
      if (current && current.serial === info.serial) {
        log.debug({ host, serial: info.serial }, 'HTTPS certificate: unchanged');
        this.warnIfExpiring();
        return 'unchanged';
      }
      fs.mkdirSync(certDir, { recursive: true });
      // The key first: the frontend checks the pair once the certificate changes
      writeAtomic(path.join(certDir, KEY_FILE), key, 0o600);
      writeAtomic(path.join(certDir, CERT_FILE), cert, 0o644);
      log.info(
        { host, names: info.names, issuer: info.issuer, validTo: info.validTo.toISOString(), serial: info.serial },
        `HTTPS certificate fetched from ${host} and saved: for ${info.names.join(', ')}, valid until ${info.validTo.toISOString()}`
      );
      this.lastWarnAt = 0;
      this.warnIfExpiring();
      return 'saved';
    } catch (error) {
      this.failures += 1;
      const retryMinutes = Math.round(retryDelayMs(this.failures) / 60_000);
      if (error instanceof HostKeyMismatch) {
        log.error(
          { host, seen: error.message, expected: this.options.hostKey || 'the one kept at the first connection' },
          `HTTPS certificate: the host key of ${host} is not the expected one (${error.message}): nothing fetched. If the host was reinstalled, set HTTPS_CERT_SSH_HOST_KEY to the new one, or delete ${path.join(this.options.keyDir, 'host-key')}`
        );
      } else {
        const reason = error instanceof Error ? error.message : String(error);
        log.warn({ host, reason, retryMinutes }, `HTTPS certificate not fetched from ${this.where}: ${reason}. Next try in ${retryMinutes} min`);
      }
      this.warnIfExpiring();
      return 'failed';
    }
  }

  private schedule(ms: number): void {
    if (this.stopped) return;
    this.timer = setTimeout(async () => {
      const outcome = await this.runOnce();
      this.schedule(outcome === 'failed' ? retryDelayMs(this.failures) : CHECK_EVERY_MS);
    }, ms);
    this.timer.unref();
  }

  /** Logs the setup line, fetches now, then every 6 hours */
  start(): void {
    const { domain, host, user, log } = this.options;
    if (!domain) {
      log.error({ host }, 'HTTPS certificate: HTTPS_CERT_SSH_HOST is set without HTTPS_DOMAIN, nothing fetched');
      return;
    }
    try {
      const { publicKey } = this.ensureKey();
      log.info(
        { host, user, publicKey },
        `HTTPS certificate from ${this.where}. To set it up (once), on ${host}: sudo sh pangolin-cert-setup.sh '${publicKey}' (docs/DEPLOYMENT.md, "Wildcard from Pangolin")`
      );
    } catch (error) {
      log.error({ error }, 'HTTPS certificate: cannot make Wayfinderr’s SSH key');
      return;
    }
    this.stopped = false;
    this.schedule(0);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
