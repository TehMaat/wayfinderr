'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ChevronDown, ChevronRight, Download, Loader2, Pause, Play, ScrollText, Search } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Tooltip } from '@/components/ui/tooltip';
import { EmptyState } from '@/components/empty-state';
import { logsApi } from '@/lib/api';
import {
  entryFields,
  formatLogTime,
  LOG_LEVELS,
  LOG_SOURCES,
  localDay,
  sourceLabel,
  type LogEntry,
  type LogLevel,
  type LogQuery,
  type LogSource,
} from '@/lib/logs';
import { cn, errorMessage } from '@/lib/utils';

// While the period includes today, new lines are fetched this often
const LIVE_MS = 5_000;
const PAGE = 200;

export type RangePreset = 'today' | '7d' | '30d' | 'all' | 'custom';
const RANGES: { value: RangePreset; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: 'all', label: 'All' },
  { value: 'custom', label: 'Custom' },
];

const LEVEL_TONE: Record<string, 'secondary' | 'info' | 'warning' | 'destructive' | 'outline'> = {
  trace: 'outline',
  debug: 'outline',
  info: 'info',
  warn: 'warning',
  error: 'destructive',
  fatal: 'destructive',
};

const startOfLocalDay = (daysAgo: number) => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - daysAgo);
  return d;
};

/** The period as ISO times for the API (local days), and whether it reaches today */
const periodOf = (preset: RangePreset, from: string, to: string) => {
  const today = localDay(new Date());
  switch (preset) {
    case 'today':
      return { from: startOfLocalDay(0).toISOString(), to: undefined, live: true };
    case '7d':
      return { from: startOfLocalDay(6).toISOString(), to: undefined, live: true };
    case '30d':
      return { from: startOfLocalDay(29).toISOString(), to: undefined, live: true };
    case 'all':
      return { from: undefined, to: undefined, live: true };
    case 'custom': {
      const start = from ? new Date(`${from}T00:00:00`).toISOString() : undefined;
      const end = to ? new Date(new Date(`${to}T00:00:00`).getTime() + 86_400_000 - 1).toISOString() : undefined;
      return { from: start, to: end, live: !to || to >= today };
    }
  }
};

/** The fields of an entry, the Dyadrr event first, readable */
function EntryDetails({ entry }: { entry: LogEntry }) {
  const fields = entryFields(entry);
  const pairId = typeof entry.pairId === 'string' ? entry.pairId : null;
  return (
    <div className="space-y-2 pb-2 pl-6 pr-2">
      {pairId && (
        <p className="text-xs">
          <Link href={`/merge/pairs/${pairId}/report`} className="text-primary underline-offset-2 hover:underline">
            Merge pair
          </Link>
        </p>
      )}
      <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted/60 p-2 font-mono text-[11px] scrollbar-thin">
        {JSON.stringify(Object.keys(fields).length ? fields : entry, null, 2)}
      </pre>
    </div>
  );
}

function Row({ entry, showDate }: { entry: LogEntry; showDate: boolean }) {
  const [open, setOpen] = useState(false);
  const hasFields = Object.keys(entryFields(entry)).length > 0;
  const date = new Date(entry.time);
  return (
    <li className={cn('border-b border-border/50 last:border-0', entry.level === 'error' || entry.level === 'fatal' ? 'bg-destructive/5' : entry.level === 'warn' ? 'bg-warning/5' : '')}>
      <button
        type="button"
        onClick={() => hasFields && setOpen(!open)}
        className={cn('flex w-full items-start gap-2 px-2 py-1.5 text-left text-xs', hasFields && 'hover:bg-accent/50')}
      >
        <span className="mt-0.5 w-3.5 shrink-0 text-muted-foreground">
          {hasFields && (open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />)}
        </span>
        <span className="shrink-0 font-mono text-[11px] text-muted-foreground tabular" title={entry.time}>
          {showDate && `${localDay(date)} `}
          {formatLogTime(entry.time)}
        </span>
        <Badge variant="outline" className="hidden w-[92px] shrink-0 justify-center sm:inline-flex">
          {sourceLabel(entry.source)}
        </Badge>
        <Badge variant={LEVEL_TONE[entry.level] ?? 'secondary'} className="w-11 shrink-0 justify-center">
          {entry.level}
        </Badge>
        <span className="min-w-0 flex-1 break-words">{entry.msg || <span className="text-muted-foreground">(no message)</span>}</span>
      </button>
      {open && <EntryDetails entry={entry} />}
    </li>
  );
}

