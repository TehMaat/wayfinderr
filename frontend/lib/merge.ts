import type { MergeChoiceName, MergePairStatus } from './store';

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
