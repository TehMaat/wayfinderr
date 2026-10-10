import path from 'path';
import { config } from '../../config/index.js';
import {
  checkLength,
  describeEnd,
  errorText,
  guiMessages,
  identify,
  MkvmergeTrack,
  parseMkvmergeProgress,
  RemuxError,
  run,
} from './remux.js';

/**
 * Discs of one film joined by hand (a long film over "Disc 1" and "Disc 2"):
 * each disc is ripped as usual, with MakeMKV or without, into a part kept in
 * the work folder; once every part is there mkvmerge appends them in order
 * (`mkvmerge -o film.mkv part1.mkv + part2.mkv`), timestamps and chapters
 * going on from one part to the next.
 *
 * Appending puts the tracks of each part after the same tracks of the first
 * one: the parts must have the same tracks, in the same order, or the second
 * half of the film would play another language. Otherwise nothing is joined.
 */

export interface JoinJob {
  parts: string[]; // in order
  output: string;
  signal: AbortSignal;
  onProgress: (percent: number) => void;
}

/** The work folder of a join: its parts and the joined file, on the watch folder's disk like the rips */
export const joinDir = (joinId: string) => path.join(config.RIP.WORK_DIR, 'join', joinId);

export const partFile = (joinId: string, part: number) => path.join(joinDir(joinId), `part${part}.mkv`);

/** mkvmerge's arguments to append the parts, in order, into output. */
export const joinArgs = (parts: string[], output: string): string[] => [
  '--gui-mode',
  '--flush-on-close',
  '-o',
  output,
  parts[0],
  ...parts.slice(1).flatMap((part) => ['+', part]),
];

export interface PartTrack {
  type: string;
  codec?: string;
  lang?: string;
}

export const partTracks = (tracks: MkvmergeTrack[]): PartTrack[] =>
  tracks.map((track) => {
    const lang = track.properties?.language?.toLowerCase();
    return { type: track.type, codec: track.codec, ...(lang && lang !== 'und' ? { lang } : {}) };
  });

const trackLabel = (track: PartTrack) => [track.type, track.codec, track.lang].filter(Boolean).join(' ');

const trackCount = (tracks: PartTrack[]) => {
  const counts = new Map<string, number>();
  for (const track of tracks) counts.set(track.type, (counts.get(track.type) ?? 0) + 1);
  return [...counts].map(([type, n]) => `${n} ${type}`).join(', ') || 'no tracks';
};

/** Why the parts can't be appended (their tracks differ), or null. */
export const trackMismatch = (parts: PartTrack[][]): string | null => {
  const [first, ...others] = parts;
  for (const [i, tracks] of others.entries()) {
    const part = i + 2;
    if (tracks.length !== first.length) {
      return `The parts have different tracks (part 1: ${trackCount(first)}; part ${part}: ${trackCount(tracks)}): they can't be joined`;
    }
    const at = first.findIndex((track, n) => trackLabel(track) !== trackLabel(tracks[n]));
    if (at >= 0) {
      return `Track ${at + 1} is ${trackLabel(first[at])} in part 1, ${trackLabel(tracks[at])} in part ${part}: the parts can't be joined`;
    }
  }
  return null;
};

/** Appends the parts into job.output: the joined file must be as long as the parts together. */
export const joinParts = async (job: JoinJob): Promise<{ file: string; warnings: string[] }> => {
  const { parts, output, signal, onProgress } = job;
  const infos = [];
  for (const part of parts) infos.push(await identify(part, signal));
  const mismatch = trackMismatch(infos.map((info) => partTracks(info.tracks ?? [])));
  if (mismatch) throw new RemuxError(mismatch);
  const expected = infos.reduce((sum, info) => sum + (info.container?.properties?.duration ?? 0) / 1e9, 0);

  let tail = '';
  const result = await run(config.RIP.MKVMERGE_PATH, joinArgs(parts, output), {
    signal,
    onOutput: (chunk) => {
      tail = (tail + chunk).slice(-65_536);
      const percent = parseMkvmergeProgress(tail);
      if (percent !== null) onProgress(percent);
    },
  });
  // 0: done, 1: done with warnings, 2: failed; above 128 a crash
  if (result.code !== 0 && result.code !== 1) {
    throw new RemuxError(
      `mkvmerge failed: ${guiMessages(tail, 'error').join(' · ') || errorText(result.stderr) || describeEnd('mkvmerge', result)}`
    );
  }
  const joined = await identify(output, signal);
  checkLength((joined.container?.properties?.duration ?? 0) / 1e9, expected, 'The joined file');
  return { file: output, warnings: guiMessages(tail, 'warning') };
};
