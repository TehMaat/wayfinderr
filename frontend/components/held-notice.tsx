'use client';

import { useState } from 'react';
import Link from 'next/link';
import { FileX2, Merge, Upload as UploadIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DeleteHeldDialog } from '@/components/upload-actions';
import { uploadHeld } from '@/lib/actions';
import type { HoldKind, Upload } from '@/lib/store';
import { cn } from '@/lib/utils';

export const HOLD_LABELS: Record<HoldKind, string> = {
  NO_ITALIAN: 'No Italian audio',
  TWIN: 'Twin found',
  POSSIBLE_TWIN: 'Possible twin',
};

/**
 * A file held for a merge: why, and what can be done with it. Waiting needs no button:
 * the file stays held until it is uploaded or deleted.
 */
export function HeldNotice({
  upload,
  showName = false,
  onDeleted,
  className,
}: {
  upload: Upload;
  showName?: boolean;
  onDeleted?: () => void;
  className?: string;
}) {
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const upload_ = async () => {
    setBusy(true);
    await uploadHeld(upload.id);
    setBusy(false);
  };

  return (
    <div className={cn('flex flex-col gap-3 rounded-lg border border-info/40 bg-info/10 p-4 text-sm sm:flex-row sm:items-center', className)}>
      <Merge className="hidden h-4 w-4 shrink-0 text-info sm:block" />
      <div className="min-w-0 flex-1 space-y-0.5">
        {showName ? (
          <Link href={`/uploads/${upload.id}`} className="block truncate font-medium hover:underline">
            {upload.filename}
          </Link>
        ) : (
          <p className="font-medium">Held for a merge</p>
        )}
        <p className="break-words text-muted-foreground">
          {upload.holdKind && <span className="text-foreground">{HOLD_LABELS[upload.holdKind]} · </span>}
          {upload.holdMessage ?? 'Waiting for its twin.'}
        </p>
      </div>
      <div className="flex shrink-0 gap-2">
        <Button variant="outline" size="sm" onClick={upload_} disabled={busy}>
          <UploadIcon />
          Upload as it is
        </Button>
        <Button variant="outline" size="sm" onClick={() => setDeleteOpen(true)}>
          <FileX2 />
          Delete file…
        </Button>
      </div>
      <DeleteHeldDialog upload={upload} open={deleteOpen} onOpenChange={setDeleteOpen} onDeleted={onDeleted} />
    </div>
  );
}
