'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertTriangle, ArrowLeft, AudioLines, Captions, FileVideo, RotateCcw, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { EmptyState } from '@/components/empty-state';
import { StatusBadge } from '@/components/status-badge';
import { canDelete, canRetry } from '@/components/upload-actions';
import { deleteUpload, retryUpload } from '@/lib/actions';
import { useAppStore } from '@/lib/store';
import { cn, formatBytes, formatDate, formatDuration, formatSpeed } from '@/lib/utils';

interface Track {
  language: string;
  codec: string;
  index: number;
}

const isItalian = (lang: string) => ['ita', 'it', 'it-it'].includes(lang.toLowerCase()) || lang.toLowerCase().startsWith('ital');

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2 text-sm">
      <span className="shrink-0 whitespace-nowrap text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate text-right tabular">{children}</span>
    </div>
  );
}

function TrackList({ title, icon: Icon, tracks }: { title: string; icon: typeof AudioLines; tracks: Track[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-muted-foreground" />
          {title}
        </CardTitle>
        <span className="text-xs text-muted-foreground">{tracks.length}</span>
      </CardHeader>
      <CardContent>
        {tracks.length === 0 ? (
          <p className="text-sm text-muted-foreground">None</p>
        ) : (
          <div className="divide-y divide-border/60">
            {tracks.map((t) => (
              <div key={t.index} className="flex items-center justify-between py-2 text-sm">
                <span className="flex items-center gap-2">
                  <span className="w-6 text-xs tabular text-muted-foreground">#{t.index}</span>
                  <span className={cn('font-medium uppercase', isItalian(t.language) && 'text-success')}>
                    {t.language}
                  </span>
                  {isItalian(t.language) && <Badge variant="success">ITA</Badge>}
                </span>
                <span className="font-mono text-xs text-muted-foreground">{t.codec}</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function UploadDetailPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const upload = useAppStore((s) => s.uploads.find((u) => u.id === params.id));
  const transfer = useAppStore((s) => s.transfers[params.id]);
  const [loading, setLoading] = useState(!upload);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Uploads older than the loaded list are fetched on demand
  useEffect(() => {
    useAppStore
      .getState()
      .refreshUpload(params.id)
      .finally(() => setLoading(false));
  }, [params.id]);

  const media = useMemo(() => {
    try {
      const parsed = upload?.mediaInfo ? JSON.parse(upload.mediaInfo) : null;
      return { audio: (parsed?.audioTracks ?? []) as Track[], subs: (parsed?.subtitles ?? []) as Track[], parsed: Boolean(parsed) };
    } catch {
      return { audio: [], subs: [], parsed: false };
    }
  }, [upload?.mediaInfo]);

  if (!upload) {
    return (
      <div className="mx-auto max-w-5xl p-4 md:p-6">
        {loading ? (
          <div className="space-y-4">
            <Skeleton className="h-8 w-1/2" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : (
          <EmptyState
            icon={FileVideo}
            title="Upload not found"
            action={
              <Button variant="outline" size="sm" asChild>
                <Link href="/uploads">Back to uploads</Link>
              </Button>
            }
          />
        )}
      </div>
    );
  }

  const uploading = upload.status === 'UPLOADING';
  const remaining = Number(upload.size) - Number(upload.progressBytes);
  const eta = transfer?.speed ? remaining / transfer.speed : null;
  const duration =
    upload.startedAt && upload.completedAt
      ? (new Date(upload.completedAt).getTime() - new Date(upload.startedAt).getTime()) / 1000
      : null;
  const remotePath = upload.server?.sshPath ? `${upload.server.sshPath.replace(/\/+$/, '')}/${upload.filename}` : null;

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-4 md:p-6">
      <Link href="/uploads" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" />
        Uploads
      </Link>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/15 text-primary">
            <FileVideo className="h-5 w-5" />
          </div>
          <div className="min-w-0 space-y-1.5">
            <h1 className="break-all text-lg font-semibold leading-tight">{upload.filename}</h1>
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={upload.status} />
              <span className="text-xs text-muted-foreground tabular">{formatBytes(upload.size)}</span>
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          {canRetry(upload) && (
            <Button size="sm" onClick={() => retryUpload(upload.id)}>
              <RotateCcw />
              Retry
            </Button>
          )}
          {canDelete(upload) && (
            <Button size="sm" variant="outline" onClick={() => setConfirmOpen(true)}>
              <Trash2 />
              Remove
            </Button>
          )}
        </div>
      </div>

      {uploading && (
        <Card className="p-4">
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="font-medium tabular">{upload.progress}%</span>
            <span className="text-xs text-muted-foreground tabular">
              {formatBytes(upload.progressBytes)} of {formatBytes(upload.size)} · {formatSpeed(transfer?.speed ?? 0)} · ETA{' '}
              {formatDuration(eta)}
            </span>
          </div>
          <Progress value={upload.progress} animated className="h-2.5" />
        </Card>
      )}

      {upload.error && (
        <div
          className={cn(
            'flex items-start gap-3 rounded-lg border p-4 text-sm',
            upload.status === 'SKIPPED'
              ? 'border-warning/40 bg-warning/10 text-warning'
              : 'border-destructive/40 bg-destructive/10 text-destructive'
          )}
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="break-words">{upload.error}</span>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Transfer</CardTitle>
          </CardHeader>
          <CardContent className="divide-y divide-border/60">
            <Row label="Server">{upload.server?.name ?? '–'}</Row>
            <Row label="Remote path">
              <span className="font-mono text-xs">{remotePath ?? '–'}</span>
            </Row>
            <Row label="Attempts">{upload.status === 'COMPLETED' ? upload.currentRetryCount + 1 : upload.currentRetryCount}</Row>
            <Row label="Duration">{duration !== null ? formatDuration(duration) : '–'}</Row>
            <Row label="Average speed">
              {duration ? formatSpeed(Number(upload.size) / duration) : '–'}
            </Row>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>File</CardTitle>
          </CardHeader>
          <CardContent className="divide-y divide-border/60">
            <Row label="Local path">
              <span className="font-mono text-xs">{upload.filepath}</span>
            </Row>
            <Row label="Detected">{formatDate(upload.createdAt)}</Row>
            <Row label="Started">{formatDate(upload.startedAt)}</Row>
            <Row label="Completed">{formatDate(upload.completedAt)}</Row>
            <Row label="Italian">
              {upload.hasItalianAudio || upload.hasItalianSubtitles
                ? [upload.hasItalianAudio && 'audio', upload.hasItalianSubtitles && 'subtitles'].filter(Boolean).join(' + ')
                : 'none'}
            </Row>
          </CardContent>
        </Card>
      </div>

      {media.parsed ? (
        <div className="grid gap-4 md:grid-cols-2">
          <TrackList title="Audio tracks" icon={AudioLines} tracks={media.audio} />
          <TrackList title="Subtitles" icon={Captions} tracks={media.subs} />
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Media info not available.</p>
      )}

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Remove from history?"
        description="The upload is removed from the list. The file itself (local and remote) is not touched."
        confirmLabel="Remove"
        onConfirm={async () => {
          if (await deleteUpload(upload.id)) router.push('/uploads');
        }}
      />
    </div>
  );
}
