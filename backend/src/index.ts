import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { statSync } from 'fs';
import { config } from './config/index.js';
import logger from './config/logger.js';
import { db } from './services/database.js';
import { fileWatcher } from './services/fileWatcher.js';
import { mediaInfoParser } from './services/mediaInfo.js';
import { jobQueue } from './services/jobQueue.js';
import { uploadManager } from './services/uploadManager.js';
import serverRoutes from './routes/servers.js';
import uploadRoutes from './routes/uploads.js';
import spaceRoutes from './routes/space.js';
import systemRoutes from './routes/system.js';

// Prisma returns BigInt for sizes: serialize them as strings in JSON responses
(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function () {
  return this.toString();
};

const app = express();
const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer });

// Middleware
app.use(cors());
app.use(express.json());

// Logging middleware
app.use((req, res, next) => {
  logger.info({ method: req.method, path: req.path }, 'Request received');
  next();
});

// Routes
app.use('/api/servers', serverRoutes);
app.use('/api/uploads', uploadRoutes);
app.use('/api/space', spaceRoutes);
app.use('/api/system', systemRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', queue: jobQueue.getQueueSize() });
});

// WebSocket setup
wss.on('connection', (ws) => {
  logger.info({ clients: wss.clients.size }, 'WebSocket client connected');

  ws.on('close', () => {
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
