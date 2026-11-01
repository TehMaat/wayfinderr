'use client';

import { useCallback, useEffect, useState } from 'react';
import { Cpu, Languages, Merge, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Chip } from '@/components/chip';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip } from '@/components/ui/tooltip';
import { mergeApi } from '@/lib/api';
import { languageName } from '@/lib/rips';
import type { MergeStatus } from '@/lib/store';
import { cn } from '@/lib/utils';

// The dyadrr container starts and stops outside Wayfinderr: refresh while the page is open
const STATUS_REFRESH_MS = 10_000;

function SetupStrip({ status }: { status: MergeStatus }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {status.runnerAlive ? (
        <Chip icon={Cpu} tone="ok">
          Dyadrr runner online
        </Chip>
      ) : (
        <Chip icon={Cpu} tone="error">
          Dyadrr runner offline
          <span className="opacity-80">
            · {status.runnerLastSeen === null ? 'The dyadrr container is not running' : `Last seen ${status.runnerLastSeen} s ago`}
          </span>
        </Chip>
      )}
      {status.languageSupported ? (
        <Tooltip content="Dyadrr adds the Italian audio and subtitles of one file to the video of the other">
          <span>
            <Chip icon={Languages} tone="ok">
              Italian
            </Chip>
          </span>
        </Tooltip>
      ) : (
        <Chip icon={Languages} tone="error">
          {languageName(status.language)}
          <span className="opacity-80">· Dyadrr only works with Italian: set RIP_LANGUAGE=it</span>
        </Chip>
      )}
    </div>
  );
}

export default function MergePage() {
  const [status, setStatus] = useState<MergeStatus | null>(null);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await mergeApi.getStatus();
      setStatus(data.status);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, STATUS_REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  const refresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  return (
    <div className="flex flex-col gap-5 p-4 md:p-6">
      <PageHeader
        title="Merge"
        description="Two rips of the same film, one with the better video and one with the Italian audio, become one file with Dyadrr: the Italian audio is lined up with the better video and added to it, without re-encoding."
        actions={
          <Tooltip content="Refresh">
            <Button variant="ghost" size="icon" onClick={refresh} aria-label="Refresh">
              <RefreshCw className={cn(refreshing && 'animate-spin')} />
            </Button>
          </Tooltip>
        }
      />

      {!status && !failed ? (
        <Skeleton className="h-7 w-full max-w-xl" />
      ) : !status ? (
        <Card>
          <EmptyState icon={Merge} title="Merge status unavailable" description="The backend did not answer." className="py-8" />
        </Card>
      ) : status.enabled ? (
        <>
          <SetupStrip status={status} />
          <Card>
            <EmptyState
              icon={Merge}
              title="Nothing to merge yet"
              description="The pairs of rips to merge will show here."
              className="py-8"
            />
          </Card>
        </>
      ) : (
        <Card>
          <EmptyState
            icon={Merge}
            title="Merging is off"
            description={
              <>
                Set <code className="font-mono">MERGE_ENABLED=true</code> and start the{' '}
                <code className="font-mono">dyadrr</code> service with{' '}
                <code className="font-mono">docker compose --profile merge up -d</code>.
              </>
            }
            className="py-8"
          />
        </Card>
      )}
    </div>
  );
}
