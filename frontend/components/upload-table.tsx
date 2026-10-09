'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Progress } from '@/components/ui/progress';
import { StatusBadge } from '@/components/status-badge';
import { MediaBadges } from '@/components/media-badges';
import { UploadActions } from '@/components/upload-actions';
import { Tooltip } from '@/components/ui/tooltip';
import { ripOfUpload, uploadLanguages } from '@/lib/media';
import { useAppStore, type Upload } from '@/lib/store';
import { cn, formatBytes, formatDate, formatDuration, formatSpeed } from '@/lib/utils';

function ProgressCell({ upload }: { upload: Upload }) {
  const uploading = upload.status === 'UPLOADING';
  const value = upload.status === 'COMPLETED' ? 100 : upload.progress;
  return (
    <div className="flex items-center gap-2">
      <Progress
        value={value}
        animated={uploading}
        className="w-20"
        indicatorClassName={cn(
          upload.status === 'COMPLETED' && 'bg-success',
          upload.status === 'FAILED' && 'bg-destructive',
          upload.status === 'CANCELLED' && 'bg-muted-foreground/40',
          upload.status === 'SKIPPED' && 'bg-warning/60'
        )}
      />
      <span className="w-8 text-right text-xs tabular text-muted-foreground">{value}</span>
    </div>
  );
}

function SpeedCell({ upload }: { upload: Upload }) {
  const transfer = useAppStore((s) => s.transfers[upload.id]);
  if (upload.status !== 'UPLOADING' || !transfer?.speed) {
    return <span className="text-muted-foreground">–</span>;
  }
  const remaining = Number(upload.size) - Number(upload.progressBytes);
  return (
    <span className="tabular">
      {formatSpeed(transfer.speed)}
      <span className="text-muted-foreground"> · {formatDuration(remaining / transfer.speed)}</span>
    </span>
  );
}

/** Italian tracks, and the original language ones unless compact */
function LanguageCells({ upload, compact }: { upload: Upload; compact?: boolean }) {
  const rip = useAppStore((s) => ripOfUpload(s.rips, upload));
  const { italian, original } = uploadLanguages(upload, rip);
  return (
    <>
      <td>
        <MediaBadges language={italian} />
      </td>
      {!compact && (
        <td>
          <MediaBadges language={original} hint="original language" />
        </td>
      )}
    </>
  );
}

export function UploadTable({ uploads, compact }: { uploads: Upload[]; compact?: boolean }) {
  const router = useRouter();

  return (
    <div className="overflow-x-auto scrollbar-thin">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-xs text-muted-foreground [&>th]:h-9 [&>th]:whitespace-nowrap [&>th]:px-3 [&>th]:font-medium">
            <th className="w-full min-w-[10rem]">Name</th>
            <th>Size</th>
            <th>Progress</th>
            <th>Status</th>
            <th>Italian</th>
            {!compact && <th>Original</th>}
            <th>Server</th>
            {!compact && <th>Speed · ETA</th>}
            <th className="hidden 2xl:table-cell">Added</th>
            <th className="w-10" />
          </tr>
        </thead>
        <tbody>
          {uploads.map((upload) => (
            <tr
              key={upload.id}
              onClick={(e) => {
                // Row click opens details, except on interactive elements and on
                // dialogs/menus rendered in portals (React bubbles their events here)
                const target = e.target as HTMLElement;
                if (!e.currentTarget.contains(target) || target.closest('button,a,[role=menuitem]')) return;
                router.push(`/uploads/${upload.id}`);
              }}
              className="cursor-pointer border-b border-border/60 transition-colors last:border-0 hover:bg-accent/50 [&>td]:h-10 [&>td]:whitespace-nowrap [&>td]:px-3"
            >
              <td className="w-full min-w-[10rem] max-w-0">
                <Tooltip content={upload.filepath} side="bottom">
                  <Link href={`/uploads/${upload.id}`} className="block truncate font-medium hover:text-primary">
                    {upload.filename}
                  </Link>
                </Tooltip>
              </td>
              <td className="tabular text-muted-foreground">{formatBytes(upload.size)}</td>
              <td>
                <ProgressCell upload={upload} />
              </td>
              <td>
                <StatusBadge status={upload.status} />
              </td>
              <LanguageCells upload={upload} compact={compact} />
              <td className="text-muted-foreground">{upload.server?.name ?? '–'}</td>
              {!compact && (
                <td className="text-xs">
                  <SpeedCell upload={upload} />
                </td>
              )}
              <td className="hidden tabular text-xs text-muted-foreground 2xl:table-cell">{formatDate(upload.createdAt)}</td>
              <td>
                <UploadActions upload={upload} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
