/**
 * Kinds of upload server (issue #68), as the backend's services/serverTypes.ts:
 * Ultra.cc reads its space from the Ultra-API (over SSH while it is unreachable),
 * a seedbox and a plain server always over SSH (the user's quota, else the disk).
 */
export type ServerType = 'ULTRA' | 'SEEDBOX' | 'SSH';

export interface ServerTypeInfo {
  type: ServerType;
  label: string;
  /** What it is, on the type picker */
  description: string;
  /** How its free space is read */
  space: string;
  hostPlaceholder: string;
  folderPlaceholder: string;
  releasePlaceholder: string;
}

export const SERVER_TYPES: ServerTypeInfo[] = [
  {
    type: 'ULTRA',
    label: 'Ultra.cc',
    description: 'A slot with the Ultra-API storage script',
    space: 'Ultra-API, then SSH quota',
    hostPlaceholder: 'host.usbx.me',
    folderPlaceholder: '/home/username/media/movies',
    releasePlaceholder: 'downloads/qbittorrent',
  },
  {
    type: 'SEEDBOX',
    label: 'Other seedbox',
    description: 'Whatbox, Feral and others, over SSH',
    space: 'SSH quota, then disk',
    hostPlaceholder: 'server.provider.com',
    folderPlaceholder: '/home/username/files/movies',
    releasePlaceholder: 'files/releases',
  },
  {
    type: 'SSH',
    label: 'Plain server',
    description: 'A VPS, a NAS or a machine on the LAN with SSH',
    space: 'SSH disk (quota if any)',
    hostPlaceholder: '192.168.1.20',
    folderPlaceholder: '/mnt/media/movies',
    releasePlaceholder: 'releases',
  },
];

export const serverTypeInfo = (type: ServerType | undefined): ServerTypeInfo =>
  SERVER_TYPES.find((info) => info.type === type) ?? SERVER_TYPES[0];

/** The Ultra.cc release folder (qBittorrent's downloads on a slot) */
export const ULTRA_RELEASE_DIR = 'downloads/qbittorrent';

/** Ultra.cc: the SSH login and the Ultra-API endpoint from the username and the host (e.g. alice, zeus) */
export const ultraFields = (user: string, host: string) => {
  const u = user.trim();
  // "zeus", "zeus.usbx.me" or a pasted URL: the host's first label
  const h = host.trim().replace(/^https?:\/\//i, '').replace(/\.usbx\.me.*$/i, '').replace(/[/:].*$/, '');
  return {
    sshUsername: u,
    sshHost: h ? `${h}.usbx.me` : '',
    apiEndpoint: u && h ? `https://${u}.${h}.usbx.me/ultra-api/get_diskquota` : '',
  };
};

/** The username and the host back from a saved Ultra.cc server (blank when they do not follow the pattern) */
export const parseUltra = (server: { apiEndpoint?: string | null; sshHost?: string; sshUsername?: string }) => {
  const api = /^https?:\/\/([^./]+)\.([^./]+)\.usbx\.me\//i.exec(server.apiEndpoint ?? '');
  if (api) return { user: api[1], host: api[2] };
  const ssh = /^([^.]+)\.usbx\.me$/i.exec(server.sshHost ?? '');
  return { user: ssh ? (server.sshUsername ?? '') : '', host: ssh ? ssh[1] : '' };
};
