# System Architecture

Deep dive into Wayfinderr's design and components.

## High-Level Architecture

```
     Browser (LAN, or HTTPS through a reverse proxy)
            │ pages, /api, /health, /ws
┌───────────┼─────────────────────────────────────────────────┐
│           │            Docker Network (bridge)              │
├───────────┼─────────────────────────────────────────────────┤
│           ▼                                                 │
│  ┌─────────────────┐         ┌─────────────────┐  ┌───────┐ │
│  │    Frontend     │  /api   │     Backend     │  │MakeMKV│ │
│  │  Next.js 3000   │────────►│  Express 3001   │◄─┤ 5800  │ │
│  │   (published)   │  /ws    │ (not published) │  └───────┘ │
│  └─────────────────┘  proxy  └────────┬────────┘  watch dir │
│                                       │                     │
│                              ┌────────▼──────────┐          │
│                              │ SQLite Database   │          │
│                              │  (Persistence)    │          │
│                              └───────────────────┘          │
└─────────────────────────────────────────────────────────────┘
                  │              │
         ┌────────▼──┐    ┌──────▼────────┐
         │Ultra.cc   │    │Ultra.cc       │
         │Server 1   │    │Server 2       │
         └───────────┘    └───────────────┘
         (SCP Upload)     (SCP Upload)
```

The browser only talks to the frontend. It proxies `/api`, `/health` and the `/ws` WebSocket to the backend over the Docker network (service name `wayfinderr-backend`), so the backend publishes no port and a reverse proxy needs a single entry pointing at the frontend.

## Component Details

### Frontend (Next.js 14 + React)

**Responsibilities:**
- Real-time dashboard display
- Server management CRUD
- Upload history browsing
- Setup and login screens, account menu
- Same-origin proxy: `/api`, `/health` and `/ws` to the backend (`next.config.js` rewrites, `BACKEND_URL` compiled in at build time)

**Architecture:**
```
next.config.js            # Proxy rewrites, security headers
app/                      # Next.js pages
├── layout.tsx            # Root layout: <AuthGate><AppShell/></AuthGate>
├── page.tsx              # Dashboard
├── servers/page.tsx      # Server management
└── uploads/
    ├── page.tsx          # Upload list
    └── [id]/page.tsx     # Upload details

components/               # Reusable components
├── auth-gate.tsx         # Loading / unreachable / setup / login screens
├── account-menu.tsx      # Change password, sign out, sign out everywhere
├── server-dialog.tsx     # Server form dialog
└── ...

lib/                      # Utilities
├── api.ts               # API client (relative URLs, 401 -> login screen)
├── auth.ts              # Zustand auth store
├── config.ts            # WebSocket URL (same host, /ws)
├── store.ts             # Zustand store (state management)
└── useRealtime.ts       # WebSocket hook
```

**State Management:**
- Zustand for client state
- WebSocket for server state sync
- URL params for page navigation

### Backend (Express + TypeScript)

**Responsibilities:**
- File watching and detection
- Media information extraction
- Server space management
- Upload coordination
- WebSocket real-time updates
- Login, sessions and cross-site checks

**Architecture:**
```
src/
├── index.ts                 # Entry point
│                           # - Express app setup
│                           # - WebSocket server (/ws, cookie auth)
│                           # - File watcher initialization
├── cli.ts                   # reset-auth (forgotten password)
│
├── config/
│   ├── index.ts            # Environment variables
│   └── logger.ts           # Pino logger setup
│
├── services/
│   ├── fileWatcher.ts      # Chokidar + debounce
│   ├── mediaInfo.ts        # FFprobe integration
│   ├── serverManager.ts    # Ultra.cc API client
│   ├── uploadManager.ts    # SSH/SCP handler
│   ├── jobQueue.ts         # p-queue job queue
│   ├── auth.ts             # Account, scrypt hashes, signed session tokens, setup code
│   ├── loginLimiter.ts     # 5 failures / 15 min per client
│   └── database.ts         # Prisma wrapper
│
├── middleware/
│   └── security.ts         # Cross-site guard, requireAuth
│
├── routes/
│   ├── auth.ts             # /api/auth endpoints
│   ├── servers.ts          # Server endpoints
│   ├── uploads.ts          # Upload endpoints
│   └── space.ts            # Space info endpoints
│
└── types/
    └── index.ts            # TypeScript interfaces
```

**Data Flow:**

1. **File Detection**
   ```
   chokidar watches /makemkv-output
        ↓
   Debounce 500ms (wait for write completion)
        ↓
   Emit file-detected event
        ↓
   Job queue receives job
   ```

2. **Media Parsing**
   ```
   Job queue processes file
        ↓
   FFprobe extracts streams
        ↓
   Check for ita audio OR ita subs
        ↓
   If match: continue to upload
      If no match: mark SKIPPED
   ```

3. **Server Selection**
   ```
   Query Ultra.cc API for both servers
        ↓
   Compare free space
        ↓
   Select server with more space
        ↓
   If primary fails: failover to secondary
   ```

4. **Upload & Retry**
   ```
   Create SSH connection
        ↓
   Transfer via SCP
        ↓
   Emit progress events
        ↓
   On error:
   - Increment retry count
   - Wait (backoff)
   - Retry (max 3 times)
   - If all fail: mark FAILED
   ```

### Database (SQLite + Prisma)

**Schema:**

