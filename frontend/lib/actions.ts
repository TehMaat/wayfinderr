import { toast } from 'sonner';
import { clientsApi, releaseApi, ripsApi, serversApi, uploadsApi } from './api';
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

/** Several uploads removed from the history at once */
export async function deleteUploads(ids: string[]) {
  const results = await Promise.allSettled(ids.map((id) => uploadsApi.deleteUpload(id)));
  const failed: string[] = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') useAppStore.getState().removeUpload(ids[i]);
    else failed.push(errorMessage(r.reason));
  });
  useAppStore.getState().loadStats().catch(() => undefined);
  const removed = ids.length - failed.length;
  if (failed.length === 0) {
    toast.success(removed === 1 ? '1 upload removed from history' : `${removed} uploads removed from history`);
  } else {
    toast.error(`${failed.length} of ${ids.length} uploads not removed`, { description: [...new Set(failed)].join(' · ') });
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

/** Several skipped rips removed from the list at once */
export async function removeRips(ids: string[]) {
  const results = await Promise.allSettled(ids.map((id) => ripsApi.removeRip(id)));
  const failed: string[] = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') useAppStore.getState().removeRip(ids[i]);
    else failed.push(errorMessage(r.reason));
  });
  const removed = ids.length - failed.length;
  if (failed.length === 0) {
    toast.success(removed === 1 ? '1 rip removed from the list' : `${removed} rips removed from the list`);
  } else {
    toast.error(`${failed.length} of ${ids.length} rips not removed`, { description: [...new Set(failed)].join(' · ') });
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
      description: `qBittorrent ${data.version} · ${data.completedTorrents} finished torrents in scope${
        data.localRelease ? ' · local release: SSH and folders OK' : ''
      }`,
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

/** The source .torrent of a torrent removed before its tracker was kept */
export async function addTorrentFile(id: string, file: File) {
  try {
    const { data } = await uploadsApi.addTorrentFile(id, file);
    await useAppStore.getState().refreshUpload(id);
    toast.success('Source torrent added', { description: [data.torrentName, data.torrentTracker].filter(Boolean).join(' · ') || undefined });
  } catch (err) {
    toast.error(`${file.name} not added`, { description: errorMessage(err) });
  }
}

/** Several source .torrents at once: each goes to the removed source torrents with its info hash */
export async function importTorrentFiles(files: File[]) {
  const pending = toast.loading(`Reading ${files.length} .torrent ${files.length === 1 ? 'file' : 'files'}…`);
  const updated = new Set<string>();
  const failed: string[] = [];
  for (const file of files) {
    try {
      const { data } = await uploadsApi.importTorrentFile(file);
      data.uploadIds.forEach((id) => updated.add(id));
    } catch (err) {
      failed.push(`${file.name}: ${errorMessage(err)}`);
    }
  }
  await Promise.all([...updated].map((id) => useAppStore.getState().refreshUpload(id)));
  const summary = `Source tracker added to ${updated.size} ${updated.size === 1 ? 'upload' : 'uploads'}`;
  if (failed.length === 0) {
    toast.success(summary, { id: pending });
  } else {
    // The files that matched no removed source torrent, or are no .torrent
    const shown = failed.slice(0, 5).join(' · ') + (failed.length > 5 ? ` · and ${failed.length - 5} more` : '');
    toast.warning(`${summary}, ${failed.length} not used`, { id: pending, description: shown, duration: 20_000 });
  }
}

// Release: the tracker command on the renamed file (see the rename dialog for the rename)
export async function runRelease(id: string) {
  try {
    const { data } = await releaseApi.run(id);
    await useAppStore.getState().refreshUpload(id);
    // Its .torrent already made: the message says it does not wait for the queue
    toast.success('Tracker upload queued', { description: data.releaseMessage ?? undefined });
  } catch (err) {
    toast.error('Tracker upload failed to start', { description: errorMessage(err) });
  }
}

export async function stopRelease(id: string) {
  try {
    await releaseApi.stop(id);
    await useAppStore.getState().refreshUpload(id);
    toast.info('Stopping the tracker upload…');
  } catch (err) {
    toast.error('Stop failed', { description: errorMessage(err) });
  }
}

export async function answerRelease(id: string, text: string): Promise<boolean> {
  try {
    await releaseApi.answer(id, text);
    await useAppStore.getState().refreshUpload(id);
    return true;
  } catch (err) {
    toast.error('Answer not sent', { description: errorMessage(err) });
    return false;
  }
}

export async function dismissRelease(id: string) {
  try {
    await releaseApi.dismiss(id);
    await useAppStore.getState().refreshUpload(id);
  } catch (err) {
    toast.error('Failed', { description: errorMessage(err) });
  }
}

export async function linkRelease(id: string) {
  const pending = toast.loading('Looking for the file and its .torrent on the server…');
  try {
    const { data } = await releaseApi.link(id);
    toast.success('Release linked', { id: pending, description: data.releaseMessage ?? undefined });
  } catch (err) {
    toast.error('Link failed', { id: pending, description: errorMessage(err) });
  } finally {
    await useAppStore.getState().refreshUpload(id);
  }
}

export async function addReleaseTorrent(id: string, file: File) {
  try {
    const { data } = await releaseApi.addTorrent(id, file);
    toast.success('.torrent added', { description: data.releaseTorrentName ?? file.name });
  } catch (err) {
    toast.error('Could not add the .torrent', { description: errorMessage(err) });
  } finally {
    await useAppStore.getState().refreshUpload(id);
  }
}
