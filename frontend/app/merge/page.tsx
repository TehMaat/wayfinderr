'use client';

import { useCallback, useEffect, useState } from 'react';
import { Cpu, Languages, Link2, Merge, RefreshCw, SlidersHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Chip } from '@/components/chip';
import { EmptyState } from '@/components/empty-state';
import { HeldNotice } from '@/components/held-notice';
import { MergeChoicesDialog } from '@/components/merge-choices-dialog';
import { MergePairCard } from '@/components/merge-pair-card';
import { MergePairDialog } from '@/components/merge-pair-dialog';
import { PageHeader } from '@/components/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip } from '@/components/ui/tooltip';
import { mergeApi } from '@/lib/api';
import { languageName } from '@/lib/rips';
import { useAppStore, type MergePair, type MergePairStatus, type MergeStatus, type Upload } from '@/lib/store';
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
            ·{' '}
            {status.runnerLastSeen === null
              ? 'The dyadrr container is not running'
              : `Last seen ${status.runnerLastSeen} s ago`}
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

/** The files held for a merge, newest first, with why and what to do with each */
function HeldFiles({ uploads, onPair }: { uploads: Upload[]; onPair?: (uploadId: string) => void }) {
  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="space-y-1">
        <h2 className="text-sm font-medium">Held for a merge ({uploads.length})</h2>
        <p className="text-xs text-muted-foreground">
          Not uploaded until you say so: files without Italian audio, and files whose twin of the same film (another
          file, a rip or a torrent, by its titles in every language) is around, for sure or maybe. Leave them here to
          wait for the twin, upload them as they are, or delete them.
        </p>
      </div>
      {uploads.map((upload) => (
        <HeldNotice key={upload.id} upload={upload} showName onPair={onPair ? () => onPair(upload.id) : undefined} />
      ))}
    </Card>
  );
}

// The pairs by what they wait for: Dyadrr, a merge, nothing (refused, failed, stopped), or done
const GROUPS: { key: string; title: string; hint: string; statuses: MergePairStatus[] }[] = [
  { key: 'active', title: 'In progress', hint: 'Dyadrr is analyzing or merging them, or they wait their turn', statuses: ['ANALYZING', 'MERGING'] },
  { key: 'ready', title: 'Ready to merge', hint: 'The analysis passed: merge them, after the choices left to make', statuses: ['ELIGIBLE'] },
  { key: 'stuck', title: 'Refused, errors and stopped', hint: 'Open the report to see why; analyze again once sorted out', statuses: ['REFUSED', 'ERROR', 'CANCELLED'] },
  { key: 'merged', title: 'Merged', hint: 'The merged file goes to the upload queue', statuses: ['MERGED'] },
];
// Merged pairs shown before "Show all"
const MERGED_SHOWN = 3;

function GroupTitle({ title, count, hint, action }: { title: string; count: number; hint: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-2 pt-1">
      <div>
        <h2 className="text-sm font-medium">
          {title} <span className="text-muted-foreground tabular">({count})</span>
        </h2>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      {action}
    </div>
  );
}

/** The pairs in groups, with the held files between the ones to act on and the rest */
function Pairs({
  pairs,
  held,
  runnerAlive,
  onPair,
}: {
  pairs: MergePair[];
  held: Upload[];
  runnerAlive: boolean;
  onPair?: (uploadId: string) => void;
}) {
  const [allMerged, setAllMerged] = useState(false);
  const group = (key: string) => pairs.filter((p) => GROUPS.find((g) => g.key === key)!.statuses.includes(p.status));
  const section = (key: string) => {
    const { title, hint } = GROUPS.find((g) => g.key === key)!;
    const list = group(key);
    if (list.length === 0) return null;
    const shown = key === 'merged' && !allMerged ? list.slice(0, MERGED_SHOWN) : list;
    return (
      <section key={key} className="flex flex-col gap-3">
        <GroupTitle
          title={title}
          count={list.length}
          hint={hint}
          action={
            key === 'merged' && list.length > MERGED_SHOWN ? (
              <Button variant="ghost" size="sm" className="h-7" onClick={() => setAllMerged(!allMerged)}>
                {allMerged ? 'Show fewer' : `Show all ${list.length}`}
              </Button>
            ) : undefined
          }
        />
        {shown.map((pair) => (
          <MergePairCard key={pair.id} pair={pair} runnerAlive={runnerAlive} />
        ))}
      </section>
    );
  };
  return (
    <>
      {section('active')}
      {section('ready')}
      {held.length > 0 && <HeldFiles uploads={held} onPair={onPair} />}
      {section('stuck')}
      {section('merged')}
    </>
  );
}

export default function MergePage() {
  const [status, setStatus] = useState<MergeStatus | null>(null);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const allUploads = useAppStore((s) => s.uploads);
  const held = allUploads.filter((u) => u.status === 'HELD');
  const pairs = useAppStore((s) => s.mergePairs);
  const [pairOpen, setPairOpen] = useState(false);
  const [pairFirst, setPairFirst] = useState<string | null>(null);
  const [choicesOpen, setChoicesOpen] = useState(false);

  const openPair = (uploadId: string | null) => {
    setPairFirst(uploadId);
    setPairOpen(true);
  };

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
    await Promise.all([
      load(),
      useAppStore
        .getState()
        .loadUploads()
        .catch(() => undefined),
      useAppStore.getState().loadMergePairs(),
    ]);
    setRefreshing(false);
  };

  return (
    <div className="flex flex-col gap-5 p-4 md:p-6">
      <PageHeader
        title="Merge"
        description="Two rips of the same film, one with the better video and one with the Italian audio, become one file with Dyadrr: the Italian audio is lined up with the better video and added to it, without re-encoding."
        actions={
          <>
            {status?.enabled && (
              <>
                <Tooltip content="What to do when a pair needs a decision">
                  <Button variant="outline" size="sm" onClick={() => setChoicesOpen(true)}>
                    <SlidersHorizontal />
                    Choices
                  </Button>
                </Tooltip>
                <Button size="sm" onClick={() => openPair(null)} disabled={!status.languageSupported}>
                  <Link2 />
                  Pair files…
                </Button>
              </>
            )}
            <Tooltip content="Refresh">
              <Button variant="ghost" size="icon" onClick={refresh} aria-label="Refresh">
                <RefreshCw className={cn(refreshing && 'animate-spin')} />
              </Button>
            </Tooltip>
          </>
        }
      />

      {!status && !failed ? (
        <Skeleton className="h-7 w-full max-w-xl" />
      ) : !status ? (
        <Card>
          <EmptyState
            icon={Merge}
            title="Merge status unavailable"
            description="The backend did not answer."
            className="py-8"
          />
        </Card>
      ) : status.enabled ? (
        <>
          <SetupStrip status={status} />
          <Pairs
            pairs={pairs}
            held={held}
            runnerAlive={status.runnerAlive}
            onPair={status.languageSupported ? openPair : undefined}
          />
          {held.length > 0 || pairs.length > 0 ? null : (
            <Card>
              <EmptyState
                icon={Merge}
                title="Nothing held for a merge"
                description="A new file without Italian audio, or with a twin of the same film around, waits here instead of being uploaded."
                className="py-8"
              />
            </Card>
          )}
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

      {/* Held and paired while merging was on: still here to upload, delete or look at */}
      {status && !status.enabled && <Pairs pairs={pairs} held={held} runnerAlive={status.runnerAlive} />}

      <MergePairDialog open={pairOpen} onOpenChange={setPairOpen} firstId={pairFirst} />
      <MergeChoicesDialog open={choicesOpen} onOpenChange={setChoicesOpen} />
    </div>
  );
}
