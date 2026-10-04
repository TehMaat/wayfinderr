import { useEffect, useRef } from 'react';
import { useUploadsStore } from './store';
import { getApiUrl } from './config';

const RECONNECT_DELAY_MS = 3000;

export const useWebSocket = () => {
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const wsUrl = getApiUrl().replace(/^http/, 'ws');
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    const connect = () => {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('WebSocket connected');
      };

      ws.onmessage = (event) => {
        // Read the store at message time: subscribing to it here would
        // re-run this effect (and reconnect) on every store change
        const uploadsStore = useUploadsStore.getState();
        const message = JSON.parse(event.data) as Record<string, unknown>;

        switch (message.type) {
          case 'upload-detected': {
            const mediaInfo = (message.mediaInfo ?? {}) as Record<string, unknown>;
            uploadsStore.addUpload({
              id: message.uploadId as string,
              filename: message.filename as string,
              size: message.size as string,
              status: 'PENDING',
              progress: 0,
              hasItalianAudio: Boolean(mediaInfo.hasItalianAudio),
              hasItalianSubtitles: Boolean(mediaInfo.hasItalianSubtitles),
              createdAt: new Date().toISOString(),
            });
            break;
          }

          case 'upload-queued':
            uploadsStore.updateUpload(message.uploadId as string, {
              status: 'QUEUED',
            });
            uploadsStore.setQueueSize(message.queueSize as number);
            break;

          case 'progress':
            uploadsStore.updateUpload(message.uploadId as string, {
              status: 'UPLOADING',
              progress: message.progress as number,
            });
            break;

          case 'upload-completed':
            uploadsStore.updateUpload(message.uploadId as string, {
              status: 'COMPLETED',
              progress: 100,
              completedAt: new Date().toISOString(),
            });
            break;

          case 'upload-failed':
            uploadsStore.updateUpload(message.uploadId as string, {
              status: 'FAILED',
            });
            break;

          case 'upload-skipped':
            uploadsStore.updateUpload(message.uploadId as string, {
              status: 'SKIPPED',
            });
            break;
        }
      };

      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
      };

      ws.onclose = () => {
        if (disposed) return;
        console.log(`WebSocket disconnected, reconnecting in ${RECONNECT_DELAY_MS / 1000}s...`);
        reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
      };
    };

    connect();

    return () => {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      wsRef.current?.close();
    };
  }, []);

  return wsRef.current;
};
