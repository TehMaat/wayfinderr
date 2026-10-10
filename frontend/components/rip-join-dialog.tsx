'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Check, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { RipStatusBadge } from '@/components/status-badge';
import { ripsApi } from '@/lib/api';
import { joinCandidates, sourceLabel } from '@/lib/rips';
import { useAppStore, type Rip } from '@/lib/store';
import { cn, errorMessage, formatRuntime } from '@/lib/utils';

/** The film's length on the disc: the title chosen, or the longest one once scanned */
const filmLength = (rip: Rip) => {
  const titles = rip.titles ?? [];
  const title = titles.find((t) => t.index === rip.titleIndex) ?? [...titles].sort((a, b) => b.durationSec - a.durationSec)[0];
  return title ? { seconds: title.durationSec, chosen: title.index === rip.titleIndex } : null;
};

/**
 * Joins discs of the rip's download into one film ("Disc 1" and "Disc 2" of a
 * long film): the ones ticked, in the order shown, each ripped then appended
 * with mkvmerge by the backend.
 */
export function RipJoinDialog({ rip, open, onOpenChange }: { rip: Rip; open: boolean; onOpenChange: (open: boolean) => void }) {
  const rips = useAppStore((s) => s.rips);
  const candidates = useMemo(() => joinCandidates(rip, rips), [rip, rips]);
  const [order, setOrder] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fresh each time it opens: every disc of the download, in disc order
  useEffect(() => {
    if (!open) return;
    setOrder(candidates.map((r) => r.id));
    setSelected(new Set(candidates.map((r) => r.id)));
    setError(null);
  }, [open, rip.id]);

  // Discs that left the list or started meanwhile are dropped
  const rows = order.map((id) => candidates.find((r) => r.id === id)).filter((r): r is Rip => Boolean(r));
  const parts = rows.filter((r) => selected.has(r.id));
  const lengths = parts.map(filmLength);
  const total = lengths.every(Boolean) ? lengths.reduce((sum, l) => sum + l!.seconds, 0) : null;

  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const move = (index: number, by: number) =>
    setOrder(() => {
      const next = rows.map((r) => r.id);
      [next[index], next[index + by]] = [next[index + by], next[index]];
      return next;
    });

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      await ripsApi.joinRips(parts.map((r) => r.id));
      await useAppStore.getState().loadRips();
      toast.success(`${parts.length} discs joined into one film`, {
        description: 'Each disc is ripped, then mkvmerge joins them',
      });
      onOpenChange(false);
    } catch (err) {
      setError(errorMessage(err, 'Could not join the discs'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl grid-cols-[minmax(0,1fr)]">
        <DialogHeader>
          <DialogTitle>Join discs into one film</DialogTitle>
          <DialogDescription className="break-words">
            For a film split over several discs: each disc is ripped, then mkvmerge joins them in this order into one
            film. The discs must have the same audio and subtitle tracks.
          </DialogDescription>
        </DialogHeader>

        <div role="group" aria-label="Discs to join" className="space-y-1.5">
          {rows.map((r, i) => {
            const checked = selected.has(r.id);
            const part = parts.indexOf(r) + 1;
            const length = filmLength(r);
            return (
              <div
                key={r.id}
                className={cn(
                  'flex items-center gap-2 rounded-md border pl-3 pr-1.5 transition-colors',
                  checked ? 'border-primary/60 bg-primary/10' : 'hover:bg-accent/50'
                )}
              >
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={checked}
                  onClick={() => toggle(r.id)}
                  className="flex min-w-0 flex-1 items-center gap-3 py-2.5 text-left"
                >
                  <span
                    className={cn(
                      'flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                      checked ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/40'
                    )}
                  >
                    {checked && <Check className="h-3 w-3" strokeWidth={3} />}
                  </span>
                  <span className="min-w-0 flex-1 space-y-1">
                    <span className="flex items-center gap-2 text-sm">
                      <span className={cn('w-12 shrink-0 tabular', checked ? 'font-medium' : 'text-muted-foreground')}>
                        {checked ? `Part ${part}` : 'Left out'}
                      </span>
                      <span className="truncate font-mono text-xs">{sourceLabel(r)}</span>
                    </span>
                    <span className="flex flex-wrap items-center gap-2 pl-14 text-xs text-muted-foreground">
                      <RipStatusBadge status={r.status} />
                      {length ? (
                        <span className="tabular">
                          {formatRuntime(length.seconds)} {length.chosen ? 'chosen title' : 'longest title'}
                        </span>
                      ) : (
                        <span>Not scanned yet</span>
                      )}
                    </span>
                  </span>
                </button>
                <div className="flex shrink-0 flex-col">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    aria-label="Move up"
                    disabled={i === 0}
                    onClick={() => move(i, -1)}
                  >
                    <ArrowUp />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    aria-label="Move down"
                    disabled={i === rows.length - 1}
                    onClick={() => move(i, 1)}
                  >
                    <ArrowDown />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>

        <p className="text-xs text-muted-foreground">
          {total !== null && parts.length > 1 ? `Together ${formatRuntime(total)}. ` : ''}When the title on a disc isn’t
          certain, that disc still asks you to choose it. Skipping one of the discs skips the whole film.
        </p>

        {error && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving || parts.length < 2}>
            {saving && <Loader2 className="animate-spin" />}
            Join {parts.length} discs
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
