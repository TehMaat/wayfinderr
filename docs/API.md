# API Documentation

Complete REST API reference for Wayfinderr backend.

## Base URL

```
http://localhost:3000
```

The frontend address: it proxies `/api`, `/health` and `/ws` to the backend, which is not published (in a local run it listens on `http://localhost:3001`). Behind a reverse proxy use its HTTPS address, e.g. `https://wayfinderr.example.com`.

`GET /health` needs no login: `{"status": "ok", "queue": 0}`.

## Authentication

One account, created on first access with the setup code from the backend log. Setup and login set the session cookie `wayfinderr_session`: HttpOnly, SameSite=Lax, `Secure` on HTTPS, valid 30 days. Every `/api` route except `/api/auth/*` needs it:

| Status | `code` | When |
|--------|--------|------|
| 401 | `auth_setup_required` | The account does not exist yet (or was deleted with `reset-auth`) |
| 401 | `auth_required` | No cookie, or a session that expired or was revoked (password changed, sign out everywhere) |

**Cross-site requests.** POST, PUT, PATCH and DELETE on any route, and the WebSocket, are refused with 403 `cross_site_request` when the browser marks them as coming from another site: `Sec-Fetch-Site` other than `same-origin`/`none` or, without it, an `Origin` whose host differs from the page's host. curl and scripts send neither header and pass.

Auth errors carry a `code` next to the message:

```json
{ "error": "Wrong username or password", "code": "auth_invalid_credentials" }
```

### Status

```
GET /api/auth/status
```

**Response:** 200 OK (`username` is `null` without a valid session)
```json
{ "configured": true, "username": "admin" }
```

While there is no account, this also prints the setup code in the backend log if it is not there yet (e.g. after `reset-auth`).

### Create the Account

```
POST /api/auth/setup
Content-Type: application/json

{ "setupCode": "code-from-the-log", "username": "admin", "password": "at-least-8-chars" }
```

**Response:** 201 Created, with the session cookie
```json
{ "username": "admin" }
```

