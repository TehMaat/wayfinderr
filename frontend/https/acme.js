'use strict';

// Let's Encrypt for the built-in HTTPS (issue #97), with HTTPS_CERT_SOURCE=acme: the
// frontend gets the certificate of HTTPS_DOMAIN by itself (HTTP-01 challenge, answered
// on port 80), writes it in the certificate folder, where the HTTPS server takes it up
// without a restart, and renews it when needed:
//
// - ARI (ACME Renewal Information, RFC 9773): Let's Encrypt says when to renew each
//   certificate (a window); a moment in it is picked at random and kept, and the new
//   order names the certificate it replaces. If Let's Encrypt moves the window (a
//   revocation, an incident), the renewal moves with it.
// - Without ARI: when a third of the certificate's life is left.
//
// Checked at start and every 6 hours (or when ARI says). A failure keeps the certificate
// in use and is tried again after 15 minutes, doubled up to 12 hours: under Let's
// Encrypt's limit of 5 failed validations an hour.

const fs = require('node:fs');
const path = require('node:path');
const { X509Certificate } = require('node:crypto');
const acme = require('acme-client');
const { readCertificate, checkCertificate, CERT_FILE, KEY_FILE } = require('./certificate');

const DIRECTORIES = {
  production: acme.directory.letsencrypt.production,
  staging: acme.directory.letsencrypt.staging,
};
const CHECK_EVERY_MS = 6 * 3_600_000;
const MIN_CHECK_MS = 60_000;
const RETRY_FIRST_MS = 15 * 60_000;
const RETRY_MAX_MS = 12 * 3_600_000;
const LOCK_STALE_MS = 15 * 60_000;

// --- ARI: the certificate's identifier (RFC 9773, 4.1) ---

/** One DER element at offset: its tag, where its content starts and ends */
function derElement(der, offset) {
  const tag = der[offset];
  let length = der[offset + 1];
  let header = 2;
  if (length & 0x80) {
    const bytes = length & 0x7f;
    length = 0;
    for (let i = 0; i < bytes; i += 1) length = length * 256 + der[offset + 2 + i];
    header += bytes;
  }
  return { tag, start: offset + header, end: offset + header + length };
}

function derChildren(der, parent) {
  const out = [];
  for (let offset = parent.start; offset < parent.end; ) {
    const child = derElement(der, offset);
    out.push(child);
    offset = child.end;
  }
  return out;
}

const base64url = (buf) => buf.toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const AKI_OID = Buffer.from([0x55, 0x1d, 0x23]); // 2.5.29.35 authorityKeyIdentifier

/** base64url(authority key identifier) "." base64url(serial number, DER bytes) */
function ariCertId(certPem) {
  const der = new X509Certificate(certPem).raw;
  const [tbs] = derChildren(der, derElement(der, 0));
  const fields = derChildren(der, tbs);
  const serial = fields[fields[0].tag === 0xa0 ? 1 : 0]; // after the optional [0] version
  const extensions = fields.find((f) => f.tag === 0xa3);
  let keyId = null;
  if (extensions) {
    for (const ext of derChildren(der, derChildren(der, extensions)[0])) {
      const parts = derChildren(der, ext);
      if (!der.subarray(parts[0].start, parts[0].end).equals(AKI_OID)) continue;
      const value = parts[parts.length - 1]; // OCTET STRING, after the optional critical flag
      for (const field of derChildren(der, derElement(der, value.start))) {
        if (field.tag === 0x80) keyId = der.subarray(field.start, field.end); // [0] keyIdentifier
      }
    }
  }
  if (!keyId) throw new Error('the certificate has no authority key identifier');
  return `${base64url(keyId)}.${base64url(der.subarray(serial.start, serial.end))}`;
}

/** Seconds or an HTTP date, in ms from now (null when absent or unreadable) */
function retryAfterMs(value, now) {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(0, date - now.getTime());
}

/** A moment in the window, picked at random (RFC 9773, 4.2) */
function pickInWindow(start, end, random = Math.random) {
  if (end <= start) return new Date(start.getTime());
  return new Date(start.getTime() + Math.floor(random() * (end.getTime() - start.getTime())));
}

/** Without ARI: when a third of the certificate's life is left */
function fallbackRenewAt(info) {
  const life = info.validTo.getTime() - info.validFrom.getTime();
  return new Date(info.validTo.getTime() - life / 3);
}

/** Wait before trying again after failures in a row: 15 minutes, doubled, at most 12 hours */
function retryDelayMs(failures) {
  return Math.min(RETRY_FIRST_MS * 2 ** Math.max(0, failures - 1), RETRY_MAX_MS);
}

const describeError = (err) => {
  const detail = err && err.response && err.response.data && err.response.data.detail;
  return detail || (err && err.message) || String(err);
};

