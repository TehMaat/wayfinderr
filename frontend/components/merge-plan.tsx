'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { CalendarClock, Check, Disc3, FileVideo, Loader2, Magnet, Search, Trash2, Link2 } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { mergeApi } from '@/lib/api';
import { useAppStore, type MergePlan, type MergePlanCandidates, type MergePlanSide } from '@/lib/store';
import { cn, errorMessage } from '@/lib/utils';

/** What a side is called: its name, else the start of its hash */
const sideName = (side: MergePlanSide) =>
  side.upload?.filename ?? side.name ?? (side.infoHash ? `Torrent ${side.infoHash.slice(0, 8)}…` : 'A file');

function SideRow({ side }: { side: MergePlanSide }) {
  const arrived = Boolean(side.upload);
  return (
    <div className="flex min-w-0 items-center gap-2 text-sm">
      {arrived ? (
        <Check className="h-4 w-4 shrink-0 text-success" />
      ) : (
        <CalendarClock className="h-4 w-4 shrink-0 text-muted-foreground" />
      )}
      {side.label && (
        <Badge variant="secondary" className="shrink-0">
          {side.label}
        </Badge>
      )}
      {side.upload ? (
        <Link href={`/uploads/${side.upload.id}`} className="min-w-0 truncate hover:underline">
          {side.upload.filename}
        </Link>
      ) : (
        <span className="min-w-0 truncate" title={side.infoHash ?? undefined}>
          {sideName(side)}
        </span>
      )}
      <span className="ml-auto shrink-0 text-xs text-muted-foreground">
        {side.upload
          ? side.upload.status === 'HELD'
            ? 'Arrived, held'
            : `Arrived, ${side.upload.status.toLowerCase()}`
          : side.rip
            ? `Rip ${side.rip.status.toLowerCase().replace('_', ' ')}${side.rip.status === 'RIPPING' ? ` ${side.rip.progress}%` : ''}`
            : 'Waiting for its file'}
      </span>
    </div>
  );
}

