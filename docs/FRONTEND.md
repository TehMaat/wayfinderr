# Wayfinderr - Fase 3 Enhancements

## Overview
This document outlines the complete enhancements made to the frontend implementation to integrate with the backend API and provide full functionality.

## New Files Created

### 1. **lib/api.ts** - API Client Utilities
- Centralized axios client with relative URLs: the browser only talks to the Next.js server, which proxies `/api`, `/health` and `/ws` to the backend (rewrites in `next.config.js`, `BACKEND_URL` compiled in at build time)
- A 401 `auth_required` / `auth_setup_required` brings back the login / setup screen
- API methods grouped by domain:
  - `authApi`: status, setup, login, logout, change password, sign out everywhere
  - `serversApi`: CRUD operations for servers, test, refresh space
  - `uploadsApi`: List uploads, get details, retry failed uploads
  - `spaceApi`: Get space information for all/single servers

### 2. **components/ServerForm.tsx** - Reusable Server Form
- Form component for creating and editing servers
- Handles all server configuration fields:
  - Server name, API endpoint, API token
  - SSH host, port, username
- Error handling with user-friendly messages
- Loading state during submission
- onSuccess/onCancel callbacks for parent integration

### 3. **components/Modal.tsx** - Modal Dialog Component
- Reusable modal wrapper for dialogs
- Simple close button (×)
- Responsive sizing and overflow handling
- Integrates with ServerForm for add/edit operations

## Updated Pages

### 4. **app/servers/page.tsx** - Server Management Page
Enhanced with:
- Real-time server list with space information
- Add/Edit/Delete/Test buttons for each server
- Modal-based form for server creation/editing
- Space refresh functionality
- Error handling and loading states
- Delete confirmation dialog
- Server test functionality to verify connectivity

#### Key Features:
```typescript
- fetchServers(): Loads all servers with current space info
- handleTestServer(): Tests SSH/API connectivity to a server
- handleDeleteServer(): Removes a server with confirmation
- handleFormSuccess(): Refreshes data after form submission
```

### 5. **app/page.tsx** - Dashboard
Updated to use API client utilities:
- Loads uploads and servers via `uploadsApi` and `spaceApi`
- Real-time status display of current upload
- Statistics: total uploads, completed, failed, queue size
- Recent uploads list with Italian media indicators

### 6. **app/uploads/page.tsx** - Upload History
Enhanced with:
- Loading state during data fetch
- Error display for failed API calls
- Retry button for failed uploads
- Status badges with color coding:
  - Green: COMPLETED
  - Red: FAILED
  - Blue: UPLOADING
  - Yellow: PENDING/QUEUED
- Media info icons (🔊 for audio, 📝 for subtitles)

### 7. **app/uploads/[id]/page.tsx** - Upload Detail Page (NEW)
New detail page showing:
- Full upload information with filename and size
- Status with color-coded badge
- Upload progress percentage
- Creation and completion timestamps
- Media information (Italian audio/subtitles presence)
- Error message display (if any)
- Retry button for failed uploads
- Navigation back to upload list

## State Management

### Zustand Store (lib/store.ts)
Already implemented with:
```typescript
interface Upload {
  id: string;
  filename: string;
  size: bigint;
  status: 'PENDING' | 'QUEUED' | 'UPLOADING' | 'COMPLETED' | 'FAILED' | 'SKIPPED' | 'CANCELLED';
  progress: number;
  hasItalianAudio: boolean;
  hasItalianSubtitles: boolean;
  createdAt: string;
  completedAt?: string;
  error?: string;
}

interface Server {
  id: string;
  name: string;
  freeSpaceBytes: string;
  freeSpaceGB: string;
  lastSpaceCheckAt?: string;
}
```

## Login

- **components/auth-gate.tsx** wraps the app (`app/layout.tsx`): loading, "backend not reachable", setup (setup code from the backend log, username, password of at least 8 characters) and login screens, until there is a valid session
- **components/account-menu.tsx**, at the bottom of the sidebar: change password (signs out other devices), sign out, sign out everywhere
- **lib/auth.ts**: Zustand auth store
- The session is an HttpOnly cookie: the page never reads it, the browser sends it with every same-origin request
- The edit server dialog leaves the API token blank: the API never returns it (`hasApiToken`), and a blank token keeps the saved one

## WebSocket Integration

