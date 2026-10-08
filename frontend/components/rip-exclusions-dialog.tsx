'use client';

import { useEffect, useMemo, useState } from 'react';
import { Loader2, Plus, X } from 'lucide-react';
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
import { Input } from '@/components/ui/input';
import { ripsApi } from '@/lib/api';
import { EXCLUDABLE, EXCLUDED_PREFIX, matchExclusion } from '@/lib/rips';
import { useAppStore, type Rip } from '@/lib/store';
import { cn, errorMessage } from '@/lib/utils';

const PREVIEW_COUNT = 5;

const discs = (n: number) => `${n} disc${n === 1 ? '' : 's'}`;

function Matches({ rips }: { rips: Rip[] }) {
  if (rips.length === 0) return <p className="text-[11px] text-muted-foreground">No disc in the list matches it yet.</p>;
  return (
    <div className="space-y-1 text-[11px] text-muted-foreground">
      <p>Matches {discs(rips.length)}:</p>
      <ul className="space-y-0.5">
        {rips.slice(0, PREVIEW_COUNT).map((rip) => (
          <li key={rip.id} title={rip.sourcePath} className="truncate font-mono">
            {rip.sourcePath}
          </li>
        ))}
        {rips.length > PREVIEW_COUNT && <li>and {rips.length - PREVIEW_COUNT} more</li>}
      </ul>
    </div>
  );
}

/** Edits the rules that keep discs in the downloads from being ripped */
export function RipExclusionsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const rips = useAppStore((s) => s.rips);
  const [saved, setSaved] = useState<string[]>([]);
  const [rules, setRules] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      const current = useAppStore.getState().ripStatus?.exclusions ?? [];
      setSaved(current);
      setRules(current);
      setDraft('');
      setError(null);
    }
  }, [open]);

  const pattern = draft.trim();
  const duplicate = rules.some((rule) => rule.toLowerCase() === pattern.toLowerCase());
  const draftMatches = useMemo(
    () => (pattern ? rips.filter((rip) => matchExclusion([pattern], rip.sourcePath)) : []),
    [rips, pattern]
  );

  // Save also keeps a rule typed but not added
  const next = useMemo(() => (pattern && !duplicate ? [...rules, pattern] : rules), [rules, pattern, duplicate]);
  const changed = next.length !== saved.length || next.some((rule, i) => rule !== saved[i]);

  // What saving does, as the backend will: new rules skip the discs not started
  // yet, the discs no rule matches any more go back to the queue
  const effect = useMemo(() => {
    const before = new Set(saved.map((rule) => rule.toLowerCase()));
    const added = next.filter((rule) => !before.has(rule.toLowerCase()));
    return {
      skipped: rips.filter((rip) => EXCLUDABLE.includes(rip.status) && matchExclusion(added, rip.sourcePath)).length,
      restored: rips.filter(
        (rip) =>
          rip.status === 'SKIPPED' && rip.reason?.startsWith(EXCLUDED_PREFIX) && !matchExclusion(next, rip.sourcePath)
      ).length,
    };
  }, [rips, next, saved]);

  const add = (e: React.FormEvent) => {
    e.preventDefault();
    if (!pattern || duplicate) return;
    setRules((prev) => [...prev, pattern]);
    setDraft('');
  };

  const remove = (rule: string) => setRules((prev) => prev.filter((r) => r !== rule));

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const { data } = await ripsApi.setExclusions(next);
      await useAppStore.getState().loadRips();
      const description = [
        data.skipped > 0 && `${discs(data.skipped)} skipped`,
        data.restored > 0 && `${discs(data.restored)} back in the queue`,
      ]
        .filter(Boolean)
        .join(' · ');
      toast.success('Exclusions saved', description ? { description } : undefined);
      onOpenChange(false);
    } catch (err) {
      setError(errorMessage(err, 'Failed to save the exclusions'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Rip exclusions</DialogTitle>
          <DialogDescription>
            Discs whose path in the downloads contains one of these texts are not ripped: they are listed as skipped,
            and “Rip anyway” still rips them. <code className="font-mono">*</code> matches any text, upper and lower
            case are the same.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}

        <form onSubmit={add} className="space-y-2">
          <div className="flex gap-2">
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="e.g. Serie TV/ or S0*E"
              maxLength={200}
              className="font-mono"
              aria-label="New rule"
              autoFocus
            />
            <Button type="submit" variant="outline" disabled={!pattern || duplicate}>
              <Plus />
              Add
            </Button>
          </div>
          {pattern &&
            (duplicate ? (
              <p className="text-[11px] text-muted-foreground">Already in the list.</p>
            ) : (
              <Matches rips={draftMatches} />
            ))}
        </form>

        <div className="space-y-1.5">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Rules</p>
          {rules.length === 0 ? (
            <p className="rounded-md border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
              No rules: every film disc is ripped.
            </p>
          ) : (
            <ul className="divide-y rounded-md border">
              {rules.map((rule) => {
                const count = rips.filter((rip) => matchExclusion([rule], rip.sourcePath)).length;
                return (
                  <li key={rule} className="flex items-center gap-2 py-1 pl-3 pr-1">
                    <span className="min-w-0 flex-1 truncate font-mono text-[13px]" title={rule}>
                      {rule}
                    </span>
                    <span className={cn('shrink-0 text-[11px] tabular', count === 0 && 'text-muted-foreground')}>
                      {discs(count)}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => remove(rule)}
                      aria-label={`Remove ${rule}`}
                    >
                      <X />
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {changed && (effect.skipped > 0 || effect.restored > 0) && (
          <p className="text-xs text-muted-foreground">
            Saving{' '}
            {[
              effect.skipped > 0 && `skips ${discs(effect.skipped)} not ripped yet`,
              effect.restored > 0 && `puts ${discs(effect.restored)} back in the queue`,
            ]
              .filter(Boolean)
              .join(' and ')}
            .
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving || !changed}>
            {saving && <Loader2 className="animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
