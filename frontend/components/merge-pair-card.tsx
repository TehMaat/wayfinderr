'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  FileVideo,
  Loader2,
  Merge,
  RotateCcw,
  ScrollText,
  Square,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Tooltip } from '@/components/ui/tooltip';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { MergeConfirmDialog } from '@/components/merge-confirm-dialog';
import { CheckpointStrip } from '@/components/report/checkpoint-chart';
import { CHECKPOINT_OUTCOMES, withClock } from '@/lib/dyadrr';
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
import { errorMessage, formatBytes } from '@/lib/utils';

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

/** Which file is which: the better video (reference) and the Italian one (donor); opens the pair's page */
function Files({ pair, summary }: { pair: MergePair; summary: MergeSummary | null }) {
  const role = (index: 0 | 1) => (summary?.roles ? (summary.roles.reference === index ? 'Video' : 'Italian') : null);
  return (
    <Link href={`/merge/pairs/${pair.id}/report`} className="group min-w-0 space-y-1">
      {[pair.fileA, pair.fileB].map((file, i) => {
        const r = role(i as 0 | 1);
        return (
          <div key={i} className="flex min-w-0 items-center gap-2 text-sm">
            {r && (
              <Badge variant={r === 'Video' ? 'info' : 'success'} className="w-14 shrink-0 justify-center">
                {r}
              </Badge>
            )}
            <span className="truncate group-hover:underline" title={file}>
              {fileName(file)}
            </span>
          </div>
        );
      })}
    </Link>
  );
}

/**
 * The checkpoints along the film, and the ones that went wrong: a lone unmatched
 * point among consistent ones shows at a glance. Opens the chart in the report.
 */
function Checkpoints({ pair, summary }: { pair: MergePair; summary: MergeSummary }) {
  const points = summary.checkpoints ?? [];
  if (points.length === 0) return null;
  const counts = CHECKPOINT_OUTCOMES.map((o) => ({ ...o, n: points.filter((p) => p.outcome === o.value).length })).filter(
    (o) => o.n > 0
  );
  const odd = points.filter((p) => p.outcome === 'unmatched' || p.outcome === 'contradictory');
  return (
    <Link href={`/merge/pairs/${pair.id}/report#checkpoints`} className="block space-y-1 rounded-md hover:bg-accent/40">
      <CheckpointStrip checkpoints={points} endMs={summary.film?.endMs ?? null} />
      <p className="flex flex-wrap gap-x-3 text-[11px] text-muted-foreground">
        <span>{points.length} checkpoints</span>
        {counts.map((o) => (
          <span key={o.value} className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full" style={{ background: o.color }} />
            {o.n} {o.label.toLowerCase()}
          </span>
        ))}
        {odd.length > 0 && odd.length <= 3 && (
          <span>at {odd.map((p) => formatMs(p.positionMs)).join(', ')}</span>
        )}
      </p>
    </Link>
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
  // A job queued or running: the analysis, or the merge
  const analyzing = pair.status === 'ANALYZING' || pair.status === 'MERGING';
  const merged = pair.status === 'MERGED';
  const [mergeOpen, setMergeOpen] = useState(false);

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
          {pair.status === 'ELIGIBLE' && (
            <Button size="sm" className="mr-1 h-7" onClick={() => setMergeOpen(true)} disabled={busy}>
              <Merge />
              Merge…
            </Button>
          )}
          {analyzing ? (
            <Tooltip content={pair.status === 'MERGING' ? 'Stop the merge' : 'Stop the analysis'}>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                aria-label="Stop"
                disabled={busy}
                onClick={() => run(() => mergeApi.cancelPair(pair.id), 'Could not stop it')}
              >
                <Square className="fill-current" />
              </Button>
            </Tooltip>
          ) : merged ? null : (
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
          {pair.mergeSummary && (
            <Tooltip content="Dyadrr's merge report">
              <Button variant="ghost" size="icon" className="h-7 w-7" asChild>
                <Link href={`/merge/pairs/${pair.id}/merge-report`} aria-label="Merge report">
                  <FileVideo />
                </Link>
              </Button>
            </Tooltip>
          )}
          {summary && (
            <Tooltip content="Dyadrr's analysis report">
              <Button variant="ghost" size="icon" className="h-7 w-7" asChild>
                <Link href={`/merge/pairs/${pair.id}/report`} aria-label="Report">
                  <FileText />
                </Link>
              </Button>
            </Tooltip>
          )}
          <Tooltip content="The pair's logs">
            <Button variant="ghost" size="icon" className="h-7 w-7" asChild>
              <Link href={`/merge/pairs/${pair.id}/logs`} aria-label="Logs">
                <ScrollText />
              </Link>
            </Button>
          </Tooltip>
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
              : pair.status === 'MERGING' && !pair.jobId
                ? 'Waiting for the rip in progress to end'
                : runnerAlive
                  ? 'Queued: Dyadrr runs one job at a time'
                  : 'Waiting for the Dyadrr container: it is not running'}
          </p>
          <Progress value={pair.progress ?? 0} animated={pair.progress === null} />
        </div>
      )}

      {pair.status === 'ELIGIBLE' && pair.mergeReasonMessage && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="break-words">
            Last merge not done: {pair.mergeReasonCode && <span className="font-mono">{pair.mergeReasonCode}</span>}{' '}
            {pair.mergeReasonMessage}. Merge again when it is sorted out.
          </span>
        </div>
      )}

      {merged && (
        <div className="space-y-2 rounded-md border border-success/40 bg-success/10 p-3 text-sm">
          <p className="flex items-start gap-2">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
            <span className="min-w-0 break-words">
              <span className="font-medium">{pair.outputPath ? fileName(pair.outputPath) : 'Merged file'}</span>
              {pair.mergeSummary?.sizeBytes ? ` · ${formatBytes(pair.mergeSummary.sizeBytes, 1)}` : ''} — merged and
              verified.{' '}
              {pair.outputUploadId ? (
                <Link href={`/uploads/${pair.outputUploadId}`} className="underline">
                  Its upload
                </Link>
              ) : (
                'It goes to the upload queue once the watch folder picks it up.'
              )}
            </span>
          </p>
          <p className="text-xs text-muted-foreground">
            The two files were {pair.inputsAfter === 'delete' ? 'deleted (the ones in the watch folder)' : 'kept'};
            their source torrents are cleaned up once the merged file is on a server.
          </p>
          {(pair.mergeSummary?.warnings ?? []).length > 0 && (
            <ul className="space-y-1">
              {pair.mergeSummary!.warnings.map((w, i) => (
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
      )}

      {(pair.status === 'REFUSED' || pair.status === 'ERROR') && pair.reasonMessage && (
        <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="break-words">
            {pair.reasonCode && <span className="font-mono">{pair.reasonCode}</span>} {withClock(pair.reasonMessage)}
          </span>
        </div>
      )}

      {summary && pair.status !== 'ANALYZING' && <Checkpoints pair={pair} summary={summary} />}
      {summary && (pair.status === 'ELIGIBLE' || pair.status === 'MERGING') && <Result summary={summary} />}
      {summary && pair.status === 'REFUSED' && summary.warnings.length > 0 && (
        <Result summary={{ ...summary, choices: [] }} />
      )}

      <p className="text-[11px] text-muted-foreground">
        Original language: {pair.originalLanguage ?? 'unknown (measured on English)'}
        {pair.dyadrrVersion && ` · Dyadrr ${pair.dyadrrVersion}`}
      </p>

      {mergeOpen && <MergeConfirmDialog pair={pair} open={mergeOpen} onOpenChange={setMergeOpen} />}

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
