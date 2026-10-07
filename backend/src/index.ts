import express from 'express';
import { createServer, IncomingMessage } from 'http';
import { Duplex } from 'stream';
import { WebSocketServer } from 'ws';
import { statSync } from 'fs';
import { config } from './config/index.js';
import logger from './config/logger.js';
import { db } from './services/database.js';
import { fileWatcher } from './services/fileWatcher.js';
import { mediaInfoParser } from './services/mediaInfo.js';
import { jobQueue } from './services/jobQueue.js';
import { uploadManager } from './services/uploadManager.js';
import { authEvents, authenticate, ensureSetupCode, getAccount } from './services/auth.js';
import { isCrossSite, requireAuth, securityMiddleware } from './middleware/security.js';
import authRoutes from './routes/auth.js';
import serverRoutes from './routes/servers.js';
import uploadRoutes from './routes/uploads.js';
import spaceRoutes from './routes/space.js';

// Prisma returns BigInt for sizes: serialize them as strings in JSON responses
(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function () {
  return this.toString();
};

const app = express();
const httpServer = createServer(app);
const wss = new WebSocketServer({ noServer: true });

// The browser reaches the backend only through the frontend proxy (and maybe a
// reverse proxy before it): trust the client address and protocol it forwards
app.set('trust proxy', 1);
app.disable('x-powered-by');

// Logging middleware
app.use((req, res, next) => {
  logger.info({ method: req.method, path: req.path }, 'Request received');
  next();
});

// Middleware: cross-site requests are refused before their body is even read
app.use(securityMiddleware);
app.use(express.json());

// Routes: everything under /api needs a login, except /api/auth itself
app.use('/api/auth', authRoutes);
app.use('/api', requireAuth);
app.use('/api/servers', serverRoutes);
app.use('/api/uploads', uploadRoutes);
app.use('/api/space', spaceRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', queue: jobQueue.getQueueSize() });
});

// Errors not handled by the routes (e.g. malformed JSON): a fixed message, never
// the error's own text or a stack trace
const ERROR_MESSAGES: Record<string, string> = {
  'entity.parse.failed': 'Invalid JSON',
  'entity.too.large': 'Request too large',
};
app.use(
  (error: Error & { status?: number; type?: string }, req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (res.headersSent) return next(error);
    const status = error.status && error.status < 500 ? error.status : 500;
    if (status === 500) logger.error(error, 'Request failed');
    const message = status === 500 ? 'Internal server error' : ERROR_MESSAGES[error.type ?? ''] ?? 'Bad request';
    res.status(status).json({ error: message });
  }
);

// WebSocket on /ws, for logged-in pages of this site only
const rejectUpgrade = (socket: Duplex, status: string) => {
  socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
};

