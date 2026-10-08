'use client';

import Link from 'next/link';
import { ExternalLink, FileVideo } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tooltip } from '@/components/ui/tooltip';
import { RipActions } from '@/components/rip-actions';
import { RipStatusBadge, StatusBadge } from '@/components/status-badge';
import { languageName, ripName, tmdbUrl } from '@/lib/rips';
import { useAppStore, type Rip } from '@/lib/store';
import { basename, cn, formatRuntime, timeAgo } from '@/lib/utils';

/** The upload of the ripped file, live from the uploads list when it is there */
function useRipUpload(rip: Rip) {
  const live = useAppStore((s) =>
    s.uploads.find((u) => (rip.upload ? u.id === rip.upload.id : rip.outputFile !== null && u.filepath === rip.outputFile))
  );
  return live ? { id: live.id, status: live.status, progress: live.progress } : rip.upload;
}

function FilmCell({ rip }: { rip: Rip }) {
  const original = rip.originalTitle && rip.originalTitle !== rip.title ? rip.originalTitle : null;
  const sub = rip.title
    ? [original, rip.originalLanguage && languageName(rip.originalLanguage)].filter(Boolean).join(' · ')
    : rip.status === 'DONE'
      ? 'Not identified on TMDB'
      : 'Not identified yet';
  return (
    <div className="min-w-0 space-y-0.5">
      <div className="flex min-w-0 items-center gap-1.5">
        <span className={cn('truncate', rip.title ? 'font-medium' : 'text-foreground/90')}>{ripName(rip)}</span>
        {rip.tmdbId && (
          <Tooltip content="Open on TMDB">
            <a
              href={tmdbUrl(rip.tmdbId)}
              target="_blank"
              rel="noreferrer"
              className="shrink-0 text-muted-foreground hover:text-primary"
              aria-label="Open on TMDB"
            >
              <ExternalLink className="h-3 w-3" />
            </a>
          </Tooltip>
        )}
      </div>
      {sub && <p className="truncate text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

/** The disc's path from the download on ("Movie.2001.BluRay/BDMV"), which tells several discs apart */
const sourceLabel = (rip: Rip) => {
  const at = rip.sourcePath.lastIndexOf(rip.downloadName);
  return at >= 0 ? rip.sourcePath.slice(at) : basename(rip.sourcePath);
};

function SourceCell({ rip }: { rip: Rip }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <Badge variant="outline" className="shrink-0 font-mono">
        {rip.sourceType}
      </Badge>
      <Tooltip content={<span className="break-all font-mono">{rip.sourcePath}</span>} side="bottom">
        <span className="truncate text-xs text-muted-foreground">{sourceLabel(rip)}</span>
      </Tooltip>
    </div>
  );
}

function Reason({ rip, wrap }: { rip: Rip; wrap?: boolean }) {
  const tone =
    rip.status === 'NEEDS_ATTENTION'
      ? 'text-warning'
      : rip.status === 'FAILED'
        ? 'text-destructive'
        : 'text-muted-foreground';
  const text = <span className={cn('block text-xs', tone, !wrap && 'line-clamp-2')}>{rip.reason}</span>;
  return wrap ? text : <Tooltip content={rip.reason}>{text}</Tooltip>;
}

/** What is going on, per status: progress, reason or the resulting file */
function DetailsCell({ rip, wrap }: { rip: Rip; wrap?: boolean }) {
  const upload = useRipUpload(rip);
  const title = rip.titles?.find((t) => t.index === rip.titleIndex);

  switch (rip.status) {
    case 'RIPPING':
      return (
        <div className="flex min-w-0 items-center gap-2">
          <Progress value={rip.progress} animated className={wrap ? 'flex-1' : 'w-28'} />
          <span className="w-9 shrink-0 text-right text-xs tabular text-muted-foreground">{rip.progress}%</span>
          {title && (
            <span className="truncate text-xs text-muted-foreground">
              Title {title.index} · {formatRuntime(title.durationSec)}
            </span>
          )}
        </div>
      );
    case 'DONE':
      return (
        <div className="flex min-w-0 items-center gap-2">
          <FileVideo className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 truncate text-xs">{rip.outputFile ? basename(rip.outputFile) : 'File moved'}</span>
          {upload ? (
            <Link href={`/uploads/${upload.id}`} className="flex shrink-0 items-center gap-1.5 rounded-md hover:opacity-80">
              <StatusBadge status={upload.status} />
              {upload.status === 'UPLOADING' && (
                <span className="text-xs tabular text-muted-foreground">{upload.progress}%</span>
              )}
            </Link>
          ) : (
            <span className="shrink-0 text-xs text-muted-foreground">Waiting for the upload</span>
          )}
        </div>
      );
    case 'WAITING':
      return <span className="text-xs text-muted-foreground">Waiting for the download to finish</span>;
    case 'QUEUED':
      return <span className="text-xs text-muted-foreground">Waiting for MakeMKV</span>;
    case 'SCANNING':
      return <span className="text-xs text-muted-foreground">Reading the disc titles…</span>;
    default:
      return rip.reason ? <Reason rip={rip} wrap={wrap} /> : <span className="text-xs text-muted-foreground">–</span>;
  }
}

export function RipTable({ rips, onChoose }: { rips: Rip[]; onChoose: (rip: Rip) => void }) {
  return (
    <>
      {/* Desktop */}
      <div className="hidden md:block">
        <table className="w-full table-fixed text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground [&>th]:h-9 [&>th]:whitespace-nowrap [&>th]:px-3 [&>th]:font-medium">
              <th className="w-[26%]">Film</th>
              <th className="w-[17%]">Source</th>
              <th className="w-36">Status</th>
              <th>Details</th>
              <th className="hidden w-24 2xl:table-cell">Updated</th>
              <th className="w-28" />
            </tr>
          </thead>
          <tbody>
            {rips.map((rip) => (
              <tr
                key={rip.id}
                className={cn(
                  'border-b border-border/60 transition-colors last:border-0 hover:bg-accent/50 [&>td]:h-14 [&>td]:px-3',
                  rip.status === 'NEEDS_ATTENTION' && 'bg-warning/[0.04]'
                )}
              >
                <td>
                  <FilmCell rip={rip} />
                </td>
                <td>
                  <SourceCell rip={rip} />
                </td>
                <td>
                  <RipStatusBadge status={rip.status} />
                </td>
                <td>
                  <DetailsCell rip={rip} />
                </td>
                <td className="hidden whitespace-nowrap text-xs tabular text-muted-foreground 2xl:table-cell">
                  {timeAgo(rip.updatedAt)}
                </td>
                <td>
                  <RipActions rip={rip} onChoose={onChoose} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile */}
      <div className="divide-y divide-border/60 md:hidden">
        {rips.map((rip) => (
          <div
            key={rip.id}
            className={cn('space-y-2.5 p-3', rip.status === 'NEEDS_ATTENTION' && 'bg-warning/[0.04]')}
          >
            <div className="flex items-start justify-between gap-3">
              <FilmCell rip={rip} />
              <RipStatusBadge status={rip.status} className="mt-0.5 shrink-0" />
            </div>
            <SourceCell rip={rip} />
            <DetailsCell rip={rip} wrap />
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] tabular text-muted-foreground">{timeAgo(rip.updatedAt)}</span>
              <RipActions rip={rip} onChoose={onChoose} />
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
