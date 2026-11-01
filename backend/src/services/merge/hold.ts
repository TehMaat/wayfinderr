import { Rip, Upload } from '@prisma/client';
import logger from '../../config/logger.js';
import { db } from '../database.js';
import { FilmTitles, filmById, filmByName } from '../filmLookup.js';
import { isMeaningfulTitle, MatchName, parseName } from '../nameMatch.js';
import { describeError, getQbitClient } from '../qbittorrent.js';
import { mapLimit, mkvNames, scoreAgainst, SUGGEST_SCORE, topLevelName } from '../torrentCleanup.js';

/**
 * Which new files are held for a merge instead of uploaded (Dyadrr's study 0.29, §15).
 * Wayfinderr cannot know whether a file will get a twin, so it looks for one:
 *
 * - a file without Italian audio is always held: it may be the better video of a
 *   merge, and would otherwise be skipped or uploaded without Italian;
 * - a file with Italian audio is held when a twin of the same film is around, certain
 *   or doubtful: a held file without Italian, a rip still to finish, or a torrent of the
 *   download clients (downloading or not), its own source torrent left out. Names are
 *   compared against every TMDB title of the film, so an Italian disc finds the German
 *   release of the same film (Altrimenti ci arrabbiamo! and Zwei.wie.Pech.und.Schwefel.1974);
 * - with no twin it is uploaded as before.
 *
 * Held uploads have the HELD status: never uploaded, deleted or cleaned up until the
 * user uploads them as they are or deletes them.
 */

export type HoldKind = 'NO_ITALIAN' | 'TWIN' | 'POSSIBLE_TWIN';

export interface HoldDecision {
  kind: HoldKind;
  message: string;
}

// What a file, rip or torrent is known by
export interface Identity {
  filmId: number | null; // TMDB id, when known
  names: MatchName[]; // parsed from its names
  titles: string[]; // those titles plus its film's TMDB titles in every language
  year?: number;
  filmLabel?: string; // "Title (Year)"
}

export interface TwinCandidate extends Identity {
  source: 'upload' | 'rip' | 'torrent';
  label: string; // file name, download name or torrent name
  where?: string; // the torrent's client, the rip's status
}

export interface TwinMatch {
  candidate: TwinCandidate;
  certain: boolean;
  score: number; // 0-100 name match (100 for the same TMDB film)
}

// Rips of a download still to finish
const RIP_UNFINISHED = ['WAITING', 'QUEUED', 'UNPACKING', 'SCANNING', 'RIPPING', 'JOINING', 'NEEDS_ATTENTION'];
const TMDB_CONCURRENCY = 4;

export const identity = (names: MatchName[], film: FilmTitles | null): Identity => {
  const meaningful = names.filter((n) => isMeaningfulTitle(n.title));
  return {
    filmId: film?.id ?? null,
    names: meaningful,
    titles: [...new Set([...meaningful.map((n) => n.title), ...(film?.titles ?? [])])],
    year: meaningful.find((n) => n.year)?.year ?? film?.year,
    filmLabel: film?.label,
  };
};

/**
 * Whether the candidate is the same film: certain for the same TMDB film, or for the
 * very same title with the same year; doubtful for a lesser name match. Two different
 * TMDB films are never twins.
 */
export const matchTwin = (file: Identity, candidate: TwinCandidate): TwinMatch | null => {
  if (file.filmId !== null && candidate.filmId !== null) {
    return file.filmId === candidate.filmId ? { candidate, certain: true, score: 100 } : null;
  }
  // Both ways: the file's names against the candidate's titles, and the other way round,
  // so a film TMDB knows on one side only still matches across languages
  const ours = scoreAgainst(file.names, { titles: candidate.titles, year: candidate.year });
  const theirs = scoreAgainst(candidate.names, { titles: file.titles, year: file.year });
  const best = theirs.score > ours.score || (theirs.score === ours.score && theirs.dated && !ours.dated) ? theirs : ours;
  if (best.score < SUGGEST_SCORE) return null;
  return { candidate, certain: best.score === 100 && best.dated, score: best.score };
};

const describe = ({ candidate }: TwinMatch): string => {
  const film = candidate.filmLabel ? ` (TMDB: ${candidate.filmLabel})` : '';
  if (candidate.source === 'upload') return `the held file "${candidate.label}"${film}`;
  if (candidate.source === 'rip') return `the rip of "${candidate.label}"${candidate.where ? `, ${candidate.where}` : ''}${film}`;
  return `the torrent "${candidate.label}"${candidate.where ? ` in ${candidate.where}` : ''}${film}`;
};

const why = (match: TwinMatch) =>
  match.candidate.filmId !== null && match.score === 100 && match.certain ? 'same TMDB film' : `${match.score}% name match`;

/** The best match first: certain ones, then by score. */
export const rankTwins = (matches: TwinMatch[]): TwinMatch[] =>
  [...matches].sort((a, b) => Number(b.certain) - Number(a.certain) || b.score - a.score);

/**
 * Held or not, and why. `problems`: what could not be searched (a download client
 * unreachable): with no twin found elsewhere, that is a doubt too, so the file is held.
 */
