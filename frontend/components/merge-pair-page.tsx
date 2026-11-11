'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Braces, Download, Loader2, Merge, ScrollText } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip } from '@/components/ui/tooltip';
import { EmptyState } from '@/components/empty-state';
import { ReportView } from '@/components/report/report-view';
import { mergeApi } from '@/lib/api';
import type { DyadrrReport } from '@/lib/dyadrr';
import { fileName, PAIR_STATUS } from '@/lib/merge';
import { useAppStore, type MergePair } from '@/lib/store';
import { cn, errorMessage } from '@/lib/utils';

export type PairTab = 'report' | 'merge-report' | 'logs';

const hasMergeReport = (pair: MergePair) => Boolean(pair.mergeSummary);

/** The pair from the store, fetched when the page is opened directly */
export function usePair(id: string) {
  const pair = useAppStore((s) => s.mergePairs.find((p) => p.id === id));
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    useAppStore
      .getState()
      .refreshMergePair(id)
      .then(() => setMissing(!useAppStore.getState().mergePairs.some((p) => p.id === id)));
  }, [id]);
  return { pair, missing };
}

/** The pair's page: its two files and status, and the tabs (analysis, merge, logs) */
export function MergePairShell({ id, tab, actions, children }: { id: string; tab: PairTab; actions?: React.ReactNode; children: React.ReactNode }) {
  const { pair, missing } = usePair(id);
  const status = pair ? PAIR_STATUS[pair.status] ?? PAIR_STATUS.ERROR : null;
  const role = (index: 0 | 1) =>
    pair?.summary?.roles ? (pair.summary.roles.reference === index ? 'Video' : 'Italian') : null;
  const tabs: { value: PairTab; label: string; shown: boolean }[] = [
    { value: 'report', label: 'Analysis report', shown: true },
    { value: 'merge-report', label: 'Merge report', shown: pair ? hasMergeReport(pair) : false },
    { value: 'logs', label: 'Logs', shown: true },
  ];

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <Link href="/merge" className="flex w-fit items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" /> Merge
      </Link>
      {missing && !pair ? (
        <Card>
          <EmptyState icon={Merge} title="Pair not found" description="It was removed, or the link is wrong." className="py-8" />
        </Card>
      ) : !pair ? (
        <Skeleton className="h-16 w-full" />
      ) : (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-1">
            {[pair.fileA, pair.fileB].map((file, i) => {
              const r = role(i as 0 | 1);
              return (
                <div key={i} className="flex min-w-0 items-center gap-2">
                  {r && (
                    <Badge variant={r === 'Video' ? 'info' : 'success'} className="w-14 shrink-0 justify-center">
                      {r}
                    </Badge>
                  )}
                  <span className="truncate text-sm font-medium" title={file}>
                    {fileName(file)}
                  </span>
                </div>
              );
            })}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {status && (
              <Badge variant={status.tone}>
                {(pair.status === 'ANALYZING' || pair.status === 'MERGING') && <Loader2 className="animate-spin" />}
                {status.label}
              </Badge>
            )}
            {actions}
          </div>
        </div>
      )}
      <div className="flex gap-1 border-b">
        {tabs
          .filter((t) => t.shown || t.value === tab)
          .map((t) => (
            <Link
              key={t.value}
              href={`/merge/pairs/${id}/${t.value}`}
              className={cn(
                '-mb-px border-b-2 px-3 py-2 text-sm transition-colors',
                t.value === tab ? 'border-primary font-medium text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'
              )}
            >
              {t.label}
            </Link>
          ))}
      </div>
      {children}
    </div>
  );
}

/** Raw JSON and download, for a report */
function RawLinks({ id, merge }: { id: string; merge: boolean }) {
  return (
    <>
      <Tooltip content="The report as Dyadrr wrote it">
        <Button variant="outline" size="sm" className="h-7" asChild>
          <a href={mergeApi.reportUrl(id, merge)} target="_blank" rel="noreferrer">
            <Braces />
            Raw JSON
          </a>
        </Button>
      </Tooltip>
      <Tooltip content="Save the report">
        <Button variant="outline" size="sm" className="h-7" asChild>
          <a href={mergeApi.reportUrl(id, merge, true)} download>
            <Download />
            Download
          </a>
        </Button>
      </Tooltip>
    </>
  );
}

/** A report tab: read when opened, and again when the pair's job ends */
export function MergeReportPage({ id, merge }: { id: string; merge: boolean }) {
  const { pair } = usePair(id);
  const [report, setReport] = useState<DyadrrReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // A new report comes with the end of a job: completedAt for an analysis, the merge's outcome otherwise
  const version = merge ? `${pair?.mergedAt}|${pair?.mergeReasonCode}|${pair?.status}` : `${pair?.completedAt}|${pair?.status}`;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (merge ? mergeApi.getMergeReport(id) : mergeApi.getReport(id))
      .then(({ data }) => {
        if (cancelled) return;
        setReport(data);
        setError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setReport(null);
        const status = (err as { response?: { status?: number } })?.response?.status;
        setError(status === 404 ? null : errorMessage(err, 'The report could not be read'));
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [id, merge, version]);

  return (
    <MergePairShell id={id} tab={merge ? 'merge-report' : 'report'} actions={report ? <RawLinks id={id} merge={merge} /> : undefined}>
      {loading && !report ? (
        <div className="space-y-3">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : report ? (
        <ReportView report={report} />
      ) : (
        <Card>
          <EmptyState
            icon={ScrollText}
            title={error ? 'The report could not be read' : merge ? 'No merge report' : 'No report yet'}
            description={
              error ??
              (pair?.status === 'ANALYZING' || pair?.status === 'MERGING'
                ? 'Dyadrr is still working on it: the report comes when it ends.'
                : merge
                  ? 'The pair has not been merged yet.'
                  : 'The analysis has not ended, or ended without a report: see the logs.')
            }
            className="py-8"
          />
        </Card>
      )}
    </MergePairShell>
  );
}
