'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { AudioLines, Captions, ExternalLink, Loader2, RotateCcw, Search, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Tooltip } from '@/components/ui/tooltip';
import { RIP_STATUS_META } from '@/components/status-badge';
import { retryRip } from '@/lib/actions';
import { ripsApi } from '@/lib/api';
import { languageCodes, languageName, ripName, tmdbUrl } from '@/lib/rips';
import { useAppStore, type DiscStream, type DiscTitle, type Rip, type TmdbMovie } from '@/lib/store';
import { cn, errorMessage, formatBytes, formatRuntime } from '@/lib/utils';

const CHOOSABLE = ['NEEDS_ATTENTION', 'FAILED', 'SKIPPED'];

const filmOf = (rip: Rip): TmdbMovie | null =>
  rip.tmdbId
    ? {
        id: rip.tmdbId,
        title: rip.title ?? rip.downloadName,
        originalTitle: rip.originalTitle ?? '',
        originalLanguage: rip.originalLanguage ?? '',
        year: rip.year,
      }
    : null;

const channelLayout = (channels?: number) => (channels ? (channels > 2 ? `${channels - 1}.1` : `${channels}.0`) : null);

function SectionTitle({ children, hint }: { children: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{children}</p>
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function RadioDot({ checked }: { checked: boolean }) {
  return (
    <span
      className={cn(
        'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border',
        checked ? 'border-primary' : 'border-muted-foreground/40'
      )}
    >
      {checked && <span className="h-2 w-2 rounded-full bg-primary" />}
    </span>
  );
}

/** One chip per language (commentary apart), green when kept as Italian, blue as the original language */
function LanguageChips({
  icon: Icon,
  streams,
  kept,
  original,
}: {
  icon: typeof AudioLines;
  streams: DiscStream[];
  kept: string[];
  original: string[];
}) {
  const groups = useMemo(() => {
    const map = new Map<string, DiscStream[]>();
    for (const s of streams) {
      const key = `${s.lang ?? 'und'}|${s.commentary ? 'c' : ''}`;
      map.set(key, [...(map.get(key) ?? []), s]);
    }
    return [...map.values()];
  }, [streams]);

  return (
    <div className="flex min-w-0 items-start gap-2">
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      {groups.length === 0 ? (
        <span className="text-xs text-muted-foreground">None</span>
      ) : (
        <div className="flex flex-wrap gap-1">
          {groups.map((group) => {
            const first = group[0];
            const lang = first.lang ?? 'und';
            const variant = kept.includes(lang) ? 'success' : original.includes(lang) ? 'info' : 'secondary';
            const details = group
              .map((s) => [s.codec, channelLayout(s.channels), s.forced && 'forced'].filter(Boolean).join(' '))
              .filter(Boolean);
            return (
              <Tooltip
                key={`${lang}${first.commentary}`}
                content={
                  <>
                    {first.langName ?? lang}
                    {first.commentary && ' (commentary)'}
                    {details.length > 0 && <span className="text-muted-foreground"> · {details.join(', ')}</span>}
                  </>
                }
              >
                <Badge variant={first.commentary ? 'outline' : variant} className="font-mono uppercase">
                  {lang}
                  {first.commentary && <span className="font-sans normal-case opacity-80">comm.</span>}
                  {group.length > 1 && <span className="opacity-70">×{group.length}</span>}
                </Badge>
              </Tooltip>
            );
          })}
        </div>
      )}
    </div>
  );
}

function TitleOption({
  title,
  checked,
  longest,
  current,
  kept,
  original,
  onSelect,
}: {
  title: DiscTitle;
  checked: boolean;
  longest: boolean;
  current: boolean;
  kept: string[];
  original: string[];
  onSelect: () => void;
}) {
  const audio = title.streams.filter((s) => s.type === 'audio');
  const subs = title.streams.filter((s) => s.type === 'subtitle');
  const source = [title.sourceFile, title.angle && `angle ${title.angle}`].filter(Boolean).join(' · ');

  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      onClick={onSelect}
      className={cn(
        'flex w-full items-start gap-3 rounded-md border px-3 py-2.5 text-left transition-colors',
        checked ? 'border-primary/60 bg-primary/10' : 'hover:bg-accent/50'
      )}
    >
      <RadioDot checked={checked} />
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <span className="font-medium">Title {title.index}</span>
          <span className="tabular text-muted-foreground">
            {formatRuntime(title.durationSec)} · {formatBytes(title.sizeBytes, 1)} · {title.chapters} chapters
          </span>
          {longest && <Badge variant="info">Longest</Badge>}
          {current && <Badge variant="secondary">Current choice</Badge>}
        </div>
        <LanguageChips icon={AudioLines} streams={audio} kept={kept} original={original} />
        <LanguageChips icon={Captions} streams={subs} kept={kept} original={original} />
        {source && (
          <Tooltip content={title.segmentsMap ? `Segments ${title.segmentsMap}` : source} side="bottom">
            <p className="truncate font-mono text-[11px] text-muted-foreground">
              {source}
              {title.segmentsMap && ` · segments ${title.segmentsMap}`}
            </p>
          </Tooltip>
        )}
      </div>
    </button>
  );
}

function FilmOption({ movie, checked, onSelect }: { movie: TmdbMovie; checked: boolean; onSelect: () => void }) {
  const original = [movie.originalTitle !== movie.title && movie.originalTitle, languageName(movie.originalLanguage)]
    .filter(Boolean)
    .join(' · ');
  return (
    <div
      className={cn('flex items-center gap-1 pr-2 transition-colors', checked ? 'bg-primary/10' : 'hover:bg-accent/50')}
    >
      <button
        type="button"
        role="radio"
        aria-checked={checked}
        onClick={onSelect}
        className="flex min-w-0 flex-1 items-start gap-3 px-3 py-2 text-left"
      >
        <RadioDot checked={checked} />
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium">
            {movie.title}
            {movie.year && <span className="font-normal text-muted-foreground"> ({movie.year})</span>}
          </span>
          <span className="block truncate text-xs text-muted-foreground">{original}</span>
        </span>
      </button>
      <Tooltip content="Open on TMDB">
        <a
          href={tmdbUrl(movie.id)}
          target="_blank"
          rel="noreferrer"
          className="shrink-0 rounded p-1 text-muted-foreground hover:text-primary"
          aria-label="Open on TMDB"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </Tooltip>
    </div>
  );
}

export function RipChooseDialog({
  rip,
  open,
  onOpenChange,
}: {
  rip: Rip | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const ripStatus = useAppStore((s) => s.ripStatus);
  const tmdbConfigured = Boolean(ripStatus?.tmdbConfigured);
  const [titleIndex, setTitleIndex] = useState<number | null>(null);
  const [film, setFilm] = useState<TmdbMovie | null>(null);
  const [query, setQuery] = useState('');
  const [year, setYear] = useState('');
  const [results, setResults] = useState<TmdbMovie[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const searchId = useRef(0);

  const titles = rip?.titles ?? null;
  const longest = useMemo(
    () => (titles ?? []).reduce<DiscTitle | null>((a, t) => (!a || t.durationSec > a.durationSec ? t : a), null),
    [titles]
  );

  const search = async (q: string, y: string) => {
    if (!q.trim()) return;
    const id = ++searchId.current;
    setSearching(true);
    setSearchError(null);
    try {
      const { data } = await ripsApi.searchTmdb(q.trim(), parseInt(y, 10) || null);
      if (id === searchId.current) setResults(data);
    } catch (err) {
      if (id === searchId.current) setSearchError(errorMessage(err, 'TMDB search failed'));
    } finally {
      if (id === searchId.current) setSearching(false);
    }
  };

  // Fresh choices on every opening; live updates of the rip do not reset them
  useEffect(() => {
    if (!open || !rip) return;
    const q = rip.suggestion?.title ?? '';
    const y = rip.suggestion?.year ? String(rip.suggestion.year) : '';
    setTitleIndex(rip.titleIndex ?? longest?.index ?? null);
    setFilm(filmOf(rip));
    setQuery(q);
    setYear(y);
    setResults(null);
    setSearchError(null);
    setError(null);
    searchId.current++;
    setSearching(false);
    // Not identified yet: look the suggestion up right away
    if (tmdbConfigured && !rip.tmdbId && q) search(q, y);
  }, [open, rip?.id]);

  if (!rip) return null;

  const allowed = CHOOSABLE.includes(rip.status);
  const kept = languageCodes(ripStatus?.language ?? 'it');
  const original = languageCodes(film?.originalLanguage ?? rip.originalLanguage);
  const keptName = languageName(ripStatus?.language ?? 'it');
  const current = filmOf(rip);

  const payload: { titleIndex?: number; tmdbId?: number } = {};
  if (titles && titleIndex !== null && titleIndex !== rip.titleIndex) payload.titleIndex = titleIndex;
  if (film && film.id !== rip.tmdbId) payload.tmdbId = film.id;
  // A scanned disc needs a title; an unscanned one can only get its film
  const canSubmit = allowed && !saving && (titles ? titleIndex !== null : payload.tmdbId !== undefined);

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      await ripsApi.chooseRip(rip.id, payload);
      await useAppStore.getState().refreshRip(rip.id);
      toast.success(titles ? 'Rip queued' : 'Film saved', {
        description: film ? ripName({ title: film.title, year: film.year, downloadName: rip.downloadName }) : rip.downloadName,
      });
      onOpenChange(false);
    } catch (err) {
      setError(errorMessage(err, 'Could not save the choice'));
    } finally {
      setSaving(false);
    }
  };

  const reasonTone =
    rip.status === 'FAILED'
      ? 'border-destructive/40 bg-destructive/10 text-destructive'
      : rip.status === 'SKIPPED'
        ? 'border-border bg-muted/50 text-muted-foreground'
        : 'border-warning/40 bg-warning/10 text-warning';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* minmax(0, 1fr): long unbreakable names must not widen the dialog on phones */}
      <DialogContent className="max-w-2xl grid-cols-[minmax(0,1fr)]">
        <DialogHeader>
          <DialogTitle>Choose what to rip</DialogTitle>
          <DialogDescription className="break-all">
            {rip.discName && rip.discName !== rip.downloadName ? `${rip.discName} · ` : ''}
            {rip.downloadName}
          </DialogDescription>
        </DialogHeader>

        {rip.reason && (
          <div className={cn('flex items-start gap-2.5 rounded-md border px-3 py-2 text-sm', reasonTone)}>
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="break-words">{rip.reason}</span>
          </div>
        )}
        {!allowed && (
          <p className="text-xs text-muted-foreground">
            This rip is {RIP_STATUS_META[rip.status].label.toLowerCase()} now: nothing to choose.
          </p>
        )}

        {/* Title on the disc */}
        <section className="space-y-2.5">
          <SectionTitle
            hint={
              titles && (
                <>
                  <span className="text-success">{keptName}</span> and{' '}
                  <span className="text-info">original-language</span> tracks are kept
                </>
              )
            }
          >
            Title on the disc
          </SectionTitle>
          {!titles ? (
            <div className="flex flex-col gap-2 rounded-md border border-dashed px-3 py-3 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
              <span>Not scanned yet: a retry scans the disc and picks the title on its own. Here you can only set the film.</span>
              {allowed && (
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  onClick={async () => {
                    await retryRip(rip.id);
                    onOpenChange(false);
                  }}
                >
                  <RotateCcw />
                  Retry
                </Button>
              )}
            </div>
          ) : titles.length === 0 ? (
            <div className="rounded-md border border-dashed px-3 py-3 text-sm text-muted-foreground">
              No titles long enough on this disc.
            </div>
          ) : (
            <div role="radiogroup" aria-label="Title on the disc" className="space-y-1.5">
              {titles.map((t) => (
                <TitleOption
                  key={t.index}
                  title={t}
                  checked={titleIndex === t.index}
                  longest={titles.length > 1 && longest?.index === t.index}
                  current={rip.titleIndex === t.index}
                  kept={kept}
                  original={original}
                  onSelect={() => setTitleIndex(t.index)}
                />
              ))}
            </div>
          )}
        </section>

        {/* Film on TMDB */}
        <section className="space-y-2.5">
          <SectionTitle hint="Names the file and sets the original language">Film on TMDB</SectionTitle>

          {film ? (
            <div className="flex items-center gap-3 rounded-md border bg-muted/40 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {film.title}
                  {film.year && <span className="font-normal text-muted-foreground"> ({film.year})</span>}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {[film.originalTitle !== film.title && film.originalTitle, film.originalLanguage && `Original language: ${languageName(film.originalLanguage)}`]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              </div>
              {film.id === rip.tmdbId ? (
                <Badge variant="secondary">Current match</Badge>
              ) : (
                <Badge>Selected</Badge>
              )}
              {current && film.id !== current.id && (
                <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => setFilm(current)}>
                  Undo
                </Button>
              )}
            </div>
          ) : (
            <div className="rounded-md border border-dashed px-3 py-2.5 text-sm text-muted-foreground">
              No film identified
              {titles ? ': pick one below, or the rip keeps every language and is named after the download' : ''}.
            </div>
          )}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              search(query, year);
            }}
            className="flex gap-2"
          >
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Film title"
                aria-label="Film title"
                disabled={!tmdbConfigured}
                className="h-8 pl-8"
              />
            </div>
            <Input
              value={year}
              onChange={(e) => setYear(e.target.value.replace(/\D/g, '').slice(0, 4))}
              placeholder="Year"
              aria-label="Year"
              inputMode="numeric"
              disabled={!tmdbConfigured}
              className="h-8 w-20"
            />
            <Button type="submit" size="sm" variant="secondary" disabled={!tmdbConfigured || searching || !query.trim()}>
              {searching && <Loader2 className="animate-spin" />}
              Search
            </Button>
          </form>

          {!tmdbConfigured ? (
            <p className="text-xs text-warning">Searching needs TMDB_API_KEY on the backend.</p>
          ) : searchError ? (
            <p className="text-xs text-destructive">{searchError}</p>
          ) : results && results.length === 0 ? (
            <p className="text-xs text-muted-foreground">No films found. Try the original title or no year.</p>
          ) : results ? (
            <div
              role="radiogroup"
              aria-label="Film on TMDB"
              className="max-h-56 divide-y divide-border/60 overflow-y-auto rounded-md border scrollbar-thin"
            >
              {results.map((movie) => (
                <FilmOption key={movie.id} movie={movie} checked={film?.id === movie.id} onSelect={() => setFilm(movie)} />
              ))}
            </div>
          ) : null}
        </section>

        {error && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!canSubmit}>
            {saving && <Loader2 className="animate-spin" />}
            {titles ? 'Rip this title' : 'Use this film'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
