import { useEffect, useRef, useCallback } from 'react';
import { useUploadsStore, useServersStore } from './store';

type MessageHandler = (data: Record<string, unknown>) => void;

export const useWebSocket = () => {
  const wsRef = useRef<WebSocket | null>(null);
  const uploadsStore = useUploadsStore();
  const serversStore = useServersStore();

  useEffect(() => {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
    const wsUrl = apiUrl.replace(/^http/, 'ws');

    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log('WebSocket connected');
    };

    ws.onmessage = (event) => {
      const message = JSON.parse(event.data) as Record<string, unknown>;

      switch (message.type) {
        case 'upload-detected':
          uploadsStore.addUpload({
            id: message.uploadId as string,
            filename: message.filename as string,
            size: BigInt(message.size as string),
            status: 'PENDING',
            progress: 0,
            hasItalianAudio: (message.mediaInfo as Record<string, unknown>).hasItalianAudio as boolean,
            hasItalianSubtitles: (message.mediaInfo as Record<string, unknown>).hasItalianSubtitles as boolean,
            createdAt: new Date().toISOString(),
          });
          break;

        case 'upload-queued':
          uploadsStore.updateUpload(message.uploadId as string, {
            status: 'QUEUED',
          });
          uploadsStore.setQueueSize(message.queueSize as number);
          break;

        case 'progress':
          uploadsStore.updateUpload(message.uploadId as string, {
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
      console.log('WebSocket disconnected, reconnecting in 3s...');
      setTimeout(() => {
        // Reconnection logic would go here
      }, 3000);
    };

    wsRef.current = ws;

    return () => {
      ws.close();
    };
  }, [uploadsStore, serversStore]);

  return wsRef.current;
};
