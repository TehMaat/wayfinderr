# Wayfinderr - Testing Guide (Fase 4)

## Pre-Deployment Checklist

### 1. Environment Setup
- [ ] Docker and Docker Compose installed
- [ ] Node.js 20 LTS installed locally (for testing)
- [ ] Ultra.cc account credentials ready
- [ ] Two destination servers configured
- [ ] SSH keys set up for server access
- [ ] MakeMKV Docker image available (`jlesage/makemkv`)

### 2. Configuration Files Verified
- [ ] `docker-compose.yml` has correct volume paths
- [ ] Environment variables configured:
  - `NODE_ENV=production`
  - `DATABASE_URL=file:./data/wayfinderr.db`
  - `WATCH_DIR=/makemkv-output`
  - `NEXT_PUBLIC_API_URL=http://localhost:3001`

---

## Fase 4: Docker & Testing

### Step 1: Build Docker Images

```bash
# Navigate to project root
cd wayfinderr

# Build all services
docker-compose build

# Verify images were created
docker images | grep wayfinderr
```

**Expected Output:**
```
wayfinderr-backend              latest    <image-id>    ...
wayfinderr-frontend             latest    <image-id>    ...
```

### Step 2: Start the Full Stack

```bash
# Start all services in background
docker-compose up -d

# Verify services are running
docker-compose ps
```

**Expected Output:**
```
NAME                    STATUS
wayfinderr-backend      Up 5 seconds
wayfinderr-frontend     Up 3 seconds
makemkv                 Up 2 seconds
```

### Step 3: Verify Backend Health

```bash
# Check backend logs
docker-compose logs wayfinderr-backend

# Test API endpoint
curl http://localhost:3001/api/space
```

**Expected Response:**
```json
[
  {
    "id": "...",
    "name": "...",
    "freeSpaceBytes": "...",
    "freeSpaceGB": "...",
    "lastSpaceCheckAt": null
  }
]
```

### Step 4: Verify Frontend Health

```bash
# Check frontend logs
docker-compose logs wayfinderr-frontend

# Access frontend in browser
# Open: http://localhost:3000
```

**Expected Behavior:**
- Dashboard loads
- Navigation links work
- No JavaScript errors in browser console

---

## Manual Testing Scenarios

### Test 1: Add Server Configuration

1. Go to http://localhost:3000/servers
2. Click "Add New Server"
3. Fill in form with first server details:
   - **Name**: `Server 1`
   - **API Endpoint**: Your Ultra.cc API endpoint
   - **API Token**: Your API token
   - **SSH Host**: SSH hostname
   - **SSH Port**: `22`
   - **SSH Username**: SSH username
4. Click "Save Server"

**Expected Result:**
- Modal closes
- Server appears in list
- Space info shows in server card
- Database record created: `uploads` table has new `Server` record

**Verification:**
```bash
# Check database
docker-compose exec wayfinderr-backend sqlite3 /app/data/wayfinderr.db
> SELECT * FROM Server;
```

### Test 2: Test Server Connectivity

1. On servers page, click "Test" button for your server
2. Wait for connection attempt

**Expected Result:**
- Button shows "Testing..." while processing
- Space info refreshes and updates `lastSpaceCheckAt`
- No errors displayed

**Verification (if error occurs):**
```bash
docker-compose logs wayfinderr-backend | grep -i "test\|error"
```

### Test 3: Create Test MKV File

```bash
# Create a test MKV with Italian audio using ffmpeg
ffmpeg -f lavfi -i testsrc=duration=1:size=320x240:rate=1 \
  -f lavfi -i sine=frequency=1000:duration=1 \
  -c:v libx264 -preset ultrafast \
  -c:a aac -metadata:s:a:0 language=ita \
  test_with_ita.mkv

# Copy to watch directory (inside container)
# This depends on your setup; typically:
docker-compose cp test_with_ita.mkv wayfinderr-backend:/makemkv-output/test_with_ita.mkv
```

