/**
 * Dyadrr's report, as the report page reads it (Dyadrr's docs/REPORT.md, format 1;
 * the types are `Report` in its src/report.ts). Partial and tolerant: every field
 * may be missing or null (a report written by the runner has the outcome only), and
 * fields this page does not know are left alone.
 */

export const REPORT_FORMAT = 1;

export type Decision = 'eligible' | 'refused' | 'error' | 'cancelled';
export type CheckResult = 'pass' | 'fail' | 'skipped';
export type CheckpointOutcome = 'consistent' | 'shifted' | 'inconclusive' | 'contradictory' | 'unmatched';
export type AnchorOutcome = 'accepted' | 'agrees' | 'shifted' | 'disagrees' | 'ambiguous' | 'no-match';

export interface Match {
  offsetMs: number;
  ncc: number;
  ratio: number;
}

export interface PairIds {
  referenceTrackId: number;
  donorTrackId: number;
  mix?: string;
}

export interface Checkpoint {
  requestedMs?: number;
  positionMs: number;
  energyDbfs: number | null;
  outcome: CheckpointOutcome;
  offsetMs: number | null;
  deviationMs: number | null;
  ncc: number | null;
  ratio: number | null;
  added?: boolean;
  alternatePair?: PairIds | null;
  local?: Match | null;
  wide?: Match | null;
  alternates?: (PairIds & { anchorOffsetMs: number; match: Match | null })[];
}

export interface Check {
  name: string;
  result: CheckResult;
  blocking: boolean;
  code?: string;
  measured?: number | string;
  threshold?: number | string;
  detail?: string;
}

export interface InputTrack {
  id: number;
  type: 'video' | 'audio' | 'subtitles';
  codec: string;
  profile?: string | null;
  language: string | null;
  channels?: number | null;
  channelLayout?: string | null;
  name: string | null;
  default?: boolean;
  forced?: boolean;
  commentary?: boolean;
  visualImpaired?: boolean;
  startMs?: number | null;
  endMs?: number | null;
}

export interface InputFile {
  path: string;
  durationMs: number | null;
  startTimeMs?: number | null;
  fingerprint?: { size: number; modifiedAt: string };
  video?: {
    codec: string;
    width: number;
    height: number;
    fps: number;
    hdr: string;
    dvProfile?: number | null;
    bitrate: number | null;
    trackId?: number;
  } | null;
  tracks?: InputTrack[];
  italianAudio?: boolean;
  italianSubtitles?: boolean;
  integrity?: { result: 'pass' | 'fail'; detail?: string; toleranceMs?: number; tracks?: { id: number; result: CheckResult; detail?: string }[] } | null;
}

export interface ChoiceEffect {
  value: string;
  italianStartMs: number | null;
  italianEndMs: number | null;
  audioTrackIds?: number[] | null;
  referenceSubtitleTrackIds?: number[] | null;
  warnings: string[];
}

export interface Choice {
  name: string;
  needed: boolean;
  status: 'decided' | 'pending' | 'ignored' | 'not-needed';
  value?: string;
  origin?: 'option' | 'env' | 'prompt';
  effects?: ChoiceEffect[];
}

export interface PlanEdge {
  case: 'aligned' | 'reference-longer' | 'donor-longer';
  amountMs: number;
  mismatchMs: number;
  cutMs: number | null;
  gapMs: number | null;
  cutLevelDbfs?: number | null;
  excess?: 'none' | 'trimmed' | 'kept' | null;
  excessMs?: number;
}

export interface SubtitleTrack {
  id: number;
  language: string | null;
  name: string | null;
  pgs: boolean;
  text?: boolean;
  forced: boolean;
  forcedBy?: string | null;
  commentary?: boolean;
  reason: string;
  taken?: boolean;
  kept?: boolean | null;
}

