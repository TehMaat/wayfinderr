import type { Client as SSHClient, SFTPWrapper } from 'ssh2';

/**
 * Free space of a server read over SSH, when its storage API cannot be reached
 * (see serverManager.getServerSpace). Two ways, in order:
 *
 * - quota: the user's disk quota (`quota -w`), what a seedbox such as Ultra.cc
 *   enforces. The limit is the soft quota, else the hard one.
 * - disk: the free space of the disk holding the upload folder (SFTP
 *   statvfs@openssh.com), for a server without a quota. On a shared seedbox
 *   disk this is the whole disk, not the user's share: hence quota first.
 */
export type SshSpaceMethod = 'quota' | 'disk';

export interface SshSpace {
  freeSpaceBytes: bigint;
  usedSpaceBytes: bigint;
  totalSpaceBytes: bigint;
  method: SshSpaceMethod;
}

// quota-tools prints blocks of 1 KiB (without -s)
const BLOCK = 1024n;
const NUMBER = /^\d+\*?$/;

/**
 * The first quota with a limit in the output of `quota` (quota-tools):
 *
 *   Disk quotas for user alice (uid 1001):
 *        Filesystem  blocks   quota   limit   grace   files   quota   limit   grace
 *         /dev/sdb1  104857* 100000  110000  6days      12       0       0
 *
 * A long filesystem name may sit alone on its line, its numbers on the next one
 * (without -w). Null when there is no quota ("none", no limit, unknown output).
 */
export const parseQuota = (output: string): { usedBytes: bigint; limitBytes: bigint } | null => {
  const lines = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const header = lines.findIndex((line) => /^Filesystem\s+(blocks|space)\b/i.test(line));
  if (header === -1) return null;

  const rows: string[][] = [];
  for (let i = header + 1; i < lines.length; i++) {
    const tokens = lines[i].split(/\s+/);
    // A filesystem alone: its numbers are on the next line
    if (tokens.length === 1 && i + 1 < lines.length && NUMBER.test(lines[i + 1].split(/\s+/)[0])) {
      rows.push([tokens[0], ...lines[i + 1].split(/\s+/)]);
      i++;
    } else {
      rows.push(tokens);
    }
  }

  for (const [, blocks, soft, hard] of rows) {
    if (![blocks, soft, hard].every((value) => value !== undefined && NUMBER.test(value))) continue;
    const limit = BigInt(soft.replace('*', '')) || BigInt(hard.replace('*', ''));
    if (limit === 0n) continue;
    return { usedBytes: BigInt(blocks.replace('*', '')) * BLOCK, limitBytes: limit * BLOCK };
  }
  return null;
};

/** Space from a quota: free never goes below 0 (over the soft quota, within the grace period) */
export const spaceFromQuota = ({ usedBytes, limitBytes }: { usedBytes: bigint; limitBytes: bigint }): SshSpace => ({
  freeSpaceBytes: limitBytes > usedBytes ? limitBytes - usedBytes : 0n,
  usedSpaceBytes: usedBytes,
  totalSpaceBytes: limitBytes,
  method: 'quota',
});

interface StatVfs {
  f_bsize: number | bigint;
  f_frsize: number | bigint;
  f_blocks: number | bigint;
  f_bfree: number | bigint;
  f_bavail: number | bigint;
}

const big = (value: number | bigint) => (typeof value === 'bigint' ? value : BigInt(Math.trunc(value)));

/** Space from statvfs: what a non-root user can still write, and the disk's size */
export const spaceFromStatvfs = (stats: StatVfs): SshSpace => {
  const unit = big(stats.f_frsize) || big(stats.f_bsize);
  const blocks = big(stats.f_blocks);
  return {
    freeSpaceBytes: big(stats.f_bavail) * unit,
    usedSpaceBytes: (blocks - big(stats.f_bfree)) * unit,
    totalSpaceBytes: blocks * unit,
    method: 'disk',
  };
};

const run = (ssh: SSHClient, command: string): Promise<string> =>
  new Promise((resolve, reject) => {
    ssh.exec(command, (err, stream) => {
      if (err) return reject(err);
      let stdout = '';
      stream.on('data', (d: Buffer) => (stdout += d.toString()));
      stream.stderr.on('data', () => undefined);
      stream.on('close', () => resolve(stdout));
    });
  });

const statvfs = (sftp: SFTPWrapper, path: string): Promise<StatVfs> =>
  new Promise((resolve, reject) => {
    try {
      // Throws when the server does not offer the extension
      sftp.ext_openssh_statvfs(path, (err: Error | undefined, stats: StatVfs) => (err ? reject(err) : resolve(stats)));
    } catch (error) {
      reject(error);
    }
  });

/**
 * Reads the space on an open SSH connection: the quota, else the disk of
 * remoteDir (or of the home, when the folder does not exist yet).
 */
export const readSpaceOverSsh = async (ssh: SSHClient, remoteDir: string): Promise<SshSpace> => {
  // quota-tools exits with 1 when over quota: the output still counts
  const quota = parseQuota(await run(ssh, 'LC_ALL=C quota -w 2>/dev/null || LC_ALL=C quota 2>/dev/null').catch(() => ''));
  if (quota) return spaceFromQuota(quota);

  const sftp = await new Promise<SFTPWrapper>((resolve, reject) => ssh.sftp((err, s) => (err ? reject(err) : resolve(s))));
  try {
    return spaceFromStatvfs(await statvfs(sftp, remoteDir).catch(() => statvfs(sftp, '.')));
  } finally {
    sftp.end();
  }
};
