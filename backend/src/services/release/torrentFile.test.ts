import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'crypto';
import { parseTorrent, torrentTrackers, trackerHost } from './torrentFile.js';

const info = 'd6:lengthi1234e4:name13:Film.2001.mkv12:piece lengthi16384e6:pieces0:e';

test('single file: name, size and the SHA-1 of the info dictionary', () => {
  const file = Buffer.from(`d8:announce30:https://t.example/a/PASSKEY/an4:info${info}e`);
  assert.deepEqual(parseTorrent(file), {
    infoHash: createHash('sha1').update(info).digest('hex'),
    name: 'Film.2001.mkv',
    size: 1234,
  });
});

test('several files: the size is their sum', () => {
  const multi = 'd5:filesld6:lengthi10e4:pathl5:a.mkveed6:lengthi5e4:pathl5:b.srteee4:name4:Film6:pieces0:e';
  const parsed = parseTorrent(Buffer.from(`d4:info${multi}e`));
  assert.equal(parsed.name, 'Film');
  assert.equal(parsed.size, 15);
});

test('an "info" key deeper down is not the info dictionary', () => {
  const file = Buffer.from(`d1:xd4:infod4:name1:yee4:info${info}e`);
  assert.equal(parseTorrent(file).infoHash, createHash('sha1').update(info).digest('hex'));
});

test('anything else is refused', () => {
  assert.throws(() => parseTorrent(Buffer.from('<html>')), /Not a \.torrent/);
  assert.throws(() => parseTorrent(Buffer.from('d4:infod4:name')), /Not a \.torrent/);
  assert.throws(() => parseTorrent(Buffer.from('d3:fooi1ee')), /no info/);
});

test('the tracker host only, never the passkey', () => {
  assert.equal(trackerHost('https://tracker.example.org/announce/0123abcd'), 'tracker.example.org');
  assert.equal(trackerHost('udp://open.example.net:1337/announce'), 'open.example.net');
  assert.equal(trackerHost('** [DHT] **'), null);
  assert.equal(trackerHost(''), null);
});

test("a .torrent's trackers: announce and announce-list hosts, each once", () => {
  const list = 'll30:https://t.example/a/PASSKEY/anel21:udp://b.example:80/anee';
  const file = Buffer.from(`d8:announce30:https://t.example/a/PASSKEY/an13:announce-list${list}4:info${info}e`);
  assert.deepEqual(torrentTrackers(file), ['t.example', 'b.example']);
  assert.deepEqual(torrentTrackers(Buffer.from(`d4:info${info}e`)), []);
});