### Test 4: Monitor Upload Detection

1. Keep browser open on Dashboard
2. Copy test MKV to watch directory
3. Monitor logs in real-time:

```bash
docker-compose logs -f wayfinderr-backend | grep -i "detected\|upload\|media"
```

**Expected Sequence:**
```
[FileWatcher] File detected: test_with_ita.mkv
[MediaInfo] Parsing: test_with_ita.mkv
[MediaInfo] Italian audio found: YES
[ServerManager] Selecting server...
[UploadManager] Starting upload to Server 1
[Upload] Progress: 0% → 100%
[Upload] COMPLETED
```

### Test 5: Verify Database Records

```bash
# Connect to SQLite database
docker-compose exec wayfinderr-backend sqlite3 /app/data/wayfinderr.db

# Check uploads table
sqlite> SELECT id, filename, status, hasItalianAudio, createdAt FROM Upload LIMIT 5;

# Check servers table
sqlite> SELECT id, name, lastSpaceCheckAt FROM Server;

# Exit
sqlite> .exit
```

### Test 6: UI Real-Time Updates

1. Start an upload (manually place MKV file)
2. Watch Dashboard for:
   - [ ] "Current Upload" section appears
   - [ ] Progress bar updates in real-time
   - [ ] Status changes from UPLOADING → COMPLETED
   - [ ] Upload appears in Recent Uploads list
   - [ ] Stats update (Total Uploads, Completed count)

### Test 7: Upload History Page

1. Navigate to http://localhost:3000/uploads
2. Verify:
   - [ ] All uploads display in table
   - [ ] Status badges show correct colors
   - [ ] Media info icons display (🔊 and 📝)
   - [ ] Dates are formatted correctly
   - [ ] "View" link works for each upload

### Test 8: Upload Detail Page

1. Click "View" on any upload
2. Verify displays:
   - [ ] Filename and file size
   - [ ] Status badge
   - [ ] Progress percentage
   - [ ] Creation and completion times
   - [ ] Italian audio/subtitles status
   - [ ] Error message (if applicable)

### Test 9: Retry Failed Upload

1. Simulate a failed upload (e.g., wrong SSH credentials)
2. On Uploads page, click "Retry" for failed upload
3. Verify:
   - [ ] Upload status changes to QUEUED
   - [ ] Progress resets to 0%
   - [ ] Upload attempts again
   - [ ] Status updates in real-time

---

## Error Handling Tests

### Test 1: Invalid Server Credentials

1. Add server with incorrect API token
2. Click "Test"
3. **Expected**: Error message displays, connection fails gracefully

### Test 2: SSH Connection Failure

1. Add server with invalid SSH host
2. Upload MKV file
3. **Expected**: Upload fails with clear error message in DB

### Test 3: API Timeout

1. Add server with non-responsive endpoint
2. Click "Test"
3. **Expected**: Timeout after 5 seconds, user-friendly error

### Test 4: Invalid Media File

1. Create file without Italian audio/subtitles
2. Set server policy to `SKIP_NO_ITA`
3. **Expected**: Upload marked as SKIPPED, no retry button

---

## Performance Testing

### Test 1: Concurrent Uploads

```bash
# Create 5 test files
for i in {1..5}; do
  ffmpeg -f lavfi -i testsrc=duration=1:size=320x240:rate=1 \
    -f lavfi -i sine=frequency=1000:duration=1 \
    -c:v libx264 -preset ultrafast \
    -c:a aac -metadata:s:a:0 language=ita \
    test_$i.mkv
done

# Copy all at once
for i in {1..5}; do
  docker-compose cp test_$i.mkv wayfinderr-backend:/makemkv-output/
done
```

**Expected Behavior:**
- Max 2 uploads processing simultaneously
- Others queued with status QUEUED
- No more than 1 per server
- All complete successfully

