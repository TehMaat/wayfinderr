'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
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
import { mergeApi } from '@/lib/api';
import { MERGE_CHOICES, MERGE_CHOICE_NAMES } from '@/lib/merge';
import type { MergeChoiceSettings } from '@/lib/store';
import { cn, errorMessage } from '@/lib/utils';

/** One segmented control: each value, or "Ask each time" */
function ChoiceButtons({
  options,
  value,
  onChange,
}: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {[...options, { value: 'ask', label: 'Ask each time' }].map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            'rounded-md border px-2.5 py-1 text-xs transition-colors',
            value === o.value ? 'border-primary bg-primary/10 text-foreground' : 'text-muted-foreground hover:bg-accent'
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Dyadrr's four choices: a fixed value passed to every analysis and merge, or asked
 * each time (left pending by the analysis, chosen before the merge).
 */
export function MergeChoicesDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [choices, setChoices] = useState<MergeChoiceSettings | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setChoices(null);
    mergeApi
      .getSettings()
      .then(({ data }) => setChoices(data.choices))
      .catch((err) => {
        toast.error('Could not read the choices', {
          description: errorMessage(err),
        });
        onOpenChange(false);
      });
  }, [open, onOpenChange]);

  const save = async () => {
    if (!choices) return;
    setSaving(true);
    try {
      await mergeApi.saveSettings(choices);
      toast.success('Choices saved', {
        description: 'Used by the next analyses',
      });
      onOpenChange(false);
    } catch (err) {
      toast.error('Could not save the choices', {
        description: errorMessage(err),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Merge choices</DialogTitle>
          <DialogDescription>
            Some pairs need a decision. A fixed value is used for every pair; with &ldquo;Ask each time&rdquo; the
            analysis shows what each value would do, and you choose before the merge.
          </DialogDescription>
        </DialogHeader>
        {!choices ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-4">
            {MERGE_CHOICE_NAMES.map((name) => (
              <div key={name} className="space-y-1.5">
                <div>
                  <p className="text-sm font-medium">{MERGE_CHOICES[name].label}</p>
                  <p className="text-xs text-muted-foreground">{MERGE_CHOICES[name].when}</p>
                </div>
                <ChoiceButtons
                  options={MERGE_CHOICES[name].values}
                  value={choices[name]}
                  onChange={(value) => setChoices({ ...choices, [name]: value })}
                />
              </div>
            ))}
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={!choices || saving}>
            {saving && <Loader2 className="animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
