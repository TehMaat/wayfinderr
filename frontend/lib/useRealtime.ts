import { useEffect } from 'react';
import { toast } from 'sonner';
import { useAppStore } from './store';
import { getApiUrl } from './config';

const RECONNECT_DELAY_MS = 3000;

/**
 * Single WebSocket connection for the whole app (mounted once in the app shell).
 * Status events refetch the affected upload; progress events update it in place.
 */
export const useRealtime = () => {
  useEffect(() => {
    const wsUrl = getApiUrl().replace(/^http/, 'ws');
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let statsTimer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;
    let wasConnected = false;

    // Coalesce bursts of events into one stats/space refresh
    const scheduleStats = (withSpace = false) => {
      if (statsTimer) clearTimeout(statsTimer);
      statsTimer = setTimeout(() => {
        const store = useAppStore.getState();
        store.loadStats().catch(() => undefined);
        if (withSpace) store.loadSpace().catch(() => undefined);
      }, 800);
    };

    const nameOf = (uploadId: string) =>
      useAppStore.getState().uploads.find((u) => u.id === uploadId)?.filename ?? 'File';

    const connect = () => {
      ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        const store = useAppStore.getState();
        store.setConnected(true);
        // After a reconnect, catch up on anything missed
        if (wasConnected) store.loadAll();
        wasConnected = true;
      };

      ws.onmessage = async (event) => {
        const store = useAppStore.getState();
        const message = JSON.parse(event.data) as Record<string, unknown>;
        const uploadId = message.uploadId as string;

        switch (message.type) {
          case 'progress':
            store.applyProgress(uploadId, message.progress as number, Number(message.bytes));
            break;

          case 'upload-detected':
            await store.refreshUpload(uploadId);
            toast.info('New file detected', { description: message.filename as string });
            scheduleStats();
            break;

          case 'upload-queued':
          case 'upload-started':
            await store.refreshUpload(uploadId);
            scheduleStats();
            break;

          case 'upload-completed':
            await store.refreshUpload(uploadId);
            toast.success('Upload completed', { description: nameOf(uploadId) });
            scheduleStats(true);
            break;

          case 'upload-failed': {
            await store.refreshUpload(uploadId);
            const upload = useAppStore.getState().uploads.find((u) => u.id === uploadId);
            toast.error('Upload failed', { description: upload?.error ?? nameOf(uploadId) });
            scheduleStats();
            break;
          }

          case 'upload-skipped':
            await store.refreshUpload(uploadId);
            toast.warning('Skipped: no Italian audio or subtitles', { description: nameOf(uploadId) });
            scheduleStats();
            break;
        }
      };

      ws.onclose = () => {
        // A socket closed by the cleanup may close after its replacement has
        // opened (React dev mounts effects twice): it must not touch the state
        if (disposed) return;
        useAppStore.getState().setConnected(false);
        reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
      };
    };

    connect();

    return () => {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (statsTimer) clearTimeout(statsTimer);
      ws?.close();
    };
  }, []);
};
