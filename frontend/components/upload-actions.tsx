'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Eye, FileX2, HardDriveDownload, MoreHorizontal, RotateCcw, Square, Tags, Trash2, Upload as UploadIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { ReleaseDialog } from '@/components/release-dialog';
import { canRelease, localReleaseClient, releaseRunning } from '@/components/release-badge';
import { deleteHeld, deleteUpload, retryUpload, stopUpload, uploadHeld } from '@/lib/actions';
import { useAppStore, type Upload } from '@/lib/store';

export const canRetry = (u: Upload) => u.status === 'FAILED' || u.status === 'SKIPPED' || u.status === 'CANCELLED';
// A held file is deleted with its file (DeleteHeldDialog), never only from the history
export const canDelete = (u: Upload) =>
  u.status !== 'QUEUED' && u.status !== 'UPLOADING' && u.status !== 'HELD' && !releaseRunning(u);
export const isHeld = (u: Upload) => u.status === 'HELD';
export const canStop = (u: Upload) => u.status === 'QUEUED' || u.status === 'UPLOADING';

export function StopUploadDialog({
  upload,
  open,
  onOpenChange,
}: {
  upload: Upload;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const uploading = upload.status === 'UPLOADING';
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={uploading ? 'Stop upload?' : 'Remove from queue?'}
      description={
        <>
          <span className="font-medium text-foreground">{upload.filename}</span>{' '}
          {uploading
            ? 'stops uploading and the partial file on the server is deleted.'
            : 'will not be uploaded.'}{' '}
          You can start it again later with Retry.
        </>
      }
      confirmLabel="Stop"
      onConfirm={() => stopUpload(upload.id)}
    />
  );
}

/** Deleting a file held for a merge: the file in the watch folder and its record */
export function DeleteHeldDialog({
  upload,
  open,
  onOpenChange,
  onDeleted,
}: {
  upload: Upload;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted?: () => void;
}) {
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Delete the file?"
      description={
        <>
          <span className="font-medium text-foreground">{upload.filename}</span> is deleted from the watch folder and
          removed from the list. It is not uploaded, and it cannot be merged any more.
        </>
      }
      confirmLabel="Delete"
      onConfirm={async () => {
        if (await deleteHeld(upload.id)) onDeleted?.();
      }}
    />
  );
}

export function UploadActions({ upload, onDeleted }: { upload: Upload; onDeleted?: () => void }) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [stopOpen, setStopOpen] = useState(false);
  const [releaseOpen, setReleaseOpen] = useState(false);
  const [localOpen, setLocalOpen] = useState(false);
  const [deleteHeldOpen, setDeleteHeldOpen] = useState(false);
  const localClient = useAppStore((s) => localReleaseClient(upload, s.clients));

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Actions">
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem asChild>
            <Link href={`/uploads/${upload.id}`}>
              <Eye />
              Details
            </Link>
          </DropdownMenuItem>
          {isHeld(upload) && (
            <DropdownMenuItem onSelect={() => uploadHeld(upload.id)}>
              <UploadIcon />
              Upload as it is
            </DropdownMenuItem>
          )}
          {canRetry(upload) && (
            <DropdownMenuItem onSelect={() => retryUpload(upload.id)}>
              <RotateCcw />
              Retry
            </DropdownMenuItem>
          )}
          {canStop(upload) && (
            <DropdownMenuItem onSelect={() => setStopOpen(true)}>
              <Square className="fill-current" />
              Stop
            </DropdownMenuItem>
          )}
          {canRelease(upload) && (
            <DropdownMenuItem onSelect={() => setReleaseOpen(true)}>
              <Tags />
              {upload.releaseName ? 'Rename again…' : 'Rename & upload to tracker…'}
            </DropdownMenuItem>
          )}
          {localClient && (
            <DropdownMenuItem onSelect={() => setLocalOpen(true)}>
              <HardDriveDownload />
              Release locally on {localClient.name}…
            </DropdownMenuItem>
          )}
          {isHeld(upload) && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem destructive onSelect={() => setDeleteHeldOpen(true)}>
                <FileX2 />
                Delete file…
              </DropdownMenuItem>
            </>
          )}
          {canDelete(upload) && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem destructive onSelect={() => setConfirmOpen(true)}>
                <Trash2 />
                Remove from history
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <StopUploadDialog upload={upload} open={stopOpen} onOpenChange={setStopOpen} />
      <DeleteHeldDialog upload={upload} open={deleteHeldOpen} onOpenChange={setDeleteHeldOpen} onDeleted={onDeleted} />
      {releaseOpen && <ReleaseDialog upload={upload} open={releaseOpen} onOpenChange={setReleaseOpen} />}
      {localOpen && <ReleaseDialog upload={upload} open={localOpen} onOpenChange={setLocalOpen} local />}

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Remove from history?"
        description={
          <>
            <span className="font-medium text-foreground">{upload.filename}</span> will be removed from the list.
            The file itself (local and remote) is not touched.
          </>
        }
        confirmLabel="Remove"
        onConfirm={async () => {
          if (await deleteUpload(upload.id)) onDeleted?.();
        }}
      />
    </>
  );
}
