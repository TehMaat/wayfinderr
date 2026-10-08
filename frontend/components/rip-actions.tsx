'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Ban, ExternalLink, ListChecks, MoreHorizontal, Play, RotateCcw, UploadCloud } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { retryRip, skipRip } from '@/lib/actions';
import { ripName, tmdbUrl } from '@/lib/rips';
import type { Rip } from '@/lib/store';

// What the backend allows in each status
export const canChoose = (r: Rip) =>
  Boolean(r.titles) && (r.status === 'NEEDS_ATTENTION' || r.status === 'FAILED' || r.status === 'SKIPPED');
export const canRetry = (r: Rip) => r.status === 'FAILED' || r.status === 'SKIPPED';
export const canSkip = (r: Rip) => r.status !== 'DONE' && r.status !== 'SKIPPED';

export function RipActions({ rip, onChoose }: { rip: Rip; onChoose: (rip: Rip) => void }) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const attention = rip.status === 'NEEDS_ATTENTION';
  const choose = () => onChoose(rip);
  // Skipped: "Rip anyway" picks by hand when the disc was scanned, otherwise starts over
  const ripAnyway = () => (rip.titles ? choose() : retryRip(rip.id));

  const hasItems = attention || canRetry(rip) || canSkip(rip) || rip.upload || rip.tmdbId;

  return (
    <div className="flex items-center justify-end gap-1">
      {attention && (
        <Button size="sm" className="h-7 px-2.5" onClick={choose}>
          Choose…
        </Button>
      )}

      {hasItems ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Actions">
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {attention && (
              <DropdownMenuItem onSelect={choose}>
                <ListChecks />
                Choose…
              </DropdownMenuItem>
            )}
            {rip.status === 'FAILED' && (
              <>
                <DropdownMenuItem onSelect={() => retryRip(rip.id)}>
                  <RotateCcw />
                  Retry
                </DropdownMenuItem>
                {rip.titles && (
                  <DropdownMenuItem onSelect={choose}>
                    <ListChecks />
                    Choose…
                  </DropdownMenuItem>
                )}
              </>
            )}
            {rip.status === 'SKIPPED' && (
              <>
                <DropdownMenuItem onSelect={ripAnyway}>
                  <Play />
                  Rip anyway
                </DropdownMenuItem>
                {rip.titles && (
                  <DropdownMenuItem onSelect={() => retryRip(rip.id)}>
                    <RotateCcw />
                    Scan again
                  </DropdownMenuItem>
                )}
              </>
            )}
            {rip.upload && (
              <DropdownMenuItem asChild>
                <Link href={`/uploads/${rip.upload.id}`}>
                  <UploadCloud />
                  View upload
                </Link>
              </DropdownMenuItem>
            )}
            {rip.tmdbId && (
              <DropdownMenuItem asChild>
                <a href={tmdbUrl(rip.tmdbId)} target="_blank" rel="noreferrer">
                  <ExternalLink />
                  Open on TMDB
                </a>
              </DropdownMenuItem>
            )}
            {canSkip(rip) && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  destructive
                  onSelect={() => (rip.status === 'RIPPING' ? setConfirmOpen(true) : skipRip(rip.id))}
                >
                  <Ban />
                  Skip
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <span className="w-7" />
      )}

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Stop this rip?"
        description={
          <>
            MakeMKV stops ripping <span className="font-medium text-foreground">{ripName(rip)}</span> and the partial
            file is removed. You can rip it later with “Rip anyway”.
          </>
        }
        confirmLabel="Skip"
        onConfirm={() => skipRip(rip.id)}
      />
    </div>
  );
}
