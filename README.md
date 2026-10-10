# Wayfinderr 🎬

Automated MKV file transfer system with intelligent server selection and real-time monitoring.

Watches the MakeMKV output folder, checks each new MKV for Italian audio/subtitles, and uploads it via SFTP to the server with the most free space, with automatic retry. Optionally it also rips the film discs (ISO, Blu-ray and DVD folders) that land in the downloads folder.

**Stack**: Node.js 20 • Express • Prisma + SQLite • Next.js 14 • WebSocket • Docker Compose (optional)

---

## Features

- 🎯 **Smart Server Selection** - Picks the server with the most free space that can hold the file (Ultra.cc API)
- 🔍 **Media Verification** - Detects Italian audio/subtitle tracks with ffprobe
- 📤 **Reliable Transfers** - SFTP upload to a temporary `.part` file, size check, then rename; automatic retry with backoff
- 📊 **Real-Time Monitoring** - WebSocket-driven live dashboard
- 💽 **Local Disk Space** - Free/used space of the disks holding the watch folder, the downloads (with ripping on) and the database, one bar per disk when they are on different disks
- 🔄 **Job Queue** - Concurrent uploads (max 2 global, max 1 per server); unfinished uploads resume after a restart
- 💾 **Full History** - SQLite-backed persistence with upload tracking
- 🌐 **Web UI** - Dashboard, server management and upload history
- 🔐 **Login** - One password-protected account; the browser only talks to the frontend, which proxies the API, so one HTTPS reverse proxy entry is enough
- 💿 **Automatic ripping** - Film discs that finish downloading are identified on TMDB and ripped with MakeMKV (main title, Italian + original language), then uploaded; anything unsure waits for a choice in the UI
- 📦 **RAR archives** - Downloaded RAR archives are unpacked on whichever disk has more free space (downloads or watch folder): the disc inside is ripped, an .mkv is uploaded

---

## Quick Start

There are two ways to run it. On a Windows PC where MakeMKV runs, the **local** run is the simplest.

### Option A: local run (no Docker)

