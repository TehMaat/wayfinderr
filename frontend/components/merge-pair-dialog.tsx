'use client';

import { useEffect, useMemo, useState } from 'react';
import { Loader2, Search } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { mergeApi } from '@/lib/api';
import { useAppStore, type MergeCandidate } from '@/lib/store';
import { cn, errorMessage, formatBytes } from '@/lib/utils';

// Words of a file name, for putting the likely twin first
const words = (name: string) =>
  new Set(
    name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/\.mkv$/, '')
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 1)
  );

const likeness = (a: string, b: string) => {
  const wa = words(a);
  const wb = words(b);
  let common = 0;
  for (const w of wa) if (wb.has(w)) common++;
  return common / Math.max(1, Math.min(wa.size, wb.size));
};

/** Video height of a candidate, from its media info: 2160, 1080... */
const videoHeight = (c: MergeCandidate): number | null => {
  try {
    return JSON.parse(c.mediaInfo ?? '{}')?.videoTracks?.[0]?.height ?? null;
  } catch {
    return null;
  }
};

function CandidateRow({
  candidate,
  selected,
  onSelect,
}: {
  candidate: MergeCandidate;
  selected: boolean;
  onSelect: () => void;
}) {
  const height = videoHeight(candidate);
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors',
        selected ? 'border-primary bg-primary/10' : 'hover:bg-accent'
      )}
    >
      <span className="min-w-0 flex-1 truncate">{candidate.filename}</span>
      {height && <span className="shrink-0 text-xs text-muted-foreground">{height}p</span>}
      <span className="shrink-0 text-xs text-muted-foreground">{formatBytes(Number(candidate.size), 1)}</span>
      <Badge variant={candidate.hasItalianAudio ? 'success' : 'secondary'} className="shrink-0">
        {candidate.hasItalianAudio ? 'ITA' : 'no ITA'}
      </Badge>
      {candidate.status !== 'HELD' && (
        <Badge variant="secondary" className="shrink-0">
          {candidate.status.toLowerCase()}
        </Badge>
      )}
    </button>
  );
}

/**
 * Pairs two files of the same film for Dyadrr: the better video and the Italian one,
 * in any order (Dyadrr tells which is which). The analysis starts right away.
 */
export function MergePairDialog({
  open,
  onOpenChange,
  firstId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  firstId?: string | null;
}) {
  const [candidates, setCandidates] = useState<MergeCandidate[] | null>(null);
  const [first, setFirst] = useState<string | null>(null);
  const [second, setSecond] = useState<string | null>(null);
  const [language, setLanguage] = useState('');
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setCandidates(null);
    setFirst(firstId ?? null);
    setSecond(null);
    setLanguage('');
    setFilter('');
    mergeApi
      .listCandidates()
      .then(({ data }) => setCandidates(data))
      .catch((err) => {
        toast.error('Could not list the files', {
          description: errorMessage(err),
        });
        onOpenChange(false);
      });
  }, [open, firstId, onOpenChange]);

  const firstFile = candidates?.find((c) => c.id === first) ?? null;
  // The second file: the likely twin first (similar name, the other side of the Italian audio)
  const others = useMemo(() => {
    if (!candidates) return [];
    const query = filter.trim().toLowerCase();
    const list = candidates.filter((c) => c.id !== first && (!query || c.filename.toLowerCase().includes(query)));
    if (!firstFile) return list;
    const score = (c: MergeCandidate) =>
      likeness(firstFile.filename, c.filename) + (c.hasItalianAudio !== firstFile.hasItalianAudio ? 0.5 : 0);
    return [...list].sort((a, b) => score(b) - score(a));
  }, [candidates, first, firstFile, filter]);

  const analyze = async () => {
    if (!first || !second) return;
    setBusy(true);
    try {
      const { data } = await mergeApi.createPair([first, second], language.trim() || undefined);
      await useAppStore.getState().refreshMergePair(data.id);
      toast.success('Analysis started', {
        description: 'Dyadrr is checking whether the two files line up',
      });
      onOpenChange(false);
    } catch (err) {
      toast.error('Could not pair the files', {
        description: errorMessage(err),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Pair two files</DialogTitle>
          <DialogDescription>
            Two rips of the same film, same cut: one with the better video, one with the Italian audio. Dyadrr tells
            which is which, measures how the Italian lines up with the video and says whether they can be merged.
            Nothing is written yet.
          </DialogDescription>
        </DialogHeader>

        {!candidates ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : candidates.length < 2 ? (
          <p className="py-4 text-sm text-muted-foreground">
            There are not two files to pair: a file must still be on the disk, and not being uploaded.
          </p>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <p className="text-sm font-medium">First file</p>
              {firstFile ? (
                <CandidateRow candidate={firstFile} selected onSelect={() => setFirst(null)} />
              ) : (
                <div className="max-h-48 space-y-1 overflow-y-auto scrollbar-thin">
                  {candidates.map((c) => (
                    <CandidateRow key={c.id} candidate={c} selected={false} onSelect={() => setFirst(c.id)} />
                  ))}
                </div>
              )}
            </div>

            {firstFile && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium">Its twin</p>
                  <div className="relative w-48">
                    <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={filter}
                      onChange={(e) => setFilter(e.target.value)}
                      placeholder="Filter"
                      className="h-8 pl-7 text-xs"
                    />
                  </div>
                </div>
                <div className="max-h-56 space-y-1 overflow-y-auto scrollbar-thin">
                  {others.map((c) => (
                    <CandidateRow
                      key={c.id}
                      candidate={c}
                      selected={c.id === second}
                      onSelect={() => setSecond(c.id)}
                    />
                  ))}
                  {others.length === 0 && <p className="py-2 text-xs text-muted-foreground">No other file.</p>}
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <p className="text-sm font-medium">Original language</p>
              <Input
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                placeholder="From TMDB (e.g. en, ja, fr)"
                className="h-8 w-56 text-sm"
              />
              <p className="text-xs text-muted-foreground">
                The sync is measured on the original language when both files have it, else on English. Leave it blank
                to take it from TMDB.
              </p>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={analyze} disabled={!first || !second || busy}>
            {busy && <Loader2 className="animate-spin" />}
            Analyze
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
