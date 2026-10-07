# Wayfinderr - Quick Start Guide

## 30-Second Overview

Wayfinderr is an automated MKV file transfer system that:
1. Watches for new MKV files from MakeMKV
2. Verifies Italian audio/subtitles exist
3. Selects the server with most free space
4. Uploads via SCP with automatic retry
5. Provides real-time UI and history tracking

**Stack**: Docker Compose • Node.js • Next.js • SQLite • WebSocket

---

## Prerequisites

- Docker & Docker Compose
- Two Ultra.cc servers with SSH access
- MakeMKV Docker container (included in compose)
- ~500MB disk space for database

---

## Installation (5 minutes)

### 1. Clone/Extract Project

```bash
cd wayfinderr
```

### 2. Configure Environment

Edit `docker-compose.yml` if needed:
- Verify volume paths for MakeMKV output
- Check container ports (3000, and 5800 for MakeMKV); the backend publishes none
- Update SSH path if different

### 3. Build and Start

```bash
# Build Docker images
docker-compose build

# Start all services
docker-compose up -d

# Verify services running
docker-compose ps
```

**Access Points:**
- Wayfinderr: http://localhost:3000 (the frontend also proxies the API and the WebSocket to the backend)
- MakeMKV: http://localhost:5800 (optional)

---

## First-Time Setup (2 minutes)

### 1. Create the Account

1. Open http://localhost:3000: the first visit shows the setup screen
2. Copy the setup code from the backend log:
   ```bash
   docker-compose logs wayfinderr-backend | grep "setup code"
   ```
3. Choose a username and a password (at least 8 characters)

Treat the setup code as a secret and create the account before exposing the app. Sessions last 30 days; the account menu at the bottom of the sidebar has Change password, Sign out and Sign out everywhere.

### 2. Add First Server

1. Go to http://localhost:3000/servers
2. Click "Add New Server"
3. Fill in your first Ultra.cc server:
   - **Name**: `Server 1`
   - **API Endpoint**: `https://username.hostname.usbx.me/ultra-api/get_diskquota`
   - **API Token**: Your Ultra.cc API token
   - **SSH Host**: `hostname.usbx.me`
   - **SSH Port**: `22`
   - **SSH Username**: Your SSH username
4. Click "Save Server"
5. Click "Test" to verify connection

### 3. Add Second Server

Repeat step 2 with your second server credentials.

---

## How It Works

### Automatic Workflow (No User Action Required)

```
MakeMKV writes .mkv file
         ↓
Wayfinderr detects file
         ↓
Extract media info (ffprobe)
         ↓
Check: Italian audio OR Italian subs?
   YES ↓ (upload)    NO ↓ (skip with warning)
     ↓                  ↓
   Select server with most free space
     ↓
   Upload via SCP with progress tracking
     ↓
   On error: Retry up to 3 times (exponential backoff)
     ↓
   Mark as COMPLETED or FAILED
     ↓
   UI updates in real-time
```

### Manual Operations

| Action | Location | Steps |
|--------|----------|-------|
| **View Status** | Dashboard (/) | See current upload & stats |
| **View History** | Uploads page | See all past uploads |
| **Manage Servers** | Servers page | Add/Edit/Delete/Test |
| **Retry Failed** | Upload detail page | Click "Retry Upload" |
| **Check Space** | Servers page | Click "Refresh" |

---

## Key Features

### 🔄 Smart Server Selection
- Rounds up to server with most available space
- Automatic failover if primary server fails
- Per-server configuration (retry policy, media check)

### 🎬 Media Verification
- Automatic detection of Italian audio tracks
- Automatic detection of Italian subtitles
- Configurable skip policy for non-Italian content

### 📤 Reliable Transfers
- Automatic retry on failure (max 3 attempts)
- Exponential backoff (100ms → 200ms → 400ms)
- Resume support for large files
- Progress tracking (0-100%)

### 🌐 Real-Time UI
- WebSocket live updates
- Live progress bars
- Upload queue status
- Historical analytics

### 💾 Persistent History
- SQLite database with full upload history
- Error logs and retry attempts
- Server space tracking
- Statistics and reporting

---

## Configuration

### Database
Default location: `/app/data/wayfinderr.db`
Accessible via:
```bash
docker-compose exec wayfinderr-backend sqlite3 /app/data/wayfinderr.db
```

### Log Levels
Edit `docker-compose.yml`:
```yaml
environment:
  LOG_LEVEL: info  # 'debug', 'info', 'warn', 'error'
```

### Media Check Policy
By default, files without Italian audio AND no Italian subtitles are skipped.
To always upload regardless: Configure per-server in UI (future feature)

### Retry Strategy
Default: Exponential backoff, max 3 retries
To change: Edit server settings in UI (future feature)

---

## Monitoring

### View Logs

```bash
# All services
docker-compose logs

# Backend (most important)
docker-compose logs -f wayfinderr-backend

# Frontend
docker-compose logs wayfinderr-frontend

# Search logs
docker-compose logs wayfinderr-backend | grep -i error
```

### Database Queries

```bash
# Connect to database
docker-compose exec wayfinderr-backend sqlite3 /app/data/wayfinderr.db

# View uploads
SELECT filename, status, progress, createdAt FROM Upload ORDER BY createdAt DESC LIMIT 10;

# View servers
SELECT name, freeSpaceGB, lastSpaceCheckAt FROM Server;

# Check failed uploads
SELECT filename, error FROM Upload WHERE status='FAILED';
```

### Health Check

```bash
# Frontend + backend health (no login needed)
curl http://localhost:3000/health

# Expected response:
{"status":"ok","queue":0}
```

