import { toast } from 'sonner';
import { clientsApi, serversApi, uploadsApi } from './api';
import { useAppStore } from './store';
import { errorMessage } from './utils';

export async function retryUpload(id: string) {
  try {
    await uploadsApi.retryUpload(id);
    await useAppStore.getState().refreshUpload(id);
    useAppStore.getState().loadStats().catch(() => undefined);
    toast.success('Upload queued again');
  } catch (err) {
    toast.error('Retry failed', { description: errorMessage(err) });
  }
}

export async function deleteUpload(id: string): Promise<boolean> {
  try {
    await uploadsApi.deleteUpload(id);
    useAppStore.getState().removeUpload(id);
    useAppStore.getState().loadStats().catch(() => undefined);
    toast.success('Removed from history');
    return true;
  } catch (err) {
    toast.error('Delete failed', { description: errorMessage(err) });
    return false;
  }
}

export async function testServer(id: string) {
  const name = useAppStore.getState().servers.find((s) => s.id === id)?.name ?? 'Server';
  const pending = toast.loading(`Testing ${name}…`, { description: 'Ultra.cc API and SSH/SFTP login' });
  try {
    const { data } = await serversApi.testServer(id);
    toast.success(`${name} is working`, { id: pending, description: `${data.freeSpaceGB} GB free` });
  } catch (err) {
    toast.error(`${name} test failed`, { id: pending, description: errorMessage(err) });
  } finally {
    useAppStore.getState().loadServers().catch(() => undefined);
  }
}

export async function refreshServerSpace(id: string) {
  try {
    await serversApi.refreshSpace(id);
    await useAppStore.getState().loadSpace();
  } catch (err) {
    toast.error('Could not refresh space', { description: errorMessage(err) });
  }
}

export async function deleteServer(id: string): Promise<boolean> {
  try {
    await serversApi.deleteServer(id);
    await useAppStore.getState().loadServers();
    toast.success('Server removed');
    return true;
  } catch (err) {
    toast.error('Delete failed', { description: errorMessage(err) });
    return false;
  }
}

export async function testClient(id: string) {
  const name = useAppStore.getState().clients.find((c) => c.id === id)?.name ?? 'Client';
  const pending = toast.loading(`Testing ${name}…`, { description: 'qBittorrent WebUI login' });
  try {
    const { data } = await clientsApi.testClient(id);
    toast.success(`${name} is working`, {
      id: pending,
      description: `qBittorrent ${data.version} · ${data.completedTorrents} finished torrents in scope`,
    });
  } catch (err) {
    toast.error(`${name} test failed`, { id: pending, description: errorMessage(err) });
  }
}

export async function deleteClient(id: string): Promise<boolean> {
  try {
    await clientsApi.deleteClient(id);
    await useAppStore.getState().loadClients();
    toast.success('Client removed');
    return true;
  } catch (err) {
    toast.error('Delete failed', { description: errorMessage(err) });
    return false;
  }
}

export async function checkTorrent(id: string) {
  const pending = toast.loading('Looking for the torrent…');
  try {
    await uploadsApi.checkTorrent(id);
    await useAppStore.getState().refreshUpload(id);
    toast.dismiss(pending);
  } catch (err) {
    toast.error('Torrent check failed', { id: pending, description: errorMessage(err) });
  }
}

export async function removeTorrent(id: string) {
  try {
    await uploadsApi.removeTorrent(id);
    await useAppStore.getState().refreshUpload(id);
    toast.success('Torrent removed from the client');
  } catch (err) {
    toast.error('Could not remove the torrent', { description: errorMessage(err) });
  }
}
