import { createHash, createPrivateKey, generateKeyPairSync, X509Certificate } from 'crypto';
import { utils as sshUtils } from 'ssh2';

/**
 * The certificate fetched for the frontend's built-in HTTPS (issue #98): what the host
 * answers, the checks before it is written, and Wayfinderr's own SSH key. The frontend
 * makes the same checks before it serves a certificate (frontend/https/certificate.js).
 */

export interface CertificateInfo {
  names: string[];
  issuer: string;
  validFrom: Date;
  validTo: Date;
  serial: string;
  fingerprint: string;
}

/** The DNS names a certificate is for (subjectAltName, else the CN) */
const certificateNames = (x509: X509Certificate): string[] => {
  const names = (x509.subjectAltName || '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.startsWith('DNS:'))
    .map((s) => s.slice(4));
  if (names.length) return names;
  const cn = /^CN=(.+)$/m.exec(x509.subject || '');
  return cn ? [cn[1]] : [];
};

const issuerName = (x509: X509Certificate): string => {
  const org = /^O=(.+)$/m.exec(x509.issuer || '');
  const cn = /^CN=(.+)$/m.exec(x509.issuer || '');
  return (org && org[1]) || (cn && cn[1]) || 'unknown issuer';
};

/**
 * Checks a certificate (PEM, the certificate first, then its chain) and its key for a
 * domain: they match, the certificate covers the domain (by name or a one-level
 * wildcard) and is valid now. Throws with the reason.
 */
export const checkCertificate = (certPem: string, keyPem: string, domain: string, now = new Date()): CertificateInfo => {
  let x509: X509Certificate;
  try {
    x509 = new X509Certificate(certPem);
  } catch {
    throw new Error('the certificate is not PEM');
  }
  let key;
  try {
    key = createPrivateKey(keyPem);
  } catch {
    throw new Error('the key is not a PEM private key');
  }
  if (!x509.checkPrivateKey(key)) throw new Error('the key is not the certificate’s own');
  const names = certificateNames(x509);
  if (!x509.checkHost(domain, { subject: 'never', partialWildcards: false })) {
    throw new Error(`the certificate is for ${names.join(', ') || 'no host name'}, not ${domain}`);
  }
  const validFrom = new Date(x509.validFrom);
  const validTo = new Date(x509.validTo);
  if (now < validFrom) throw new Error(`the certificate is valid only from ${validFrom.toISOString()}`);
  if (now >= validTo) throw new Error(`the certificate expired on ${validTo.toISOString()}`);
  return { names, issuer: issuerName(x509), validFrom, validTo, serial: x509.serialNumber, fingerprint: x509.fingerprint256 };
};

/** The certificate of a PEM file already there, without the checks (null when unreadable) */
export const certificateOf = (certPem: string): { serial: string; validTo: Date } | null => {
  try {
    const x509 = new X509Certificate(certPem);
    return { serial: x509.serialNumber, validTo: new Date(x509.validTo) };
  } catch {
    return null;
  }
};

const decodePem = (value: unknown, what: string): string => {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`the host sent no ${what}`);
  const text = value.includes('-----BEGIN') ? value : Buffer.from(value, 'base64').toString('utf8');
  if (!text.includes('-----BEGIN')) throw new Error(`the host sent a ${what} that is not PEM`);
  return text.endsWith('\n') ? text : `${text}\n`;
};

/**
 * What the command on the host prints: one JSON object with the certificate and its
 * key, base64 of the PEM as Traefik keeps them in acme.json (plain PEM is fine too).
 */
export const parseFetched = (output: string): { cert: string; key: string } => {
  let data: unknown;
  try {
    data = JSON.parse(output.trim());
  } catch {
    const first = output.trim().split('\n')[0]?.slice(0, 120);
    throw new Error(first ? `the host did not answer with the certificate: "${first}"` : 'the host answered nothing');
  }
  if (!data || typeof data !== 'object') throw new Error('the host has no certificate for the domain');
  const { certificate, key } = data as { certificate?: unknown; key?: unknown };
  return { cert: decodePem(certificate, 'certificate'), key: decodePem(key, 'key') };
};

/** OpenSSH's fingerprint of a host key (SHA256:…, base64 without padding) */
export const hostKeyFingerprint = (key: Buffer): string =>
  `SHA256:${createHash('sha256').update(key).digest('base64').replace(/=+$/, '')}`;

/** Wait before the next try after failures in a row: 15 min, doubled, at most 6 hours */
export const retryDelayMs = (failures: number): number =>
  Math.min(15 * 60_000 * 2 ** Math.max(0, failures - 1), 6 * 3_600_000);

/** Whole days left before the certificate ends */
export const daysLeft = (validTo: Date, now = new Date()): number => Math.floor((validTo.getTime() - now.getTime()) / 86_400_000);

/**
 * A new SSH key for Wayfinderr (ECDSA P-256, a format ssh2 reads): the private key in
 * PEM and the public key as an authorized_keys line.
 */
export const generateSshKey = (comment = 'wayfinderr-https'): { privateKey: string; publicKey: string } => {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const pem = privateKey.export({ type: 'sec1', format: 'pem' }).toString();
  return { privateKey: pem, publicKey: publicKeyOf(pem, comment) };
};

/** The authorized_keys line of a private key */
export const publicKeyOf = (privateKeyPem: string, comment = 'wayfinderr-https'): string => {
  const parsed = sshUtils.parseKey(privateKeyPem);
  if (parsed instanceof Error) throw parsed;
  const key = Array.isArray(parsed) ? parsed[0] : parsed;
  return `${key.type} ${key.getPublicSSH().toString('base64')} ${comment}`;
};
