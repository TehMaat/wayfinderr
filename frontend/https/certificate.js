'use strict';

// The certificate served on HTTPS: fullchain.pem (the certificate first, then the
// chain) and privkey.pem in the certificate folder. Whoever writes them (by hand, the
// Let's Encrypt client, the copy from another host) replaces them whole, by a rename.

const fs = require('node:fs');
const path = require('node:path');
const { X509Certificate, createPrivateKey } = require('node:crypto');

const CERT_FILE = 'fullchain.pem';
const KEY_FILE = 'privkey.pem';

/** The DNS names a certificate is for (subjectAltName, else the CN) */
function certificateNames(x509) {
  const names = (x509.subjectAltName || '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.startsWith('DNS:'))
    .map((s) => s.slice(4));
  if (names.length) return names;
  const cn = /^CN=(.+)$/m.exec(x509.subject || '');
  return cn ? [cn[1]] : [];
}

/** The issuer's organization, else its common name (e.g. "Let's Encrypt") */
function issuerName(x509) {
  const issuer = x509.issuer || '';
  const org = /^O=(.+)$/m.exec(issuer);
  const cn = /^CN=(.+)$/m.exec(issuer);
  return (org && org[1]) || (cn && cn[1]) || 'unknown issuer';
}

/**
 * Checks a certificate and its key for a domain: a valid PEM certificate and key that
 * match each other, a certificate that covers the domain (by name, or a wildcard of one
 * level: *.example.com covers wayfinderr.example.com, not a.b.example.com) and is valid
 * now. Throws with the reason, in English (it goes to the log).
 * @returns {{ names: string[], issuer: string, validFrom: Date, validTo: Date, serial: string, fingerprint: string }}
 */
function checkCertificate(certPem, keyPem, domain, now = new Date()) {
  let x509;
  try {
    x509 = new X509Certificate(certPem);
  } catch {
    throw new Error(`${CERT_FILE} is not a PEM certificate`);
  }
  let key;
  try {
    key = createPrivateKey(keyPem);
  } catch {
    throw new Error(`${KEY_FILE} is not a PEM private key`);
  }
  if (!x509.checkPrivateKey(key)) {
    throw new Error(`${KEY_FILE} is not the key of the certificate in ${CERT_FILE}`);
  }
  const names = certificateNames(x509);
  if (!x509.checkHost(domain, { subject: 'never', partialWildcards: false })) {
    throw new Error(`the certificate is for ${names.join(', ') || 'no host name'}, not ${domain}`);
  }
  const validFrom = new Date(x509.validFrom);
  const validTo = new Date(x509.validTo);
  if (now < validFrom) throw new Error(`the certificate is valid only from ${validFrom.toISOString()}`);
  if (now >= validTo) throw new Error(`the certificate expired on ${validTo.toISOString()}`);
  return {
    names,
    issuer: issuerName(x509),
    validFrom,
    validTo,
    serial: x509.serialNumber,
    fingerprint: x509.fingerprint256,
  };
}

/**
 * Reads and checks the certificate in a folder.
 * @returns {{ cert: string, key: string, info: ReturnType<typeof checkCertificate> }}
 */
function readCertificate(certDir, domain, now = new Date()) {
  const read = (file) => {
    const full = path.join(certDir, file);
    try {
      return fs.readFileSync(full, 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') throw new Error(`no certificate yet: ${full} not found`);
      throw new Error(`cannot read ${full}: ${err.code || err.message}`);
    }
  };
  const cert = read(CERT_FILE);
  const key = read(KEY_FILE);
  return { cert, key, info: checkCertificate(cert, key, domain, now) };
}

/** Whole days from now to the end of the certificate */
function daysLeft(info, now = new Date()) {
  return Math.floor((info.validTo.getTime() - now.getTime()) / 86_400_000);
}

module.exports = { CERT_FILE, KEY_FILE, checkCertificate, readCertificate, daysLeft };
