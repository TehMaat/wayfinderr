'use client';

import { useState } from 'react';
import { AlertTriangle, ExternalLink, Loader2, RotateCcw, Square, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Tooltip } from '@/components/ui/tooltip';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { mergeApi } from '@/lib/api';
import {
  choiceValueLabel,
  fileName,
  formatMs,
  formatOffset,
  MERGE_CHOICES,
  PAIR_STATUS,
  PHASE_LABELS,
} from '@/lib/merge';
import { useAppStore, type MergePair, type MergeSummary } from '@/lib/store';
import { errorMessage } from '@/lib/utils';

function Fact({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  const body = (
    <div className="min-w-0">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="truncate text-sm tabular">{children}</p>
    </div>
  );
  return hint ? (
    <Tooltip content={hint}>
      <div>{body}</div>
    </Tooltip>
  ) : (
    body
  );
}

/** Which file is which: the better video (reference) and the Italian one (donor) */
function Files({ pair, summary }: { pair: MergePair; summary: MergeSummary | null }) {
  const role = (index: 0 | 1) => (summary?.roles ? (summary.roles.reference === index ? 'Video' : 'Italian') : null);
  return (
    <div className="space-y-1">
      {[pair.fileA, pair.fileB].map((file, i) => {
        const r = role(i as 0 | 1);
        return (
          <div key={i} className="flex min-w-0 items-center gap-2 text-sm">
            {r && (
              <Badge variant={r === 'Video' ? 'info' : 'success'} className="w-14 shrink-0 justify-center">
                {r}
              </Badge>
            )}
            <span className="truncate" title={file}>
              {fileName(file)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function Result({ summary }: { summary: MergeSummary }) {
  const pending = summary.choices.filter((c) => c.status === 'pending');
  const decided = summary.choices.filter((c) => c.status === 'decided');
  const italian = summary.italian;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Fact label="Offset" hint="Where the Italian goes on the better video's timeline (S): positive, later">
          {formatOffset(summary.offsetMs)}
        </Fact>
        <Fact label="In common" hint="Share of the better video matched in the Italian file">
          {summary.coverage !== null ? `${Math.round(summary.coverage * 100)}%` : '—'}
        </Fact>
        <Fact label="Italian" hint="Where the Italian audio is, in the merged file">
          {italian ? `${formatMs(italian.startMs)} – ${formatMs(italian.endMs)}` : '—'}
          {summary.film && <span className="text-muted-foreground"> of {formatMs(summary.film.endMs)}</span>}
        </Fact>
        <Fact label="Measured on" hint="The language both files have, used to line them up">
          {summary.measureLanguage ?? '—'}
        </Fact>
      </div>

      {summary.audio.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Italian audio:{' '}
          {summary.audio
            .map(
              (t) =>
                `${t.name ?? `track ${t.id}`} (${t.role}${t.taken === false ? ', left out' : t.taken === null ? ', to choose' : ''})`
            )
            .join(' · ')}
        </p>
      )}

      {decided.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {decided
            .map((c) => `${MERGE_CHOICES[c.name]?.label ?? c.name}: ${choiceValueLabel(c.name, c.value)}`)
            .join(' · ')}
        </p>
      )}

      {pending.length > 0 && (
        <div className="space-y-2 rounded-md border border-info/40 bg-info/10 p-3">
          <p className="text-xs font-medium">To choose before the merge</p>
          {pending.map((c) => (
            <div key={c.name} className="space-y-0.5 text-xs">
              <p>{MERGE_CHOICES[c.name]?.label ?? c.name}</p>
              <ul className="space-y-0.5 text-muted-foreground">
                {c.effects.map((e) => (
                  <li key={e.value}>
                    <span className="text-foreground">{choiceValueLabel(c.name, e.value)}</span>: Italian{' '}
                    {formatMs(e.italianStartMs)} – {formatMs(e.italianEndMs)}
                    {e.warnings.length > 0 && <span> · {e.warnings.join(', ')}</span>}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {summary.warnings.length > 0 && (
        <ul className="space-y-1">
          {summary.warnings.map((w, i) => (
            <li key={i} className="flex items-start gap-2 text-xs text-warning">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                <span className="font-mono">{w.code}</span> {w.message}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** A pair of files: its analysis while Dyadrr runs it, then what it found */
export function MergePairCard({ pair, runnerAlive }: { pair: MergePair; runnerAlive: boolean }) {
  const [busy, setBusy] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const status = PAIR_STATUS[pair.status] ?? PAIR_STATUS.ERROR;
  const summary = pair.summary;
  const analyzing = pair.status === 'ANALYZING';

  const run = async (action: () => Promise<unknown>, failure: string) => {
    setBusy(true);
    try {
      await action();
      await useAppStore.getState().refreshMergePair(pair.id);
    } catch (err) {
      toast.error(failure, { description: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="space-y-3 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <Files pair={pair} summary={summary} />
        <div className="flex shrink-0 items-center gap-1">
          <Badge variant={status.tone}>
            {analyzing && <Loader2 className="animate-spin" />}
            {status.label}
          </Badge>
          {analyzing ? (
            <Tooltip content="Stop the analysis">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                aria-label="Stop"
                disabled={busy}
                onClick={() => run(() => mergeApi.cancelPair(pair.id), 'Could not stop the analysis')}
              >
                <Square className="fill-current" />
              </Button>
            </Tooltip>
          ) : (
            <Tooltip content="Analyze again">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                aria-label="Analyze again"
                disabled={busy}
                onClick={() => run(() => mergeApi.analyzePair(pair.id), 'Could not analyze again')}
              >
                <RotateCcw />
              </Button>
            </Tooltip>
          )}
          {summary && (
            <Tooltip content="Dyadrr's full report (JSON)">
              <Button variant="ghost" size="icon" className="h-7 w-7" asChild>
                <a href={mergeApi.reportUrl(pair.id)} target="_blank" rel="noreferrer" aria-label="Report">
                  <ExternalLink />
                </a>
              </Button>
            </Tooltip>
          )}
          <Tooltip content="Remove the pair (the files stay)">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              aria-label="Remove"
              onClick={() => setRemoveOpen(true)}
            >
              <Trash2 />
            </Button>
          </Tooltip>
        </div>
      </div>

      {analyzing && (
        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground">
            {pair.phase
              ? `${PHASE_LABELS[pair.phase] ?? pair.phase}${pair.progress !== null ? ` · ${pair.progress}%` : ''}`
              : runnerAlive
                ? 'Waiting for Dyadrr to start'
                : 'Waiting for the Dyadrr container: it is not running'}
          </p>
          <Progress value={pair.progress ?? 0} animated={pair.progress === null} />
        </div>
      )}

      {(pair.status === 'REFUSED' || pair.status === 'ERROR') && pair.reasonMessage && (
        <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="break-words">
            {pair.reasonCode && <span className="font-mono">{pair.reasonCode}</span>} {pair.reasonMessage}
          </span>
        </div>
      )}

      {summary && pair.status === 'ELIGIBLE' && <Result summary={summary} />}
      {summary && pair.status === 'REFUSED' && summary.warnings.length > 0 && (
        <Result summary={{ ...summary, choices: [] }} />
      )}

      <p className="text-[11px] text-muted-foreground">
        Original language: {pair.originalLanguage ?? 'unknown (measured on English)'}
        {pair.dyadrrVersion && ` · Dyadrr ${pair.dyadrrVersion}`}
      </p>

      <ConfirmDialog
        open={removeOpen}
        onOpenChange={setRemoveOpen}
        title="Remove the pair?"
        description="The pair and its analysis are removed. The two files stay as they are."
        confirmLabel="Remove"
        onConfirm={async () => {
          try {
            await mergeApi.removePair(pair.id);
            useAppStore.getState().removeMergePair(pair.id);
          } catch (err) {
            toast.error('Could not remove the pair', {
              description: errorMessage(err),
            });
          }
        }}
      />
    </Card>
  );
}
