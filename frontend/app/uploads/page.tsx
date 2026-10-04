'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { FolderSearch, ListFilter, RefreshCw, Search, Server as ServerIcon, UploadCloud, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip } from '@/components/ui/tooltip';
import { EmptyState } from '@/components/empty-state';
import { STATUS_META } from '@/components/status-badge';
import { UploadTable } from '@/components/upload-table';
import { UPLOAD_STATUSES, useAppStore, type Filters } from '@/lib/store';
import { cn } from '@/lib/utils';

function FilterItem({
  active,
  onClick,
  icon,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  count: number;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[13px] transition-colors [&_svg]:h-3.5 [&_svg]:w-3.5',
        active ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:bg-accent hover:text-foreground'
      )}
    >
      {icon}
      <span className="flex-1 truncate">{label}</span>
      <span className="text-xs tabular opacity-80">{count}</span>
    </button>
  );
}

function FilterSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-card p-2">
      <p className="px-2.5 pb-1.5 pt-1 text-xs font-medium text-foreground">{title}</p>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

export default function UploadsPage() {
  const uploads = useAppStore((s) => s.uploads);
  const loaded = useAppStore((s) => s.uploadsLoaded);
  const servers = useAppStore((s) => s.servers);
  const filters = useAppStore((s) => s.filters);
  const setFilters = useAppStore((s) => s.setFilters);
  const [refreshing, setRefreshing] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  // "/" focuses the search box, Esc clears it
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement).closest('input,textarea,select');
      if (e.key === '/' && !typing) {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === 'Escape' && e.target === searchRef.current) {
        setFilters({ search: '' });
        searchRef.current?.blur();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setFilters]);

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const u of uploads) counts[u.status] = (counts[u.status] ?? 0) + 1;
    return counts;
  }, [uploads]);

  const serverCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const u of uploads) if (u.serverId) counts[u.serverId] = (counts[u.serverId] ?? 0) + 1;
    return counts;
  }, [uploads]);

  const filtered = useMemo(() => {
    const q = filters.search.trim().toLowerCase();
    return uploads.filter(
      (u) =>
        (filters.status === 'ALL' || u.status === filters.status) &&
        (filters.serverId === 'ALL' || u.serverId === filters.serverId) &&
        (!q || u.filename.toLowerCase().includes(q))
    );
  }, [uploads, filters]);

  const hasFilters = filters.status !== 'ALL' || filters.serverId !== 'ALL' || filters.search !== '';
  const set = (f: Partial<Filters>) => setFilters(f);

  const refresh = async () => {
    setRefreshing(true);
    await useAppStore.getState().loadAll();
    setRefreshing(false);
  };

  return (
    <div className="flex h-full">
      {/* Filters panel */}
      <aside className="hidden w-60 shrink-0 space-y-3 overflow-y-auto border-r p-3 scrollbar-thin lg:block">
        <div className="flex items-center justify-between px-1 pt-1">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <ListFilter className="h-4 w-4 text-muted-foreground" />
            Filters
          </h2>
          {hasFilters && (
            <button
              onClick={() => set({ status: 'ALL', serverId: 'ALL', search: '' })}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Clear
            </button>
          )}
        </div>

        <FilterSection title="Status">
          <FilterItem
            active={filters.status === 'ALL'}
            onClick={() => set({ status: 'ALL' })}
            icon={<UploadCloud />}
            label="All"
            count={uploads.length}
          />
          {UPLOAD_STATUSES.map((status) => {
            const meta = STATUS_META[status];
            const Icon = meta.icon;
            return (
              <FilterItem
                key={status}
                active={filters.status === status}
                onClick={() => set({ status })}
                icon={<Icon className={filters.status === status ? '' : meta.color} />}
                label={meta.label}
                count={statusCounts[status] ?? 0}
              />
            );
          })}
        </FilterSection>

        <FilterSection title="Servers">
          <FilterItem
            active={filters.serverId === 'ALL'}
            onClick={() => set({ serverId: 'ALL' })}
            icon={<ServerIcon />}
            label="All servers"
            count={uploads.length}
          />
          {servers.map((server) => (
            <FilterItem
              key={server.id}
              active={filters.serverId === server.id}
              onClick={() => set({ serverId: server.id })}
              icon={
                <span
                  className={cn(
                    'mx-[3px] !h-2 !w-2 rounded-full',
                    server.reachable ? 'bg-success' : server.reachable === false ? 'bg-destructive' : 'bg-muted-foreground/40'
                  )}
                />
              }
              label={server.name}
              count={serverCounts[server.id] ?? 0}
            />
          ))}
        </FilterSection>
      </aside>

      {/* Table */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5">
          <div className="relative w-full max-w-sm">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={searchRef}
              value={filters.search}
              onChange={(e) => set({ search: e.target.value })}
              placeholder="Search uploads…"
              className="h-8 pl-8 pr-10"
            />
            <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded border bg-muted px-1.5 font-mono text-[10px] text-muted-foreground">
              /
            </kbd>
          </div>

          {/* Compact filters for small screens */}
          <select
            value={filters.status}
            onChange={(e) => set({ status: e.target.value as Filters['status'] })}
            className="h-8 rounded-md border border-input bg-background px-2 text-xs lg:hidden"
          >
            <option value="ALL">All statuses</option>
            {UPLOAD_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_META[s].label}
              </option>
            ))}
          </select>

          {filters.serverId !== 'ALL' && (
            <button
              onClick={() => set({ serverId: 'ALL' })}
              className="flex h-8 items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-2.5 text-xs text-primary"
            >
              {servers.find((s) => s.id === filters.serverId)?.name ?? 'Server'}
              <X className="h-3 w-3" />
            </button>
          )}

          <div className="ml-auto">
            <Tooltip content="Refresh">
              <Button variant="ghost" size="icon" onClick={refresh} aria-label="Refresh">
                <RefreshCw className={cn(refreshing && 'animate-spin')} />
              </Button>
            </Tooltip>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
          {!loaded ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-9 w-full" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            hasFilters ? (
              <EmptyState
                icon={FolderSearch}
                title="No uploads match the filters"
                action={
                  <Button variant="outline" size="sm" onClick={() => set({ status: 'ALL', serverId: 'ALL', search: '' })}>
                    Clear filters
                  </Button>
                }
              />
            ) : (
              <EmptyState
                icon={UploadCloud}
                title="No uploads yet"
                description="New .mkv files saved by MakeMKV in the watch folder show up here automatically."
              />
            )
          ) : (
            <UploadTable uploads={filtered} />
          )}
        </div>

        <div className="border-t px-4 py-1.5 text-[11px] text-muted-foreground">
          {filtered.length} of {uploads.length} uploads
        </div>
      </div>
    </div>
  );
}
