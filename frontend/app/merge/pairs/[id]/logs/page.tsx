'use client';

import { LogViewer } from '@/components/log-viewer';
import { MergePairShell } from '@/components/merge-pair-page';

// The pair's lines: Wayfinderr's (queued, ended, removed) and its Dyadrr jobs', as long as retention keeps them
export default function PairLogsPage({ params }: { params: { id: string } }) {
  return (
    <MergePairShell id={params.id} tab="logs">
      <LogViewer
        fixed={{ pair: params.id }}
        sources={['wayfinderr', 'dyadrr-job']}
        defaultRange="all"
        emptyHint="No lines of this pair: its jobs ended before the log history, or retention deleted them."
      />
    </MergePairShell>
  );
}