/** A pair planned before its files arrive: each side, and what is left to do */
export function MergePlanCard({ plan }: { plan: MergePlan }) {
  const [busy, setBusy] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);

  const pair = async () => {
    setBusy(true);
    try {
      await mergeApi.pairPlan(plan.id);
      await Promise.all([useAppStore.getState().loadMergePlans(), useAppStore.getState().loadMergePairs()]);
    } catch (err) {
      toast.error('Could not create the pair', { description: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    try {
      await mergeApi.removePlan(plan.id);
      await useAppStore.getState().loadMergePlans();
      toast.success('Planned pair removed', { description: 'Its files already held stay held' });
    } catch (err) {
      toast.error('Could not remove the planned pair', { description: errorMessage(err) });
    }
  };

  return (
    <Card className="flex flex-col gap-2 p-4">
      <div className="flex items-center gap-2">
        <Badge variant={plan.status === 'ERROR' ? 'destructive' : 'info'}>
          {plan.status === 'ERROR' ? 'Not paired' : 'Waiting for its files'}
        </Badge>
        {plan.origin && <span className="text-xs text-muted-foreground">from {plan.origin}</span>}
        <div className="ml-auto flex gap-1">
          {plan.status === 'ERROR' && (
            <Button size="sm" className="h-7" onClick={pair} disabled={busy}>
              {busy ? <Loader2 className="animate-spin" /> : <Link2 />}
              Pair again
            </Button>
          )}
          <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Remove" onClick={() => setRemoveOpen(true)}>
            <Trash2 />
          </Button>
        </div>
      </div>
      <SideRow side={plan.files[0]} />
      <SideRow side={plan.files[1]} />
      {plan.status === 'ERROR' && plan.message && <p className="text-xs text-destructive">{plan.message}</p>}
      <ConfirmDialog
        open={removeOpen}
        onOpenChange={setRemoveOpen}
        title="Remove the planned pair?"
        description="Files that arrive from now on are handled as usual. The ones already held stay held: pair them, upload them as they are or delete them."
        confirmLabel="Remove"
        onConfirm={remove}
      />
    </Card>
  );
}

// One download picked for a side
type Pick =
  | { kind: 'rip'; id: string; label: string }
  | { kind: 'torrent'; infoHash: string; name: string; label: string }
  | { kind: 'upload'; id: string; label: string };

const pickKey = (p: Pick) => (p.kind === 'torrent' ? `t:${p.infoHash}` : `${p.kind}:${p.id}`);

const toSide = (p: Pick) =>
  p.kind === 'rip' ? { ripId: p.id } : p.kind === 'torrent' ? { infoHash: p.infoHash, name: p.name } : { uploadId: p.id };

function PickRow({
  icon: Icon,
  label,
  detail,
  selected,
  disabled,
  onSelect,
}: {
  icon: typeof Disc3;
  label: string;
  detail: string;
  selected: boolean;
  disabled?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      className={cn(
        'flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors disabled:opacity-40',
        selected ? 'border-primary bg-primary/10' : 'hover:bg-accent'
      )}
    >
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="shrink-0 text-xs text-muted-foreground">{detail}</span>
    </button>
  );
}

/**
 * Plans a pair from two downloads, among the rips not finished, the torrents of the
 * clients and the files not uploaded: each file is held as it arrives, and the pair is
 * created and analyzed once both are there.
 */
export function MergePlanDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [candidates, setCandidates] = useState<MergePlanCandidates | null>(null);
  const [picks, setPicks] = useState<Pick[]>([]);
  const [filter, setFilter] = useState('');
  const [language, setLanguage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setCandidates(null);
    setPicks([]);
    setFilter('');
    setLanguage('');
    mergeApi
      .planCandidates()
      .then(({ data }) => setCandidates(data))
      .catch((err) => {
        toast.error('Could not list the downloads', { description: errorMessage(err) });
        onOpenChange(false);
      });
  }, [open, onOpenChange]);

  const options = useMemo(() => {
    if (!candidates) return [];
    const query = filter.trim().toLowerCase();
    const all: { pick: Pick; icon: typeof Disc3; detail: string; search: string }[] = [
      ...candidates.rips.map((r) => ({
        pick: { kind: 'rip' as const, id: r.id, label: r.downloadName },
        icon: Disc3,
        detail: `rip ${r.status.toLowerCase().replace('_', ' ')}`,
        search: `${r.downloadName} ${r.title ?? ''}`,
      })),
      ...candidates.torrents.map((t) => ({
        pick: { kind: 'torrent' as const, infoHash: t.infoHash, name: t.downloadName, label: t.name },
        icon: Magnet,
        detail: `${t.client} · ${t.progress}%`,
        search: `${t.name} ${t.downloadName}`,
      })),
      ...candidates.uploads.map((u) => ({
        pick: { kind: 'upload' as const, id: u.id, label: u.filename },
        icon: FileVideo,
        detail: u.status.toLowerCase(),
        search: u.filename,
      })),
    ];
    return all.filter((o) => !query || o.search.toLowerCase().includes(query));
  }, [candidates, filter]);

  const toggle = (pick: Pick) => {
    const key = pickKey(pick);
    if (picks.some((p) => pickKey(p) === key)) setPicks(picks.filter((p) => pickKey(p) !== key));
    else if (picks.length < 2) setPicks([...picks, pick]);
  };

  const plan = async () => {
    if (picks.length !== 2) return;
    setBusy(true);
    try {
      const { data } = await mergeApi.createPlan({
        files: picks.map(toSide),
        originalLanguage: language.trim() || undefined,
      });
      await Promise.all([useAppStore.getState().loadMergePlans(), useAppStore.getState().loadMergePairs()]);
      toast.success(data.status === 'PAIRED' ? 'Both files are here: analysis started' : 'Pair planned', {
        description: data.status === 'PAIRED' ? undefined : 'Each file is held as it arrives',
      });
      onOpenChange(false);
    } catch (err) {
      toast.error('Could not plan the pair', { description: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Plan a pair</DialogTitle>
          <DialogDescription>
            Two downloads of the same film that will become a pair: a rip not finished, a torrent of a client or a file
            not uploaded yet. Each file is held as it arrives, without looking for a twin; once both are there the pair is
            created and Dyadrr analyzes it. You still confirm before the merge.
          </DialogDescription>
        </DialogHeader>

        {!candidates ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-3">
            {candidates.problems.length > 0 && (
              <p className="text-xs text-warning">Not listed: {candidates.problems.join('; ')}</p>
            )}
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium">
                Two downloads <span className="text-muted-foreground tabular">({picks.length}/2)</span>
              </p>
              <div className="relative w-48">
                <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter" className="h-8 pl-7 text-xs" />
              </div>
            </div>
            <div className="max-h-72 space-y-1 overflow-y-auto scrollbar-thin">
              {options.map(({ pick, icon, detail }) => {
                const selected = picks.some((p) => pickKey(p) === pickKey(pick));
                return (
                  <PickRow
                    key={pickKey(pick)}
                    icon={icon}
                    label={pick.label}
                    detail={detail}
                    selected={selected}
                    disabled={!selected && picks.length >= 2}
                    onSelect={() => toggle(pick)}
                  />
                );
              })}
              {options.length === 0 && (
                <p className="py-2 text-xs text-muted-foreground">No rip, torrent or file to plan with.</p>
              )}
            </div>
            <div className="space-y-1.5">
              <p className="text-sm font-medium">Original language</p>
              <Input
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                placeholder="From TMDB (e.g. en, ja, fr)"
                className="h-8 w-56 text-sm"
              />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={plan} disabled={picks.length !== 2 || busy}>
            {busy && <Loader2 className="animate-spin" />}
            Plan the pair
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
