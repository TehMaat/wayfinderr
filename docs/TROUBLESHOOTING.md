# Troubleshooting Guide

Common issues and solutions.

## Services Won't Start

### Issue: "Docker daemon is not running"

**Solution:**
```bash
# Start Docker
docker-compose up -d

# If on macOS
open -a Docker
```

### Issue: Port 3000/5800 already in use (3001 too for a local run)

**Solution:**

Find and kill existing process:
```bash
lsof -i :3000
kill -9 <PID>
```

Or change ports in `docker-compose.yml`:
```yaml
services:
  wayfinderr-frontend:
    ports:
      - "3100:3000"  # Changed to 3100
```

### Issue: "docker-compose command not found"

**Solution:**

Install Docker Compose:
```bash
# macOS (Homebrew)
brew install docker-compose

# Ubuntu
sudo apt-get install docker-compose

# Or use newer Docker (includes compose)
docker compose up -d
```

## Frontend Issues

### Issue: Frontend won't load (blank page)

**Solution:**

1. Check the frontend reaches the backend (no login needed):
```bash
curl http://localhost:3000/health
```

2. Check browser console for errors (F12)

3. Clear cache:
```bash
# Hard refresh
Ctrl+Shift+R  # Windows/Linux
Cmd+Shift+R   # macOS
```

4. Check frontend logs:
```bash
docker-compose logs wayfinderr-frontend
```

### Issue: "The backend is not reachable right now"

The browser only talks to the frontend, which proxies `/api`, `/health` and `/ws` to the backend at `BACKEND_URL`, compiled into the image (default `http://wayfinderr-backend:3001`). The backend port is not published.

**Solution:**

1. Verify backend is running:
```bash
docker-compose ps | grep wayfinderr-backend
```

2. Check backend logs:
```bash
docker-compose logs wayfinderr-backend
```

3. Try the proxy and the backend from the frontend container:
```bash
curl http://localhost:3000/health
docker-compose exec wayfinderr-frontend wget -qO- http://wayfinderr-backend:3001/health
```

4. If the name does not resolve, both containers must share a Docker network and the backend must be reachable as `wayfinderr-backend` (service or container name, or `extra_hosts` on the frontend). For another address, rebuild the frontend with `--build-arg BACKEND_URL=...`; in a local run set `BACKEND_URL` in `frontend/.env` and restart `npm run dev` (rebuild for `npm start`).

## Login Issues

### Issue: Where is the setup code?

**Solution:**

It is printed in the backend log while no account exists:
```bash
docker-compose logs wayfinderr-backend | grep "setup code"
# or, if the container is named wayfinderr-backend:
docker logs wayfinderr-backend 2>&1 | grep "setup code"
```

- It is logged as a warning: it does not show with `LOG_LEVEL=error`.
- Each backend start without an account prints a new random code; use the latest one. To fix it, set `WAYFINDERR_SETUP_CODE` for the backend.
- Treat it as a secret: whoever has it can create the account.

### Issue: Forgotten password

**Solution:**

```bash
docker-compose exec wayfinderr-backend node dist/cli.js reset-auth
```

This deletes the account and signs out every session (servers and history are kept). Reopen the page: the setup screen is back, and the log has a new setup code. In a local run: `cd backend && npm run build && npm run reset-auth`.

### Issue: "Too many attempts: try again in N min"

**Solution:**

5 failed logins (or setup codes, or current passwords) in 15 minutes from the same client block it until the oldest failure is 15 minutes old. Wait, or restart the backend (the count is kept in memory).

The client is the address the reverse proxy forwards in `X-Forwarded-For`. Without a reverse proxy the backend only sees the frontend, so every device shares the same count.

### Issue: Signed out on every device

**Solution:**

Expected after **Change password** (signs out every other device) or **Sign out everywhere**. Sessions also end after 30 days. Sign in again.

### Issue: "Cross-site request refused" behind a reverse proxy

**Solution:**

The reverse proxy must pass the original `Host` header: the backend compares it with the page's `Origin` when the browser sends no `Sec-Fetch-Site`. Traefik and Pangolin do by default; in nginx use `proxy_set_header Host $host;`. Point the proxy at the frontend, never at the backend. See [DEPLOYMENT.md](./DEPLOYMENT.md#reverse-proxy-https).

### Issue: No live updates behind a reverse proxy

**Solution:**

