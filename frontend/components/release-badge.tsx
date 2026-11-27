import { AlertTriangle, Clapperboard } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Tooltip } from '@/components/ui/tooltip';
import { missingInfo, versionLabel, versionOrigin } from '@/lib/release';
import type { ReleaseStatus, TorrentClient, Upload } from '@/lib/store';

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

/** Renamed and sent to the tracker from the upload history: only once the file is on a server (or released locally) */
export const canRelease = (u: Upload) =>
  u.status === 'COMPLETED' && Boolean(u.serverId || u.localClientId) && !releaseRunning(u);

/**
 * The download client a file not on a server yet can be released on instead of uploaded
 * (its upload stops): the one of its source torrent, else the first set up for it, as the backend picks
 */
export const localReleaseClient = (u: Upload, clients: TorrentClient[]) => {
  if (u.status === 'COMPLETED' || u.status === 'PENDING' || u.status === 'HELD' || u.localClientId) return undefined;
  const ready = clients.filter((c) => c.enabled && c.localRelease);
  return ready.find((c) => c.id === u.torrentClientId) ?? ready[0];
};

export function ReleaseBadge({ upload }: { upload: Upload }) {
  if (!upload.releaseStatus) return null;
  const meta = RELEASE_STATUS[upload.releaseStatus];
  return <Badge variant={meta.variant}>{meta.label}</Badge>;
}

/** What could not be found for this upload, as one warning badge */
export function MissingBadge({ upload }: { upload: Upload }) {
  const missing = missingInfo(upload);
  if (missing.length === 0) return null;
  return (
    <Tooltip content={`Missing: ${missing.join(', ')}`}>
      <Badge variant="warning">
        <AlertTriangle />
        {missing.length === 1 ? `Missing ${missing[0]}` : `Missing ${missing.length}`}
      </Badge>
    </Tooltip>
  );
}

/**
 * The version its release name starts from (issue #108), chosen beforehand; a warning
 * when its sources disagree (the rename waits for a choice). Nothing once released.
 */
export function VersionBadge({ upload }: { upload: Upload }) {
  const v = upload.releaseVersion;
  if (!v || upload.releaseName) return null;
  if (v.toChoose) {
    const said = v.sources.map((s) => `${versionLabel(s.version)} ${versionOrigin(s)}`).join(', ');
    return (
      <Tooltip content={`The sources disagree: ${said}`}>
        <Badge variant="warning">
          <AlertTriangle />
          Version to choose
        </Badge>
      </Tooltip>
    );
  }
  if (!v.version) return null;
  return (
    <Tooltip content={v.origin ? `Version ${versionOrigin({ origin: v.origin, from: v.from })}` : 'Version'}>
      <Badge variant="secondary">
        <Clapperboard />
        {v.version}
      </Badge>
    </Tooltip>
  );
}