/**
 * The log history, newest first, with its filters: source, lowest level, text,
 * period. Older lines load on scrolling; while the period includes today, new
 * ones come in every few seconds (with a pause).
 */
export function LogViewer({
  fixed,
  defaultRange = 'today',
  defaultLevel = 'info',
  sources: allowedSources = LOG_SOURCES.map((s) => s.value),
  oldestDay,
  emptyHint,
}: {
  fixed?: Pick<LogQuery, 'pair' | 'job'>;
  defaultRange?: RangePreset;
  defaultLevel?: LogLevel;
  sources?: LogSource[];
  oldestDay?: string | null;
  emptyHint?: string;
}) {
  const [sources, setSources] = useState<LogSource[]>(allowedSources);
  const [level, setLevel] = useState<LogLevel>(defaultLevel);
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [range, setRange] = useState<RangePreset>(defaultRange);
  const [from, setFrom] = useState(localDay(startOfLocalDay(6)));
  const [to, setTo] = useState(localDay(new Date()));
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const sentinel = useRef<HTMLDivElement>(null);
  const generation = useRef(0);

  // Typing settles before the query goes out
  useEffect(() => {
    const timer = setTimeout(() => setQ(text.trim()), 350);
    return () => clearTimeout(timer);
  }, [text]);

  const period = useMemo(() => periodOf(range, from, to), [range, from, to]);
  const pair = fixed?.pair;
  const job = fixed?.job;
  const query: LogQuery = useMemo(
    () => ({ source: sources, level, q: q || undefined, from: period.from, to: period.to, pair, job }),
    [sources, level, q, period.from, period.to, pair, job]
  );

  const load = useCallback(async () => {
    const mine = ++generation.current;
    setLoading(true);
    setError(null);
    try {
      const { data } = await logsApi.list({ ...query, limit: PAGE });
      if (mine !== generation.current) return;
      setEntries(data.entries);
      setNext(data.next);
    } catch (err) {
      if (mine === generation.current) setError(errorMessage(err, 'The logs could not be read'));
    } finally {
      if (mine === generation.current) setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    if (sources.length === 0) {
      setEntries([]);
      setNext(null);
      setLoading(false);
      return;
    }
    load();
  }, [load, sources.length]);

  const loadMore = useCallback(async () => {
    if (!next || loadingMore) return;
    const mine = generation.current;
    setLoadingMore(true);
    try {
      const { data } = await logsApi.list({ ...query, limit: PAGE, before: next });
      if (mine !== generation.current) return;
      setEntries((prev) => {
        const seen = new Set(prev.map((e) => e.id));
        return [...prev, ...data.entries.filter((e) => !seen.has(e.id))];
      });
      setNext(data.next);
    } catch (err) {
      setError(errorMessage(err, 'The logs could not be read'));
    } finally {
      setLoadingMore(false);
    }
  }, [next, loadingMore, query]);

  // Older lines when the end of the list comes into view
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const observer = new IntersectionObserver(([entry]) => entry.isIntersecting && loadMore(), { rootMargin: '400px' });
    observer.observe(el);
    return () => observer.disconnect();
  }, [loadMore]);

  // New lines while the period includes today
  const live = period.live && !paused && sources.length > 0;
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(async () => {
      if (document.visibilityState !== 'visible' || loading) return;
      const mine = generation.current;
      try {
        const { data } = await logsApi.list({ ...query, limit: PAGE });
        if (mine !== generation.current) return;
        setEntries((prev) => {
          if (prev.length === 0) return data.entries;
          const seen = new Set(prev.map((e) => e.id));
          const newest = prev[0].time;
          const fresh = data.entries.filter((e) => !seen.has(e.id) && e.time >= newest);
          return fresh.length ? [...fresh, ...prev] : prev;
        });
      } catch {
        // The next tick tries again
      }
    }, LIVE_MS);
    return () => clearInterval(timer);
  }, [live, query, loading]);

  const toggleSource = (source: LogSource) =>
    setSources((prev) => (prev.includes(source) ? prev.filter((s) => s !== source) : allowedSources.filter((s) => s === source || prev.includes(s))));

  const showDate = range !== 'today';

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {allowedSources.length > 1 &&
          LOG_SOURCES.filter((s) => allowedSources.includes(s.value)).map((s) => (
            <Tooltip key={s.value} content={s.hint}>
              <Button
                variant="outline"
                size="sm"
                aria-pressed={sources.includes(s.value)}
                className={cn(
                  'h-7',
                  sources.includes(s.value) ? 'border-primary/50 bg-primary/15 text-primary hover:bg-primary/20 hover:text-primary' : 'text-muted-foreground'
                )}
                onClick={() => toggleSource(s.value)}
              >
                {s.label}
              </Button>
            </Tooltip>
          ))}
        <select
          value={level}
          onChange={(e) => setLevel(e.target.value as LogLevel)}
          className="h-7 rounded-md border bg-transparent px-2 text-xs"
          aria-label="Lowest level"
        >
          {LOG_LEVELS.map((l) => (
            <option key={l} value={l}>
              {l === 'debug' ? 'Debug and up' : l === 'info' ? 'Info and up' : l === 'warn' ? 'Warnings and errors' : 'Errors only'}
            </option>
          ))}
        </select>
        <div className="relative min-w-[12rem] flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Search messages and fields" className="h-7 pl-7 text-xs" />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-md border p-0.5">
          {RANGES.map((r) => (
            <Button
              key={r.value}
              variant={range === r.value ? 'secondary' : 'ghost'}
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={() => setRange(r.value)}
            >
              {r.label}
            </Button>
          ))}
        </div>
        {range === 'custom' && (
          <div className="flex items-center gap-1 text-xs">
            <Input type="date" value={from} min={oldestDay ?? undefined} max={to} onChange={(e) => setFrom(e.target.value)} className="h-7 w-[9.5rem] text-xs" />
            <span className="text-muted-foreground">to</span>
            <Input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className="h-7 w-[9.5rem] text-xs" />
          </div>
        )}
        <div className="ml-auto flex items-center gap-1">
          {period.live && (
            <Tooltip content={paused ? 'Show new lines as they come' : 'Stop adding new lines'}>
              <Button variant="ghost" size="sm" className="h-7" onClick={() => setPaused(!paused)}>
                {paused ? <Play /> : <Pause />}
                {paused ? 'Paused' : 'Live'}
              </Button>
            </Tooltip>
          )}
          <Tooltip content="The lines matching these filters, as a JSON Lines file">
            <Button variant="ghost" size="sm" className="h-7" asChild>
              <a href={logsApi.downloadUrl(query)} download>
                <Download />
                Download
              </a>
            </Button>
          </Tooltip>
        </div>
      </div>

      <Card className="overflow-hidden">
        {error && <p className="border-b bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>}
        {loading && entries.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Reading the logs…
          </div>
        ) : entries.length === 0 ? (
          <EmptyState icon={ScrollText} title="No lines" description={emptyHint ?? 'Nothing matches these filters in this period.'} className="py-10" />
        ) : (
          <ul className={cn(loading && 'opacity-60')}>
            {entries.map((entry) => (
              <Row key={entry.id} entry={entry} showDate={showDate} />
            ))}
          </ul>
        )}
        <div ref={sentinel} />
        {loadingMore && (
          <div className="flex items-center justify-center gap-2 py-3 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Older lines…
          </div>
        )}
        {!next && entries.length > 0 && !loading && (
          <p className="py-2 text-center text-[11px] text-muted-foreground">
            {range === 'all' || range === 'custom' ? 'The oldest line kept' : 'The start of the period'}
          </p>
        )}
      </Card>
    </div>
  );
}
