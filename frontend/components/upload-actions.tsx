'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Eye, MoreHorizontal, RotateCcw, Square, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { deleteUpload, retryUpload, stopUpload } from '@/lib/actions';
import type { Upload } from '@/lib/store';

export const canRetry = (u: Upload) => u.status === 'FAILED' || u.status === 'SKIPPED' || u.status === 'CANCELLED';
export const canDelete = (u: Upload) => u.status !== 'QUEUED' && u.status !== 'UPLOADING';
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

export function UploadActions({ upload, onDeleted }: { upload: Upload; onDeleted?: () => void }) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [stopOpen, setStopOpen] = useState(false);

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
