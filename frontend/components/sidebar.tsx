'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ArrowUpFromLine, Compass, Disc3, LayoutDashboard, Magnet, Plus, Server as ServerIcon, UploadCloud } from 'lucide-react';
import { useAppStore } from '@/lib/store';
import { cn } from '@/lib/utils';
import { AccountMenu } from '@/components/account-menu';
import { ThemeToggle } from '@/components/theme-toggle';
import { Tooltip } from '@/components/ui/tooltip';

const NAV = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/uploads', label: 'Uploads', icon: UploadCloud },
  { href: '/rips', label: 'Rips', icon: Disc3 },
  { href: '/servers', label: 'Servers', icon: ServerIcon },
  { href: '/clients', label: 'Clients', icon: Magnet },
];

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const servers = useAppStore((s) => s.servers);
  const uploads = useAppStore((s) => s.uploads);
  const filters = useAppStore((s) => s.filters);
  const setFilters = useAppStore((s) => s.setFilters);
  const ripsToChoose = useAppStore((s) => s.rips.filter((r) => r.status === 'NEEDS_ATTENTION').length);

  const activeServerIds = new Set(uploads.filter((u) => u.status === 'UPLOADING').map((u) => u.serverId));

  const openServer = (serverId: string) => {
    setFilters({ serverId, status: 'ALL' });
    router.push('/uploads');
    onNavigate?.();
  };

  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex h-14 items-center gap-2.5 px-5">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/15 text-primary">
          <Compass className="h-4 w-4" />
        </div>
        <span className="text-[15px] font-semibold tracking-tight text-foreground">wayfinderr</span>
      </div>

      <nav className="space-y-0.5 px-3 pt-2">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              onClick={onNavigate}
              className={cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
                active
                  ? 'bg-accent font-medium text-foreground'
                  : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
              {href === '/rips' && ripsToChoose > 0 && (
                <Tooltip content={`${ripsToChoose} need a choice`} side="right">
                  <span className="ml-auto rounded-full bg-warning/15 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-warning tabular">
                    {ripsToChoose}
                  </span>
                </Tooltip>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="mx-5 my-4 h-px bg-border" />

      <div className="flex items-center justify-between px-5 pb-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Servers</span>
        <Tooltip content="Add server" side="right">
          <Link
            href="/servers?add=1"
            onClick={onNavigate}
            className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <Plus className="h-3.5 w-3.5" />
          </Link>
        </Tooltip>
      </div>

      <div className="flex-1 space-y-0.5 overflow-y-auto px-3 scrollbar-thin">
        {servers.length === 0 && <p className="px-3 py-1 text-xs text-muted-foreground">No servers yet</p>}
        {servers.map((server) => {
          const selected = pathname.startsWith('/uploads') && filters.serverId === server.id;
          const uploading = activeServerIds.has(server.id);
          return (
            <button
              key={server.id}
              onClick={() => openServer(server.id)}
              className={cn(
                'flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors',
                selected
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
              )}
            >
              <ServerIcon className="h-4 w-4 shrink-0" />
              <span className="flex-1 truncate">{server.name}</span>
              {uploading && (
                <ArrowUpFromLine className={cn('h-3.5 w-3.5 animate-pulse', !selected && 'text-primary')} />
              )}
              <span
                className={cn(
                  'h-2 w-2 shrink-0 rounded-full',
                  server.reachable === undefined
                    ? 'bg-muted-foreground/40'
                    : server.reachable
                      ? 'bg-success shadow-[0_0_6px_hsl(var(--success))]'
                      : 'bg-destructive'
                )}
              />
            </button>
          );
        })}
      </div>

      <div className="flex items-center justify-between gap-2 border-t px-3 py-3">
        <AccountMenu />
        <ThemeToggle />
      </div>
    </div>
  );
}