| Status | `code` | When |
|--------|--------|------|
| 400 | `auth_invalid_input` | Username missing or over 256 characters; password under 8 or over 256 characters |
| 403 | `auth_setup_code_invalid` | Wrong setup code |
| 409 | `auth_already_configured` | The account already exists |
| 429 | `auth_too_many_attempts` | See [Rate Limiting](#rate-limiting) |

### Login

```
POST /api/auth/login
Content-Type: application/json

{ "username": "admin", "password": "your-password" }
```

**Response:** 200 OK, with the session cookie
```json
{ "username": "admin" }
```

Errors: 401 `auth_invalid_credentials`, 401 `auth_setup_required` (no account: deleted with `reset-auth`), 429 `auth_too_many_attempts`.

### Logout

```
POST /api/auth/logout
```

**Response:** 204 No Content. Clears the cookie of this client only.

### Change Password

```
POST /api/auth/change-password
Content-Type: application/json

{ "currentPassword": "your-password", "newPassword": "at-least-8-chars" }
```

Needs a session. **Response:** 204 No Content, with a new cookie: this session continues, every other one is signed out.

Errors: 400 `auth_wrong_current_password`, 400 `auth_invalid_input`, 401, 429 `auth_too_many_attempts`.

### Sign Out Everywhere

```
POST /api/auth/logout-everywhere
```

Needs a session. **Response:** 204 No Content. Every session ends, this one included, and the cookie is cleared.

## Servers API

### List All Servers

```
GET /api/servers
```

The API token and the SSH password are never returned: `hasApiToken` and `hasSshPassword` say whether one is saved.

**Response:**
```json
[
  {
    "id": "cuid123",
    "name": "Server 1",
    "apiEndpoint": "https://user.host.usbx.me/ultra-api/get_diskquota",
    "hasApiToken": true,
    "hasSshPassword": false,
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

Fields left out or blank keep their saved value (so a blank `apiToken` or `sshPassword` keeps the current one).

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
- `status`: Filter by status (PENDING, QUEUED, UPLOADING, COMPLETED, FAILED, SKIPPED)
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

Re-enqueue a failed upload for retry.

**Response:** 200 OK
```json
{
  "status": "QUEUED",
  "message": "Upload queued for retry"
}
```

## WebSocket

### Connect

```javascript
const ws = new WebSocket('ws://localhost:3000/ws'); // wss://<domain>/ws behind HTTPS
```

Only on `/ws`, from a page of the same site with a valid session cookie. The upgrade is refused with 404 on another path, 403 for a cross-site page and 401 without a valid session. The server pings every 30 seconds and drops clients that stop answering. When the password changes or every session is signed out, open connections are closed with code `4401`; the same happens within 30 seconds when the session expires or the account is deleted with `reset-auth`.

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

## Error Responses

Errors are JSON with a fixed `error` message (auth and security errors also have a `code`). Details of internal errors stay in the backend log.

### 400 Bad Request

```json
{
  "error": "Missing required fields"
}
```

### 401 Unauthorized

```json
{
  "error": "Login required",
  "code": "auth_required"
}
```

### 403 Forbidden

```json
{
  "error": "Cross-site request refused",
  "code": "cross_site_request"
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
  "error": "Internal server error"
}
```

## Status Codes

| Code | Meaning |
|------|---------|
| 200 | Success |
| 201 | Created |
| 204 | No Content |
| 400 | Bad Request |
| 401 | Login required (or account not created yet) |
| 403 | Cross-site request, or wrong setup code |
| 404 | Not Found |
| 409 | Conflict (account already exists, upload busy) |
| 429 | Too many failed attempts |
| 500 | Server Error |
| 502 | Ultra.cc API or SSH unreachable |

## Rate Limiting

Failed logins, wrong setup codes and wrong current passwords (on password change) are limited to 5 per 15 minutes per client. Then the endpoint answers 429 `auth_too_many_attempts` with a `Retry-After` header (seconds) until the oldest failure leaves the window. A success clears the count; a backend restart resets it.

The client is the last address in `X-Forwarded-For`, set by the reverse proxy (see [DEPLOYMENT.md](./DEPLOYMENT.md#reverse-proxy-https)). Without a reverse proxy the backend only sees the frontend: clients that send no such header share one count, and a client can send its own, so keep such a setup on the LAN. Other endpoints are not rate limited.

## Pagination

Use `limit` and `offset` query parameters:

```
GET /api/uploads?limit=20&offset=40
```

Returns records 40-59 (20 records per page).

## Examples

### cURL

Log in once and keep the session cookie in a cookie jar (`-c` saves it, `-b` sends it). Use the frontend URL, or the HTTPS address behind a reverse proxy.

```bash
URL=http://localhost:3000

# Log in (saves the cookie in cookies.txt)
curl -c cookies.txt -H "Content-Type: application/json" \
  -d '{"username": "admin", "password": "your-password"}' \
  $URL/api/auth/login

# List servers
curl -b cookies.txt $URL/api/servers

# Create server
curl -b cookies.txt -X POST $URL/api/servers \
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
curl -b cookies.txt "$URL/api/uploads?limit=10"

# Retry upload
curl -b cookies.txt -X POST $URL/api/uploads/upload123/retry

# Log out
curl -b cookies.txt -c cookies.txt -X POST $URL/api/auth/logout
```

The cookie jar holds a valid session for 30 days: keep it private, and delete it when done.

### JavaScript/Fetch

From a page served by Wayfinderr itself (same origin: the browser sends the session cookie on its own):

```javascript
// List servers
const servers = await fetch('/api/servers')
  .then(r => r.json());

// Get space info
const space = await fetch('/api/space')
  .then(r => r.json());

// WebSocket listener
const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  console.log('Upload event:', msg.type, msg.data);
};
```

## Versioning

No API versioning currently. Future versions may introduce `/api/v2/` etc.
