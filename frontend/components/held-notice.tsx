'use client';

import { useState } from 'react';
import Link from 'next/link';
import { FileX2, Link2, Merge, Upload as UploadIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DeleteHeldDialog } from '@/components/upload-actions';
import { uploadHeld } from '@/lib/actions';
import type { HoldKind, Upload } from '@/lib/store';
import { cn } from '@/lib/utils';

export const HOLD_LABELS: Record<HoldKind, string> = {
  NO_ITALIAN: 'No Italian audio',
  TWIN: 'Twin found',
  POSSIBLE_TWIN: 'Possible twin',
  MANUAL: 'Held by hand',
  PLANNED: 'Planned pair',
};

/**
 * What can be done with a held file: pair it, upload it as it is, delete it. On the held
 * card, and on the card of a pair it is in that Dyadrr is not running.
 */
export function HeldActions({
  upload,
  onPair,
  pairLabel = 'Pair…',
  onDeleted,
  className,
}: {
  upload: Upload;
  // Pairs it with its twin, or another file (shown when merging is on)
  onPair?: () => void;
  pairLabel?: string;
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
    <div className={cn('flex shrink-0 flex-wrap gap-2', className)}>
      {onPair && (
        <Button size="sm" onClick={onPair}>
          <Link2 />
          {pairLabel}
        </Button>
      )}
      <Button variant="outline" size="sm" onClick={upload_} disabled={busy}>
        <UploadIcon />
        Upload as it is
      </Button>
      <Button variant="outline" size="sm" onClick={() => setDeleteOpen(true)}>
        <FileX2 />
        Delete file…
      </Button>
      <DeleteHeldDialog upload={upload} open={deleteOpen} onOpenChange={setDeleteOpen} onDeleted={onDeleted} />
    </div>
  );
}

/**
 * A file held for a merge: why, and what can be done with it. Waiting needs no button:
 * the file stays held until it is uploaded or deleted.
 */
export function HeldNotice({
  upload,
  showName = false,
  onDeleted,
  onPair,
  className,
}: {
  upload: Upload;
  showName?: boolean;
  onDeleted?: () => void;
  // Pairs it with its twin for a merge (shown when merging is on)
  onPair?: () => void;
  className?: string;
}) {
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
          {/* The label, unless the message already starts with it ("Held by hand: its rip…") */}
          {upload.holdKind && !upload.holdMessage?.startsWith(HOLD_LABELS[upload.holdKind]) && (
            <span className="text-foreground">{HOLD_LABELS[upload.holdKind]} · </span>
          )}
          {upload.holdMessage ?? 'Waiting for its twin.'}
        </p>
      </div>
      <HeldActions upload={upload} onPair={onPair} onDeleted={onDeleted} />
    </div>
  );
}
