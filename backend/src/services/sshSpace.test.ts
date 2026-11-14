import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseQuota, spaceFromQuota, spaceFromStatvfs } from './sshSpace.js';

const KIB = 1024n;

test('a quota: used blocks and the soft limit, in KiB', () => {
  const output = [
    'Disk quotas for user alice (uid 1001): ',
    '     Filesystem  blocks   quota   limit   grace   files   quota   limit   grace',
    '      /dev/sdb1  1048576  2097152 2202009             12       0       0        ',
  ].join('\n');
  assert.deepEqual(parseQuota(output), { usedBytes: 1048576n * KIB, limitBytes: 2097152n * KIB });
});

test('no soft quota: the hard limit counts', () => {
  const output = [
    'Disk quotas for user bob (uid 1002):',
    'Filesystem  blocks   quota   limit   grace   files   quota   limit   grace',
    '/dev/md2    500      0       1000            3       0       0',
  ].join('\n');
  assert.deepEqual(parseQuota(output), { usedBytes: 500n * KIB, limitBytes: 1000n * KIB });
});

test('over the soft quota: the star is dropped, free stops at 0', () => {
  const output = [
    'Disk quotas for user carol (uid 1003):',
    '     Filesystem  blocks   quota   limit   grace   files   quota   limit   grace',
    '      /dev/sdb1  110000*  100000  120000  6days      12       0       0',
  ].join('\n');
  const quota = parseQuota(output);
  assert.deepEqual(quota, { usedBytes: 110000n * KIB, limitBytes: 100000n * KIB });
  assert.equal(spaceFromQuota(quota!).freeSpaceBytes, 0n);
});

test('a long filesystem name wrapped on its own line', () => {
  const output = [
    'Disk quotas for user dave (uid 1004):',
    '     Filesystem  blocks   quota   limit   grace   files   quota   limit   grace',
    '/dev/mapper/vg0-home',
    '                 2048     4096    4096              5       0       0',
  ].join('\n');
  assert.deepEqual(parseQuota(output), { usedBytes: 2048n * KIB, limitBytes: 4096n * KIB });
});

test('the first filesystem with a limit, skipping those without', () => {
  const output = [
    'Disk quotas for user erin (uid 1005):',
    '     Filesystem  blocks   quota   limit   grace   files   quota   limit   grace',
    '      /dev/sda1      10       0       0               1       0       0',
    '      /dev/sdb1     300     900     900               2       0       0',
  ].join('\n');
  assert.deepEqual(parseQuota(output), { usedBytes: 300n * KIB, limitBytes: 900n * KIB });
});

test('no quota: none, only unlimited filesystems, empty or unknown output', () => {
  assert.equal(parseQuota('Disk quotas for user frank (uid 1006): none'), null);
  assert.equal(
    parseQuota(
      [
        'Disk quotas for user frank (uid 1006):',
        '     Filesystem  blocks   quota   limit   grace   files   quota   limit   grace',
        '      /dev/sda1      10       0       0               1       0       0',
      ].join('\n')
    ),
    null
  );
  assert.equal(parseQuota(''), null);
  assert.equal(parseQuota('bash: quota: command not found'), null);
});

test('space from a quota', () => {
  assert.deepEqual(spaceFromQuota({ usedBytes: 300n, limitBytes: 1000n }), {
    freeSpaceBytes: 700n,
    usedSpaceBytes: 300n,
    totalSpaceBytes: 1000n,
    method: 'quota',
  });
});

test('space from statvfs: fragment size, free for non-root users', () => {
  assert.deepEqual(spaceFromStatvfs({ f_bsize: 4096, f_frsize: 4096, f_blocks: 1000, f_bfree: 300, f_bavail: 250 }), {
    freeSpaceBytes: 250n * 4096n,
    usedSpaceBytes: 700n * 4096n,
    totalSpaceBytes: 1000n * 4096n,
    method: 'disk',
  });
  // BigInt values, and no fragment size: the block size counts
  assert.deepEqual(spaceFromStatvfs({ f_bsize: 512n, f_frsize: 0n, f_blocks: 10n, f_bfree: 4n, f_bavail: 4n }), {
    freeSpaceBytes: 2048n,
    usedSpaceBytes: 3072n,
    totalSpaceBytes: 5120n,
    method: 'disk',
  });
});
