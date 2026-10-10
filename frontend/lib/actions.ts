import { toast } from 'sonner';
import { clientsApi, ripsApi, serversApi, uploadsApi } from './api';
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

export async function stopUpload(id: string) {
  try {
    const { data } = await uploadsApi.cancelUpload(id);
    await useAppStore.getState().refreshUpload(id);
    useAppStore.getState().loadStats().catch(() => undefined);
    if (data.status === 'CANCELLED') toast.success('Upload stopped');
    else if (data.status === 'COMPLETED') toast.info('The upload finished before it could be stopped');
    else toast.info('Stopping the upload…');
  } catch (err) {
    toast.error('Stop failed', { description: errorMessage(err) });
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

export async function retryRip(id: string) {
  try {
    const { data } = await ripsApi.retryRip(id);
    await useAppStore.getState().refreshRip(id);
    // An archive not unpacked yet is read again; once unpacked, its disc is scanned again
    const again =
      data.status === 'JOINING'
        ? 'The ripped parts are joined again'
        : data.sourceType === 'RAR' && !data.unpackedTo
          ? 'The archive is read and unpacked again'
          : 'The disc is scanned again';
    toast.success('Rip queued again', { description: again });
  } catch (err) {
    toast.error('Retry failed', { description: errorMessage(err) });
  }
}

export async function remuxRip(id: string) {
  try {
    await ripsApi.remuxRip(id);
    await useAppStore.getState().refreshRip(id);
    toast.success('Ripping without MakeMKV', { description: 'The disc is read again with mkvmerge or ffmpeg' });
  } catch (err) {
    toast.error('Rip without MakeMKV failed', { description: errorMessage(err) });
  }
}

export async function ripAgain(id: string) {
  try {
    const { data } = await ripsApi.ripAgain(id);
    await useAppStore.getState().loadRips();
    toast.success('Ripping the film again', {
      description: data.joinId ? 'Every disc is ripped and joined again' : 'Same film and title, with the current settings',
    });
  } catch (err) {
    toast.error('Rip again failed', { description: errorMessage(err) });
  }
}

export async function skipRip(id: string) {
  try {
    await ripsApi.skipRip(id);
    await useAppStore.getState().refreshRip(id);
    toast.success('Rip skipped');
  } catch (err) {
    toast.error('Skip failed', { description: errorMessage(err) });
  }
}

export async function removeRip(id: string) {
  try {
    await ripsApi.removeRip(id);
    useAppStore.getState().removeRip(id);
    toast.success('Removed from the list');
  } catch (err) {
    toast.error('Remove failed', { description: errorMessage(err) });
  }
}

export async function clearSkippedRips() {
  try {
    const { data } = await ripsApi.clearSkippedRips();
    await useAppStore.getState().loadRips();
    toast.success(data.removed === 1 ? '1 skipped rip removed' : `${data.removed} skipped rips removed`);
  } catch (err) {
    toast.error('Remove failed', { description: errorMessage(err) });
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
