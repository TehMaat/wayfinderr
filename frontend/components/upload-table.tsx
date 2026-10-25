'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ColGroup, ColumnHeader } from '@/components/column-layout';
import { Progress } from '@/components/ui/progress';
import { StatusBadge } from '@/components/status-badge';
import { MissingBadge, ReleaseBadge } from '@/components/release-badge';
import { MediaBadges } from '@/components/media-badges';
import { SelectAllCell, SelectCell } from '@/components/selection';
import { UploadActions } from '@/components/upload-actions';
import { Tooltip } from '@/components/ui/tooltip';
import { useColumnLayout, type Column, type ColumnLayout } from '@/lib/columns';
import { ripOfUpload, uploadLanguages } from '@/lib/media';
import { destinationName, uploadName } from '@/lib/release';
import type { Selection } from '@/lib/selection';
import { useAppStore, type Upload } from '@/lib/store';
import { cn, formatBytes, formatDate, formatDuration, formatSpeed } from '@/lib/utils';

function ProgressCell({ upload }: { upload: Upload }) {
  const uploading = upload.status === 'UPLOADING';
  const value = upload.status === 'COMPLETED' ? 100 : upload.progress;
  return (
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

/** Italian tracks, and the original language ones when shown */
function LanguageCells({ upload, italian: showItalian, original: showOriginal }: { upload: Upload; italian: boolean; original: boolean }) {
  const rip = useAppStore((s) => ripOfUpload(s.rips, upload));
  const { italian, original } = uploadLanguages(upload, rip);
  return (
    <>
      {showItalian && (
        <td>
          <MediaBadges language={italian} />
        </td>
      )}
      {showOriginal && (
        <td>
          <MediaBadges language={original} hint="original language" />
        </td>
      )}
    </>
  );
}

// The widths apply once a column is resized (until then the columns fit their content)
const COLUMNS: Column[] = [
  { id: 'select', width: 40, fixed: true },
  { id: 'name', flex: true, minWidth: 160 },
  { id: 'size', label: 'Size', width: 90, minWidth: 64 },
  { id: 'progress', label: 'Progress', width: 110, minWidth: 64 },
  { id: 'status', label: 'Status', width: 180, minWidth: 80 },
  { id: 'italian', label: 'Italian', width: 120, minWidth: 64 },
  { id: 'original', label: 'Original', width: 120, minWidth: 64 },
  { id: 'server', label: 'Server', width: 120, minWidth: 64 },
  { id: 'speed', label: 'Speed · ETA', width: 150, minWidth: 72 },
  { id: 'added', label: 'Added', width: 140, minWidth: 72 },
  { id: 'actions', width: 56, fixed: true },
];

// The dashboard's: no checkboxes, no original language and speed
const COMPACT_COLUMNS = COLUMNS.filter((c) => !['select', 'original', 'speed'].includes(c.id));

/** The columns of the uploads page: picked and resized there, kept in this browser */
export const useUploadColumns = () => useColumnLayout(COLUMNS, { storageKey: 'uploads', resizable: true });

export function UploadTable({
  uploads,
  columns,
  selection,
  fill,
}: {
  uploads: Upload[];
  /** From useUploadColumns; none: the dashboard's compact columns */
  columns?: ColumnLayout;
  /** Checkboxes to pick rows for removing many at once (with the columns from useUploadColumns) */
  selection?: Selection;
  /** Fills its parent: scrolls both ways, the header stays on top */
  fill?: boolean;
}) {
  const router = useRouter();
  const compactLayout = useColumnLayout(COMPACT_COLUMNS);
  const layout = columns ?? compactLayout;
  const compact = !columns;
  const show = layout.isShown;

  return (
    <div className={cn('scrollbar-thin', fill ? 'min-h-0 flex-1 overflow-auto' : 'overflow-x-auto')}>
      <table
        className={cn('w-full text-sm', layout.fixed && 'table-fixed')}
        style={{ minWidth: layout.fixed ? layout.minWidth : undefined }}
      >
        <ColGroup layout={layout} />
        <thead>
          <tr
            className={cn(
              'border-b text-left text-xs text-muted-foreground [&>th]:h-9 [&>th]:whitespace-nowrap [&>th]:px-3 [&>th]:font-medium',
              // The border goes with the header: a collapsed table border does not stick
              fill && '[&>th]:sticky [&>th]:top-0 [&>th]:z-10 [&>th]:bg-background [&>th]:shadow-[inset_0_-1px_0_hsl(var(--border))]'
            )}
          >
            {selection && <SelectAllCell selection={selection} />}
            <ColumnHeader layout={layout} id="name" className={cn(!layout.fixed && 'w-full min-w-[10rem]')}>
              Name
            </ColumnHeader>
            {show('size') && <ColumnHeader layout={layout} id="size">Size</ColumnHeader>}
            {show('progress') && <ColumnHeader layout={layout} id="progress">Progress</ColumnHeader>}
            {show('status') && <ColumnHeader layout={layout} id="status">Status</ColumnHeader>}
            {show('italian') && <ColumnHeader layout={layout} id="italian">Italian</ColumnHeader>}
            {show('original') && <ColumnHeader layout={layout} id="original">Original</ColumnHeader>}
            {show('server') && <ColumnHeader layout={layout} id="server">Server</ColumnHeader>}
            {show('speed') && <ColumnHeader layout={layout} id="speed">Speed · ETA</ColumnHeader>}
            {show('added') && (
              <ColumnHeader layout={layout} id="added" className={cn(compact && 'hidden 2xl:table-cell')}>
                Added
              </ColumnHeader>
            )}
            <ColumnHeader layout={layout} id="actions" className={cn(!layout.fixed && 'w-10')} />
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
                if (!e.currentTarget.contains(target) || target.closest('button,a,[data-select],[role=menuitem]')) return;
                router.push(`/uploads/${upload.id}`);
              }}
              className={cn(
                'cursor-pointer border-b border-border/60 transition-colors last:border-0 hover:bg-accent/50 [&>td]:h-10 [&>td]:whitespace-nowrap [&>td]:px-3',
                layout.fixed && '[&>td]:overflow-hidden [&>td]:text-ellipsis',
                selection?.has(upload.id) && 'bg-primary/[0.06]'
              )}
            >
              {selection && (
                <SelectCell
                  id={upload.id}
                  selection={selection}
                  label={uploadName(upload)}
                  disabledReason="Queued, uploading or uploading to the tracker: can't be removed now"
                />
              )}
              <td className={cn(!layout.fixed && 'w-full min-w-[10rem] max-w-0')}>
                <Tooltip
                  content={upload.releaseName ? `${upload.filepath} · renamed on the server` : upload.filepath}
                  side="bottom"
                >
                  <Link href={`/uploads/${upload.id}`} className="block truncate font-medium hover:text-primary">
                    {uploadName(upload)}
                  </Link>
                </Tooltip>
              </td>
              {show('size') && <td className="tabular text-muted-foreground">{formatBytes(upload.size)}</td>}
              {show('progress') && (
                <td>
                  <ProgressCell upload={upload} />
                </td>
              )}
              {show('status') && (
                <td>
                  <span className="flex items-center gap-1.5">
                    <StatusBadge status={upload.status} />
                    <ReleaseBadge upload={upload} />
                    <MissingBadge upload={upload} />
                  </span>
                </td>
              )}
              <LanguageCells upload={upload} italian={show('italian')} original={show('original')} />
              {show('server') && <td className="text-muted-foreground">{destinationName(upload) ?? '–'}</td>}
              {show('speed') && (
                <td className="text-xs">
                  <SpeedCell upload={upload} />
                </td>
              )}
              {show('added') && (
                <td className={cn('tabular text-xs text-muted-foreground', compact && 'hidden 2xl:table-cell')}>
                  {formatDate(upload.createdAt)}
                </td>
              )}
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
