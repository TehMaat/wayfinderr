# API Documentation

Complete REST API reference for Wayfinderr backend.

## Base URL

```
http://localhost:3001
```

Production deployments should use HTTPS.

## Authentication

Current version has no authentication. For production, consider adding:
- JWT tokens
- API keys
- OAuth2

## Servers API

### List All Servers

```
GET /api/servers
```

**Response:**
```json
[
  {
    "id": "cuid123",
    "name": "Server 1",
    "apiEndpoint": "https://user.host.usbx.me/ultra-api/get_diskquota",
    "apiToken": "token***",
    "sshHost": "host.usbx.me",
    "sshPort": 22,
    "sshUsername": "user",
    "maxRetries": 3,
    "backoffStrategy": "exponential",
    "lastSpaceCheckAt": "2026-10-04T15:30:00Z",
    "createdAt": "2026-10-04T10:00:00Z"
  }
]
```

### Create Server

```
POST /api/servers
Content-Type: application/json

{
  "name": "Server 1",
  "apiEndpoint": "https://user.host.usbx.me/ultra-api/get_diskquota",
  "apiToken": "your-token",
  "sshHost": "host.usbx.me",
  "sshPort": 22,
  "sshUsername": "user",
  "maxRetries": 3,
  "backoffStrategy": "exponential"
}
```

**Response:** 201 Created
```json
{
  "id": "cuid123",
  "name": "Server 1",
  ...
}
```

### Update Server

```
PUT /api/servers/:id
Content-Type: application/json

{
  "name": "Server 1 Updated",
  "maxRetries": 5
}
```

**Response:** 200 OK

### Delete Server

```
DELETE /api/servers/:id
```

**Response:** 204 No Content

### Test Server Connection

```
POST /api/servers/:id/test
```

Tests SSH connectivity and API access.

**Response:** 200 OK
```json
{
  "status": "connected",
  "sshOk": true,
  "apiOk": true
}
```

## Space API

### Get All Server Spaces

```
GET /api/space
```

Returns current free space for all servers (cached).

**Response:**
```json
[
  {
    "id": "cuid123",
    "name": "Server 1",
    "freeSpaceBytes": "1234567890",
    "freeSpaceGB": "1234.56",
    "lastSpaceCheckAt": "2026-10-04T15:30:00Z"
  }
]
```

### Get Single Server Space

```
GET /api/space/:id
```

**Response:** 200 OK
```json
{
  "id": "cuid123",
  "name": "Server 1",
  "freeSpaceBytes": "1234567890",
  "freeSpaceGB": "1234.56"
}
```

### Refresh Server Space

```
POST /api/space/:id/refresh
```

Bypass cache and fetch fresh space info.

**Response:** 200 OK
```json
{
  "freeSpaceBytes": "1234567890",
  "freeSpaceGB": "1234.56",
  "cachedAt": "2026-10-04T15:35:00Z"
}
```

## Uploads API

### List Uploads

```
GET /api/uploads?limit=50&offset=0&status=COMPLETED
```

**Query Parameters:**
- `limit`: Max results (default 50)
- `offset`: Pagination offset (default 0)
- `status`: Filter by status (PENDING, QUEUED, UPLOADING, COMPLETED, FAILED, SKIPPED, CANCELLED)
- `serverId`: Filter by server

**Response:**
```json
[
  {
    "id": "upload123",
    "filename": "movie.mkv",
    "size": "1073741824",
    "status": "COMPLETED",
    "progress": 100,
    "hasItalianAudio": true,
    "hasItalianSubtitles": false,
    "serverId": "server123",
    "error": null,
    "createdAt": "2026-10-04T10:00:00Z",
    "completedAt": "2026-10-04T10:30:00Z"
  }
]
```

### Get Upload Details

```
GET /api/uploads/:id
```

**Response:**
```json
{
  "id": "upload123",
  "filename": "movie.mkv",
  "filepath": "/makemkv-output/movie.mkv",
  "size": "1073741824",
  "status": "COMPLETED",
  "progress": 100,
  "progressBytes": "1073741824",
  "hasItalianAudio": true,
  "hasItalianSubtitles": true,
  "mediaInfo": {
    "audioTracks": [
      { "language": "ita", "codec": "aac" }
    ],
    "subtitles": [
      { "language": "ita", "codec": "subrip" }
    ]
  },
  "serverId": "server123",
  "currentRetryCount": 0,
  "retryStrategy": "exponential",
  "error": null,
  "startedAt": "2026-10-04T10:05:00Z",
  "completedAt": "2026-10-04T10:30:00Z",
  "createdAt": "2026-10-04T10:00:00Z"
}
```

