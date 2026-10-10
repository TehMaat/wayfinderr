/**
 * A .torrent file read just enough to tell which file it is for and to compute its
 * info hash (the SHA-1 of the bencoded info dictionary, as clients and trackers do).
 */
import { createHash } from 'crypto';

export interface TorrentFile {
  infoHash: string; // v1, hex
  name: string;
  size: number; // the single file's length, or the sum of the files
  files: { path: string; length: number }[]; // a single file: its name; else paths inside the folder
  announce: string | null; // the tracker's URL, with the passkey
}

type Value = number | Buffer | Value[] | { [key: string]: Value };

class Decoder {
  pos = 0;
  // Where the top-level "info" value starts and ends in the buffer
  info: [number, number] | null = null;

  constructor(private buf: Buffer) {}

  private fail(what: string): never {
    throw new Error(`Not a .torrent file: ${what} at byte ${this.pos}`);
  }

  value(depth = 0): Value {
    const c = this.buf[this.pos];
    if (c === 0x69) return this.integer(); // i
    if (c === 0x6c) return this.list(depth); // l
    if (c === 0x64) return this.dict(depth); // d
    if (c >= 0x30 && c <= 0x39) return this.bytes();
    return this.fail('unexpected byte');
  }

  private integer(): number {
    const end = this.buf.indexOf(0x65, this.pos); // e
    if (end < 0) this.fail('unterminated integer');
    const n = Number(this.buf.subarray(this.pos + 1, end).toString('ascii'));
    if (!Number.isFinite(n)) this.fail('bad integer');
    this.pos = end + 1;
    return n;
  }

  private bytes(): Buffer {
    const colon = this.buf.indexOf(0x3a, this.pos); // :
    if (colon < 0) this.fail('unterminated string length');
    const length = Number(this.buf.subarray(this.pos, colon).toString('ascii'));
    const start = colon + 1;
    if (!Number.isInteger(length) || length < 0 || start + length > this.buf.length) this.fail('bad string length');
    this.pos = start + length;
    return this.buf.subarray(start, this.pos);
  }

  private list(depth: number): Value[] {
    this.pos++;
    const out: Value[] = [];
    while (this.buf[this.pos] !== 0x65) {
      if (this.pos >= this.buf.length) this.fail('unterminated list');
      out.push(this.value(depth + 1));
    }
    this.pos++;
    return out;
  }

  private dict(depth: number): { [key: string]: Value } {
    this.pos++;
    const out: { [key: string]: Value } = {};
    while (this.buf[this.pos] !== 0x65) {
      if (this.pos >= this.buf.length) this.fail('unterminated dictionary');
      const key = this.bytes().toString('utf8');
      const start = this.pos;
      out[key] = this.value(depth + 1);
      if (depth === 0 && key === 'info') this.info = [start, this.pos];
    }
    this.pos++;
    return out;
  }
}

const isDict = (v: Value | undefined): v is { [key: string]: Value } =>
  typeof v === 'object' && v !== null && !Buffer.isBuffer(v) && !Array.isArray(v);

export const parseTorrent = (buf: Buffer): TorrentFile => {
  const decoder = new Decoder(buf);
  const root = decoder.value();
  if (!isDict(root) || !isDict(root.info) || !decoder.info) throw new Error('Not a .torrent file: no info dictionary');
  const info = root.info;
  if (!Buffer.isBuffer(info.name)) throw new Error('Not a .torrent file: no name');

  const files =
    typeof info.length === 'number'
      ? [{ path: info.name.toString('utf8'), length: info.length }]
      : Array.isArray(info.files)
        ? info.files.filter(isDict).map((f) => ({
            path: Array.isArray(f.path) ? f.path.filter(Buffer.isBuffer).map((part) => part.toString('utf8')).join('/') : '',
            length: typeof f.length === 'number' ? f.length : 0,
          }))
        : [];

  return {
    infoHash: createHash('sha1').update(buf.subarray(...decoder.info)).digest('hex'),
    name: info.name.toString('utf8'),
    size: files.reduce((sum, f) => sum + f.length, 0),
    files,
    announce: Buffer.isBuffer(root.announce) ? root.announce.toString('utf8') : null,
  };
};

/**
 * The tracker's host from an announce URL: the passkey in its path stays out.
 * Null for qBittorrent's pseudo trackers (** [DHT] **, PeX, LSD) and anything unparsable.
 */
export const trackerHost = (url: string | null | undefined): string | null => {
  if (!url || !/^(https?|udp):\/\//i.test(url)) return null;
  try {
    return new URL(url).hostname || null;
  } catch {
    return null;
  }
};

/** The hosts of a .torrent's trackers (announce, then announce-list), each once: never their passkeys */
export const torrentTrackers = (buf: Buffer): string[] => {
  const root = new Decoder(buf).value();
  if (!isDict(root)) return [];
  const urls = [root.announce, ...(Array.isArray(root['announce-list']) ? root['announce-list'].flat() : [])];
  const hosts = urls.map((url) => (Buffer.isBuffer(url) ? trackerHost(url.toString('utf8')) : null));
  return [...new Set(hosts.filter((host): host is string => Boolean(host)))];
};
