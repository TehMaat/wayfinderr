'use client';

import { useEffect, useRef, useState } from 'react';
import { Folder, FileVideo, Info, Loader2, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input, Label, Select } from '@/components/ui/input';
import { dismissRelease } from '@/lib/actions';
import { releaseApi } from '@/lib/api';
import { useAppStore, type ReleaseAnalysis, type ReleaseFlags, type ReleasePreview, type ReleaseProposal, type Upload } from '@/lib/store';
import { cn, errorMessage } from '@/lib/utils';

const OTHER = '__other';
const PREVIEW_DELAY_MS = 200;

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{children}</p>;
}

/** What moverr.py prints before its questions: the tracks that make the name */
function Analysis({ analysis }: { analysis: ReleaseAnalysis }) {
  const { video, audio, subtitles } = analysis;
  const videoLine = [
    video.resolution ? `${video.resolution} (${video.width}×${video.height})` : 'no video',
    video.codec,
    video.dv ? `Dolby Vision${video.dvProfile !== null ? ` P${video.dvProfile}` : ''}` : null,
    video.hdr,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <div className="space-y-1 rounded-md border bg-muted/40 p-3 font-mono text-xs leading-relaxed">
      <p>
        <span className="text-muted-foreground">Video     </span>
        {videoLine}
      </p>
      <p>
        <span className="text-muted-foreground">Audio     </span>
        {audio.length === 0
          ? 'none'
          : audio.map((a, i) => (
              <span key={a.language} className={cn(i >= 2 && 'text-muted-foreground')}>
                {i > 0 && ' · '}
                {a.codec} {a.language}
              </span>
            ))}
        {audio.length > 2 && <span className="text-muted-foreground"> → first 2 + MULTI</span>}
      </p>
      <p>
        <span className="text-muted-foreground">Subtitles </span>
        {subtitles.length ? subtitles.join(' · ') : 'none'}
        {subtitles.length > 2 && <span className="text-muted-foreground"> → first 2 + MULTI</span>}
      </p>
    </div>
  );
}

/**
 * The release name, asked like moverr.py does: film name, year, version and
 * REMUX, with the result shown before the file is moved on the server.
 * local: a file not uploaded yet, moved on the machine of its download client instead.
 */