export interface Plan {
  offsetMs: number;
  film: { startMs: number; endMs: number };
  commonMaterial: { startMs: number; endMs: number };
  start: PlanEdge;
  end: PlanEdge;
  italian: { startMs: number | null; endMs: number | null };
  audio: { id: number; name: string | null; role: string; reason: string; taken: boolean | null; startMs: number | null; endMs: number | null }[];
  subtitles: SubtitleTrack[];
  referenceItalianSubtitles: SubtitleTrack[];
  pending: string[];
}

export interface Measurement {
  language: string;
  pair: PairIds;
  anchors: (Match & { positionMs: number; outcome: AnchorOutcome })[];
  speedRatio: number | null;
  offset: { anchorMs: number; medianMs: number; offsetMs: number; dispersionMs: number } | null;
  drift: { msPerHour: number; totalMs: number; spanMs: number } | null;
  contradiction: { kind: string; jumps: { afterMs: number; beforeMs: number; fromOffsetMs: number; toOffsetMs: number; amountMs: number; frames: number }[] } | null;
  checkpoints: Checkpoint[];
  commonMaterial: {
    startMs: number;
    endMs: number;
    continuesElsewhere?: { start: boolean; end: boolean };
    verifiedStartMs: number | null;
    verifiedEndMs: number | null;
    coverage: number;
  } | null;
  edgeProbes?: { side: 'start' | 'end'; positionMs: number; match: Match | null }[] | null;
  transfer: {
    measureTrackId: number;
    italianTrackId: number;
    sameFormat?: boolean;
    offsetMs: number | null;
    confident: number;
    probes?: { positionMs: number; match: Match | null; mix?: string }[];
    candidates?: { trackId: number; offsetMs: number | null; confident: number }[];
  } | null;
  bytesRead?: { reference: number; donor: number };
}

export interface FinalTrack {
  source: 'reference' | 'donor';
  sourceTrackId: number;
  type: string;
  codec: string;
  language: string | null;
  name: string | null;
  default: boolean;
  forced: boolean;
  expectedStartMs?: number | null;
  expectedEndMs?: number | null;
}

export interface Output {
  path: string;
  delivered: boolean;
  sizeBytes: number | null;
  durationMs: number | null;
  build: {
    startCutMs: number | null;
    endCutMs: number | null;
    tracks: FinalTrack[];
    droppedSubtitles: { trackId: number; edge: 'start' | 'end'; cutMs: number; subtitleStartMs: number }[];
    space?: { requiredBytes: number; availableBytes: number; italianBytes?: number };
    commands: { tool: string; args: string[]; exitCode: number | null; warnings: string[]; errors: string[] }[];
    replaced?: boolean;
  } | null;
  verification: {
    result: 'pass' | 'fail';
    checks: { name: string; result: CheckResult; blocking: boolean; code?: string; details: string[] }[];
    italian: { trackId: number; sourceTrackId: number; codec: string; toleranceMs: number; expectedStartMs: number; startMs: number | null; expectedEndMs: number; endMs: number | null }[];
    duration: { referenceEndMs: number; minMs: number; maxMs: number; endMs: number | null; declaredMs: number | null } | null;
    transfer: { offsetMs: number | null; confident: number; candidates?: { trackId: number; offsetMs: number | null; confident: number }[] } | null;
  } | null;
  inputs: { value: 'keep' | 'delete'; origin: string; deleted: string[] } | null;
}