### Test 2: Memory Usage

```bash
# Monitor container stats during upload
docker stats wayfinderr-backend wayfinderr-frontend
```

**Expected:**
- Backend: <200MB for small files
- Frontend: <100MB at idle
- No memory leaks after multiple uploads

### Test 3: Database Performance

```bash
# After 100+ uploads, check DB size and query time
docker-compose exec wayfinderr-backend sqlite3 /app/data/wayfinderr.db
sqlite> .timer on
sqlite> SELECT COUNT(*) FROM Upload;
sqlite> SELECT * FROM Upload WHERE status='COMPLETED' LIMIT 10;
```

**Expected:**
- Query time <100ms even with 1000+ records
- DB file <10MB for 1000 uploads

---

## Logging & Debugging

### View Logs by Service

```bash
# All services
docker-compose logs

# Backend only
docker-compose logs wayfinderr-backend

# Frontend only
docker-compose logs wayfinderr-frontend

# MakeMKV
docker-compose logs makemkv

# Real-time tail
docker-compose logs -f wayfinderr-backend
```

### Enable Debug Logging

Edit `backend/src/config/logger.ts`:
```typescript
// Change to 'debug' for more verbose output
level: process.env.LOG_LEVEL || 'debug',
```

Then rebuild:
```bash
docker-compose build wayfinderr-backend
docker-compose up -d
```

### Browser DevTools

1. Open http://localhost:3000
2. Press F12 to open DevTools
3. Check:
   - [ ] **Console**: No JavaScript errors
   - [ ] **Network**: API calls returning 200
   - [ ] **Application**: WebSocket connection active

### API Testing with curl

```bash
# List all servers
curl http://localhost:3001/api/servers

# Get space info
curl http://localhost:3001/api/space

# List uploads
curl http://localhost:3001/api/uploads?limit=10

# Get upload details
curl http://localhost:3001/api/uploads/{upload-id}

# Test server
curl -X POST http://localhost:3001/api/servers/{server-id}/test
```

---

## Cleanup & Troubleshooting

### Restart Services

```bash
# Restart all
docker-compose restart

# Restart specific service
docker-compose restart wayfinderr-backend

# Stop and remove all (WARNING: deletes volumes)
docker-compose down

# Down with volumes
docker-compose down -v
```

### View Database

```bash
# Access SQLite CLI
docker-compose exec wayfinderr-backend sqlite3 /app/data/wayfinderr.db

# Common queries
SELECT COUNT(*) FROM Upload;
SELECT * FROM Server;
DELETE FROM Upload WHERE status='FAILED';
```

### Check Disk Space

```bash
docker-compose exec wayfinderr-backend df -h /app/data
```

### View Environment Variables

```bash
docker-compose exec wayfinderr-backend env | grep -E "NODE_ENV|DATABASE_URL|WATCH_DIR"
```

---

## Sign-Off Checklist

- [ ] Docker images build successfully
- [ ] All services start without errors
- [ ] Frontend loads at http://localhost:3000
- [ ] Backend API responds at http://localhost:3001
- [ ] Server CRUD operations work
- [ ] Server connectivity test works
- [ ] File detection works
- [ ] Media info parsing works
- [ ] Upload completes successfully
- [ ] WebSocket real-time updates work
- [ ] UI reflects correct status and progress
- [ ] Database persistence works
- [ ] Error handling is graceful
- [ ] No console errors or warnings

---

## Production Deployment Notes

When deploying to production:

1. Use strong API tokens and SSH keys
2. Enable HTTPS for frontend (nginx reverse proxy)
3. Set `NODE_ENV=production`
4. Enable persistent volumes for database
5. Configure backup strategy for SQLite database
6. Set up monitoring/alerting
7. Use environment variables for sensitive data
8. Regular database maintenance/optimization
9. Monitor disk space on destination servers
10. Implement log rotation for application logs

