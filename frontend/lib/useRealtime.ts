import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { useAppStore, type RipStatus } from './store';
import { checkSession } from './api';
import { useAuthStore } from './auth';
import { getWsUrl } from './config';
import { ripName } from './rips';

const RECONNECT_DELAY_MS = 3000;
const SESSION_REVOKED = 4401; // close code sent by the backend

/**
 * Single WebSocket connection for the whole app (mounted once in the app shell).
 * Status events refetch the affected upload or rip; progress events update it in place.
 */
export const useRealtime = () => {
  // The toasts outlive renders: keep the latest router for their actions
  const router = useRouter();
  const routerRef = useRef(router);
  routerRef.current = router;

  useEffect(() => {
    const wsUrl = getWsUrl();
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

    // Toast on a rip's change of status (the same status sent again is not news)
    const onRipUpdated = async (ripId: string, status: RipStatus | 'DELETED') => {
      const store = useAppStore.getState();
      if (status === 'DELETED') {
        store.removeRip(ripId);
        return;
      }
      const previous = store.rips.find((r) => r.id === ripId)?.status;
      await store.refreshRip(ripId);
      if (previous === status) return;

      const rip = useAppStore.getState().rips.find((r) => r.id === ripId);
      const name = rip ? ripName(rip) : 'Disc';
      if (status === 'NEEDS_ATTENTION') {
        toast.warning('Rip needs a choice', {
          description: name,
          duration: 15_000,
          action: { label: 'Choose', onClick: () => routerRef.current.push('/rips') },
        });
      } else if (status === 'DONE') {
        toast.success('Rip completed', { description: name });
      } else if (status === 'FAILED') {
        toast.error('Rip failed', { description: rip?.reason ? `${name}: ${rip.reason}` : name });
      }
    };

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

          case 'upload-cancelled':
            await store.refreshUpload(uploadId);
            scheduleStats(true);
            break;

          case 'upload-skipped':
            await store.refreshUpload(uploadId);
            toast.warning('Skipped: no Italian audio or subtitles', { description: nameOf(uploadId) });
            scheduleStats();
            break;

          case 'rip-progress':
            store.applyRipProgress(message.ripId as string, message.progress as number);
            break;

          case 'rip-updated':
            await onRipUpdated(message.ripId as string, message.status as RipStatus | 'DELETED');
            break;
        }
      };

      ws.onclose = (event) => {
        // A socket closed by the cleanup may close after its replacement has
        // opened (React dev mounts effects twice): it must not touch the state
        if (disposed) return;
        useAppStore.getState().setConnected(false);
        // Session revoked or expired: the login screen if it was this page's,
        // otherwise (password just changed here) reconnect with the new cookie
        if (event.code === SESSION_REVOKED) {
          checkSession().then(() => {
            if (!disposed && useAuthStore.getState().status === 'ready') connect();
          });
          return;
        }
        reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
      };
    };

    connect();

    return () => {
      disposed = true;
      useAppStore.getState().setConnected(false);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (statsTimer) clearTimeout(statsTimer);
      ws?.close();
    };
  }, []);
};