export interface DyadrrReport {
  format?: number;
  dyadrr?: string | null;
  mode?: 'analyze' | 'merge' | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  durationMs?: number | null;
  tools?: Record<string, string | null> | null;
  arguments?: { files?: string[]; originalLanguage?: string | null; choices?: Record<string, { value: string; origin: string }> } | null;
  calibration?: { version: number; values: Record<string, number>; provisional: string[] } | null;
  decision?: Decision;
  reasons?: { code: string; message: string }[] | null;
  inputs?: (InputFile | null)[] | null;
  roles?: {
    reference: 0 | 1;
    donor: 0 | 1;
    reason: string | null;
    video?: Check | null;
    measureLanguage?: { language: string; reason: string; originalLanguage: string | null; originalNotCommon?: boolean } | null;
    pairs?: (PairIds & { positionMs: number; match: Match | null })[];
  } | null;
  measurement?: Measurement | null;
  checks?: Check[] | null;
  choices?: Choice[] | null;
  plan?: Plan | null;
  expect?: { path: string; result: 'pass' | 'fail'; differences: string[] } | null;
  output?: Output | null;
  warnings?: { code: string; message: string; value?: number; source?: string }[] | null;
}

/** A time on the timeline, to the ms: 1:02:41.412 (the raw ms in the tooltip). */
export const formatClock = (ms: number | null | undefined): string => {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '—';
  const sign = ms < 0 ? '−' : '';
  const total = Math.round(Math.abs(ms));
  const h = Math.floor(total / 3_600_000);
  const m = Math.floor((total % 3_600_000) / 60_000);
  const s = Math.floor((total % 60_000) / 1000);
  const rest = total % 1000;
  return `${sign}${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(rest).padStart(3, '0')}`;
};

/** A message with times in ms (Dyadrr's "first at 3761412 ms"), each followed by its h:mm:ss.mmm */
export const withClock = (message: string) =>
  message.replace(/\b(\d{5,}) ms\b/g, (whole, n: string) => `${whole} (${formatClock(Number(n))})`);

/** A plain number with spaces for thousands: 3 761 412 */
export const formatNumber = (n: number | null | undefined, digits = 0): string => {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  const fixed = n.toFixed(digits);
  const [int, dec] = fixed.split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ' ').replace('-', '−');
  return dec ? `${grouped}.${dec}` : grouped;
};

export const CHECKPOINT_OUTCOMES: { value: CheckpointOutcome; label: string; color: string; hint: string }[] = [
  { value: 'consistent', label: 'Consistent', color: 'hsl(var(--success))', hint: 'Same offset as the anchors' },
  { value: 'shifted', label: 'Shifted', color: 'hsl(var(--info))', hint: 'Off by less than a frame' },
  { value: 'inconclusive', label: 'Inconclusive', color: 'hsl(var(--muted-foreground))', hint: 'Silence, or a match not sharp enough' },
  { value: 'contradictory', label: 'Contradictory', color: 'hsl(var(--warning))', hint: 'A sure match at another offset' },
  { value: 'unmatched', label: 'Unmatched', color: 'hsl(var(--destructive))', hint: 'Content that matches nowhere' },
];

export const outcomeColor = (outcome: string) =>
  CHECKPOINT_OUTCOMES.find((o) => o.value === outcome)?.color ?? 'hsl(var(--muted-foreground))';

