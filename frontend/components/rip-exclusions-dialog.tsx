'use client';

import { useEffect, useMemo, useState } from 'react';
import { ChevronRight, Folder, FolderX, Loader2, Plus, X } from 'lucide-react';
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
import { EXCLUDABLE, EXCLUDED_PREFIX, ignoredFolder, matchExclusion, REMOVABLE } from '@/lib/rips';
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

const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * Browses the folders of the downloads to pick the ignored ones: the torrent
 * client's folder for the downloads in progress, never searched.
 */
function FolderPicker({ folders, onIgnore }: { folders: string[]; onIgnore: (folder: string) => void }) {
  const [current, setCurrent] = useState('');
  const [children, setChildren] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setChildren(null);
    setError(null);
    ripsApi
      .listFolders(current)
      .then(({ data }) => !cancelled && setChildren(data.folders))
      .catch((err) => !cancelled && setError(errorMessage(err, 'Cannot list the folder')));
    return () => {
      cancelled = true;
    };
  }, [current]);

  const parts = current ? current.split('/') : [];
  const full = (name: string) => (current ? `${current}/${name}` : name);

  return (
    <div className="rounded-md border">
      <div className="flex flex-wrap items-center gap-0.5 border-b px-2 py-1.5 text-xs">
        <button type="button" className="rounded px-1 font-medium hover:bg-accent" onClick={() => setCurrent('')}>
          Downloads
        </button>
        {parts.map((part, i) => (
          <span key={i} className="flex items-center gap-0.5">
            <ChevronRight className="h-3 w-3 text-muted-foreground" />
            <button
              type="button"
              className="rounded px-1 font-mono hover:bg-accent"
              onClick={() => setCurrent(parts.slice(0, i + 1).join('/'))}
            >
              {part}
            </button>
          </span>
        ))}
      </div>
      <div className="max-h-48 overflow-y-auto scrollbar-thin">
        {error ? (
          <p className="px-3 py-3 text-xs text-destructive">{error}</p>
        ) : children === null ? (
          <p className="flex items-center gap-2 px-3 py-3 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" /> Loading…
          </p>
        ) : children.length === 0 ? (
          <p className="px-3 py-3 text-xs text-muted-foreground">No folders here.</p>
        ) : (
          <ul className="divide-y">
            {children.map((name) => {
              const ignored = ignoredFolder(folders, full(name));
              return (
                <li key={name} className="flex items-center gap-2 py-0.5 pl-2 pr-1">
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-2 rounded px-1 py-1 text-left text-[13px] hover:bg-accent disabled:pointer-events-none"
                    onClick={() => setCurrent(full(name))}
                    disabled={!!ignored}
                    title={ignored ? undefined : `Open ${name}`}
                  >
                    {ignored ? (
                      <FolderX className="h-4 w-4 shrink-0 text-muted-foreground" />
                    ) : (
                      <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
                    )}
                    <span className={cn('truncate font-mono', ignored && 'text-muted-foreground line-through')}>{name}</span>
                  </button>
                  {ignored ? (
                    <span className="shrink-0 px-2 text-[11px] text-muted-foreground">Ignored</span>
                  ) : (
                    <Button type="button" variant="ghost" size="sm" className="h-7" onClick={() => onIgnore(full(name))}>
                      Ignore
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

/** Edits the ignored folders and the rules that keep discs in the downloads from being ripped */
export function RipExclusionsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const rips = useAppStore((s) => s.rips);
  const [saved, setSaved] = useState<string[]>([]);
  const [rules, setRules] = useState<string[]>([]);
  const [savedFolders, setSavedFolders] = useState<string[]>([]);
  const [folders, setFolders] = useState<string[]>([]);
  const [savedArriveComplete, setSavedArriveComplete] = useState(false);
  const [arriveComplete, setArriveComplete] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      const status = useAppStore.getState().ripStatus;
      const current = status?.exclusions ?? [];
      setSaved(current);
      setRules(current);
      setSavedFolders(status?.ignoredFolders ?? []);
      setFolders(status?.ignoredFolders ?? []);
      setSavedArriveComplete(status?.arriveComplete ?? false);
      setArriveComplete(status?.arriveComplete ?? false);
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
  const changed = !sameList(next, saved) || !sameList(folders, savedFolders) || arriveComplete !== savedArriveComplete;

  // What saving does, as the backend will: the discs not ripped in an ignored
  // folder leave the list, new rules skip the discs not started yet, the discs
  // no rule matches any more go back to the queue
  const effect = useMemo(() => {
    const before = new Set(saved.map((rule) => rule.toLowerCase()));
    const added = next.filter((rule) => !before.has(rule.toLowerCase()));
    const kept = rips.filter((rip) => !(REMOVABLE.includes(rip.status) && ignoredFolder(folders, rip.sourcePath)));
    return {
      removed: rips.length - kept.length,
      skipped: kept.filter((rip) => EXCLUDABLE.includes(rip.status) && matchExclusion(added, rip.sourcePath)).length,
      restored: kept.filter(
        (rip) =>
          rip.status === 'SKIPPED' && rip.reason?.startsWith(EXCLUDED_PREFIX) && !matchExclusion(next, rip.sourcePath)
      ).length,
    };
  }, [rips, next, saved, folders]);

  // A folder holding ignored ones replaces them
  const ignore = (folder: string) => setFolders((prev) => [...prev.filter((f) => !ignoredFolder([folder], f)), folder]);

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
      const { data } = await ripsApi.setExclusions({ patterns: next, folders, arriveComplete });
      await useAppStore.getState().loadRips();
      const description = [
        data.removed > 0 && `${discs(data.removed)} in ignored folders removed`,
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
          <DialogDescription>Folders of the downloads never searched, and discs never ripped.</DialogDescription>
        </DialogHeader>

        {error && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}

        <section className="space-y-2">
          <div className="space-y-0.5">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Ignored folders</p>
            <p className="text-xs text-muted-foreground">
              Never searched: nothing inside them is listed or ripped. Ignore the folder where the torrent client keeps
              the downloads in progress (e.g. <code className="font-mono">torrents</code>).
            </p>
          </div>
          {folders.length > 0 && (
            <ul className="divide-y rounded-md border">
              {folders.map((folder) => {
                const count = rips.filter(
                  (rip) => REMOVABLE.includes(rip.status) && ignoredFolder([folder], rip.sourcePath)
                ).length;
                return (
                  <li key={folder} className="flex items-center gap-2 py-1 pl-3 pr-1">
                    <FolderX className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate font-mono text-[13px]" title={folder}>
                      {folder}
                    </span>
                    {count > 0 && (
                      <span className="shrink-0 text-[11px] tabular text-muted-foreground">{discs(count)} listed</span>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => setFolders((prev) => prev.filter((f) => f !== folder))}
                      aria-label={`Stop ignoring ${folder}`}
                    >
                      <X />
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
          {open && <FolderPicker folders={folders} onIgnore={ignore} />}
          <label className="flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 accent-primary"
              checked={arriveComplete}
              onChange={(e) => setArriveComplete(e.target.checked)}
            />
            <span className="space-y-0.5">
              <span className="block text-sm">Downloads arrive complete</span>
              <span className="block text-xs text-muted-foreground">
                The torrent client moves each download out of the ignored folder once it has finished: what appears in
                the downloads is handled within a minute or two, without waiting the quiet time
                (<code className="font-mono">RIP_QUIET_MINUTES</code>).
              </span>
            </span>
          </label>
        </section>

        <div className="space-y-0.5">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Rules</p>
          <p className="text-xs text-muted-foreground">
            Discs whose path in the downloads contains one of these texts are not ripped: they are listed as skipped,
            and “Rip anyway” still rips them. <code className="font-mono">*</code> matches any text, upper and lower
            case are the same.
          </p>
        </div>

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

        {changed && (effect.removed > 0 || effect.skipped > 0 || effect.restored > 0) && (
          <p className="text-xs text-muted-foreground">
            Saving{' '}
            {[
              effect.removed > 0 && `removes from the list ${discs(effect.removed)} in ignored folders`,
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