httpServer.on('upgrade', async (req, socket, head) => {
  // A client that drops the connection mid-check must not crash the process
  socket.on('error', () => socket.destroy());
  try {
    if (new URL(req.url ?? '/', 'http://localhost').pathname !== '/ws') {
      rejectUpgrade(socket, '404 Not Found');
      return;
    }
    if (isCrossSite(req.headers)) {
      rejectUpgrade(socket, '403 Forbidden');
      return;
    }
    if (!(await authenticate(req.headers))) {
      rejectUpgrade(socket, '401 Unauthorized');
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  } catch (error) {
    logger.error(error, 'WebSocket upgrade failed');
    rejectUpgrade(socket, '500 Internal Server Error');
  }
});

// Password changed or "sign out everywhere": open sockets end too (the page
// then checks its session and shows the login)
authEvents.on('revoked', () => {
  wss.clients.forEach((client) => client.close(4401, 'Session revoked'));
});

wss.on('connection', (ws, req: IncomingMessage) => {
  logger.info({ clients: wss.clients.size }, 'WebSocket client connected');

  // Every 30s: ping, since reverse proxies and tunnels drop idle connections
  // (a client that missed the previous pong is gone), and check the session
  // again, since it may have expired or been revoked by `reset-auth`
  let alive = true;
  ws.on('pong', () => (alive = true));
  const heartbeat = setInterval(() => {
    if (!alive) {
      ws.terminate();
      return;
    }
    alive = false;
    ws.ping();
    authenticate(req.headers)
      .then((username) => {
        if (!username) ws.close(4401, 'Session ended');
      })
      .catch(() => undefined);
  }, 30_000);

  ws.on('close', () => {
    clearInterval(heartbeat);
    logger.info({ clients: wss.clients.size }, 'WebSocket client disconnected');
  });

  ws.on('error', (error) => {
    logger.error(error, 'WebSocket error');
  });
});

// Broadcast helper
export const broadcast = (message: Record<string, unknown>) => {
  wss.clients.forEach((client) => {
    if (client.readyState === 1) {
      // WebSocket.OPEN
      client.send(JSON.stringify(message));
    }
  });
};

// JobQueue event listeners
jobQueue.on('progress', ({ uploadId, progress, bytes }) => {
  broadcast({
    type: 'progress',
    uploadId,
    progress,
    bytes: bytes.toString(),
  });
});

jobQueue.on('upload-started', ({ uploadId, serverId }) => {
  broadcast({
    type: 'upload-started',
    uploadId,
    serverId,
  });
});

jobQueue.on('upload-completed', ({ uploadId }) => {
  broadcast({
    type: 'upload-completed',
    uploadId,
  });
});

jobQueue.on('upload-failed', ({ uploadId }) => {
  broadcast({
    type: 'upload-failed',
    uploadId,
  });
});

jobQueue.on('upload-skipped', ({ uploadId }) => {
  broadcast({
    type: 'upload-skipped',
    uploadId,
  });
});

// File watcher event handler
fileWatcher.on('file-detected', async (event) => {
  let uploadId: string | null = null;
  try {
    logger.info(event, 'Processing detected file');

    // Get file size
    const fileSize = BigInt(statSync(event.filepath).size);

    // Create upload record
    const upload = await db.createUpload({
      filename: event.filename,
      filepath: event.filepath,
      size: fileSize,
      status: 'PENDING',
    });
    uploadId = upload.id;

    // Parse media info
    const mediaInfo = await mediaInfoParser.parseFile(event.filepath);

    // Update upload with media info
    await db.updateUpload(upload.id, {
      mediaInfo: JSON.stringify(mediaInfo),
      hasItalianAudio: mediaInfo.hasItalianAudio,
      hasItalianSubtitles: mediaInfo.hasItalianSubtitles,
    });

    logger.info(
      { uploadId: upload.id, mediaInfo, size: fileSize.toString() },
      'Upload created and media info stored'
    );

    // Broadcast to frontend via WebSocket
    broadcast({
      type: 'upload-detected',
      uploadId: upload.id,
      filename: event.filename,
      mediaInfo,
      size: fileSize.toString(),
    });

    // Enqueue for upload
    await jobQueue.enqueueUpload({
      uploadId: upload.id,
      filepath: event.filepath,
    });

    broadcast({
      type: 'upload-queued',
      uploadId: upload.id,
      queueSize: jobQueue.getQueueSize(),
    });
  } catch (error) {
    logger.error({ event, error }, 'Failed to process detected file');
    if (uploadId) {
      await db
        .updateUpload(uploadId, { status: 'FAILED', error: (error as Error).message })
        .catch(() => undefined);
      broadcast({ type: 'upload-failed', uploadId });
    }
  }
});

// Error handling
fileWatcher.on('error', (error) => {
  logger.error(error, 'File watcher error');
});

// Graceful shutdown
const shutdown = async (signal: string) => {
  logger.info({ signal }, 'Received shutdown signal');

  try {
    // Stop accepting new jobs
    jobQueue.pause();

    // Close file watcher
    await fileWatcher.stop();

    // Close SSH connections
    uploadManager.close();

    // Close the browsers' WebSockets, or the HTTP server would wait for them
    wss.clients.forEach((client) => client.close(1001, 'Server shutting down'));

    // Close database
    await db.disconnect();

    // Close HTTP server
    httpServer.close(() => {
      logger.info('HTTP server closed');
      process.exit(0);
    });

    // Force exit after 30 seconds
    setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, 30000);
  } catch (error) {
    logger.error(error, 'Error during shutdown');
    process.exit(1);
  }
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Start server
const startServer = async () => {
  try {
    // Without an account everything is closed until it is created with this code
    if (!(await getAccount())) ensureSetupCode();

    // Resume uploads left unfinished by a previous run
    await jobQueue.resumePending();

    // Start file watcher
    fileWatcher.start();

    // Start HTTP server
    httpServer.listen(config.PORT, () => {
      logger.info(
        { port: config.PORT, env: config.NODE_ENV },
        'Server started successfully'
      );
    });
  } catch (error) {
    logger.error(error, 'Failed to start server');
    process.exit(1);
  }
};

startServer();