Prerequisites: [Node.js 20+](https://nodejs.org) and ffmpeg/ffprobe on the `PATH`.

```bash
# 1. Backend
cd backend
cp .env.example .env        # then set WATCH_DIR to your MakeMKV output folder
npm install
npm run db:deploy           # creates the SQLite database
npm run dev                 # API on http://localhost:3001

# 2. Frontend (second terminal)
cd frontend
npm install
npm run dev                 # http://localhost:3000
```

Open http://localhost:3000. The frontend proxies `/api`, `/health` and the `/ws` WebSocket to the backend on `http://localhost:3001`; to use another address, set `BACKEND_URL` in `frontend/.env` (see `frontend/.env.example`).

For an always-on install use `npm run build && npm start` in both folders instead of `npm run dev`. `BACKEND_URL` is compiled in by `npm run build`: rebuild after changing it.

### Option B: Docker Compose (prebuilt images)

Prerequisites: Docker with Compose v2. The images are built by GitHub Actions and published on `ghcr.io` (see [Docker images](#docker-images)), so nothing is built locally.

```bash
cp .env.example .env        # set MAKEMKV_OUTPUT_DIR (and WATCH_USE_POLLING=true on Windows/macOS)
docker compose pull
docker compose up -d
docker compose logs -f wayfinderr-backend
```

To update: `docker compose pull && docker compose up -d` (with `--profile makemkv` on both if you run the MakeMKV service, or `COMPOSE_PROFILES=makemkv` in `.env`). Data (servers, history, login account) lives in the `wayfinderr-data` volume and survives updates.

Open http://localhost:3000, or `http://<pc-ip>:3000` from other devices on the LAN. The browser only talks to the frontend, which proxies `/api`, `/health` and the `/ws` WebSocket to the backend over the compose network (service name `wayfinderr-backend`); the backend port is not published. To put it on a domain with HTTPS, see [Reverse proxy](./docs/DEPLOYMENT.md#reverse-proxy-https).

ffprobe is included in the backend image. The dashboard's **This machine** card shows the disks as the container sees them: the watch folder is the host folder you mounted, the database lives in the `wayfinderr-data` volume (with Docker Desktop on Windows/macOS that is the Docker VM disk, not a Windows/macOS drive). To also run MakeMKV in Docker (Linux host with an optical drive), use `docker compose --profile makemkv up -d` and uncomment the `devices` section in `docker-compose.yml`.

To build from source instead: `docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build`.

### Create the account

Wayfinderr stays closed until its single account exists.

1. Open http://localhost:3000: the first visit shows the setup screen.
2. Copy the one-time **setup code** from the backend log: `docker compose logs wayfinderr-backend | grep "setup code"` (`docker logs wayfinderr-backend` if the container has that name; the backend terminal for a local run). To choose the code yourself, set `WAYFINDERR_SETUP_CODE` for the backend.
3. Choose a username and a password (at least 8 characters).

Anyone with the setup code can create the account: treat that log line as a secret, and create the account before exposing the app outside the LAN.

Sessions last 30 days (HttpOnly cookie). The account menu at the bottom of the sidebar (your username) has **Change password** (signs out every other device), **Sign out** and **Sign out everywhere**. After 5 failed attempts in 15 minutes, a client has to wait before trying again.

**Forgotten password**: delete the account, then reopen the page and create it again with the new setup code from the log (servers and history are kept):

```bash
docker compose exec wayfinderr-backend node dist/cli.js reset-auth   # or: docker exec wayfinderr-backend node dist/cli.js reset-auth
# local run: cd backend && npm run build && npm run reset-auth
```

### Configure the servers

1. Open http://localhost:3000 → **Servers** → **Add New Server**
2. Fill in:
   - **API Endpoint / Token**: from the Ultra.cc [Storage/Traffic API script](https://docs.ultra.cc/unofficial-ssh-utilities/storagetraffic-api-endpoint), e.g. `https://user.host.usbx.me/ultra-api/get_diskquota`
   - **SSH Host / Port / Username / Password**: your Ultra.cc SSH login (leave the password blank to use the key in `SSH_PRIVATE_KEY_PATH`)
   - **Remote Folder**: where the files go, e.g. `/home/<user>/media/movies` (created if missing)
   - **Media Policy**: skip files without Italian audio/subs, or always upload
3. Click **Test**: it checks the API and the SSH/SFTP login
4. Repeat for the second server

From now on every new `.mkv` in the watch folder, subfolders included, is uploaded automatically. A file is picked up once its size has been stable for 30 seconds. The folder is also rescanned every 30 seconds, so files the watcher misses (it can happen on Docker Desktop and network shares) are still picked up, within a minute or two. With `DELETE_AFTER_UPLOAD=true` the local file is deleted once it is on the server.

### Automatic ripping (optional)

For films downloaded as discs: every `.iso`, Blu-ray folder (`BDMV`) or DVD folder (`VIDEO_TS`) that finishes downloading is ripped to MKV and uploaded.

1. In `.env`: `RIP_ENABLED=true`, `DOWNLOADS_DIR` (the torrent client's download folder), `TMDB_API_KEY` ([themoviedb.org](https://www.themoviedb.org/settings/api) API key or read access token) and `MAKEMKV_KEY` (your registration key, or `BETA`).
2. Start the MakeMKV service too: `docker compose --profile makemkv up -d`. Its image, `wayfinderr-makemkv`, is [jlesage/makemkv](https://github.com/jlesage/docker-makemkv) (web GUI on port 5800) plus a runner that executes the rips Wayfinderr asks for.

For each disc Wayfinderr:

1. waits until the download is complete (no `.!qB`/`.part` files, nothing changed for `RIP_QUIET_MINUTES`);
2. reads its titles (`makemkvcon info`);
3. finds the film on TMDB from the download name (title and year), or from the disc label;
4. picks the film's title: the only one at least `RIP_MIN_LENGTH` long (45 minutes; shorter extras are ignored);
5. rips it keeping video, audio and subtitles in Italian and in the film's original language (Italian first);
6. moves it to the watch folder as `Title (Year).mkv`, with the Italian TMDB title: the upload follows.

It never guesses: when a disc has more than one long title (several films or cuts), many look-alike playlists, no Italian track, more discs in the same download, an unsure TMDB match, or there is not enough space, the rip stops on **Rips** → *Needs attention*: *Choose…* the title and/or the film there and it goes on. A film TMDB doesn't know can be ripped all the same: it keeps every language and is named after the download. When the backend starts, the rips still waiting for their film are looked up on TMDB again (and again 10 minutes later if TMDB does not answer), so an update that recognizes more titles also applies to them: the ones identified go on by themselves, or wait only for the title choice. Downloads already in the folder the first time are listed as skipped (*Rip anyway* from the page, or `RIP_EXISTING=true`).

If the torrent client keeps the downloads in progress in a folder inside the downloads (e.g. qBittorrent's *Keep incomplete torrents in* `/downloads/torrents`) and moves them to the downloads folder once complete, pick that folder in **Rips** → *Exclusions* → *Ignored folders*: it is never searched, and the discs listed from it leave the list. Tick *Downloads arrive complete* too: what appears in the downloads is then handled within a minute or two instead of waiting `RIP_QUIET_MINUTES` without changes.

To keep some discs from being ripped (TV series, extras discs...), add rules in **Rips** → *Exclusions*: a disc whose path in the downloads contains one of them (`Serie TV/`, `S0*E`; `*` matches any text, case doesn't matter) is listed as skipped. The dialog shows which discs each rule matches. A new rule also skips the discs not ripped yet; removing it puts back in the queue the discs it skipped.

The rips run one at a time inside the MakeMKV container; Wayfinderr only exchanges small job files with it in `<watch folder>/.wayfinderr`. Set the MakeMKV container's `USER_ID`/`GROUP_ID` to the owner of the watch folder: at start it takes ownership of `/output` if it cannot write there.

#### RAR archives

RAR archives in the downloads (`.rar`, `.part1.rar` + `.part2.rar`..., `.rar` + `.r00`...) are unpacked with `unrar` (included in the Docker image; for a local run install it, or set `UNRAR_PATH`, e.g. `C:/Program Files/WinRAR/UnRAR.exe`). Once the download is complete, Wayfinderr lists the archive without unpacking it:

- one film inside, a disc (ISO, `BDMV`, `VIDEO_TS`) or an `.mkv` (samples aside): it is unpacked;
- nothing else is handled: an archive without a film (subtitles, extras), with several films, password-protected or holding links is listed as skipped, with the reason.

**Where it is unpacked.** Wayfinderr checks the free space of the disk holding the downloads and of the one holding the watch folder, and unpacks the archive on the one with more space left afterwards (2 GB always stay free). A disc unpacked next to the watch folder counts twice there, since its rip goes there too. Without room on either disk the archive stops on *Needs attention* with the free space of each: free some space, then *Retry*.

- Next to the downloads: `<downloads>/.wayfinderr/unpack/`. With Docker the downloads are read-only for the backend except this folder, mounted writable by `docker-compose.yml`; without that line archives are only unpacked next to the watch folder (the Rips page tells which disks are used).
- Next to the watch folder: `<watch folder>/.wayfinderr/unpack/`.

**Then:**

- a disc is ripped like any other (MakeMKV reads it where it was unpacked); the unpacked copy is deleted once the rip is done;
- an `.mkv` is named `Title (Year).mkv` like a rip (TMDB title, or the download name). Unpacked next to the watch folder, it is moved there and uploaded like any other file. Unpacked next to the downloads, it is uploaded from there (moving it would mean copying it to the other disk) and deleted once on the server, or skipped by the server's media policy, or when its upload is deleted; until then a failed or stopped upload can be retried.

Archives are unpacked one at a time, between rips. *Skip* stops an unpacking and deletes what was unpacked. Archives already in the downloads when this was added are listed as skipped (*Rip anyway*, or `RIP_EXISTING=true`). To never unpack them, add the exclusion rule `.rar`.

---

## Configuration

| Variable | Default | Description |
|---|---|---|
| `WATCH_DIR` | `/makemkv-output` | Folder to watch (local run) |
| `MAKEMKV_OUTPUT_DIR` | `./makemkv-output` | Host folder mounted as the watch folder (Docker) |
| `WATCH_USE_POLLING` | `false` | Poll the folder instead of using file events (needed for Docker Desktop and network shares) |
| `DATABASE_URL` | `file:../data/wayfinderr.db` | SQLite file, relative to `backend/prisma/` |
| `MAX_CONCURRENT_UPLOADS` | `2` | Max uploads running at the same time |
| `SSH_PRIVATE_KEY_PATH` | – | SSH key for servers saved without a password |
| `WAYFINDERR_TAG` | `latest` | Docker image version to run |
| `WAYFINDERR_SETUP_CODE` | random | Backend: fixed setup code for creating the account, instead of the one printed in the log |
| `BACKEND_URL` | `http://wayfinderr-backend:3001` (Docker image), `http://localhost:3001` (local run) | Frontend **build** setting: where the frontend server proxies `/api`, `/health` and `/ws`. Compiled in by `next build` (Docker build arg), so changing it means rebuilding |
| `DELETE_AFTER_UPLOAD` | `false` | Delete the local `.mkv` once uploaded |
| `RIP_ENABLED` | `false` | Rip film discs from the downloads folder (needs the `makemkv` service) |
| `DOWNLOADS_DIR` | `./downloads` | Docker: host folder with the downloads, mounted read-only in the backend (`/downloads`, but for its `.wayfinderr` folder where archives are unpacked) and MakeMKV (`/storage`) |
| `RIP_SOURCE_DIR` | `/downloads` | Backend: the downloads folder as it sees it |
| `RIP_WORK_DIR` | `<WATCH_DIR>/.wayfinderr` | Backend: folder shared with the MakeMKV runner (jobs, rips in progress) |
| `RIP_QUIET_MINUTES` | `10` | A download is complete when nothing changed for this long |
| `RIP_MIN_LENGTH` | `2700` | Seconds: shorter titles are never the film |
| `RIP_EXISTING` | `false` | Also rip the downloads already there when ripping is first enabled |
| `RIP_LANGUAGE` | `it` | Language always kept (ISO 639-1), besides the film's original one |
| `UNRAR_PATH` | `unrar` | Backend: the unrar command for RAR archives (in the Docker image) |
| `TMDB_API_KEY` | – | themoviedb.org API key (v3) or read access token; without it every rip waits for a choice |
| `TMDB_LANGUAGE` | `it-IT` | Language of the title used for the file name |
| `MAKEMKV_KEY` | `BETA` | MakeMKV container: registration key, or `BETA` for the free beta key |
| `WAYFINDERR_RUNNER` | `1` | MakeMKV container: `0` turns the runner off |
| `WAYFINDERR_CACHE_MB` | `1024` | MakeMKV container: read cache of a rip |

---

## Docker images

The [`Docker images`](.github/workflows/docker-publish.yml) workflow builds the images on every push to `main` and publishes them to GitHub Container Registry. Every tag is multi-platform, `linux/amd64` and `linux/arm64` (Raspberry Pi 4/5, ARM NAS): Docker pulls the one for your machine.

| Image | Tags |
|---|---|
| `ghcr.io/tehmaat/wayfinderr-backend` | `latest`, `sha-<commit>`, `1.2.3` / `1.2` for git tags `v1.2.3` |
| `ghcr.io/tehmaat/wayfinderr-frontend` | same |
| `ghcr.io/tehmaat/wayfinderr-makemkv` | same (jlesage/makemkv + the rip runner) |

To publish a version: `git tag v1.0.0 && git push --tags`, then set `WAYFINDERR_TAG=1.0.0` in `.env`.

**Visibility.** New packages are private. To pull a private image, log in once with a [personal access token (classic)](https://github.com/settings/tokens/new?scopes=read:packages) with the `read:packages` scope:

```bash
docker login ghcr.io -u <github-user>
```

To make an image public: GitHub → your profile → **Packages** → the image → **Package settings** → **Change visibility** → Public. This cannot be undone, and anyone can then pull the image (which contains the compiled code).

---

## Project Structure

```
wayfinderr/
├── docker-compose.yml        # runs the prebuilt images
├── docker-compose.build.yml  # override to build from source
├── .env.example              # Docker Compose settings
├── .github/workflows/        # image build + publish
├── backend/              # Express API, file watcher, upload queue
│   ├── .env.example      # local run settings
│   ├── src/
│   └── prisma/           # schema + migrations
├── frontend/             # Next.js UI
├── makemkv/              # wayfinderr-makemkv image: jlesage/makemkv + rip runner
├── docs/
└── scripts/              # setup/start/stop helpers for Docker
```

---

## API Endpoints

Served through the frontend (`http://localhost:3000/api/...`). Every route except `/api/auth/*` needs the session cookie; see [docs/API.md](./docs/API.md).

### Auth
- `GET /api/auth/status` - Account configured? Logged in as?
- `POST /api/auth/setup` - Create the account (setup code from the log)
- `POST /api/auth/login` / `POST /api/auth/logout` - Sign in / out
- `POST /api/auth/change-password` - Change password, sign out other sessions
- `POST /api/auth/logout-everywhere` - Sign out every session

### Servers
- `GET /api/servers` - List all servers (secrets are never returned: `hasApiToken`, `hasSshPassword`)
- `POST /api/servers` - Create server
- `PUT /api/servers/:id` - Update server (blank token or password = keep current)
- `DELETE /api/servers/:id` - Delete server
- `POST /api/servers/:id/test` - Test Ultra.cc API + SSH/SFTP

### Uploads
- `GET /api/uploads?limit=50` - List uploads
- `GET /api/uploads/:id` - Get upload details
- `POST /api/uploads/:id/retry` - Re-queue a failed, skipped or stopped upload
- `POST /api/uploads/:id/cancel` - Stop a queued or running upload (the partial file on the server is deleted)

### Space
- `GET /api/space` - All servers' space
- `POST /api/space/:id/refresh` - Refresh cache

### System
- `GET /api/system/disks` - Free/used space of the disks holding the watch folder, the downloads (with ripping on) and the database

### Rips
- `GET /api/rips` - Rips and the ripping status (enabled, runner online, TMDB configured)
- `POST /api/rips/:id/choose` - Rip with the given `titleIndex` and/or `tmdbId`
- `POST /api/rips/:id/retry` - Scan and choose again
- `POST /api/rips/:id/skip` - Never rip it (stops a running rip)
- `GET /api/rips/tmdb/search?query=&year=` - Search a film on TMDB

---

## Troubleshooting

See **[docs/TROUBLESHOOTING.md](./docs/TROUBLESHOOTING.md)** for common issues.

---

## Contributing

Contributions welcome! See **[CONTRIBUTING.md](./CONTRIBUTING.md)** for guidelines.

---

## License

MIT License - see **[LICENSE](./LICENSE)** file
