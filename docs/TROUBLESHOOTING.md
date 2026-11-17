# Troubleshooting

Common problems and what to do. The commands are for Docker Compose; in a local run read the
backend terminal instead of `docker compose logs`. The **Logs** page shows the same log, with
filters, without a terminal.

- [Install and start](#install-and-start)
- [Login](#login)
- [Servers](#servers)
- [Uploads](#uploads)
- [Rips](#rips)
- [Torrent cleanup and release](#torrent-cleanup-and-release)
- [Database](#database)
- [Asking for help](#asking-for-help)

## Install and start

### Port 3000 or 5800 already in use

Something else listens there (the backend's 3001 too, in a local run). Find it (`lsof -i :3000`,
on Windows `netstat -ano | findstr :3000`) or publish another port in `docker-compose.yml`:

```yaml
services:
  wayfinderr-frontend:
    ports:
      - "3100:3000"
```

### The page is blank, or "The backend is not reachable right now"

The browser only talks to the frontend, which proxies `/api`, `/health` and `/ws` to the backend at
`BACKEND_URL`, compiled into the image (default `http://wayfinderr-backend:3001`).

```bash
docker compose ps
docker compose logs --tail 50 wayfinderr-backend
curl http://localhost:3000/health
docker compose exec wayfinderr-frontend wget -qO- http://wayfinderr-backend:3001/health
```

Both containers must share a Docker network, and the backend must be reachable as
`wayfinderr-backend`. For another address rebuild the frontend with `--build-arg BACKEND_URL=...`;
in a local run set `BACKEND_URL` in `frontend/.env` and restart `npm run dev` (rebuild for
`npm start`). Then a hard refresh (Ctrl+Shift+R).

### The backend stops at start

```bash
docker compose logs --tail 50 wayfinderr-backend
```

Usually the data volume is not writable, the watch folder is not mounted, or a migration failed (the
log says which). In a local run, `npm run db:deploy` creates or updates the database.

## Login

### Where is the setup code?

It is printed in the backend log while no account exists:

```bash
docker compose logs wayfinderr-backend | grep "setup code"
```

It is logged as a warning (hidden with `LOG_LEVEL=error`). Every start without an account prints a
new random code: use the latest one, or fix it with `WAYFINDERR_SETUP_CODE`. Whoever has it can
create the account.

### Forgotten password

```bash
docker compose exec wayfinderr-backend node dist/cli.js reset-auth
```

This deletes the account and signs out every session (servers and history are kept). Reopen the
page: the setup screen is back, and the log has a new setup code. Local run:
`cd backend && npm run build && npm run reset-auth`.

### "Too many attempts: try again in N min"

5 failed logins (or setup codes, or current passwords) in 15 minutes from the same client block it
until the oldest failure is 15 minutes old. Wait, or restart the backend (the count is in memory).
The client is the address the reverse proxy forwards in `X-Forwarded-For`; without a reverse proxy
every device shares one count.

### Signed out on every device

Expected after **Change password** (signs out every other device) or **Sign out everywhere**.
Sessions also end after 30 days.

### "Cross-site request refused" behind a reverse proxy

The reverse proxy must pass the original `Host` header: the backend compares it with the page's
`Origin` when the browser sends no `Sec-Fetch-Site`. Traefik and Pangolin do by default; in nginx
use `proxy_set_header Host $host;`. Point the proxy at the frontend, never at the backend. See
[Deployment](DEPLOYMENT.md#reverse-proxy-https).

### No live updates behind a reverse proxy

The WebSocket is `/ws` on the same address as the page. Traefik and Pangolin need no extra settings;
nginx needs `proxy_http_version 1.1` and the `Upgrade`/`Connection` headers for `/ws` (example in
[Deployment](DEPLOYMENT.md#nginx)). The status bar at the bottom says *Live* when it is connected.

## Servers

### The test fails

**Test** checks the free space (Ultra-API, or over SSH) and the SSH/SFTP login, and says which
part failed.

- SSH: try the same login from the machine Wayfinderr runs on (`ssh -p <port> <user>@<host>`). A
  server saved without a password uses the key in `SSH_PRIVATE_KEY_PATH`: with Docker the key file
  must be mounted in the backend container and readable by it.
- Ultra-API: check the endpoint (`https://<user>.<host>.usbx.me/ultra-api/get_diskquota`) and the
  token, by hand:
  ```bash
  curl -H "Authorization: Bearer <token>" https://<user>.<host>.usbx.me/ultra-api/get_diskquota
  ```
- The remote folder is created if missing: the SSH user must be allowed to.

### A server shows "Online via SSH", or "Unreachable"

**Online via SSH**: the storage API did not answer, so the free space was read over SSH (the user's
quota, else the disk of the upload folder) and the server still takes uploads. **Unreachable**:
neither the API nor SSH answered; the server takes no uploads.

The Ultra-API service on the server may have stopped. **Restart API** on the **Servers** page runs
Ultra's Ultra-API script over SSH and picks *Restart*, the same as doing it by hand:

```bash
bash <(wget -qO- https://scripts.ultra.cc/util-v2/Ultra-API/main.sh)
```

(then `3` for *Restart*). Turn on **Restart automatically when unreachable** to have it done by
itself, at most once every 15 minutes per server. If the restart works but the API stays
unreachable, check the endpoint and the token.

## Uploads

### A file is not picked up

- It must be a `.mkv` inside the watch folder (subfolders included) and its size must have been
  stable for 30 seconds: MakeMKV may still be writing it.
- Docker Desktop (Windows/macOS) and network shares do not forward file events: set
  `WATCH_USE_POLLING=true`. The rescan every 30 seconds picks files up anyway, within a minute or two.
- Check that the folder in `MAKEMKV_OUTPUT_DIR` is the one MakeMKV writes to:
  ```bash
  docker compose exec wayfinderr-backend ls -la /makemkv-output/
  ```

### Skipped: "No Italian audio or subtitles"

The server's media policy skips files without Italian. Check the tracks:

```bash
docker compose exec wayfinderr-backend ffprobe -v error -show_entries stream=codec_type:stream_tags=language "/makemkv-output/<file>.mkv"
```

If Italian is missing the skip is right. To upload such files anyway, set the server's **Media
policy** to *Always upload*, then **Retry** the upload. With merging on, such a file is held for a
merge instead (see [Merge](USAGE.md#merge-with-dyadrr)).

### Stuck in queue, or failing

- Every server that could hold the file may be busy (one upload per server) or full: the dashboard
  shows their free space.
- Failed uploads show the error on their page; **Retry** queues them again. Check the SSH login with
  **Test** on the server.
- "Permission denied" writing the local file (moving a rip, `DELETE_AFTER_UPLOAD`): the backend
  container must be able to write the watch folder (no `:ro` on its mount).

### Slow uploads

The upload runs over SFTP from the machine Wayfinderr runs on: its upload bandwidth is the limit.
`MAX_CONCURRENT_UPLOADS` uploads run at once, at most one per server.

## Rips

### Nothing is ripped

The **Rips** page says what is missing at the top: the MakeMKV runner offline (start the service with
`--profile makemkv`, `WAYFINDERR_RUNNER=1`), TMDB not configured, the downloads folder not mounted.
A download is ripped only once nothing in it changed for `RIP_QUIET_MINUTES`; the downloads already
there when ripping was turned on are listed as skipped (*Rip anyway*). A path matching an
exclusion rule is skipped on purpose (**Rips** → *Exclusions*).

### "Needs attention"

The rip did not guess: several long titles, an unsure TMDB match, no Italian track, several discs.
*Choose…* the title and/or the film, and it goes on. See
[Automatic ripping](USAGE.md#automatic-ripping).

### MakeMKV fails

An expired `BETA` key, a crash, a damaged download. The rip's menu → *Rip without MakeMKV* rips an
unencrypted disc with mkvmerge or ffmpeg instead (see [Rip without MakeMKV](USAGE.md#rip-without-makemkv)).
The MakeMKV GUI on port 5800 shows its own log.

### The MakeMKV container cannot write the watch folder

Set its `USER_ID`/`GROUP_ID` to the owner of the watch folder: at start it takes ownership of
`/output` if it cannot write there.

## Torrent cleanup and release

- **The torrent is not removed**: only a 100% match is removed by itself; anything less shows a
  suggestion and **Remove torrent now** on the upload page. Generic names (`title_t00.mkv`) never
  match: rename the file, or rip into a folder named after the film. Set `TMDB_API_KEY` to match
  names in different languages. See [Remove the source torrent](USAGE.md#remove-the-source-torrent).
- **Test connection** on the client fails: enable qBittorrent's WebUI; from Docker use
  `http://host.docker.internal:8080` (the compose file maps it on Linux too).
- **A release's torrent is never removed**: by design, the torrent of a film Wayfinderr released
  (on a server or locally) seeds for good. The upload says *seeds the release of …: it is never
  removed*; remove it from qBittorrent yourself if you mean to.
- **"mount its release folder (LOCAL_RELEASE_DIR) to pair it"**, or a film released locally missing
  from **Pair…**: set `SEEDING_DIR` in `.env` to the client's release folder on this machine (the
  same disk as the watch folder) and recreate the backend and `dyadrr` containers. If it is set, the
  file seeding there must have the size of the uploaded one: a file changed or moved by hand is
  not taken. The backend log says which (`docker logs wayfinderr-backend`, or **Logs**, source
  *backend*): at start, `Release folder /seeding: N entries, X of Y films released locally found
  there`, or why the folder cannot be read; then one line per film left out, `Released locally, not
  offered for a merge: <file>: <reason>` with the path it looked at:
  - `NOT_MOUNTED`: `LOCAL_RELEASE_DIR` is not set in the backend;
  - `NO_REMOTE_PATH`: Wayfinderr does not know where the release moved the file;
  - `NOT_FOUND`: no file at `<release folder>/<name>/<name>.mkv` (moved or renamed after the release,
    or the client's release folder is not the one mounted);
  - `SIZE_MISMATCH`: a file is there, with another size than the uploaded one;
  - `UNREADABLE`: the folder or the file cannot be read by the backend's user (`EACCES`).
- **The tracker command does not start**: the server (or the client's machine, for a local release)
  needs `tmux` and `bash`, and the command must work in a login shell there. The **Tracker** card
  shows its output.

## Database

### Database errors, or a corrupted file

Stop the backend, keep a copy of `wayfinderr.db`, then start again: migrations run at every start.
To start from scratch (servers, history and account lost), remove the volume:

```bash
docker compose down
docker volume rm wayfinderr_wayfinderr-data
docker compose up -d
```

(the volume name is `<folder>_wayfinderr-data`; `docker volume ls` shows it). Backups and restore:
[Deployment](DEPLOYMENT.md#backups).

## Asking for help

1. Look at the **Logs** page (level *debug* with `LOG_LEVEL=debug`) or
   `docker compose logs --tail 200 wayfinderr-backend`.
2. Search the [issues](https://github.com/TehMaat/wayfinderr/issues), closed ones too.
3. Open a new issue with the log lines, the steps to reproduce, your install method, OS and Docker
   version. Remove passwords, hosts and file names you do not want to share.
