'use client';

import { useEffect, useRef, useState } from 'react';
import { CornerDownLeft, Download, FileUp, Link2, Loader2, Play, Send, Square, Tags } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Tooltip } from '@/components/ui/tooltip';
import { ReleaseDialog } from '@/components/release-dialog';
import { canRelease, RELEASE_STATUS, releaseRunning } from '@/components/release-badge';
import { addReleaseTorrent, answerRelease, linkRelease, runRelease, stopRelease } from '@/lib/actions';
import { releaseApi } from '@/lib/api';
import { useAppStore, type ReleasePrompt, type Upload } from '@/lib/store';
import { formatDate, formatDuration } from '@/lib/utils';

const parsePrompt = (value: string | null): ReleasePrompt | null => {
  try {
    return value ? (JSON.parse(value) as ReleasePrompt) : null;
  } catch {
    return null;
  }
};

/** The question Unit3Dup waits on, with the answers it takes */
function PromptBox({ upload, prompt }: { upload: Upload; prompt: ReleasePrompt | null }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  const send = async (answer: string) => {
    setBusy(true);
    if (await answerRelease(upload.id, answer)) setText('');
    setBusy(false);
  };

  const numeric = prompt?.kind === 'tmdb';
  return (
    <div className={prompt ? 'space-y-2 rounded-md border border-warning/40 bg-warning/10 p-3' : 'space-y-2'}>
      {prompt && <p className="break-words font-mono text-xs text-warning">{prompt.text}</p>}
      {prompt?.kind === 'duplicate' ? (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={busy} onClick={() => send('c')}>
            Continue (C)
          </Button>
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => send('s')}>
            Skip (S)
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => send('q')}>
            Quit (Q)
          </Button>
        </div>
      ) : (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            send(text);
          }}
        >
          <Input
            value={text}
            onChange={(e) => setText(numeric ? e.target.value.replace(/\D/g, '') : e.target.value)}
            inputMode={numeric ? 'numeric' : undefined}
            placeholder={numeric ? 'TMDB id' : prompt?.kind === 'trailer' ? 'YouTube id' : prompt ? 'Answer' : 'Type to the command, then Enter'}
            className="h-8 font-mono text-xs"
            autoFocus={Boolean(prompt)}
          />
          <Button type="submit" size="sm" disabled={busy}>
            {busy ? <Loader2 className="animate-spin" /> : prompt ? <Send /> : <CornerDownLeft />}
            Send
          </Button>
          {(prompt?.kind === 'tmdb' || prompt?.kind === 'trailer') && (
            <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => send('0')}>
              Skip (0)
            </Button>
          )}
        </form>
      )}
    </div>
  );
}

function TorrentRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2 text-sm">
      <span className="shrink-0 whitespace-nowrap text-muted-foreground">{label}</span>
      <span className="min-w-0 break-all text-right">{children}</span>
    </div>
  );
}

const missing = <span className="text-warning">Missing</span>;

/** The .torrent the tracker gave back: downloadable, with its info hash */
function TrackerTorrent({ upload }: { upload: Upload }) {
  return (
    <div className="divide-y divide-border/60 rounded-md border px-3">
      <TorrentRow label=".torrent">
        {upload.releaseTorrentName ? (
          <a
            href={releaseApi.torrentUrl(upload.id)}
            download={upload.releaseTorrentName}
            className="inline-flex items-center gap-1.5 font-mono text-xs text-primary hover:underline"
            title={upload.releaseTorrentPath ?? undefined}
          >
            <Download className="h-3.5 w-3.5 shrink-0" />
            {upload.releaseTorrentName}
          </a>
        ) : (
          missing
        )}
      </TorrentRow>
      <TorrentRow label="Info hash">
        {upload.releaseTorrentHash ? <span className="select-all font-mono text-xs">{upload.releaseTorrentHash}</span> : missing}
      </TorrentRow>
      <TorrentRow label="Tracker">{upload.releaseTracker ?? (upload.releaseTorrentHash ? '–' : missing)}</TorrentRow>
    </div>
  );
}

