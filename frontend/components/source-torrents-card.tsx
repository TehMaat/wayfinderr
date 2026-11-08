'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Download, FilePlus, FileStack, Loader2, RefreshCw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Tooltip } from '@/components/ui/tooltip';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { sourceTorrentsApi } from '@/lib/api';
import type { SourceTorrent } from '@/lib/store';
import { errorMessage, formatBytes, timeAgo } from '@/lib/utils';

/**
 * Source torrents' .torrent files sent before their upload exists: by bookrr once the
 * download is complete, or added here by hand. Each one is copied into its upload as soon
 * as the rip of its download is done (or the upload is matched to its hash), and kept here.
 */
export function SourceTorrentsCard() {
  const [torrents, setTorrents] = useState<SourceTorrent[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<SourceTorrent | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const { data } = await sourceTorrentsApi.list();
      setTorrents(data);
    } catch (err) {
      toast.error('Could not load the source torrents', { description: errorMessage(err) });
      setTorrents((current) => current ?? []);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const add = async (files: File[]) => {
    setBusy(true);
    for (const file of files) {
      try {
        const { data } = await sourceTorrentsApi.add(file);
        toast.success(data.uploadIds.length ? 'Source .torrent copied into its upload' : 'Source .torrent kept', {
          description: data.uploadIds.length ? data.name : `${data.name}: copied into its upload once the rip is done`,
        });
      } catch (err) {
        toast.error(`Could not add ${file.name}`, { description: errorMessage(err) });
      }
    }
    await load();
    setBusy(false);
  };

  const remove = async (torrent: SourceTorrent) => {
    try {
      await sourceTorrentsApi.remove(torrent.infoHash);
      await load();
    } catch (err) {
      toast.error('Could not delete the source .torrent', { description: errorMessage(err) });
    }
  };

  const waiting = torrents?.filter((t) => t.uploadIds.length === 0).length ?? 0;

  return (
    <Card className="p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/15 text-primary">
            <FileStack className="h-4 w-4" />
          </div>
          <div className="min-w-0 space-y-1">
            <p className="flex flex-wrap items-center gap-2 font-semibold">
              Source .torrent files
              {torrents !== null && torrents.length > 0 && (
                <Badge variant="secondary">{waiting ? `${waiting} waiting for their rip` : 'all copied'}</Badge>
              )}
            </p>
            <p className="text-xs text-muted-foreground">
              Sent before their upload exists: by bookrr once the download is complete (with the API key, from the account
              menu), or added here. Each one is copied into its upload as soon as the rip of its download is done, the
              torrent removal then knows the source for sure. They are kept here for good.
            </p>
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          <Tooltip content="Load again">
            <Button size="icon" variant="ghost" onClick={load} aria-label="Load again">
              <RefreshCw />
            </Button>
          </Tooltip>
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => fileRef.current?.click()}>
            {busy ? <Loader2 className="animate-spin" /> : <FilePlus />}
            Add .torrent…
          </Button>
          <input
            ref={fileRef}
            type="file"
            multiple
            accept=".torrent,application/x-bittorrent"
            className="hidden"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = '';
              if (files.length) add(files);
            }}
          />
        </div>
      </div>

      {torrents !== null && torrents.length > 0 && (
        <ul className="mt-4 divide-y divide-border/60 border-t border-border/60">
          {torrents.map((t) => (
            <li key={t.infoHash} className="flex flex-col gap-2 py-2.5 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 space-y-1">
                <p className="break-all font-mono text-xs">{t.name}</p>
                <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  {t.label && <Badge variant="outline">{t.label}</Badge>}
                  <Badge variant="secondary">{t.origin ?? 'by hand'}</Badge>
                  <span className="tabular">{formatBytes(t.size)}</span>
                  <span>· {t.tracker}</span>
                  <span>· {timeAgo(t.createdAt)}</span>
                  <span>·</span>
                  {t.uploadIds.length === 0 ? (
                    <span>waiting for its rip</span>
                  ) : (
                    t.uploadIds.map((id, i) => (
                      <Link key={id} href={`/uploads/${id}`} className="text-primary hover:underline">
                        {t.uploadIds.length > 1 ? `upload ${i + 1}` : 'its upload'}
                      </Link>
                    ))
                  )}
                </div>
              </div>
              <div className="flex shrink-0 gap-1">
                <Tooltip content={`Download ${t.fileName}`}>
                  <Button size="icon" variant="ghost" asChild>
                    <a href={sourceTorrentsApi.fileUrl(t.infoHash)} download={t.fileName} aria-label={`Download ${t.fileName}`}>
                      <Download />
                    </a>
                  </Button>
                </Tooltip>
                <Tooltip content="Delete: the copies already in the uploads stay">
                  <Button size="icon" variant="ghost" onClick={() => setDeleting(t)} aria-label={`Delete ${t.name}`}>
                    <Trash2 />
                  </Button>
                </Tooltip>
              </div>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Delete this .torrent?"
        description={`"${deleting?.name}" is forgotten here${
          deleting?.uploadIds.length ? '; the copy in its upload stays' : ': its upload will not get it'
        }. bookrr may have deleted its own copy already.`}
        confirmLabel="Delete"
        onConfirm={async () => {
          if (deleting) await remove(deleting);
        }}
      />
    </Card>
  );
}
