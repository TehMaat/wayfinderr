# Wayfinderr 🎬

Automated MKV file transfer system with intelligent server selection and real-time monitoring.

Watches the MakeMKV output folder, checks each new MKV for Italian audio/subtitles, and uploads it via SFTP to the server with the most free space, with automatic retry.

**Stack**: Node.js 20 • Express • Prisma + SQLite • Next.js 14 • WebSocket • Docker Compose (optional)

---

## Features

- 🎯 **Smart Server Selection** - Picks the server with the most free space that can hold the file (Ultra.cc API)
- 🔍 **Media Verification** - Detects Italian audio/subtitle tracks with ffprobe
- 📤 **Reliable Transfers** - SFTP upload to a temporary `.part` file, size check, then rename; automatic retry with backoff
- 📊 **Real-Time Monitoring** - WebSocket-driven live dashboard
- 🔄 **Job Queue** - Concurrent uploads (max 2 global, max 1 per server); unfinished uploads resume after a restart
- 💾 **Full History** - SQLite-backed persistence with upload tracking
- 🌐 **Web UI** - Dashboard, server management and upload history
- 🔐 **Login** - One password-protected account; the browser only talks to the frontend, which proxies the API, so one HTTPS reverse proxy entry is enough

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

To update: `docker compose pull && docker compose up -d`. Data (servers, history, login account) lives in the `wayfinderr-data` volume and survives updates.

Open http://localhost:3000, or `http://<pc-ip>:3000` from other devices on the LAN. The browser only talks to the frontend, which proxies `/api`, `/health` and the `/ws` WebSocket to the backend over the compose network (service name `wayfinderr-backend`); the backend port is not published. To put it on a domain with HTTPS, see [Reverse proxy](./docs/DEPLOYMENT.md#reverse-proxy-https).

ffprobe is included in the backend image. To also run MakeMKV in Docker (Linux host with an optical drive), use `docker compose --profile makemkv up -d` and uncomment the `devices` section in `docker-compose.yml`.

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

From now on every new `.mkv` in the watch folder is uploaded automatically. A file is picked up once its size has been stable for 30 seconds.

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

---

## Docker images

The [`Docker images`](.github/workflows/docker-publish.yml) workflow builds both images on every push to `main` and publishes them to GitHub Container Registry:

| Image | Tags |
|---|---|
| `ghcr.io/tehmaat/wayfinderr-backend` | `latest`, `sha-<commit>`, `1.2.3` / `1.2` for git tags `v1.2.3` |
| `ghcr.io/tehmaat/wayfinderr-frontend` | same |

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
- `POST /api/uploads/:id/retry` - Re-queue a failed or skipped upload

### Space
- `GET /api/space` - All servers' space
- `POST /api/space/:id/refresh` - Refresh cache

---

## Troubleshooting

See **[docs/TROUBLESHOOTING.md](./docs/TROUBLESHOOTING.md)** for common issues.

---

## Contributing

Contributions welcome! See **[CONTRIBUTING.md](./CONTRIBUTING.md)** for guidelines.

---

## License

MIT License - see **[LICENSE](./LICENSE)** file
