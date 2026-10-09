import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import { TorrentClient } from '@prisma/client';
import logger from '../config/logger.js';

export interface QbitTorrent {
  hash: string;
  name: string;
  category: string;
  tags: string;
  content_path: string;
  save_path: string;
  progress: number;
  state: string;
  size: number;
  completion_on: number;
}

const form = (data: Record<string, string>) => new URLSearchParams(data).toString();

/**
 * Minimal qBittorrent WebUI API v2 client.
 * Auth: API key (5.2+), or username/password (SID cookie), or none when the
 * WebUI bypasses authentication for this host (localhost / whitelisted subnet).
 */
export class QbitClient {
  private http: AxiosInstance;
  private sid: string | null = null;

  constructor(private client: TorrentClient) {
    this.http = axios.create({
      // Keeps a path prefix such as https://user.host.usbx.me/qbittorrent
      baseURL: client.url.replace(/\/+$/, ''),
      timeout: 10000,
      // No Referer/Origin header: qBittorrent's CSRF check only applies when one is sent
    });
  }

  private async login(): Promise<void> {
    const response = await this.http.post(
      '/api/v2/auth/login',
      form({ username: this.client.username ?? '', password: this.client.password ?? '' }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, validateStatus: () => true }
    );

    if (response.status === 403) {
      throw new Error('qBittorrent banned this IP after too many failed logins');
    }
    const cookie = ([] as string[])
      .concat(response.headers['set-cookie'] ?? [])
      .map((c) => /(?:^|;\s*)(SID|QBT_SID_\w+)=([^;]+)/.exec(c))
      .find(Boolean);
    // "Ok." without a cookie: auth is bypassed for this host
    if (!cookie && String(response.data).trim() !== 'Ok.') {
      throw new Error('qBittorrent login failed: wrong username or password');
    }
    this.sid = cookie ? `${cookie[1]}=${cookie[2]}` : null;
  }

  private async request<T>(config: AxiosRequestConfig): Promise<T> {
    const send = () =>
      this.http.request<T>({
        ...config,
        headers: {
          ...config.headers,
          ...(this.client.apiKey ? { Authorization: `Bearer ${this.client.apiKey}` } : {}),
          ...(this.sid ? { Cookie: this.sid } : {}),
        },
      });

    const hasLogin = Boolean(this.client.username) && !this.client.apiKey;
    if (hasLogin && !this.sid) await this.login();

    try {
      return (await send()).data;
    } catch (error) {
      // Session expired: log in again once
      if (hasLogin && axios.isAxiosError(error) && (error.response?.status === 401 || error.response?.status === 403)) {
        await this.login();
        return (await send()).data;
      }
      throw error;
    }
  }

  async getVersion(): Promise<string> {
    return String(await this.request<string>({ method: 'GET', url: '/api/v2/app/version', responseType: 'text' }));
  }

  /** Finished torrents (downloading ones are never touched), optionally in one category */
  async getCompletedTorrents(category?: string | null): Promise<QbitTorrent[]> {
    return this.request<QbitTorrent[]>({
      method: 'GET',
      url: '/api/v2/torrents/info',
      params: { filter: 'completed', ...(category ? { category } : {}) },
    });
  }

  async getTorrent(hash: string): Promise<QbitTorrent | null> {
    const torrents = await this.request<QbitTorrent[]>({
      method: 'GET',
      url: '/api/v2/torrents/info',
      params: { hashes: hash },
    });
    return torrents.find((t) => t.hash === hash) ?? null;
  }

  async deleteTorrent(hash: string, deleteFiles: boolean): Promise<void> {
    // Never pass "all" or a list: exactly one hash
    if (!/^[0-9a-f]{40}$|^[0-9a-f]{64}$/i.test(hash)) {
      throw new Error(`Invalid torrent hash: ${hash}`);
    }
    await this.request({
      method: 'POST',
      url: '/api/v2/torrents/delete',
      data: form({ hashes: hash, deleteFiles: String(deleteFiles) }),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    logger.info({ clientId: this.client.id, hash, deleteFiles }, 'Torrent removed from qBittorrent');
  }
}

// One client (and session cookie) per saved config; a config change makes a new one
const clients = new Map<string, { updatedAt: number; client: QbitClient }>();

export const getQbitClient = (client: TorrentClient): QbitClient => {
  const cached = clients.get(client.id);
  if (cached && cached.updatedAt === client.updatedAt.getTime()) return cached.client;
  const fresh = new QbitClient(client);
  clients.set(client.id, { updatedAt: client.updatedAt.getTime(), client: fresh });
  return fresh;
};

/** Error text safe to log/show: axios errors carry the request headers (cookie, API key) */
export const describeError = (error: unknown): string => {
  if (axios.isAxiosError(error)) {
    if (error.response) return `HTTP ${error.response.status}${error.response.status === 403 ? ' (not logged in)' : ''}`;
    return error.code ? `${error.code}: ${error.message}` : error.message;
  }
  return (error as Error).message;
};