function writeAtomic(file, content, mode) {
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.tmp`);
  fs.writeFileSync(tmp, content, { mode });
  fs.chmodSync(tmp, mode);
  fs.renameSync(tmp, file);
}

/**
 * Gets and renews the certificate from Let's Encrypt.
 * @param {object} options
 * @param {string} options.domain
 * @param {string} options.certDir fullchain.pem and privkey.pem; acme/ for the account and ARI
 * @param {string} options.directoryUrl ACME directory
 * @param {string} [options.email] contact of the ACME account
 * @param {Map<string, string>} options.challenges token → key authorization, served on port 80
 * @param {() => Promise<void>} options.onCertificate a new certificate was written
 * @param {{ info: Function, warn: Function, error: Function }} options.log
 * @param {() => Date} [options.now]
 * @param {() => number} [options.random]
 * @param {{ min: number, max: number }} [options.backoff] polling of the ACME server (tests)
 */
class AcmeManager {
  constructor(options) {
    this.options = options;
    this.now = options.now || (() => new Date());
    this.random = options.random || Math.random;
    this.stateDir = path.join(options.certDir, 'acme');
    this.failures = 0;
    this.timer = null;
    this.stopped = false;
    this.running = null;
  }

  readState() {
    try {
      return JSON.parse(fs.readFileSync(path.join(this.stateDir, 'state.json'), 'utf8'));
    } catch {
      return {};
    }
  }

  writeState(state) {
    fs.mkdirSync(this.stateDir, { recursive: true, mode: 0o700 });
    writeAtomic(path.join(this.stateDir, 'state.json'), `${JSON.stringify(state, null, 2)}\n`, 0o600);
  }

  async accountKey() {
    const file = path.join(this.stateDir, 'account.pem');
    try {
      return fs.readFileSync(file, 'utf8');
    } catch {
      fs.mkdirSync(this.stateDir, { recursive: true, mode: 0o700 });
      const key = (await acme.crypto.createPrivateEcdsaKey()).toString();
      writeAtomic(file, key, 0o600);
      return key;
    }
  }

  async client() {
    const client = new acme.Client({
      directoryUrl: this.options.directoryUrl,
      accountKey: await this.accountKey(),
      backoffAttempts: 10,
      backoffMin: (this.options.backoff && this.options.backoff.min) || 2000,
      backoffMax: (this.options.backoff && this.options.backoff.max) || 15000,
    });
    const { email } = this.options;
    await client.createAccount({ termsOfServiceAgreed: true, ...(email ? { contact: [`mailto:${email}`] } : {}) });
    return client;
  }

  /** One process at a time on the folder (two frontends on one volume) */
  lock() {
    fs.mkdirSync(this.stateDir, { recursive: true, mode: 0o700 });
    const file = path.join(this.stateDir, 'lock');
    try {
      fs.writeFileSync(file, String(process.pid), { flag: 'wx' });
    } catch {
      const age = Date.now() - fs.statSync(file).mtimeMs;
      if (age < LOCK_STALE_MS) throw new Error(`another order is running (${file})`);
      fs.writeFileSync(file, String(process.pid));
    }
    return () => fs.rmSync(file, { force: true });
  }

  /**
   * When to renew the certificate in use: ARI's window when Let's Encrypt answers,
   * else a third of its life before the end. Also when to ask ARI again.
   */
  async renewalPlan(cert, info) {
    const now = this.now();
    let certId = null;
    try {
      certId = ariCertId(cert);
    } catch {
      // not from an ACME CA, or no key identifier: the fallback only
    }
    if (certId) {
      try {
        const directory = (await acme.axios.get(this.options.directoryUrl)).data;
        if (directory && directory.renewalInfo) {
          const res = await acme.axios.get(`${directory.renewalInfo.replace(/\/$/, '')}/${certId}`);
          const window = res.data && res.data.suggestedWindow;
          const start = new Date(window && window.start);
          const end = new Date(window && window.end);
          if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime())) {
            const state = this.readState();
            let renewAt;
            const kept = state.ari;
            if (kept && kept.certId === certId && kept.start === start.toISOString() && kept.end === end.toISOString()) {
              renewAt = new Date(kept.renewAt);
            } else {
              renewAt = pickInWindow(start, end, this.random);
              this.writeState({ ...state, ari: { certId, start: start.toISOString(), end: end.toISOString(), renewAt: renewAt.toISOString() } });
              this.options.log.info(
                `Let's Encrypt renewal window ${start.toISOString()} – ${end.toISOString()} (ARI): renewal at ${renewAt.toISOString()}`,
              );
            }
            const askAgain = Math.min(Math.max(retryAfterMs(res.headers['retry-after'], now) ?? CHECK_EVERY_MS, 3_600_000), 24 * 3_600_000);
            return { certId, renewAt, nextCheckMs: askAgain, ari: true };
          }
        }
      } catch (err) {
        this.options.log.warn(`ARI (renewal information) not available, renewing at a third of the certificate's life: ${describeError(err)}`);
      }
    }
    return { certId, renewAt: fallbackRenewAt(info), nextCheckMs: CHECK_EVERY_MS, ari: false };
  }

  /** Orders a certificate: HTTP-01 on port 80, a new key, the files written */
  async obtain(replaces) {
    const { domain, certDir, challenges, log } = this.options;
    const unlock = this.lock();
    try {
      const client = await this.client();
      let order;
      try {
        order = await client.createOrder({ identifiers: [{ type: 'dns', value: domain }], ...(replaces ? { replaces } : {}) });
      } catch (err) {
        if (!replaces) throw err;
        log.warn(`order naming the certificate it replaces refused (${describeError(err)}): ordering without it`);
        order = await client.createOrder({ identifiers: [{ type: 'dns', value: domain }] });
      }
      for (const authz of await client.getAuthorizations(order)) {
        if (authz.status === 'valid') continue;
        const challenge = (authz.challenges || []).find((c) => c.type === 'http-01');
        if (!challenge) throw new Error('Let\'s Encrypt offered no HTTP-01 challenge');
        challenges.set(challenge.token, await client.getChallengeKeyAuthorization(challenge));
        try {
          await client.completeChallenge(challenge);
          await client.waitForValidStatus(challenge);
        } catch (err) {
          let reason = describeError(err);
          try {
            const [again] = await client.getAuthorizations(order);
            const failed = (again.challenges || []).find((c) => c.type === 'http-01');
            if (failed && failed.error && failed.error.detail) reason = failed.error.detail;
          } catch {
            // keep the first reason
          }
          throw new Error(`the HTTP-01 challenge failed (is port 80 of ${domain} reaching this machine?): ${reason}`);
        } finally {
          challenges.delete(challenge.token);
        }
      }
      const [key, csr] = await acme.crypto.createCsr(
        { commonName: domain, altNames: [domain] },
        await acme.crypto.createPrivateEcdsaKey(),
      );
      const finalized = await client.finalizeOrder(order, csr);
      const cert = await client.getCertificate(finalized);
      const info = checkCertificate(cert, key.toString(), domain, this.now());
      fs.mkdirSync(certDir, { recursive: true });
      // The key first: the HTTPS server checks the pair once the certificate changes
      writeAtomic(path.join(certDir, KEY_FILE), key.toString(), 0o600);
      writeAtomic(path.join(certDir, CERT_FILE), cert, 0o644);
      return info;
    } finally {
      unlock();
    }
  }

  /** One check: renews when it is time; returns when to check again (ms) */
  async check() {
    const { domain, certDir, log } = this.options;
    let current = null;
    try {
      current = readCertificate(certDir, domain, this.now());
    } catch (err) {
      log.info(`Let's Encrypt: getting the certificate of ${domain} (${err.message})`);
    }

    let plan = null;
    if (current) {
      plan = await this.renewalPlan(current.cert, current.info);
      const wait = plan.renewAt.getTime() - this.now().getTime();
      if (wait > 0) return Math.max(MIN_CHECK_MS, Math.min(wait, plan.nextCheckMs));
      log.info(`Let's Encrypt: renewing the certificate of ${domain}, valid until ${current.info.validTo.toISOString()}${plan.ari ? ' (ARI window)' : ''}`);
    }

    const info = await this.obtain(plan && plan.ari ? plan.certId : null);
    this.failures = 0;
    log.info(`Let's Encrypt: certificate of ${domain} ${current ? 'renewed' : 'obtained'}, valid until ${info.validTo.toISOString()}`);
    await this.options.onCertificate();
    return MIN_CHECK_MS; // read the ARI window of the new certificate
  }

  runOnce() {
    if (!this.running) {
      this.running = this.check()
        .catch((err) => {
          this.failures += 1;
          const retry = retryDelayMs(this.failures);
          this.options.log.warn(
            `Let's Encrypt: ${describeError(err)}. The certificate in use stays; next try in ${Math.round(retry / 60_000)} min`,
          );
          return retry;
        })
        .finally(() => {
          this.running = null;
        });
    }
    return this.running;
  }

  schedule(ms) {
    if (this.stopped) return;
    this.timer = setTimeout(async () => {
      const next = await this.runOnce();
      this.schedule(next);
    }, ms);
    this.timer.unref();
  }

  start() {
    this.stopped = false;
    this.schedule(0);
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
  }
}

module.exports = { AcmeManager, DIRECTORIES, ariCertId, pickInWindow, fallbackRenewAt, retryDelayMs, retryAfterMs };