export const decideHold = (hasItalianAudio: boolean, matches: TwinMatch[], problems: string[] = []): HoldDecision | null => {
  const [best] = rankTwins(matches);
  if (!hasItalianAudio) {
    return {
      kind: 'NO_ITALIAN',
      message: `No Italian audio: kept as the better video of a merge${best ? `. Its twin may be ${describe(best)}` : ''}`,
    };
  }
  if (best?.certain) return { kind: 'TWIN', message: `Twin of ${describe(best)} (${why(best)})` };
  if (best) {
    return {
      kind: 'POSSIBLE_TWIN',
      message: `Possible twin: ${describe(best)} (${why(best)}). Upload it if they are not the same film`,
    };
  }
  if (problems.length > 0) {
    return { kind: 'POSSIBLE_TWIN', message: `Could not look for a twin: ${problems.join('; ')}` };
  }
  return null;
};

const rawNames = (...names: (string | null | undefined)[]): MatchName[] =>
  names.filter((n): n is string => Boolean(n)).map(parseName);

/** The first of the names that TMDB knows. */
const filmOfNames = async (names: MatchName[]): Promise<FilmTitles | null> => {
  for (const name of names) {
    const film = await filmByName({ title: name.title, year: name.year ?? null });
    if (film) return film;
  }
  return null;
};

const ripFilm = (rip: Rip) =>
  rip.tmdbId ? filmById(rip.tmdbId, rip.title || rip.originalTitle || rip.downloadName, rip.year) : Promise.resolve(null);

const ripNames = (rip: Rip): MatchName[] =>
  rawNames(rip.downloadName, rip.title, rip.originalTitle).map((n) => ({ ...n, year: n.year ?? rip.year ?? undefined }));

const ripIdentity = async (rip: Rip) => identity(ripNames(rip), await ripFilm(rip));

/** What a file is known by: its rip's film, else the film TMDB finds from its names. */
export const fileIdentity = async (filepath: string, rip: Rip | null): Promise<Identity> => {
  const names = mkvNames(filepath);
  if (!rip) return identity(names, await filmOfNames(names));
  return identity([...names, ...ripNames(rip)], await ripFilm(rip));
};

// The other uploads that may be the twin: held ones, with the Italian audio the file lacks, or the other way round
const uploadCandidates = async (upload: Upload): Promise<TwinCandidate[]> => {
  const held = (await db.getUploadsByStatus('HELD')).filter(
    (u) => u.id !== upload.id && u.filepath !== upload.filepath && u.hasItalianAudio !== upload.hasItalianAudio
  );
  return mapLimit(held, TMDB_CONCURRENCY, async (u) => {
    const rip = await db.getRipByOutputFile(u.filepath);
    return { ...(await fileIdentity(u.filepath, rip)), source: 'upload' as const, label: u.filename };
  });
};

// Rips still to finish, of another download than the file's own
const ripCandidates = async (ownRip: Rip | null): Promise<TwinCandidate[]> => {
  const rips = (await db.getRipsByStatus(RIP_UNFINISHED)).filter((r) => r.downloadName !== ownRip?.downloadName);
  return mapLimit(rips, TMDB_CONCURRENCY, async (rip) => ({
    ...(await ripIdentity(rip)),
    source: 'rip' as const,
    label: rip.downloadName,
    where: rip.status.toLowerCase().replace('_', ' '),
  }));
};

// Every torrent of the enabled download clients, but the one the file was ripped from
const torrentCandidates = async (ownRip: Rip | null, problems: string[]): Promise<TwinCandidate[]> => {
  const candidates: TwinCandidate[] = [];
  for (const client of (await db.getTorrentClients()).filter((c) => c.enabled)) {
    try {
      const torrents = (await getQbitClient(client).getTorrents(client.category)).filter(
        (t) => !ownRip || topLevelName(t) !== ownRip.downloadName
      );
      candidates.push(
        ...(await mapLimit(torrents, TMDB_CONCURRENCY, async (torrent) => {
          const names = rawNames(torrent.name, topLevelName(torrent));
          return {
            ...identity(names, await filmOfNames(names)),
            source: 'torrent' as const,
            label: torrent.name,
            where: client.name,
          };
        }))
      );
    } catch (error) {
      problems.push(`${client.name}: ${describeError(error)}`);
    }
  }
  return candidates;
};

/** Looks for the file's twins and decides whether it is held. */
export const checkHold = async (upload: Upload): Promise<HoldDecision | null> => {
  const rip = await db.getRipByOutputFile(upload.filepath);
  const file = await fileIdentity(upload.filepath, rip);
  const problems: string[] = [];
  const candidates = [
    ...(await uploadCandidates(upload)),
    ...(await ripCandidates(rip)),
    ...(await torrentCandidates(rip, problems)),
  ];
  const matches = candidates.map((c) => matchTwin(file, c)).filter((m): m is TwinMatch => m !== null);
  const decision = decideHold(upload.hasItalianAudio, matches, problems);
  logger.info(
    {
      uploadId: upload.id,
      film: file.filmLabel ?? file.names.map((n) => n.title),
      twins: rankTwins(matches)
        .slice(0, 3)
        .map((m) => ({ source: m.candidate.source, name: m.candidate.label, score: m.score, certain: m.certain })),
      problems,
      held: decision?.kind ?? null,
    },
    'Merge twin search'
  );
  return decision;
};
