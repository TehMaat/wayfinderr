# Installation & Setup Guide

Detailed guide for setting up Wayfinderr from scratch.

## Prerequisites

### System Requirements
- Docker 20.10+
- Docker Compose 1.29+
- 500MB+ free disk space
- Linux, macOS, or Windows with WSL2

### External Requirements
- Two Ultra.cc servers with SSH access
- Ultra.cc API tokens for both servers
- SSH private key or password for authentication

## Installation Steps

### Step 1: Clone Repository

```bash
git clone https://github.com/yourusername/wayfinderr.git
cd wayfinderr
```

### Step 2: Environment Configuration

Copy environment template and configure:

```bash
cp .env.example .env
```

Edit `.env` with your settings (optional - can also configure via UI).

### Step 3: Build Docker Images

```bash
docker-compose build
```

This creates two images:
- `wayfinderr-backend:latest`
- `wayfinderr-frontend:latest`

### Step 4: Start Services

```bash
./scripts/start.sh
# OR
docker-compose up -d
```

Verify all services are running:

```bash
docker-compose ps
```

Expected output:
```
NAME                STATUS
wayfinderr-backend  Up 10s
wayfinderr-frontend Up 8s
makemkv             Up 5s
```

### Step 5: Verify Installation

Test the health endpoint (served through the frontend, which proxies `/api`, `/health` and `/ws` to the backend; the backend port is not published):

```bash
curl http://localhost:3000/health
```

Expected response:
```json
{"status":"ok","queue":0}
```

Open browser to http://localhost:3000 - the setup screen should load.

## Initial Configuration

### Create the Account

1. Copy the one-time setup code from the backend log:
   ```bash
   docker-compose logs wayfinderr-backend | grep "setup code"
   ```
   To choose it yourself, set `WAYFINDERR_SETUP_CODE` in `.env`.
2. On the setup screen, enter the code, a username and a password (at least 8 characters)

Anyone with the code can create the account: treat that log line as a secret and create the account before exposing the app. Sessions last 30 days. Change password, Sign out and Sign out everywhere are in the account menu at the bottom of the sidebar. Forgotten password: `docker-compose exec wayfinderr-backend node dist/cli.js reset-auth`, then reopen the page and use the new setup code from the log.

### Add First Server

1. Open http://localhost:3000/servers
2. Click "Add New Server"
3. Fill in your first Ultra.cc server:

```
Name: Server 1
API Endpoint: https://USERNAME.HOSTNAME.usbx.me/ultra-api/get_diskquota
API Token: your_api_token_here
SSH Host: HOSTNAME.usbx.me
SSH Port: 22
SSH Username: your_ssh_username
```

4. Click "Save Server"
5. Click "Test" button to verify connectivity

### Add Second Server

Repeat the above with your second server credentials.

## Development Setup

To run locally without Docker:

### Backend

```bash
cd backend
cp ../.env.example .env

# Edit .env with your settings
nano .env

# Install dependencies
npm install

# Run database migrations
npx prisma migrate dev

# Start development server
npm run dev
```

Backend will start at http://localhost:3001 (API only)

### Frontend

In a new terminal:

```bash
cd frontend
npm install
npm run dev
```

Frontend will start at http://localhost:3000: open this one. It proxies `/api`, `/health` and `/ws` to the backend at `BACKEND_URL` (default `http://localhost:3001`; set it in `frontend/.env`, see `frontend/.env.example`). The setup code is printed in the backend terminal.

## Database Initialization

Database is automatically initialized on first backend start:

```bash
# Manual migration (if needed)
docker-compose exec wayfinderr-backend npx prisma migrate dev

# View database
docker-compose exec wayfinderr-backend sqlite3 /app/data/wayfinderr.db
```

## Troubleshooting Setup

### Docker won't start
```bash
# Check Docker daemon
docker ps

# Check docker-compose version
docker-compose --version

# Try rebuilding
docker-compose build --no-cache
docker-compose up -d
```

### Port conflicts
If port 3000 or 5800 is in use (the backend's 3001 is not published):

Edit `docker-compose.yml`:
```yaml
services:
  wayfinderr-frontend:
    ports:
      - "3100:3000"  # Changed from 3000:3000
```

Then restart: `docker-compose up -d`

### Database errors
```bash
# Reset database
docker-compose exec wayfinderr-backend rm /app/data/wayfinderr.db

# Restart to reinitialize
docker-compose restart wayfinderr-backend
```

## Next Steps

1. ✅ Installation complete
2. → Add servers in UI
3. → Test server connectivity
4. → Place first test MKV file
5. → Monitor dashboard for upload

See [QUICK-START.md](./QUICK-START.md) for 5-minute walkthrough.
