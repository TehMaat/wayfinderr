'use client';

import { useEffect, useMemo, useState } from 'react';
import { Clapperboard, Cpu, Disc3, FolderSearch, Languages, RefreshCw, Timer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip } from '@/components/ui/tooltip';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { RipChooseDialog } from '@/components/rip-choose-dialog';
import { RipTable } from '@/components/rip-table';
import { languageName, matchesRipFilter, RIP_FILTERS, type RipFilter } from '@/lib/rips';
import { useAppStore, type Rip, type RipperStatus } from '@/lib/store';
import { cn } from '@/lib/utils';

// The runner and the TMDB key change outside Wayfinderr: refresh while the page is open
const STATUS_REFRESH_MS = 30_000;

function Chip({
  icon: Icon,
  tone = 'neutral',
  children,
}: {
  icon: typeof Cpu;
  tone?: 'neutral' | 'ok' | 'warning' | 'error';
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs',
        tone === 'neutral' && 'text-muted-foreground',
        tone === 'ok' && 'text-foreground',
        tone === 'warning' && 'border-warning/40 bg-warning/10 text-warning',
        tone === 'error' && 'border-destructive/40 bg-destructive/10 text-destructive'
      )}
    >
      <Icon className={cn('h-3.5 w-3.5 shrink-0', tone === 'ok' && 'text-success')} />
      {children}
    </span>
  );
}

function SetupStrip({ status }: { status: RipperStatus }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {status.runnerAlive ? (
        <Chip icon={Cpu} tone="ok">
          MakeMKV runner online
        </Chip>
      ) : (
        <Chip icon={Cpu} tone="error">
          MakeMKV runner offline
          <span className="opacity-80">· The wayfinderr-makemkv container is not running</span>
        </Chip>
      )}
      {status.tmdbConfigured ? (
        <Chip icon={Clapperboard} tone="ok">
          TMDB configured
        </Chip>
      ) : (
        <Chip icon={Clapperboard} tone="warning">
          TMDB not configured
          <span className="opacity-80">· set TMDB_API_KEY</span>
        </Chip>
      )}
      <Tooltip content="Audio and subtitle tracks kept in the rip">
        <span>
          <Chip icon={Languages}>{languageName(status.language)} + original</Chip>
        </span>
      </Tooltip>
      <Tooltip content="Shorter titles (extras, trailers) are ignored">
        <span>
          <Chip icon={Timer}>Titles ≥ {Math.round(status.minLength / 60)} min</Chip>
        </span>
      </Tooltip>
    </div>
  );
}

export default function RipsPage() {
  const rips = useAppStore((s) => s.rips);
  const loaded = useAppStore((s) => s.ripsLoaded);
  const status = useAppStore((s) => s.ripStatus);
  const [filter, setFilter] = useState<RipFilter>('ALL');
  const [choosingId, setChoosingId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // /rips?filter=attention (dashboard callout) opens that list
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('filter') === 'attention') {
      setFilter('ATTENTION');
      window.history.replaceState(null, '', '/rips');
    }
  }, []);

  useEffect(() => {
    const load = () => useAppStore.getState().loadRips();
    load();
    const timer = setInterval(load, STATUS_REFRESH_MS);
    return () => clearInterval(timer);
  }, []);

  const counts = useMemo(
    () =>
      Object.fromEntries(RIP_FILTERS.map((f) => [f.value, rips.filter((r) => matchesRipFilter(r, f.value)).length])) as Record<
        RipFilter,
        number
      >,
    [rips]
  );
  const filtered = useMemo(() => rips.filter((r) => matchesRipFilter(r, filter)), [rips, filter]);
  const choosing = rips.find((r) => r.id === choosingId) ?? null;

  const openChoose = (rip: Rip) => {
    setChoosingId(rip.id);
    setDialogOpen(true);
  };

  const refresh = async () => {
    setRefreshing(true);
    await useAppStore.getState().loadRips();
    setRefreshing(false);
  };

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-4 md:p-6">
      <PageHeader
        title="Rips"
        description="Film discs (ISO, Blu-ray, DVD) downloaded by qBittorrent are ripped with MakeMKV into the watch folder."
        actions={
          <Tooltip content="Refresh">
            <Button variant="ghost" size="icon" onClick={refresh} aria-label="Refresh">
              <RefreshCw className={cn(refreshing && 'animate-spin')} />
            </Button>
          </Tooltip>
        }
      />

      {!loaded ? (
        <Skeleton className="h-7 w-full max-w-xl" />
      ) : status?.enabled ? (
        <SetupStrip status={status} />
      ) : (
        <Card>
          <EmptyState
            icon={Disc3}
            title="Automatic ripping is off"
            description={
              <>
                Set <code className="font-mono">RIP_ENABLED=true</code> and mount the downloads folder on the backend.
              </>
            }
            className="py-8"
          />
        </Card>
      )}

      {(!loaded || status?.enabled || rips.length > 0) && (
        <Card className="overflow-hidden">
          <div className="flex gap-1 overflow-x-auto border-b p-2 scrollbar-thin">
            {RIP_FILTERS.map((f) => {
              const active = filter === f.value;
              const count = counts[f.value] ?? 0;
              return (
                <button
                  key={f.value}
                  onClick={() => setFilter(f.value)}
                  className={cn(
                    'flex shrink-0 items-center gap-2 rounded-md px-2.5 py-1.5 text-[13px] transition-colors',
                    active ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                  )}
                >
                  {f.label}
                  <span
                    className={cn(
                      'text-xs tabular opacity-80',
                      f.value === 'ATTENTION' && count > 0 && !active && 'font-semibold text-warning opacity-100'
                    )}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>

          {!loaded ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-11 w-full" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            rips.length > 0 ? (
              <EmptyState
                icon={FolderSearch}
                title="Nothing in this list"
                action={
                  <Button variant="outline" size="sm" onClick={() => setFilter('ALL')}>
                    Show all
                  </Button>
                }
              />
            ) : (
              <EmptyState
                icon={Disc3}
                title="No discs yet"
                description="ISO files and Blu-ray (BDMV) or DVD (VIDEO_TS) folders that appear in the downloads show up here."
              />
            )
          ) : (
            <RipTable rips={filtered} onChoose={openChoose} />
          )}
        </Card>
      )}

      <RipChooseDialog rip={choosing} open={dialogOpen && Boolean(choosing)} onOpenChange={setDialogOpen} />
    </div>
  );
}
