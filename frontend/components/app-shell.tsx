'use client';

import { useEffect, useState } from 'react';
import { Menu } from 'lucide-react';
import { Toaster } from 'sonner';
import { Sidebar } from '@/components/sidebar';
import { StatusBar } from '@/components/status-bar';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { useAppStore } from '@/lib/store';
import { useRealtime } from '@/lib/useRealtime';
import { cn } from '@/lib/utils';

const SPACE_REFRESH_MS = 60_000;

export function AppShell({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  useRealtime();

  useEffect(() => {
    useAppStore.getState().loadAll();
    // Free space also changes outside Wayfinderr: refresh it periodically
    const timer = setInterval(() => {
      useAppStore.getState().loadSpace().catch(() => undefined);
    }, SPACE_REFRESH_MS);
    return () => clearInterval(timer);
  }, []);

  return (
    <TooltipProvider>
      <div className="flex h-screen overflow-hidden">
        {/* Desktop sidebar */}
        <aside className="hidden w-60 shrink-0 border-r md:block">
          <Sidebar />
        </aside>

        {/* Mobile sidebar */}
        <div
          className={cn(
            'fixed inset-0 z-40 bg-black/60 transition-opacity md:hidden',
            mobileOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
          )}
          onClick={() => setMobileOpen(false)}
        />
        <aside
          className={cn(
            'fixed inset-y-0 left-0 z-50 w-64 border-r transition-transform md:hidden',
            mobileOpen ? 'translate-x-0' : '-translate-x-full'
          )}
        >
          <Sidebar onNavigate={() => setMobileOpen(false)} />
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-12 shrink-0 items-center border-b px-3 md:hidden">
            <Button variant="ghost" size="icon" onClick={() => setMobileOpen(true)} aria-label="Open menu">
              <Menu />
            </Button>
            <span className="ml-2 text-sm font-semibold">wayfinderr</span>
          </div>
          <main className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">{children}</main>
          <StatusBar />
        </div>
      </div>
      <Toaster theme="system" position="bottom-right" richColors closeButton offset={44} />
    </TooltipProvider>
  );
}