/** Rename on the server and upload to the tracker: status, live output and the answers */
export function ReleaseCard({ upload }: { upload: Upload }) {
  const server = useAppStore((s) => s.servers.find((x) => x.id === upload.serverId));
  const liveLog = useAppStore((s) => s.releaseLogs[upload.id]);
  const log = liveLog ?? upload.releaseLog ?? '';
  const [dialogOpen, setDialogOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const logRef = useRef<HTMLPreElement>(null);
  const torrentInput = useRef<HTMLInputElement>(null);

  // Follow the end of the output, unless scrolled up to read it
  useEffect(() => {
    const el = logRef.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 80) el.scrollTop = el.scrollHeight;
  }, [log]);

  // Opened on its own after an upload, on a server set to ask
  const askedOnce = useRef(false);
  useEffect(() => {
    if (upload.releaseStatus === 'CONFIRM' && !askedOnce.current) {
      askedOnce.current = true;
      setDialogOpen(true);
    }
  }, [upload.releaseStatus]);

  if (upload.status !== 'COMPLETED' || !upload.serverId) return null;

  const status = upload.releaseStatus ? RELEASE_STATUS[upload.releaseStatus] : null;
  const running = releaseRunning(upload);
  const live = upload.releaseStatus === 'RUNNING' || upload.releaseStatus === 'NEEDS_INPUT';
  const prompt = upload.releaseStatus === 'NEEDS_INPUT' ? parsePrompt(upload.releasePrompt) : null;
  const hasCommand = Boolean(server?.trackerCommand);
  const canRerun = hasCommand && Boolean(upload.releaseName) && !running && upload.releaseStatus !== 'CONFIRM';
  const duration =
    upload.releaseStartedAt && upload.releaseCompletedAt
      ? (new Date(upload.releaseCompletedAt).getTime() - new Date(upload.releaseStartedAt).getTime()) / 1000
      : null;

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    await action();
    setBusy(false);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Tags className="h-4 w-4 text-muted-foreground" />
          Tracker
        </CardTitle>
        {status ? <Badge variant={status.variant}>{status.label}</Badge> : <Badge variant="secondary">Not renamed</Badge>}
      </CardHeader>
      <CardContent className="space-y-3">
        {upload.releaseName ? (
          <div className="space-y-1 text-sm">
            <p className="break-all font-mono text-xs">{upload.releaseName}</p>
            {upload.releaseMessage && <p className="text-muted-foreground">{upload.releaseMessage}</p>}
            {(upload.releaseCompletedAt || upload.releaseStartedAt) && (
              <p className="text-xs text-muted-foreground tabular">
                {upload.releaseCompletedAt ? `Ended ${formatDate(upload.releaseCompletedAt)}` : `Started ${formatDate(upload.releaseStartedAt)}`}
                {duration !== null && ` · ${formatDuration(duration)}`}
              </p>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Rename the file on the server as a release
            {hasCommand ? ', then upload it to the tracker' : ''}.
            {!hasCommand && server && ' No tracker command set for this server.'}
          </p>
        )}

        {(upload.releaseStatus === 'DONE' || upload.releaseTorrentHash) && <TrackerTorrent upload={upload} />}

        {live && <PromptBox upload={upload} prompt={prompt} />}

        {log && (
          <pre
            ref={logRef}
            className="max-h-80 overflow-auto whitespace-pre-wrap break-all rounded-md border bg-muted/40 p-3 font-mono text-[11px] leading-relaxed scrollbar-thin"
          >
            {log}
          </pre>
        )}

        <div className="flex flex-wrap gap-2">
          {running && (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => run(() => stopRelease(upload.id))}>
              <Square className="fill-current" />
              Stop
            </Button>
          )}
          {canRelease(upload) && (
            <Button
              size="sm"
              variant={upload.releaseName ? 'ghost' : 'default'}
              disabled={busy}
              onClick={() => setDialogOpen(true)}
            >
              <Tags />
              {upload.releaseName ? 'Rename again…' : hasCommand ? 'Rename & upload…' : 'Rename…'}
            </Button>
          )}
          {canRelease(upload) && (
            <Tooltip
              content={
                upload.releaseName
                  ? 'Look for the file and its .torrent on the server again, and read its media info from there'
                  : 'Already renamed and on the tracker? Find the file on the server (by size) and its .torrent in the Unit3Dup archive'
              }
            >
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(() => linkRelease(upload.id))}>
                <Link2 />
                {upload.releaseName ? 'Check on the server' : 'Link existing release'}
              </Button>
            </Tooltip>
          )}
          {canRelease(upload) && (
            <Tooltip
              content={
                upload.releaseTorrentHash
                  ? 'Replace the stored .torrent with one downloaded from the tracker'
                  : 'Not in the Unit3Dup archive? Add the .torrent downloaded from the tracker'
              }
            >
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => torrentInput.current?.click()}>
                <FileUp />
                {upload.releaseTorrentHash ? 'Replace .torrent…' : 'Add .torrent…'}
              </Button>
            </Tooltip>
          )}
          <input
            ref={torrentInput}
            type="file"
            accept=".torrent,application/x-bittorrent"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = ''; // the same file can be picked again
              if (file) run(() => addReleaseTorrent(upload.id, file));
            }}
          />
          {canRerun && (
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => run(() => runRelease(upload.id))}>
              <Play />
              Upload to the tracker again
            </Button>
          )}
        </div>
      </CardContent>

      <ReleaseDialog upload={upload} open={dialogOpen} onOpenChange={setDialogOpen} />
    </Card>
  );
}