// What each code means (Dyadrr's docs/CODICI.md, in short)
export const CODE_MEANINGS: Record<string, string> = {
  // Refusals (exit 20)
  NO_ITALIAN_AUDIO: 'Neither file has Italian audio',
  BOTH_ITALIAN_AUDIO: 'Both files have Italian audio: nothing to merge',
  NO_COMMON_LANGUAGE: 'No language in both files to measure on',
  DONOR_BETTER_VIDEO: "The Italian file's video is clearly better",
  FPS_MISMATCH: 'Different speeds (metadata, or the speed diagnosis)',
  PAL_SPEEDUP: 'PAL speed-up, from the measured ratio',
  NO_MATCH: 'No anchor finds a match similar enough',
  AMBIGUOUS_MATCH: 'Matches similar but not unique',
  OFFSET_TOO_LARGE: 'A sure offset, but beyond the maximum',
  CHECKPOINT_CONTRADICTION:
    'The offset changes along the film by a frame or more, or the film goes on at another offset past an edge far from the end',
  CHECKPOINT_UNMATCHED: 'A stretch with content matches nowhere',
  DRIFT: 'The offset grows with time',
  TOO_FEW_CHECKPOINTS: 'Too few consistent checkpoints, or badly spread',
  LOW_COVERAGE: 'The material in common covers too little of the film',
  // Errors (exit 30, 40)
  BAD_ARGUMENTS: 'Invalid arguments, options or calibration, or an --expect report that cannot be used',
  INPUT_UNREADABLE: 'A file missing, unreadable or not MKV, or audio that does not decode',
  INPUT_TRUNCATED: 'A file is truncated',
  INPUT_BUSY: 'A file is still being written: retry later',
  INPUT_CHANGED: 'The files, roles, offset or plan differ from the confirmed analysis',
  CHOICE_REQUIRED: 'A choice this pair needs is missing',
  OUTPUT_EXISTS: 'The merged file is already there',
  OUTPUT_NOT_WRITABLE: 'The output or temp folder cannot be written',
  NO_SPACE: 'Not enough disk space: retry when there is',
  TOOL_MISSING: 'mkvmerge, ffprobe or ffmpeg missing',
  TOOL_TOO_OLD: 'mkvmerge or ffmpeg too old',
  MERGE_FAILED: 'mkvmerge (or ffmpeg) failed',
  VERIFY_FAILED: 'A check of the merged file failed: it is not delivered',
  INTERNAL: 'Unexpected error, or Dyadrr ended without a report',
  INTERRUPTED: 'The job ended without an outcome (container stopped, out of memory): retry',
  CANCELLED: 'Stopped',
  // Warnings
  VIDEO_QUALITY_UNCERTAIN: 'The videos can only be compared uncertainly',
  ORIGINAL_LANGUAGE_NOT_COMMON: 'The original language is not in both files',
  MEASURE_MIX_DIFFERS: 'The measuring pair is similar enough, but in a low band',
  MAIN_TRACKS_DISAGREE: 'The main tracks give another offset than the measuring pair',
  ITALIAN_TRANSFER_OFFSET: 'In the Italian file, the Italian is off the measuring language',
  ITALIAN_UNVERIFIED: 'The Italian could not be checked against the measuring language',
  ITALIAN_TRACKS_SKIPPED: 'An Italian audio track left out (--italian main)',
  REFERENCE_HAS_ITALIAN_SUBS: 'The better video already has Italian PGS subtitles',
  ITALIAN_SUBS_NOT_PGS: 'Italian subtitles neither PGS nor text (VobSub): left out',
  NO_FORCED_ITALIAN_SUBS: 'Forced subtitles in another language, none in Italian',
  SDR_SUBS_ON_HDR: 'Italian PGS from an SDR disc over an HDR video',
  SUBTITLES_DROPPED_AT_CUT: 'Subtitles on screen at a cut, lost',
  INTRO_MISMATCH: 'Different intros: Italian kept there, out of sync',
  OUTRO_MISMATCH: 'Different endings: Italian kept there, out of sync',
  LONG_GAP_WITHOUT_ITALIAN: 'More than 10 minutes without Italian at the start or the end',
  TAIL_EXCESS_KEPT: 'Italian past the end of the video, kept',
  ABRUPT_START: 'The Italian starts loud at the first cut',
  MANY_INCONCLUSIVE: 'More than 10% of the checkpoints inconclusive',
  SUBFRAME_JUMPS: 'Jumps under a frame: the Italian is off by that much there',
  EDGE_CONTINUES_ELSEWHERE: 'Past an edge near the end the film goes on at another offset: cut there',
  MKVMERGE_WARNING: 'mkvmerge warning',
  OUTPUT_TRANSFER_OFFSET: 'In the merged file the Italian is off the measuring language',
  OUTPUT_TRANSFER_UNVERIFIED: 'In the merged file the Italian could not be checked again',
  INPUT_NOT_DELETED: 'An input could not be deleted: it stays',
};
