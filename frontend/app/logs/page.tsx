'use client';

import { useCallback, useEffect, useState } from 'react';
import { Download, HardDrive, History, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/chip';
import { LogViewer } from '@/components/log-viewer';
import { PageHeader } from '@/components/page-header';
import { Tooltip } from '@/components/ui/tooltip';
import { logsApi } from '@/lib/api';
import { LOG_SOURCES, type LogsInfo } from '@/lib/logs';
import { cn, formatBytes } from '@/lib/utils';

/** Retention in force, space taken, oldest day kept, and a day's file to download */
function RetentionStrip({ info }: { info: LogsInfo }) {
  const [day, setDay] = useState(info.days[0] ?? '');
  const full = info.maxSizeMb > 0 ? info.usedBytes / (info.maxSizeMb * 1024 * 1024) : 0;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Tooltip content="LOG_RETENTION_DAYS: older days are deleted, whole, at the start and once a day">
        <span>
          <Chip icon={History}>Kept {info.retentionDays > 0 ? `${info.retentionDays} days` : 'forever'}</Chip>
        </span>
      </Tooltip>
      <Tooltip
        content={
          <div className="space-y-0.5">
            <p>LOG_MAX_SIZE_MB: past it, the oldest days are deleted first</p>
            {LOG_SOURCES.map((s) => (
              <p key={s.value} className="tabular">
                {s.label}: {formatBytes(info.sources[s.value]?.bytes ?? 0, 1)}
              </p>
            ))}
          </div>
        }
      >
        <span>
          <Chip icon={HardDrive} tone={full > 0.9 ? 'warning' : 'neutral'}>
            {formatBytes(info.usedBytes, 1)}
            {info.maxSizeMb > 0 ? ` of ${formatBytes(info.maxSizeMb * 1024 * 1024, 0)}` : ', no limit'}
          </Chip>
        </span>
      </Tooltip>
      {info.oldestDay && (
        <Chip icon={History}>
          Since <span className="tabular">{info.oldestDay}</span>
        </Chip>
      )}
      {info.days.length > 0 && (
        <div className="flex items-center gap-1">
          <select
            value={day}
            onChange={(e) => setDay(e.target.value)}
            className="h-7 rounded-md border bg-transparent px-2 text-xs"
            aria-label="Day to download"
          >
            {info.days.map((d) => (
              <option key={d} value={d}>
                {d} (UTC)
              </option>
            ))}
          </select>
          <Tooltip content="Every line of that day, of every source, as a JSON Lines file">
            <Button variant="outline" size="sm" className="h-7" asChild>
              <a href={logsApi.downloadUrl({ from: day, to: day })} download>
                <Download />
                Day
              </a>
            </Button>
          </Tooltip>
        </div>
      )}
    </div>
  );
}

// /logs?pair=<id> or ?job=<id>: only the lines of one merge pair, or of one Dyadrr job
export default function LogsPage() {
  const [filter, setFilter] = useState<{ pair?: string; job?: string } | null>(null);
  const pair = filter?.pair;
  const job = filter?.job;
  const [info, setInfo] = useState<LogsInfo | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [key, setKey] = useState(0);

  const loadInfo = useCallback(async () => {
    try {
      const { data } = await logsApi.info();
      setInfo(data);
    } catch {
      setInfo(null);
    }
  }, []);

  useEffect(() => {
    loadInfo();
    const params = new URLSearchParams(window.location.search);
    setFilter({ pair: params.get('pair') ?? undefined, job: params.get('job') ?? undefined });
  }, [loadInfo]);

  const refresh = async () => {
    setRefreshing(true);
    await loadInfo();
    setKey((k) => k + 1);
    setRefreshing(false);
  };

  return (
    <div className="flex flex-col gap-5 p-4 md:p-6">
      <PageHeader
        title="Logs"
        description="What Wayfinderr and Dyadrr did, kept on disk in the data volume: the backend, the Dyadrr runner, and every analysis and merge, phase by phase."
        actions={
          <Tooltip content="Refresh">
            <Button variant="ghost" size="icon" onClick={refresh} aria-label="Refresh">
              <RefreshCw className={cn(refreshing && 'animate-spin')} />
            </Button>
          </Tooltip>
        }
      />
      {info && <RetentionStrip info={info} />}
      {(pair || job) && (
        <p className="text-xs text-muted-foreground">
          Only the lines of {pair ? 'one merge pair' : 'one Dyadrr job'}.{' '}
          <a href="/logs" className="text-primary underline-offset-2 hover:underline">
            Show all
          </a>
        </p>
      )}
      {filter && (
        <LogViewer key={key} fixed={{ pair, job }} defaultRange={pair || job ? 'all' : 'today'} oldestDay={info?.oldestDay} />
      )}
    </div>
  );
}