```prisma
model Server {
  id              String    @id @default(cuid())
  name            String
  apiEndpoint     String
  apiToken        String
  sshHost         String
  sshPort         Int       @default(22)
  sshUsername     String
  sshPath         String    @default("/")
  
  maxRetries      Int       @default(3)
  backoffStrategy String    @default("exponential")
  
  lastSpaceCheckAt DateTime?
  cachedFreeSpaceBytes String?
  
  uploads         Upload[]
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt
}

model Upload {
  id              String    @id @default(cuid())
  filename        String
  filepath        String
  size            BigInt
  
  mediaInfo       Json      # { audioTracks: [...], subtitles: [...] }
  hasItalianAudio Boolean
  hasItalianSubtitles Boolean
  
  serverId        String
  server          Server    @relation(fields: [serverId], references: [id], onDelete: Cascade)
  
  status          String    # PENDING|QUEUED|UPLOADING|COMPLETED|FAILED|SKIPPED
  progress        Int       @default(0)
  progressBytes   BigInt    @default(0)
  
  error           String?
  currentRetryCount Int    @default(0)
  retryStrategy   String   @default("exponential")
  
  startedAt       DateTime?
  completedAt     DateTime?
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt
}

model Setting {             # key/value: login account, session signing key
  key             String    @id
  value           String
  updatedAt       DateTime  @updatedAt
}
```

## API Contracts

### WebSocket Messages (Server → Client)

```json
{
  "type": "upload-detected",
  "data": { "filename": "file.mkv" }
}

{
  "type": "upload-queued",
  "data": { "uploadId": "...", "position": 1 }
}

{
  "type": "progress",
  "data": { "uploadId": "...", "progress": 45, "speed": "5MB/s" }
}

{
  "type": "upload-completed",
  "data": { "uploadId": "...", "serverId": "..." }
}

{
  "type": "upload-failed",
  "data": { "uploadId": "...", "error": "SSH timeout" }
}

{
  "type": "upload-skipped",
  "data": { "uploadId": "...", "reason": "No Italian audio/subs" }
}
```

### REST API Endpoints

See [API.md](./API.md) for detailed documentation.

## Concurrency Model

### Job Queue (p-queue)

```
Upload Queue
├── Global concurrency: 2
├── Per-server concurrency: 1
└── Queue strategy:
    1. File detected → job created
    2. Job queued with priority
    3. Concurrent processor picks up job
    4. If server busy: keep in queue
    5. When server free: start upload
```

**Example:**
```
Time  Server1  Server2  Queue
T0    Upload1  Upload2  Upload3, Upload4
T1    Upload1  Upload2  Upload3, Upload4
T2    Upload1 (done)    Upload3, Upload4
T3    Upload3  Upload2  Upload4
T4    Upload3  Upload2  Upload4
T5    Upload3 (done)    Upload4
T6    Upload4  Upload2  (empty)
```

## Error Handling

### Retry Logic

```
Upload fails
    ↓
currentRetryCount < maxRetries?
    ├─ YES:
    │   ├─ Calculate backoff delay
    │   │   ├─ Exponential: 100ms × 2^attempt
    │   │   └─ Linear: 100ms × attempt
    │   ├─ Wait
    │   └─ Retry
    │
    └─ NO: Mark FAILED
```

### Error Types

| Error | Cause | Handling |
|-------|-------|----------|
| SSH Connection Timeout | Network/SSH issues | Retry with backoff |
| Invalid Credentials | Wrong SSH/API token | Fail, no retry |
| File Not Found | MakeMKV not finished | Retry |
| Disk Full | Server out of space | Fail with error |
| Invalid Media | No Italian content | Skip, no retry |

## Security Considerations

1. **Credentials Storage**
   - API tokens and SSH passwords stored in database, never returned by the API (`hasApiToken`, `hasSshPassword`)
   - SSH keys via filesystem/environment
   - No credential caching beyond session

2. **Access Control**
   - One account (username + scrypt password hash) in the `Setting` table; until it exists the other `/api` routes answer 401 `auth_setup_required`, and creating it takes the one-time setup code printed in the backend log (or `WAYFINDERR_SETUP_CODE`)
   - Sessions: HMAC-signed token in the HttpOnly, SameSite=Lax cookie `wayfinderr_session` (`Secure` on HTTPS, via `X-Forwarded-Proto`), valid 30 days. Changing the password or "sign out everywhere" bumps a token version: older sessions stop working and open WebSockets close with code 4401
   - A session is required for every `/api` route except `/api/auth`, and for the `/ws` WebSocket
   - Unsafe methods and the WebSocket are refused when cross-site (`Sec-Fetch-Site`, else `Origin` vs `X-Forwarded-Host`/`Host`)
   - Failed logins, wrong setup codes and wrong current passwords: 5 per 15 minutes per client (`X-Forwarded-For` from the reverse proxy)
   - Forgotten password: `node dist/cli.js reset-auth` in the backend container deletes the account
   - Database backups contain the password hash and the session key: keep them private

3. **Data Validation**
   - Filename validation before upload
   - Media info parsing sandboxed
   - API responses validated

## Performance Characteristics

### Benchmarks (Typical)

| Operation | Time | Notes |
|-----------|------|-------|
| File detection | <100ms | After debounce |
| Media parsing | 1-3s | Depends on file size |
| Server space check | 500ms-2s | API call with caching |
| 100MB upload | ~20s | At 5MB/s average |
| 1GB upload | ~3min | At 5MB/s average |
| DB query (100 records) | <10ms | Indexed queries |

### Optimization Techniques

1. **Caching**: Server space cached 60s
2. **Debouncing**: File detection debounced 500ms
3. **Connection Pooling**: SSH connections reused
4. **Async Processing**: All I/O is non-blocking
5. **Database Indexes**: Indexed on status, createdAt

## Scaling Considerations

### Limitations

- Single process: can't scale horizontally
- SQLite: suitable for <100k uploads
- Single machine: CPU/memory bound

### Future Improvements

1. Move to PostgreSQL for multi-node setup
2. Add Redis for caching/sessions
3. Split services (separate workers)
4. Add load balancing (nginx)
5. Database sharding/partitioning