The frontend maintains real-time connectivity via WebSocket (lib/useRealtime.ts) on `/ws` of the page's own host (`ws://` or `wss://`):
- Listens for events: `upload-detected`, `upload-queued`, `progress`, `upload-completed`, `upload-failed`, `upload-skipped`, `upload-cancelled`
- Updates store automatically on events
- Implements reconnection logic
- Close code 4401 (password changed or signed out everywhere): the page checks its session and shows the login screen if it has ended
- All pages subscribe to real-time updates

## Error Handling

### Implemented Across All Pages:
1. **API Error Display**: Red alert boxes show error messages
2. **Loading States**: Buttons and content show loading indicators
3. **Retry Functionality**: Failed uploads can be retried with one click
4. **Toast-like Notifications**: Could be added via a notification component

## Styling & UI

All components follow the existing design system:
- Dark theme with slate colors (900-700)
- Blue accent color (#2563eb) for primary actions
- Color-coded status badges
- Responsive grid layouts (1 col mobile, 2+ col desktop)
- Consistent spacing and typography

## Component Usage Example

```tsx
// Servers page uses Modal + ServerForm
<Modal
  isOpen={showAddModal || editingServer !== null}
  title={editingServer ? 'Edit Server' : 'Add New Server'}
  onClose={() => {
    setShowAddModal(false);
    setEditingServer(null);
  }}
>
  <ServerForm
    server={editingServer ? selectedServer : undefined}
    onSuccess={handleFormSuccess}
    onCancel={() => setShowAddModal(false)}
  />
</Modal>
```

## API Endpoints Used

### Auth API
- `GET /api/auth/status`, `POST /api/auth/setup`, `POST /api/auth/login`, `POST /api/auth/logout`
- `POST /api/auth/change-password`, `POST /api/auth/logout-everywhere`

### Servers API
- `GET /api/servers` - List all servers
- `POST /api/servers` - Create new server
- `PUT /api/servers/:id` - Update server
- `DELETE /api/servers/:id` - Delete server
- `POST /api/servers/:id/test` - Test server connectivity

### Uploads API
- `GET /api/uploads?limit=50` - List uploads
- `GET /api/uploads/:id` - Get upload details
- `POST /api/uploads/:id/retry` - Retry failed upload
- `POST /api/uploads/:id/cancel` - Stop a queued or running upload

### Space API
- `GET /api/space` - Get all servers' space info
- `GET /api/space/:id` - Get specific server space
- `POST /api/space/:id/refresh` - Refresh space cache

### Rips API
- `GET /api/rips`, `GET /api/rips/:id` - Rips and the ripping status
- `POST /api/rips/:id/choose`, `POST /api/rips/:id/retry`, `POST /api/rips/:id/skip`
- `PUT /api/rips/exclusions` - Ignored folders, "downloads arrive complete", and rules for the discs that are never ripped
- `GET /api/rips/folders` - Subfolders of the downloads, for picking the ignored folders
- `GET /api/rips/tmdb/search?query=&year=` - Search a film on TMDB

### System API
- `GET /api/system/disks` - Disks holding the watch folder and the database

## Next Steps / Testing

### Phase 4 - Docker & Testing:
1. Build Docker containers:
   ```bash
   docker-compose build
   ```

2. Run the full stack:
   ```bash
   docker-compose up -d
   ```

3. Test endpoints:
   - Frontend (also proxies the API): http://localhost:3000
   - MakeMKV: http://localhost:5800

4. Verify:
   - Create the account with the setup code from the backend log
   - Add test servers in UI
   - Test connectivity to Ultra.cc servers
   - Monitor upload history
   - Check real-time WebSocket updates

## Known Limitations

1. **Form Validation**: Basic HTML validation only, could add Zod/Yup
2. **Toasts/Notifications**: Using alert-style boxes, could add toast library
3. **Pagination**: Currently loads up to 50 uploads, could add pagination UI
4. **Upload Detail Page**: Could add more detailed media info visualization
5. **Settings Page**: Not yet implemented for global app configuration

## Recommendations for Future Enhancement

1. Add form validation library (Zod or Yup)
2. Implement toast notification system (react-hot-toast)
3. Add server health status indicator
4. Create settings/configuration page
5. Add real-time chart for server space trends
6. Implement file upload drag-and-drop (if needed)
7. Add internationalization (i18n) for Italian/English