export function ReleaseDialog({
  upload,
  open,
  onOpenChange,
  local = false,
}: {
  upload: Upload;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  local?: boolean;
}) {
  const [proposal, setProposal] = useState<ReleaseProposal | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [year, setYear] = useState('');
  const [versionChoice, setVersionChoice] = useState('');
  const [customVersion, setCustomVersion] = useState('');
  const [remux, setRemux] = useState(false);
  const [preview, setPreview] = useState<ReleasePreview | null>(null);
  const [pending, setPending] = useState(false); // the shown name is not the answers' yet
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);
  const previewSeq = useRef(0);

  const flags: ReleaseFlags = {
    title,
    year,
    version: versionChoice === OTHER ? customVersion : versionChoice,
    remux,
  };

  // Fresh analysis and defaults each time it opens
  useEffect(() => {
    if (!open) return;
    setProposal(null);
    setLoadError(null);
    setPreview(null);
    setError(null);
    setConflict(null);
    releaseApi
      .proposal(upload.id, local)
      .then(({ data }) => {
        setProposal(data);
        setTitle(data.defaults.title);
        setYear(data.defaults.year);
        setVersionChoice('');
        setCustomVersion('');
        setRemux(data.defaults.remux);
      })
      .catch((err) => setLoadError(errorMessage(err)));
  }, [open, upload.id, local]);

  // The name, rebuilt by the backend as the answers change
  useEffect(() => {
    if (!proposal) return;
    const seq = ++previewSeq.current;
    setPending(true);
    const timer = setTimeout(() => {
      releaseApi
        .preview(upload.id, flags, local)
        .then(({ data }) => {
          if (seq !== previewSeq.current) return;
          setPreview(data);
          setPending(false);
        })
        .catch((err) => seq === previewSeq.current && setError(errorMessage(err)));
    }, PREVIEW_DELAY_MS);
    setConflict(null);
    return () => clearTimeout(timer);
  }, [proposal, title, year, versionChoice, customVersion, remux, upload.id, local]);

  const confirm = async (overwrite = false) => {
    setBusy(true);
    setError(null);
    try {
      await releaseApi.confirm(upload.id, flags, overwrite, local);
      await useAppStore.getState().refreshUpload(upload.id);
      const where = proposal?.target.local ? `Moved on ${proposal.target.name}` : 'Renamed on the server';
      toast.success(proposal?.hasTrackerCommand ? `${where}, uploading to the tracker` : where, {
        description: preview?.filename,
      });
      onOpenChange(false);
    } catch (err) {
      const data = (err as { response?: { data?: { code?: string } } }).response?.data;
      if (data?.code === 'exists') setConflict(errorMessage(err));
      else setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const extra = proposal?.analysis.extraLanguages;
  const hasExtra = Boolean(extra && (extra.audio.length || extra.subtitles.length));
  const action = local
    ? proposal?.hasTrackerCommand
      ? 'Move & upload'
      : 'Move'
    : proposal?.hasTrackerCommand
      ? 'Rename & upload'
      : 'Rename';
  const canConfirm = Boolean(preview && !preview.error) && !pending && !busy;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{local ? 'Release locally' : 'Rename for the tracker'}</DialogTitle>
          <DialogDescription>
            {local ? (
              <>
                Instead of uploading it, the file is moved on {proposal?.target.name ?? 'the download client'}'s machine
                into its own folder{proposal?.hasTrackerCommand ? ', then the tracker command uploads it and seeds it there' : ''}.
                {(upload.status === 'QUEUED' || upload.status === 'UPLOADING') && ' Its upload stops.'}
              </>
            ) : (
              <>
                The file is moved on {proposal?.target.name ?? upload.server?.name ?? upload.localClient?.name ?? 'the server'}{' '}
                into its own folder
                {proposal?.hasTrackerCommand ? ', then the tracker command uploads it' : ''}.
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        {loadError ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{loadError}</div>
        ) : !proposal ? (
          <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Reading the file…
          </div>
        ) : (
          <div className="max-h-[65vh] space-y-5 overflow-y-auto pr-1 scrollbar-thin">
            <div className="space-y-2">
              <SectionTitle>Analysis</SectionTitle>
              <Analysis analysis={proposal.analysis} />
            </div>

            {hasExtra && (
              <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  Languages other than ITA and ENG:
                  {extra!.audio.length > 0 && <> audio {extra!.audio.join(', ')}</>}
                  {extra!.audio.length > 0 && extra!.subtitles.length > 0 && ';'}
                  {extra!.subtitles.length > 0 && <> subtitles {extra!.subtitles.join(', ')}</>}. Continue anyway?
                </span>
              </div>
            )}

            <div className="space-y-3">
              <SectionTitle>Name</SectionTitle>
              <div className="grid gap-3 sm:grid-cols-[1fr_6rem]">
                <div className="space-y-1.5">
                  <Label htmlFor="release-title">Film name (Italian)</Label>
                  <Input id="release-title" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
                  <p className="text-[11px] text-muted-foreground">
                    {proposal.rip?.tmdbId ? 'From the rip (TMDB)' : 'From the file name'}
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="release-year">Year</Label>
                  <Input
                    id="release-year"
                    value={year}
                    onChange={(e) => setYear(e.target.value.replace(/\D/g, '').slice(0, 4))}
                    inputMode="numeric"
                    placeholder="1972"
                  />
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="release-version">Version</Label>
                  <Select id="release-version" value={versionChoice} onChange={(e) => setVersionChoice(e.target.value)}>
                    <option value="">None (standard version)</option>
                    {proposal.versions.map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                    <option value={OTHER}>Other…</option>
                  </Select>
                  {versionChoice === OTHER && (
                    <Input value={customVersion} onChange={(e) => setCustomVersion(e.target.value)} placeholder="Version" />
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label>REMUX: a direct copy of the disc, not re-encoded?</Label>
                  <div className="grid grid-cols-2 gap-1 rounded-md border p-0.5">
                    {[true, false].map((value) => (
                      <button
                        key={String(value)}
                        type="button"
                        onClick={() => setRemux(value)}
                        className={cn(
                          'h-8 rounded text-sm transition-colors',
                          remux === value ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent'
                        )}
                      >
                        {value ? 'Yes' : 'No'}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {preview?.autoHybrid && (
                <div className="flex items-start gap-2 rounded-md border border-info/40 bg-info/10 px-3 py-2 text-sm text-info">
                  <Info className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    HYBRID added: a REMUX with Dolby Vision profile 8, a layer not native to the disc (and no VU).
                  </span>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <SectionTitle>Result</SectionTitle>
              <div className="space-y-1 rounded-md border bg-muted/40 p-3 font-mono text-xs">
                {preview ? (
                  <>
                    <p className="flex items-center gap-1.5 text-muted-foreground">
                      <Folder className="h-3.5 w-3.5 shrink-0" />
                      {proposal.releaseDir}/
                    </p>
                    <p className="flex items-center gap-1.5 pl-4 break-all">
                      <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      {preview.folder}/
                    </p>
                    <p className="flex items-center gap-1.5 pl-8 break-all font-medium">
                      <FileVideo className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      {preview.filename}
                    </p>
                  </>
                ) : (
                  <p className="text-muted-foreground">…</p>
                )}
              </div>
              <p className="break-all text-[11px] text-muted-foreground">From {proposal.remotePath}</p>
              {!proposal.releaseTag && (
                <p className="text-[11px] text-muted-foreground">
                  No release tag: set one in the {proposal.target.local ? 'client' : 'server'} settings.
                </p>
              )}
            </div>
          </div>
        )}

        {/* Outside the scrolling part: always in sight next to the buttons */}
        {preview?.error && <p className="text-sm text-destructive">{preview.error}</p>}
        {error && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
        )}
        {conflict && (
          <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="break-all">{conflict}. Overwrite it?</span>
          </div>
        )}

        <DialogFooter className="sm:items-center">
          {proposal && (
            <p className="mr-auto text-sm text-muted-foreground">
              {proposal.hasTrackerCommand ? 'Move the file and upload it to the tracker?' : 'Move the file?'}
            </p>
          )}
          {upload.releaseStatus === 'CONFIRM' && (
            <Button
              variant="ghost"
              onClick={async () => {
                await dismissRelease(upload.id);
                onOpenChange(false);
              }}
            >
              Not now
            </Button>
          )}
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          {conflict ? (
            <Button variant="destructive" disabled={!canConfirm} onClick={() => confirm(true)}>
              {busy && <Loader2 className="animate-spin" />}
              Overwrite & {action.toLowerCase()}
            </Button>
          ) : (
            <Button disabled={!canConfirm} onClick={() => confirm()}>
              {busy && <Loader2 className="animate-spin" />}
              {action}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
