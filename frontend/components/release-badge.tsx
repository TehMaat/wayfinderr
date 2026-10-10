import { Badge } from '@/components/ui/badge';
import type { ReleaseStatus, Upload } from '@/lib/store';

export const RELEASE_STATUS: Record<
  ReleaseStatus,
  { label: string; variant: 'success' | 'warning' | 'destructive' | 'info' | 'secondary' }
> = {
  CONFIRM: { label: 'Name to confirm', variant: 'warning' },
  RENAMED: { label: 'Renamed', variant: 'success' },
  QUEUED: { label: 'Tracker queued', variant: 'secondary' },
  RUNNING: { label: 'On the tracker…', variant: 'info' },
  NEEDS_INPUT: { label: 'Needs an answer', variant: 'warning' },
  DONE: { label: 'On the tracker', variant: 'success' },
  SKIPPED: { label: 'Tracker skipped', variant: 'secondary' },
  UNKNOWN: { label: 'Tracker unknown', variant: 'warning' },
  FAILED: { label: 'Tracker failed', variant: 'destructive' },
  CANCELLED: { label: 'Tracker stopped', variant: 'secondary' },
};

export const releaseRunning = (u: Upload) =>
  u.releaseStatus === 'QUEUED' || u.releaseStatus === 'RUNNING' || u.releaseStatus === 'NEEDS_INPUT';

/** Renamed and sent to the tracker from the upload history: only once the file is on a server */
export const canRelease = (u: Upload) => u.status === 'COMPLETED' && Boolean(u.serverId) && !releaseRunning(u);

export function ReleaseBadge({ upload }: { upload: Upload }) {
  if (!upload.releaseStatus) return null;
  const meta = RELEASE_STATUS[upload.releaseStatus];
  return <Badge variant={meta.variant}>{meta.label}</Badge>;
}
