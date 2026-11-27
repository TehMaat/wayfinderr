'use client';

import { useEffect, useState } from 'react';
import { Lightbulb, Loader2, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input, Label, Select } from '@/components/ui/input';
import { VERSIONS, versionLabel, versionOrigin } from '@/lib/release';
import type { VersionSource } from '@/lib/store';

const UNSET = '__unset';
const OTHER = '__other';

/** The select's value for a version: one of the list, none, other (free text) or not chosen */
const choiceOf = (version: string | null) =>
  version === null ? UNSET : version === '' || VERSIONS.includes(version) ? version : OTHER;

/**
 * The version (Extended, Director's Cut...) chosen beforehand for the release name,
 * on a rip or on an upload (issue #108). "Not chosen" leaves it to the other sources.
 */
export function VersionDialog({
  open,
  onOpenChange,
  name,
  current,
  unsetLabel,
  sources = [],
  toChoose = false,
  suggestion,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name: string;
  current: string | null;
  unsetLabel: string;
  sources?: VersionSource[];
  toChoose?: boolean;
  suggestion?: string | null;
  onSave: (version: string | null) => Promise<boolean>;
}) {
  const [choice, setChoice] = useState(UNSET);
  const [custom, setCustom] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setChoice(choiceOf(current));
    setCustom(current !== null && choiceOf(current) === OTHER ? current : '');
  }, [open, current]);

  const version = choice === UNSET ? null : choice === OTHER ? custom.trim() : choice;
  const invalid = choice === OTHER && !custom.trim();

  const save = async () => {
    setBusy(true);
    try {
      if (await onSave(version)) onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Version</DialogTitle>
          <DialogDescription className="break-all">
            The version written in the release name of <span className="font-medium text-foreground">{name}</span>.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {toChoose && (
            <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <span>Its sources disagree: the rename waits until you choose one.</span>
            </div>
          )}
          {sources.length > 0 && (
            <ul className="space-y-1 rounded-md border bg-muted/40 px-3 py-2 text-sm">
              {sources.map((s, i) => (
                <li key={i} className="flex justify-between gap-3">
                  <span className="font-medium">{versionLabel(s.version)}</span>
                  <span className="truncate text-muted-foreground">{versionOrigin(s)}</span>
                </li>
              ))}
            </ul>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="version-choice">Version</Label>
            <Select id="version-choice" value={choice} onChange={(e) => setChoice(e.target.value)}>
              <option value={UNSET}>{unsetLabel}</option>
              <option value="">None (standard version)</option>
              {VERSIONS.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
              <option value={OTHER}>Other…</option>
            </Select>
            {choice === OTHER && (
              <Input value={custom} onChange={(e) => setCustom(e.target.value.slice(0, 60))} placeholder="Version" autoFocus />
            )}
          </div>

          {suggestion && choice === UNSET && (
            <button
              type="button"
              onClick={() => setChoice(choiceOf(suggestion))}
              className="flex w-full items-center gap-2 rounded-md border border-dashed px-3 py-2 text-left text-sm text-muted-foreground hover:bg-accent"
            >
              <Lightbulb className="h-4 w-4 shrink-0" />
              <span>
                The name says <span className="font-medium text-foreground">{suggestion}</span>: use it
              </span>
            </button>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={busy || invalid} onClick={save}>
            {busy && <Loader2 className="animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
