'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
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
import { mergeApi } from '@/lib/api';
import { choiceValueLabel, fileName, formatMs, MERGE_CHOICES } from '@/lib/merge';
import { useAppStore, type MergeInputsAfter, type MergePair } from '@/lib/store';
import { cn, errorMessage } from '@/lib/utils';

interface Existing {
  fileName: string;
  existsLocally: boolean;
  existsOnServer: boolean;
}

const conflictOf = (err: unknown): Existing | null => {
  const data = (err as { response?: { status?: number; data?: Record<string, unknown> } })?.response;
  if (data?.status !== 409 || data.data?.code !== 'OUTPUT_EXISTS') return null;
  return {
    fileName: String(data.data.fileName ?? ''),
    existsLocally: Boolean(data.data.existsLocally),
    existsOnServer: Boolean(data.data.existsOnServer),
  };
};

/**
 * The merge, once the analysis passed: the choices it left pending (with what each value
 * does), the merged file's name (the film's usual name), and, when a file with that name
 * is already there, whether to replace it or stop to check.
 */
export function MergeConfirmDialog({
  pair,
  open,
  onOpenChange,
}: {
  pair: MergePair;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const pending = (pair.summary?.choices ?? []).filter((c) => c.status === 'pending');
  const decided = (pair.summary?.choices ?? []).filter((c) => c.status === 'decided');
  const [values, setValues] = useState<Record<string, string>>({});
  const [name, setName] = useState('');
  const [inputsAfter, setInputsAfter] = useState<MergeInputsAfter>('keep');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [existing, setExisting] = useState<Existing | null>(null);

  useEffect(() => {
    if (!open) return;
    setValues({});
    setExisting(null);
    setLoading(true);
    mergeApi
      .mergePreview(pair.id)
      .then(({ data }) => {
        setName(data.outputName);
        setInputsAfter(data.inputsAfter);
        if (data.existsLocally || data.existsOnServer) {
          setExisting({
            fileName: `${data.outputName}.mkv`,
            existsLocally: data.existsLocally,
            existsOnServer: data.existsOnServer,
          });
        }
      })
      .catch((err) => toast.error('Could not prepare the merge', { description: errorMessage(err) }))
      .finally(() => setLoading(false));
  }, [open, pair.id]);

  const missing = pending.filter((c) => !values[c.name]);

  const merge = async (replaceExisting: boolean) => {
    setBusy(true);
    try {
      await mergeApi.mergePair(pair.id, { choices: values, outputName: name, replaceExisting });
      await useAppStore.getState().refreshMergePair(pair.id);
      toast.success('Merge started', { description: `${name}.mkv` });
      onOpenChange(false);
    } catch (err) {
      const conflict = conflictOf(err);
      if (conflict) setExisting(conflict);
      else toast.error('Could not start the merge', { description: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Merge</DialogTitle>
          <DialogDescription>
            Dyadrr checks that nothing changed since the analysis, adds the Italian audio and subtitles to the better
            video without re-encoding, and verifies the result. The merged file then goes to the upload queue.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-4">
            {pending.map((c) => (
              <div key={c.name} className="space-y-1.5">
                <p className="text-sm font-medium">{MERGE_CHOICES[c.name]?.label ?? c.name}</p>
                <div className="space-y-1">
                  {c.effects.map((e) => (
                    <button
                      key={e.value}
                      type="button"
                      onClick={() => setValues({ ...values, [c.name]: e.value })}
                      className={cn(
                        'flex w-full flex-col items-start rounded-md border px-3 py-2 text-left text-xs transition-colors',
                        values[c.name] === e.value ? 'border-primary bg-primary/10' : 'hover:bg-accent'
                      )}
                    >
                      <span className="text-sm text-foreground">{choiceValueLabel(c.name, e.value)}</span>
                      <span className="text-muted-foreground">
                        Italian {formatMs(e.italianStartMs)} – {formatMs(e.italianEndMs)}
                        {e.warnings.length > 0 && ` · ${e.warnings.join(', ')}`}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ))}

            {decided.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Set in Choices:{' '}
                {decided
                  .map((c) => `${MERGE_CHOICES[c.name]?.label ?? c.name}: ${choiceValueLabel(c.name, c.value)}`)
                  .join(' · ')}
              </p>
            )}

            <div className="space-y-1.5">
              <p className="text-sm font-medium">Merged file</p>
              <div className="flex items-center gap-1">
                <Input
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    setExisting(null);
                  }}
                  className="h-8 text-sm"
                />
                <span className="text-sm text-muted-foreground">.mkv</span>
              </div>
              <p className="text-xs text-muted-foreground">
                In the watch folder, next to {fileName(pair.fileA)} and {fileName(pair.fileB)}.{' '}
                {inputsAfter === 'delete'
                  ? 'Once verified, those two files are deleted (the ones in the watch folder).'
                  : 'Those two files are kept: delete them later.'}
              </p>
            </div>

            {existing && (
              <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-xs text-warning">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  <span className="font-medium">{existing.fileName}</span> is already{' '}
                  {existing.existsLocally && existing.existsOnServer
                    ? 'in the watch folder and on a server'
                    : existing.existsLocally
                      ? 'in the watch folder'
                      : 'on a server'}
                  . Replace it ({existing.existsLocally ? 'the local file is deleted' : ''}
                  {existing.existsLocally && existing.existsOnServer ? ', ' : ''}
                  {existing.existsOnServer ? 'the upload replaces the one on the server' : ''}), or stop to check.
                </span>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {existing ? 'Stop to check' : 'Cancel'}
          </Button>
          {existing ? (
            <Button
              variant="destructive"
              onClick={() => merge(true)}
              disabled={busy || loading || missing.length > 0 || !name.trim()}
            >
              {busy && <Loader2 className="animate-spin" />}
              Replace and merge
            </Button>
          ) : (
            <Button onClick={() => merge(false)} disabled={busy || loading || missing.length > 0 || !name.trim()}>
              {busy && <Loader2 className="animate-spin" />}
              {missing.length > 0 ? `Choose ${missing.length === 1 ? 'one more' : `${missing.length} more`}` : 'Merge'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
