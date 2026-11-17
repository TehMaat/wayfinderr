import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'events';
import { Client as SSHClient, SFTPWrapper } from 'ssh2';
import { whereabouts } from './index.js';

const SIZE = 1234;
const HOME = '/home/u';
const server = { releaseDir: 'releases', sshPath: '/data/uploads' };
const RELEASED = `${HOME}/releases/Film.2001.1080p-TAG/Film.2001.1080p-TAG.mkv`;
const upload = { remotePath: RELEASED, filename: 'Film.2001.mkv', size: BigInt(SIZE) };

/** An SFTP server holding files of these sizes; stat fails as a lost channel when broken */
const fakeSftp = (files: Record<string, number>, broken = false) =>
  ({
    stat: (p: string, cb: (err: Error | undefined, s?: unknown) => void) => {
      if (broken) return cb(new Error('Channel closed'));
      return p in files ? cb(undefined, { mode: 0o100644, size: files[p] }) : cb(Object.assign(new Error('No such file'), { code: 2 }));
    },
  }) as unknown as SFTPWrapper;

/** An SSH connection whose `find` lists the files of this size under the folders it is given */
const fakeSsh = (files: Record<string, number>, broken = false) => {
  const commands: string[] = [];
  const ssh = {
    commands,
    exec: (command: string, cb: (err: Error | undefined, stream?: EventEmitter) => void) => {
      commands.push(command);
      if (broken) return cb(new Error('Not connected'));
      const stream = Object.assign(new EventEmitter(), { stderr: new EventEmitter() });
      cb(undefined, stream);
      const roots = [...command.matchAll(/'([^']+)'/g)].map((m) => m[1]);
      const size = Number(/-size (\d+)c/.exec(command)?.[1]);
      const listed = Object.entries(files)
        .filter(([p, s]) => s === size && roots.some((r) => p.startsWith(`${r}/`)))
        .map(([p]) => p);
      stream.emit('data', Buffer.from(listed.map((p) => `${p}\n`).join('')));
      stream.emit('close', 0);
    },
  };
  return ssh as unknown as SSHClient & { commands: string[] };
};

test('the file still where it was released: in place, no search', async () => {
  const files = { [RELEASED]: SIZE };
  const ssh = fakeSsh(files);
  assert.deepEqual(await whereabouts(ssh, fakeSftp(files), upload, server, HOME), { kind: 'in-place', path: RELEASED });
  assert.equal(ssh.commands.length, 0);
});

test('moved by the tracker command into another folder of the release folder: its new path', async () => {
  const moved = `${HOME}/releases/seeding/Film.2001.1080p-TAG/Film.2001.1080p-TAG.mkv`;
  const files = { [moved]: SIZE, [`${HOME}/releases/Other.mkv`]: 99 };
  assert.deepEqual(await whereabouts(fakeSsh(files), fakeSftp(files), upload, server, HOME), {
    kind: 'moved',
    from: RELEASED,
    path: moved,
  });
});

test('a relative remotePath counts from the SSH home', async () => {
  const files = { [RELEASED]: SIZE };
  const relative = { ...upload, remotePath: 'releases/Film.2001.1080p-TAG/Film.2001.1080p-TAG.mkv' };
  assert.deepEqual(await whereabouts(fakeSsh(files), fakeSftp(files), relative, server, HOME), { kind: 'in-place', path: RELEASED });
});

test('found nowhere (or only with another size): missing, with the path it had', async () => {
  const files = { [RELEASED]: SIZE - 1, '/elsewhere/Film.2001.1080p-TAG.mkv': SIZE };
  assert.deepEqual(await whereabouts(fakeSsh(files), fakeSftp(files), upload, server, HOME), { kind: 'missing', path: RELEASED });
});

test('an SSH error, or several files of its size: an error, nothing to change', async () => {
  const files = { [RELEASED]: SIZE };
  const lost = await whereabouts(fakeSsh(files, true), fakeSftp(files, true), upload, server, HOME);
  assert.deepEqual(lost, { kind: 'error', error: 'Not connected' });

  const twins = { [`${HOME}/releases/a.mkv`]: SIZE, [`${HOME}/releases/b.mkv`]: SIZE };
  const several = await whereabouts(fakeSsh(twins), fakeSftp(twins), upload, server, HOME);
  assert.equal(several.kind, 'error');
  assert.match(several.kind === 'error' ? several.error : '', /2 files of 1234 bytes/);
});
