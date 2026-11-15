/**
 * What the screenshots show that the demo backend cannot have: the space of servers
 * that do not exist, the disks of a typical install, an upload and a rip running,
 * the MakeMKV and Dyadrr runners online. Everything else is the real API answer.
 *
 * Every name here is made up (see seed.ts).
 */

const GB = 1024 ** 3;
const TB = 1024 * GB;
const bytes = (n) => String(Math.round(n));

// The temporary folders of the demo, shown as the Docker install's folders
let folders = [];
export const configure = ({ tmp }) => {
  folders = [
    [`${tmp}/watch`, '/makemkv-output'],
    [`${tmp}/downloads`, '/downloads'],
    [`${tmp}/data`, '/app/data'],
  ];
};
const withDockerPaths = (json) => {
  let text = JSON.stringify(json);
  for (const [from, to] of folders) text = text.split(from).join(to);
  return JSON.parse(text);
};

// Server space by name: free and total
const space = {
  'Seedbox Alpha': { free: 1.21 * TB, total: 4 * TB, source: 'api' },
  'Seedbox Beta': { free: 612 * GB, total: 2 * TB, source: 'quota' },
  'Home NAS': { free: 3.4 * TB, total: 8 * TB, source: 'disk' },
};

// The upload shown as running, and the rip shown as ripping
const RUNNING_UPLOAD = 'Il Guardiano del Faro Spento (2021).mkv';
const RUNNING_RIP = 'Sabbia.e.Rame.2012.1080p.BluRay.AVC-DEMO';

const runningUpload = (upload) =>
  upload.filename === RUNNING_UPLOAD
    ? {
        ...upload,
        status: 'UPLOADING',
        progress: 63,
        progressBytes: bytes(Number(upload.size) * 0.63),
        startedAt: new Date(Date.now() - 9 * 60_000).toISOString(),
      }
    : upload;

/**
 * WebSocket messages for the running upload: two progress updates a second apart,
 * so the dashboard shows a speed and an ETA
 */
export const liveMessages = async (api) => {
  const { uploads } = await api('/api/uploads?limit=100');
  const upload = uploads.find((u) => u.filename === RUNNING_UPLOAD);
  if (!upload) return [];
  const start = Number(upload.size) * 0.63;
  const message = (bytes) => JSON.stringify({ type: 'progress', uploadId: upload.id, progress: 63, bytes });
  return [
    { after: 0, data: message(Math.round(start)) },
    { after: 1000, data: message(Math.round(start + 41.7 * 1024 ** 2)) },
  ];
};

/** A fixed answer for a request, or undefined to ask the backend */
export const fixedResponse = (url, method) => {
  if (method !== 'GET') return undefined;
  if (url.pathname === '/api/system/disks') {
    return {
      sameDisk: false,
      disks: [
        {
          id: 'disk-media',
          mountPoint: '/makemkv-output',
          device: '/dev/sdb1',
          fsType: 'ext4',
          kind: 'disk',
          totalBytes: bytes(4 * TB),
          freeBytes: bytes(1.62 * TB),
          usedBytes: bytes(2.38 * TB),
          folders: [
            { key: 'watch', label: 'Watch folder', path: '/makemkv-output' },
            { key: 'downloads', label: 'Downloads', path: '/downloads' },
          ],
        },
        {
          id: 'disk-system',
          mountPoint: '/',
          device: '/dev/nvme0n1p2',
          fsType: 'ext4',
          kind: 'disk',
          totalBytes: bytes(476 * GB),
          freeBytes: bytes(301 * GB),
          usedBytes: bytes(175 * GB),
          folders: [
            { key: 'data', label: 'Database', path: '/app/data' },
            { key: 'logs', label: 'Logs', path: '/app/data/logs' },
          ],
        },
      ],
      missing: [],
    };
  }
  return undefined;
};

/** The backend's answer, adjusted */
export const patchResponse = (url, body) => {
  const json = withDockerPaths(body);
  const p = url.pathname;

  if (p === '/api/space') {
    return json.map((s) => {
      const known = space[s.name];
      if (!known) return s;
      return {
        ...s,
        reachable: true,
        spaceSource: known.source,
        apiReachable: known.source === 'api' ? true : null,
        freeSpaceBytes: bytes(known.free),
        usedSpaceBytes: bytes(known.total - known.free),
        totalSpaceBytes: bytes(known.total),
        freeSpaceGB: (known.free / GB).toFixed(2),
        lastSpaceCheckAt: new Date().toISOString(),
      };
    });
  }

  if (p === '/api/uploads') return { ...json, uploads: json.uploads.map(runningUpload) };
  if (/^\/api\/uploads\/[^/]+$/.test(p) && json.filename) return runningUpload(json);
  if (p === '/api/uploads/stats') {
    const byStatus = { ...json.byStatus, UPLOADING: 1 };
    delete byStatus.CANCELLED;
    return { ...json, byStatus, queueSize: 1 };
  }

  if (p === '/api/rips') {
    return {
      status: {
        ...json.status,
        runnerAlive: true,
        tmdbConfigured: true,
        exclusions: ['Serie TV/', 'S0*E'],
        unpack: json.status.unpack && { ...json.status.unpack, unrar: true },
        remux: { mkvmerge: true, sevenZip: true, dvd: true },
      },
      rips: json.rips.map((rip) =>
        rip.downloadName === RUNNING_RIP
          ? { ...rip, status: 'RIPPING', progress: 64, completedAt: null, outputFile: null, upload: null, canRipAgain: false }
          : { ...rip, canRipAgain: rip.status === 'DONE' }
      ),
    };
  }

  // Shown as analyzing: there is no Dyadrr behind the demo, so the backend calls it not started
  if (p === '/api/merge/pairs') {
    return json.map((pair) => ({
      ...pair,
      status: 'ANALYZING',
      phase: 'checkpoints',
      progress: 58,
      reasonCode: null,
      reasonMessage: null,
      completedAt: null,
    }));
  }

  if (p === '/api/merge') return { ...json, status: { ...json.status, runnerAlive: true, runnerLastSeen: 2 } };

  if (p === '/api/clients') return json.map((c) => ({ ...c, spaceMessage: null, spacePausedAt: null }));

  return json;
};
