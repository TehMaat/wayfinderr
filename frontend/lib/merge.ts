import type { MergeChoiceName, MergePair, MergePairStatus, Upload } from './store';

// Dyadrr's four choices (its docs/CLI.md, "Scelte"): what each one decides and what each value does
export const MERGE_CHOICES: Record<
  MergeChoiceName,
  { label: string; when: string; values: { value: string; label: string }[] }
> = {
  tail: {
    label: 'Italian past the end of the video',
    when: 'The Italian file goes on after the better video ends',
    values: [
      { value: 'trim', label: 'Cut it' },
      { value: 'keep', label: 'Keep it' },
    ],
  },
  italian: {
    label: 'Italian audio tracks',
    when: 'The Italian file has more than one Italian audio track',
    values: [
      { value: 'all', label: 'All of them' },
      { value: 'main', label: 'Main one only' },
    ],
  },
  referenceItalianSubs: {
    label: 'Italian PGS subtitles already in the better video',
    when: 'The better video already has Italian image subtitles',
    values: [
      { value: 'keep', label: 'Keep them (never default)' },
      { value: 'drop', label: 'Drop them' },
    ],
  },
  edgeMismatch: {
    label: 'Italian audio over a different intro or ending',
    when: 'The two files start or end differently (logos, credits)',
    values: [
      { value: 'drop', label: 'Leave it out' },
      { value: 'keep', label: 'Keep it (out of sync there)' },
    ],
  },
};

export const MERGE_CHOICE_NAMES = Object.keys(MERGE_CHOICES) as MergeChoiceName[];

export const choiceValueLabel = (name: MergeChoiceName, value: string | null) =>
  MERGE_CHOICES[name]?.values.find((v) => v.value === value)?.label ?? value ?? '—';

export const PAIR_STATUS: Record<
  MergePairStatus,
  {
    label: string;
    tone: 'info' | 'success' | 'warning' | 'destructive' | 'secondary';
  }
> = {
  ANALYZING: { label: 'Analyzing', tone: 'info' },
  ELIGIBLE: { label: 'Can be merged', tone: 'success' },
  REFUSED: { label: 'Refused', tone: 'warning' },
  ERROR: { label: 'Error', tone: 'destructive' },
  CANCELLED: { label: 'Stopped', tone: 'secondary' },
  MERGING: { label: 'Merging', tone: 'info' },
  MERGED: { label: 'Merged', tone: 'success' },
};

// Dyadrr's progress phases (its docs/REPORT.md, "Avanzamento")
export const PHASE_LABELS: Record<string, string> = {
  read: 'Reading the files',
  anchors: 'First measure',
  edges: 'Common material',
  checkpoints: 'Checkpoints',
  'edge-probes': 'Beyond the edges',
  transfer: 'Italian transfer check',
  plan: 'Start and end plan',
  intermediate: 'Italian tracks',
  merge: 'Merging',
  verify: 'Checking the merged file',
};

/** A time on the film's timeline: 1:33:45 */
export const formatMs = (ms: number | null | undefined): string => {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '—';
  const total = Math.round(Math.abs(ms) / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const time =
    h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
  return ms < 0 ? `−${time}` : time;
};

/** An offset in ms, signed: +667 ms, −23 973 ms */
export const formatOffset = (ms: number | null | undefined): string => {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '—';
  const rounded = Math.round(ms);
  return `${rounded > 0 ? '+' : rounded < 0 ? '−' : ''}${Math.abs(rounded).toLocaleString('en-US').replace(/,/g, ' ')} ms`;
};

export const fileName = (filepath: string) => filepath.split(/[\\/]/).pop() ?? filepath;

// A pair still on the page and not merged: its held files are followed on its card, not in "Held for a merge"
const OPEN_PAIR: MergePairStatus[] = ['ANALYZING', 'ELIGIBLE', 'MERGING', 'REFUSED', 'ERROR', 'CANCELLED'];
// Dyadrr is not running it: a held side can be paired with another file, uploaded or deleted from its card
export const pairIdle = (pair: MergePair) => pair.status !== 'ANALYZING' && pair.status !== 'MERGING' && pair.status !== 'MERGED';

/** The uploads in a pair still on the page */
export const pairedUploadIds = (pairs: MergePair[]): Set<string> =>
  new Set(pairs.filter((p) => OPEN_PAIR.includes(p.status)).flatMap((p) => [p.uploadAId, p.uploadBId]));

/** The held files not in a pair: the ones listed in "Held for a merge" (and counted in the sidebar) */
export const unpairedHeld = (uploads: Upload[], pairs: MergePair[]): Upload[] => {
  const paired = pairedUploadIds(pairs);
  return uploads.filter((u) => u.status === 'HELD' && !paired.has(u.id));
};

/** The file's partner in a pair, or null when the file is not in it */
export const partnerOf = (pair: MergePair, uploadId: string): string | null =>
  pair.uploadAId === uploadId ? pair.uploadBId : pair.uploadBId === uploadId ? pair.uploadAId : null;

/** The files already paired with this one (not merged), by partner: Pair… marks them, and pairing them again reuses that pair */
export const pairedPartners = (pairs: MergePair[], uploadId: string): Map<string, MergePair> => {
  const partners = new Map<string, MergePair>();
  for (const pair of pairs) {
    const partner = pair.status === 'MERGED' ? null : partnerOf(pair, uploadId);
    if (partner && !partners.has(partner)) partners.set(partner, pair);
  }
  return partners;
};