---

## Troubleshooting

### Services won't start

```bash
# Check logs
docker-compose logs

# Rebuild images
docker-compose build --no-cache

# Remove containers and try again
docker-compose down
docker-compose up -d
```

### Frontend doesn't load

```bash
# Check frontend logs
docker-compose logs wayfinderr-frontend

# Verify the frontend reaches the backend
curl http://localhost:3000/health

# Clear browser cache (Ctrl+Shift+R)
```

### Server test fails

```bash
# Check SSH connectivity manually
ssh -p 22 username@hostname.usbx.me

# Verify API token format (should start with Bearer)
# Check firewall/network access

# Review backend logs
docker-compose logs wayfinderr-backend | grep -i test
```

### Forgot the password

```bash
# Deletes the account; reopen the page and create it again with the new setup code from the log
docker-compose exec wayfinderr-backend node dist/cli.js reset-auth
```

### Upload doesn't start

```bash
# Check file is in watch directory
docker-compose exec wayfinderr-backend ls -la /makemkv-output/

# Check media info parsing (requires ffprobe)
docker-compose exec wayfinderr-backend ffprobe /makemkv-output/filename.mkv

# Check job queue status in logs
docker-compose logs wayfinderr-backend | grep -i "queue\|upload"
```

### Database corrupted

```bash
# Backup current database
docker-compose exec wayfinderr-backend cp /app/data/wayfinderr.db /app/data/wayfinderr.db.backup

# Start fresh (migrations run automatically)
docker-compose exec wayfinderr-backend rm /app/data/wayfinderr.db

# Restart backend
docker-compose restart wayfinderr-backend
```

---

## Common Tasks

### Add a new server

1. Go to http://localhost:3000/servers
2. Click "Add New Server"
3. Fill in details and save
4. Click "Test" to verify

### Retry a failed upload

1. Go to http://localhost:3000/uploads
2. Click "View" on failed upload
3. Click "Retry Upload"
4. Monitor progress in Dashboard

### View upload details

1. Go to http://localhost:3000/uploads
2. Click "View" on any upload
3. See media info, error messages, timestamps

### Change server configuration

1. Go to http://localhost:3000/servers
2. Click "Edit" on server
3. Update fields
4. Click "Save Server"
5. Test new configuration

### View system statistics

1. Dashboard shows:
   - Total uploads count
   - Completed uploads
   - Failed uploads
   - Queue size
   - Current upload progress

---

## Performance Tips

- **Keep database lean**: Periodically archive old uploads (not auto)
- **Monitor disk space**: Server space is checked every 60 seconds
- **Watch memory**: Check with `docker stats` if system slows
- **Check logs regularly**: Look for patterns in failures

---

## Next Steps

1. ✅ Docker Compose setup
2. ✅ Add servers and test connectivity
3. ✅ Place first test MKV file
4. Monitor Dashboard for real-time updates
5. Verify upload completed successfully
6. Check uploaded file on destination server
7. Test error handling (disconnect SSH, etc.)
8. Fine-tune per-server settings

---

## Support / Debugging

### Enable Debug Logging

```bash
# Edit docker-compose.yml
environment:
  LOG_LEVEL: debug

# Rebuild and restart
docker-compose build wayfinderr-backend
docker-compose up -d
```

### Check Network Connectivity

```bash
# Test backend from frontend container (the proxy uses this address)
docker-compose exec wayfinderr-frontend wget -qO- http://wayfinderr-backend:3001/health

# Test SSH from backend
docker-compose exec wayfinderr-backend ssh -v user@host
```

### Reset Everything

```bash
# Stop and remove ALL containers and volumes
docker-compose down -v

# Rebuild from scratch
docker-compose build
docker-compose up -d
```

---

## Architecture

```
        Browser (http://localhost:3000, or HTTPS via a reverse proxy)
            │
┌───────────┼─────────────────────────────────────────────────┐
│           │             Docker Compose Network              │
├───────────┼─────────────────────────────────────────────────┤
│           ▼                                                 │
│  ┌─────────────────┐  /api   ┌─────────────────┐  ┌───────┐ │
│  │    Frontend     │  /ws    │     Backend     │  │MakeMKV│ │
│  │  Next.js Port   │────────►│  Express Port   │◄─┤Docker │ │
│  │      3000       │  proxy  │ 3001 (internal) │  │ 5800  │ │
│  └─────────────────┘         └────────┬────────┘  └───────┘ │
│                                       │                     │
│                              ┌────────▼───────┐             │
│                              │  SQLite DB     │             │
│                              │ Uploads/Servers│             │
│                              │ Login account  │             │
│                              └────────────────┘             │
│                                                             │
└─────────────────────────────────────────────────────────────┘
                           │
         ┌─────────────────┴────────────────┐
         ▼                                  ▼
    ┌──────────┐                    ┌──────────┐
    │Ultra.cc  │◄───── SCP ────►    │Ultra.cc  │
    │Server 1  │                    │Server 2  │
    └──────────┘                    └──────────┘
```

---

## License & Attribution

Built with:
- Next.js 14
- Express.js
- Prisma ORM
- WebSocket
- Docker
- Tailwind CSS / Shadcn/ui

---

## Questions?

Check the detailed documentation:
- `FASE1-Summary.md` - Backend foundation
- `FASE2-Summary.md` - Upload and server logic
- `FASE3-ENHANCEMENTS.md` - Frontend improvements
- `TESTING-GUIDE.md` - Comprehensive testing
- `README.md` (root) - Project overview
