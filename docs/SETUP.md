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

Test API endpoint:

```bash
curl http://localhost:3001/api/space
```

Expected response:
```json
[]  # Empty array (no servers configured yet)
```

Open browser to http://localhost:3000 - Dashboard should load.

## Initial Configuration

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

Backend will start at http://localhost:3001

### Frontend

In a new terminal:

```bash
cd frontend
npm install
npm run dev
```

Frontend will start at http://localhost:3000

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
If ports 3000, 3001, or 5800 are in use:

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