The WebSocket is `/ws` on the same address as the page. Traefik and Pangolin need no extra settings. nginx needs `proxy_http_version 1.1` and the `Upgrade`/`Connection` headers for `/ws` (example in [DEPLOYMENT.md](./DEPLOYMENT.md#nginx)).

## Backend Issues

### Issue: Backend crashes on startup

**Solution:**

Check logs for errors:
```bash
docker-compose logs wayfinderr-backend | tail -50
```

Common causes:
- Port already in use
- Database permission issue
- Missing environment variables

### Issue: "Database is locked"

**Solution:**

```bash
# Restart backend to release lock
docker-compose restart wayfinderr-backend

# Or reset database
docker-compose exec wayfinderr-backend rm /app/data/wayfinderr.db
docker-compose restart wayfinderr-backend
```

### Issue: "Cannot connect to socket"

**Solution:**

```bash
# Ensure database file exists
docker-compose exec wayfinderr-backend ls -la /app/data/

# Or recreate database
docker-compose exec wayfinderr-backend rm /app/data/wayfinderr.db
docker-compose exec wayfinderr-backend npx prisma migrate dev
```

## Server Configuration Issues

### Issue: Server test fails - "Connection refused"

**Solution:**

1. Verify credentials:
   - Check API endpoint is correct
   - Verify API token is valid
   - Test API manually:
   ```bash
   curl -H "Authorization: Bearer YOUR_TOKEN" \
     https://user.host.usbx.me/ultra-api/get_diskquota
   ```

2. Check SSH connectivity:
   ```bash
   ssh -v user@host.usbx.me
   ```

3. Check firewall allows SSH (port 22)

4. Check backend logs:
   ```bash
   docker-compose logs wayfinderr-backend | grep -i "test\|ssh"
   ```

### Issue: "Permission denied" on SSH

**Solution:**

1. Check SSH key permissions:
   ```bash
   chmod 600 ~/.ssh/id_rsa
   chmod 700 ~/.ssh
   ```

2. Add key to SSH agent:
   ```bash
   ssh-add ~/.ssh/id_rsa
   ```

3. Use key-based auth in Wayfinderr (future feature)

### Issue: "Invalid API token"

**Solution:**

1. Verify token format:
   - Should start with API credentials
   - No spaces or extra characters
   - Check for expiration

2. Generate new token from Ultra.cc panel

3. Update in Wayfinderr UI

## Upload Issues

### Issue: Files not detected

**Solution:**

1. Verify watch directory:
```bash
docker-compose exec wayfinderr-backend ls -la /makemkv-output/
```

2. Check file watcher logs:
```bash
docker-compose logs wayfinderr-backend | grep -i "detected\|watch"
```

3. Verify file path is correct in `docker-compose.yml`

4. Check file isn't being written to (wait for MakeMKV to finish)

### Issue: "File permission denied"

**Solution:**

```bash
# Check MakeMKV output permissions
docker-compose exec wayfinderr-backend ls -la /makemkv-output/

# Fix permissions if needed
docker-compose exec wayfinderr-backend chmod 644 /makemkv-output/*
```

### Issue: Upload gets stuck at 0%

**Solution:**

1. Check SSH connection:
```bash
docker-compose exec wayfinderr-backend ssh -v user@host
```

2. Check destination disk space:
```bash
docker-compose logs wayfinderr-backend | grep -i "disk\|full\|space"
```

3. Check file is accessible:
```bash
docker-compose exec wayfinderr-backend file /makemkv-output/filename.mkv
```

4. Stop and check logs:
```bash
docker-compose restart wayfinderr-backend
docker-compose logs -f wayfinderr-backend
```

### Issue: Upload fails with "No Italian content"

**Solution:**

1. Verify file has Italian audio/subs:
```bash
docker-compose exec wayfinderr-backend \
  ffprobe /makemkv-output/filename.mkv 2>&1 | grep -i language
```

2. Should show `language=ita` for audio or subtitles

3. If not present, the file is correctly skipped

4. To disable this check (future feature): Configure per-server policy

## Database Issues

### Issue: Database file is missing

**Solution:**

```bash
# Recreate database with migrations
docker-compose exec wayfinderr-backend npx prisma migrate dev

# Or just restart (auto-migration runs)
docker-compose restart wayfinderr-backend
```

### Issue: Database query errors

**Solution:**

```bash
# Check database integrity
docker-compose exec wayfinderr-backend sqlite3 /app/data/wayfinderr.db "PRAGMA integrity_check;"

# If corrupted, backup and reset
docker-compose exec wayfinderr-backend cp /app/data/wayfinderr.db /app/data/wayfinderr.db.backup
docker-compose exec wayfinderr-backend rm /app/data/wayfinderr.db
docker-compose restart wayfinderr-backend
```

## Performance Issues

### Issue: High CPU/Memory usage

**Solution:**

1. Check what's consuming resources:
```bash
docker stats wayfinderr-backend wayfinderr-frontend
```

2. Check for queued uploads:
```bash
docker-compose logs wayfinderr-backend | grep -i "queue\|upload"
```

3. Check database size:
```bash
docker-compose exec wayfinderr-backend du -h /app/data/wayfinderr.db
```

4. Restart containers:
```bash
docker-compose restart
```

### Issue: Slow uploads

**Solution:**

1. Check network speed:
```bash
# From backend container
docker-compose exec wayfinderr-backend \
  dd if=/dev/zero bs=1M count=100 | ssh user@host "dd of=/tmp/test.bin"
```

2. Check server disk I/O:
```bash
ssh user@host "iostat -x 1"
```

3. Check file size:
   - Large files (>2GB) may be slower
   - SCP doesn't support resume (downloads full)

## Logging & Debugging

### Enable Debug Logging

Edit `docker-compose.yml`:
```yaml
environment:
  LOG_LEVEL: debug
```

Rebuild and restart:
```bash
docker-compose build wayfinderr-backend
docker-compose up -d
```

### View All Logs

```bash
# Real-time logs
docker-compose logs -f

# Last 100 lines
docker-compose logs --tail 100

# Specific service
docker-compose logs -f wayfinderr-backend

# Filter by keyword
docker-compose logs wayfinderr-backend | grep error
```

### Check Health

```bash
# All services
docker-compose ps

# Specific service
docker-compose ps wayfinderr-backend

# Resource usage
docker stats

# Network
docker network ls
```

## Getting Help

1. **Check logs first:**
```bash
docker-compose logs | tail -100
```

2. **Search GitHub issues:**
   - Look for similar problems
   - Check closed issues

3. **Open new issue:**
   - Include error logs
   - Steps to reproduce
   - Your environment (OS, Docker version)

4. **Check documentation:**
   - QUICK-START.md
   - ARCHITECTURE.md
   - API.md