### Retry Failed Upload

```
POST /api/uploads/:id/retry
```

Re-enqueue a failed, skipped or stopped upload.

**Response:** 200 OK
```json
{
  "status": "QUEUED",
  "message": "Upload queued for retry"
}
```

### Stop Upload

```
POST /api/uploads/:id/cancel
```

Stop a `QUEUED` or `UPLOADING` upload. A queued upload is removed from the queue;
a running transfer is interrupted and the partial `.<filename>.part` file on the
server is deleted. The upload becomes `CANCELLED` and can be started again with
`/retry`.

The request waits for the transfer to stop (up to 10 seconds) and returns the
upload. Its `status` is `CANCELLED`, or `COMPLETED` if the transfer finished
before it could be stopped.

**Response:** 200 OK (the upload), 409 if the upload is not queued or uploading

## WebSocket

### Connect

```javascript
const ws = new WebSocket('ws://localhost:3001/ws/uploads');
```

### Events

#### upload-detected
New file detected in watch directory.
```json
{
  "type": "upload-detected",
  "data": {
    "id": "upload123",
    "filename": "movie.mkv",
    "size": "1073741824"
  }
}
```

#### upload-queued
Upload added to queue.
```json
{
  "type": "upload-queued",
  "data": {
    "uploadId": "upload123",
    "position": 1
  }
}
```

#### progress
Upload progress update.
```json
{
  "type": "progress",
  "data": {
    "uploadId": "upload123",
    "progress": 45,
    "progressBytes": "500000000",
    "speed": "5.2 MB/s"
  }
}
```

#### upload-completed
Upload finished successfully.
```json
{
  "type": "upload-completed",
  "data": {
    "uploadId": "upload123",
    "serverId": "server123",
    "completedAt": "2026-10-04T10:30:00Z"
  }
}
```

#### upload-failed
Upload failed.
```json
{
  "type": "upload-failed",
  "data": {
    "uploadId": "upload123",
    "error": "SSH connection timeout",
    "retryCount": 0
  }
}
```

#### upload-skipped
Upload skipped (no Italian content).
```json
{
  "type": "upload-skipped",
  "data": {
    "uploadId": "upload123",
    "reason": "No Italian audio or subtitles"
  }
}
```

#### upload-cancelled
Upload stopped by the user.
```json
{
  "type": "upload-cancelled",
  "uploadId": "upload123"
}
```

## Error Responses

### 400 Bad Request

```json
{
  "error": "Invalid request parameters",
  "details": "Name is required"
}
```

### 404 Not Found

```json
{
  "error": "Server not found"
}
```

### 500 Internal Server Error

```json
{
  "error": "Internal server error",
  "message": "Database connection failed"
}
```

## Status Codes

| Code | Meaning |
|------|---------|
| 200 | Success |
| 201 | Created |
| 204 | No Content |
| 400 | Bad Request |
| 404 | Not Found |
| 500 | Server Error |

## Rate Limiting

Currently no rate limiting. Consider implementing for production.

## Pagination

Use `limit` and `offset` query parameters:

```
GET /api/uploads?limit=20&offset=40
```

Returns records 40-59 (20 records per page).

## Examples

### cURL

```bash
# List servers
curl http://localhost:3001/api/servers

# Create server
curl -X POST http://localhost:3001/api/servers \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Server 1",
    "apiEndpoint": "https://user.host.usbx.me/ultra-api/get_diskquota",
    "apiToken": "token123",
    "sshHost": "host.usbx.me",
    "sshPort": 22,
    "sshUsername": "user"
  }'

# Get uploads
curl http://localhost:3001/api/uploads?limit=10

# Retry upload
curl -X POST http://localhost:3001/api/uploads/upload123/retry

# Stop upload
curl -X POST http://localhost:3001/api/uploads/upload123/cancel
```

### JavaScript/Fetch

```javascript
// List servers
const servers = await fetch('http://localhost:3001/api/servers')
  .then(r => r.json());

// Get space info
const space = await fetch('http://localhost:3001/api/space')
  .then(r => r.json());

// WebSocket listener
const ws = new WebSocket('ws://localhost:3001/ws/uploads');
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  console.log('Upload event:', msg.type, msg.data);
};
```

## Versioning

No API versioning currently. Future versions may introduce `/api/v2/` etc.
