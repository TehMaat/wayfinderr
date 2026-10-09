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

## System API

### Local Disks

```
GET /api/system/disks
```

Free/used space of the machine running the backend, for the filesystems that hold the watch folder, the downloads folder (`key: "downloads"`, with `RIP_ENABLED=true`: RAR archives are unpacked on it or on the watch folder's) and the database folder. Folders on the same filesystem are grouped into one entry, so `sameDisk: true` means they share a disk. `freeBytes` is the space that can still be written (on Linux it excludes the blocks reserved for root).

`kind` is `disk` (block device: local disk, VPS block storage), `network` (NFS, SMB, sshfs, UNC path), `shared` (host folder seen from a VM or Docker Desktop: 9p, virtiofs...), `memory` (tmpfs) or `other` (e.g. overlay). `device` and `fsType` are only known on Linux. In Docker the paths are the ones inside the container.

**Response:** 200 OK
```json
{
  "sameDisk": false,
  "disks": [
    {
      "id": "/dev/sdb1",
      "mountPoint": "/makemkv-output",
      "device": "/dev/sdb1",
      "fsType": "ext4",
      "kind": "disk",
      "totalBytes": "1000204886016",
      "freeBytes": "612345678848",
      "usedBytes": "387859207168",
      "folders": [{ "key": "watch", "label": "Watch folder", "path": "/makemkv-output" }]
    },
    {
      "id": "/dev/sda1",
      "mountPoint": "/app/data",
      "device": "/dev/sda1",
      "fsType": "ext4",
      "kind": "disk",
      "totalBytes": "250059350016",
      "freeBytes": "180123456512",
      "usedBytes": "69935893504",
      "folders": [{ "key": "data", "label": "Database", "path": "/app/data" }]
    }
  ],
  "missing": []
}
```

A folder that does not exist (or cannot be read) is listed in `missing` with an `error` instead.

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

## Rips API

Film discs and RAR archives found in the downloads folder (`RIP_ENABLED=true`), see the README's *Automatic ripping* and *RAR archives*.

### List Rips

```
GET /api/rips
```

**Response:** 200 OK
```json
{
  "status": {
    "enabled": true, "runnerAlive": true, "tmdbConfigured": true, "language": "it", "minLength": 2700, "exclusions": ["Serie TV/"],
    "unpack": {
      "unrar": true,
      "disks": [{ "disk": "watch", "freeBytes": 412316860416 }, { "disk": "downloads", "freeBytes": 1288490188800 }],
      "downloadsWritable": true
    }
  },
  "rips": [
    {
      "id": "rip123",
      "sourcePath": "Le.Film.2019.BluRay/movie.iso",
      "sourceType": "ISO",
      "downloadName": "Le.Film.2019.BluRay",
      "status": "NEEDS_ATTENTION",
      "reason": "Several long titles (1h52, 1h38): more than one film or cut, choose one",
      "contentType": null,
      "contentPath": null,
      "unpackBytes": null,
      "unpackedTo": null,
      "discName": "LE_FILM",
      "titles": [
        {
          "index": 0,
          "durationSec": 6720,
          "sizeBytes": 32212254720,
          "chapters": 24,
          "segmentsMap": "1-5",
          "streams": [{ "type": "audio", "lang": "ita", "codec": "DTS", "forced": false, "commentary": false }]
        }
      ],
      "titleIndex": null,
      "tmdbId": 101,
      "title": "Il film",
      "originalTitle": "Le Film",
      "originalLanguage": "fr",
      "year": 2019,
      "progress": 0,
      "outputFile": null,
      "upload": null,
      "suggestion": { "title": "Le Film", "year": 2019 }
    }
  ]
}
```

`status`: `WAITING` (still downloading), `QUEUED`, `UNPACKING` (a RAR archive, `progress` 0-100), `SCANNING`, `RIPPING` (`progress` 0-100), `DONE` (`outputFile` in the watch folder, `upload` once picked up), `NEEDS_ATTENTION` (`reason` says what to choose, or that there is no room to unpack an archive), `FAILED`, `SKIPPED`. `suggestion` is the title and year read from the download name, to search TMDB.

A RAR archive has `sourceType` `RAR` and `sourcePath` its first volume. Once listed, `contentType` (`ISO`, `BDMV`, `DVD` or `MKV`) and `contentPath` (inside the archive) tell its film, `unpackBytes` (string) the size of all its files. `unpackedTo` is the disk it is unpacked (or being unpacked) on, `downloads` or `watch`, and `null` once the unpacked copy is deleted. An `.mkv` unpacked next to the downloads is uploaded from there: `outputFile` is in `<downloads>/.wayfinderr/unpack/`.

`status.unpack` (with ripping on): `unrar` whether the command can be run, `disks` where archives can be unpacked with their free space (one entry per disk: just `watch` when the downloads are on the same disk or read-only), `downloadsWritable` whether the downloads' `.wayfinderr` folder can be written.

### Choose and Rip

```
POST /api/rips/:id/choose
Content-Type: application/json

{ "titleIndex": 1, "tmdbId": 101 }
```

Either field may be left out to keep the current one. Allowed when the rip is `NEEDS_ATTENTION`, `FAILED` or `SKIPPED`; the rip is queued with that title and film, without asking again. Errors: 400 (not integers), 404, 409 (`No such title on the disc`, rip in another state).

### Retry, Skip

```
POST /api/rips/:id/retry
POST /api/rips/:id/skip
```

Retry starts over (scan and automatic choices; an archive not unpacked yet is listed and unpacked again); not while unpacking, scanning or ripping. Skip never rips the disc, stops a running rip or unpacking, and deletes what was unpacked of an archive.

### Exclusions

```
PUT /api/rips/exclusions
Content-Type: application/json

{ "patterns": ["Serie TV/", "S0*E"] }
```

Replaces the exclusion rules (also listed in `status.exclusions`). A disc whose path in the downloads folder contains a rule is not ripped: it is created as `SKIPPED` with the reason `Excluded by the rule “…”`. Case doesn't matter and `*` matches any text. Saving skips the `WAITING`, `QUEUED` and `NEEDS_ATTENTION` rips a new rule matches, and puts back to `WAITING` the rips a rule skipped that no rule matches any more; rips skipped by hand are left alone. Rules are trimmed, blanks and duplicates dropped; at most 100, of 200 characters each.

**Response:** 200 OK: `{ "exclusions": ["Serie TV/", "S0*E"], "skipped": 2, "restored": 0 }`. 400 when `patterns` is not an array of strings or is too long.

### Search TMDB

```
GET /api/rips/tmdb/search?query=Le%20Film&year=2019
```

**Response:** 200 OK: `[{ "id": 101, "title": "Il film", "originalTitle": "Le Film", "originalLanguage": "fr", "year": 2019 }]`. 502 when TMDB fails.

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

#### upload-cancelled
Upload stopped by the user.
```json
{
  "type": "upload-cancelled",
  "uploadId": "upload123"
}
```

#### rip-updated, rip-progress
A rip changed (`status` is `DELETED` when it was removed: its download disappeared before finishing), or a running rip or unpacking progressed (`status`: `RIPPING` or `UNPACKING`).
```json
{ "type": "rip-updated", "ripId": "rip123", "status": "RIPPING" }
{ "type": "rip-progress", "ripId": "rip123", "progress": 42, "status": "RIPPING" }
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

# Stop upload
curl -b cookies.txt -X POST $URL/api/uploads/upload123/cancel

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
