import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SFTPWrapper } from 'ssh2';
import { archiveDirs, findTorrent } from './index.js';

const torrent = (name: string, length: number) => Buffer.from(`d4:infod6:lengthi${length}e4:name${Buffer.byteLength(name)}:${name}ee`);

/** An SFTP server holding these files (folders are implied by their paths) */
const fakeSftp = (files: Record<string, { data: Buffer; mtime?: number }>) => {
  const dirs = new Set(Object.keys(files).flatMap((p) => p.split('/').slice(1, -1).map((_, i, parts) => `/${parts.slice(0, i + 1).join('/')}`)));
  const attrs = (p: string) =>
    dirs.has(p) ? { mode: 0o040755, size: 0, mtime: 0 } : files[p] ? { mode: 0o100644, size: files[p].data.length, mtime: files[p].mtime ?? 0 } : null;
  const missing = () => Object.assign(new Error('No such file'), { code: 2 });
  return {
    stat: (p: string, cb: (err: Error | undefined, s?: unknown) => void) => {
      const a = attrs(p);
      return a ? cb(undefined, a) : cb(missing());
    },
    readFile: (p: string, cb: (err: Error | undefined, d?: Buffer) => void) =>
      files[p] ? cb(undefined, files[p].data) : cb(missing()),
    readdir: (p: string, cb: (err: Error | undefined, list?: unknown[]) => void) => {
      if (!dirs.has(p)) return cb(missing());
      const children = new Set(
        [...dirs, ...Object.keys(files)].filter((c) => c.startsWith(`${p}/`)).map((c) => c.slice(p.length + 1).split('/')[0])
      );
      cb(undefined, [...children].map((filename) => ({ filename, attrs: attrs(`${p}/${filename}`) })));
    },
  } as unknown as SFTPWrapper;
};

const NAME = 'Film.2001.1080p.BluRay.mkv';
const ARCHIVE = '/home/u/Unit3Dup_config/torrent_archive_path';

test("the archive from Unit3Dup's output, its configuration and its default, once each", async () => {
  const sftp = fakeSftp({
    'Unit3Dup_config/Unit3Dbot.json': { data: Buffer.from(JSON.stringify({ user_preferences: { TORRENT_ARCHIVE_PATH: '/data/torrents/' } })) },
  });
  const log = `[*.torrent Archive] '/data/torrents'\n`;
  assert.deepEqual(await archiveDirs(sftp, '/home/u', log), ['/data/torrents', ARCHIVE]);
  // Not configured: Unit3Dup writes "no_path"
  const unset = fakeSftp({ 'Unit3Dup_config/Unit3Dbot.json': { data: Buffer.from('{"user_preferences":{"TORRENT_ARCHIVE_PATH":"no_path"}}') } });
  assert.deepEqual(await archiveDirs(unset, '/home/u', ''), [ARCHIVE]);
});

test('the .torrent of this very file, in a tracker folder', async () => {
  const sftp = fakeSftp({
    [`${ARCHIVE}/ITT/${NAME}.torrent`]: { data: torrent(NAME, 1000) },
    [`${ARCHIVE}/ITT/Other.mkv.torrent`]: { data: torrent('Other.mkv', 1000) },
  });
  const found = await findTorrent(sftp, [ARCHIVE], { path: `/home/u/downloads/${NAME}`, size: 1000 });
  assert.equal(found?.path, `${ARCHIVE}/ITT/${NAME}.torrent`);
  assert.equal(found?.tracker, 'ITT');
  assert.match(found?.infoHash ?? '', /^[0-9a-f]{40}$/);
  // Same name, another size: another file
  assert.equal(await findTorrent(sftp, [ARCHIVE], { path: `/home/u/downloads/${NAME}`, size: 999 }), null);
  assert.equal(await findTorrent(sftp, ['/nowhere'], { path: `/home/u/downloads/${NAME}`, size: 1000 }), null);
});

test('in several trackers: the one that accepted the upload, else the newest', async () => {
  const sftp = fakeSftp({
    [`${ARCHIVE}/ITT/${NAME}.torrent`]: { data: torrent(NAME, 5), mtime: 100 },
    [`${ARCHIVE}/SIS/${NAME}.torrent`]: { data: torrent(NAME, 5), mtime: 200 },
  });
  assert.equal((await findTorrent(sftp, [ARCHIVE], { path: `/home/u/downloads/${NAME}`, size: 5 }))?.tracker, 'SIS');
  assert.equal((await findTorrent(sftp, [ARCHIVE], { path: `/home/u/downloads/${NAME}`, size: 5 }, 'itt'))?.tracker, 'ITT');
});

test("named as Unit3Dup does: after the file without its extension, or after its folder", async () => {
  const release = 'Film.2001.1080p.BluRay-TAG';
  const file = { path: `/home/u/downloads/${release}/${release}.mkv`, size: 7 };
  const single = fakeSftp({ [`${ARCHIVE}/ITT/${release}.torrent`]: { data: torrent(`${release}.mkv`, 7) } });
  assert.equal((await findTorrent(single, [ARCHIVE], file))?.path, `${ARCHIVE}/ITT/${release}.torrent`);

  // The whole folder: the file is in it, with its size
  const multi = Buffer.from(
    `d4:infod5:filesld6:lengthi7e4:pathl${Buffer.byteLength(`${release}.mkv`)}:${release}.mkveed6:lengthi3e4:pathl8:info.nfoeee4:name${release.length}:${release}ee`
  );
  const folder = fakeSftp({ [`${ARCHIVE}/ITT/${release}.torrent`]: { data: multi } });
  assert.equal((await findTorrent(folder, [ARCHIVE], file))?.tracker, 'ITT');
  assert.equal(await findTorrent(folder, [ARCHIVE], { ...file, size: 10 }), null);
});
