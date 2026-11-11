'use client';

import { Fragment, useState } from 'react';
import {
  AlertTriangle,
  AudioLines,
  ChevronDown,
  ChevronRight,
  Clapperboard,
  FileVideo,
  Gauge,
  ListChecks,
  Merge,
  Route,
  ScrollText,
  SlidersHorizontal,
  type LucideIcon,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tooltip } from '@/components/ui/tooltip';
import { CheckpointChart } from '@/components/report/checkpoint-chart';
import {
  CODE_MEANINGS,
  formatClock,
  formatNumber,
  REPORT_FORMAT,
  withClock,
  type Check,
  type DyadrrReport,
  type InputFile,
  type InputTrack,
  type PlanEdge,
} from '@/lib/dyadrr';
import { choiceValueLabel, fileName, MERGE_CHOICES } from '@/lib/merge';
import type { MergeChoiceName } from '@/lib/store';
import { cn, formatBitrate, formatBytes } from '@/lib/utils';

// ---------------------------------------------------------------- primitives

/** A time on the timeline, h:mm:ss.mmm, with the raw ms in the tooltip */
export function Ms({ value, empty = '—' }: { value: number | null | undefined; empty?: string }) {
  if (value === null || value === undefined) return <span className="text-muted-foreground">{empty}</span>;
  return (
    <span className="tabular" title={`${formatNumber(value)} ms`}>
      {formatClock(value)}
    </span>
  );
}

/** A code, with what it means in the tooltip */
export function Code({ code, tone = 'secondary' }: { code: string; tone?: 'secondary' | 'warning' | 'destructive' | 'info' }) {
  const meaning = CODE_MEANINGS[code];
  const badge = (
    <Badge variant={tone} className="font-mono">
      {code}
    </Badge>
  );
  return meaning ? (
    <Tooltip content={meaning}>
      <span>{badge}</span>
    </Tooltip>
  ) : (
    badge
  );
}

function Section({
  id,
  title,
  icon: Icon,
  children,
  aside,
}: {
  id: string;
  title: string;
  icon: LucideIcon;
  children: React.ReactNode;
  aside?: React.ReactNode;
}) {
  return (
    <Card id={id} className="scroll-mt-4">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-muted-foreground" />
          {title}
        </CardTitle>
        {aside}
      </CardHeader>
      <CardContent className="space-y-3">{children}</CardContent>
    </Card>
  );
}

function Facts({ items, className }: { items: [string, React.ReactNode, string?][]; className?: string }) {
  return (
    <dl className={cn('grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3 lg:grid-cols-4', className)}>
      {items.map(([label, value, hint]) => (
        <div key={label} className="min-w-0" title={hint}>
          <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</dt>
          <dd className="truncate text-sm tabular">{value ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

function Table({ head, children, className }: { head: string[]; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('overflow-x-auto scrollbar-thin', className)}>
      <table className="w-full text-left text-xs">
        <thead className="text-[11px] uppercase tracking-wide text-muted-foreground">
          <tr>
            {head.map((h) => (
              <th key={h} className="whitespace-nowrap px-2 py-1.5 font-medium first:pl-0">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">{children}</tbody>
      </table>
    </div>
  );
}

const Td = ({ children, className }: { children?: React.ReactNode; className?: string }) => (
  <td className={cn('px-2 py-1.5 align-top first:pl-0', className)}>{children ?? <span className="text-muted-foreground">—</span>}</td>
);

const Result = ({ result }: { result: string }) => (
  <Badge variant={result === 'pass' ? 'success' : result === 'fail' ? 'destructive' : 'secondary'}>{result}</Badge>
);

const yes = (v: boolean | null | undefined) => (v === null || v === undefined ? '—' : v ? 'yes' : 'no');
const ms = (v: number | null | undefined, digits = 0) =>
  v === null || v === undefined ? '—' : `${v > 0 ? '+' : ''}${formatNumber(v, digits)} ms`;

function Collapsible({ label, children }: { label: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        {label}
      </button>
      {open && <div className="mt-2">{children}</div>}
    </div>
  );
}

// ---------------------------------------------------------------- sections

const DECISION_TONE = { eligible: 'success', refused: 'warning', error: 'destructive', cancelled: 'secondary' } as const;
const DECISION_LABEL = { eligible: 'Eligible', refused: 'Refused', error: 'Error', cancelled: 'Stopped' } as const;

function Outcome({ report }: { report: DyadrrReport }) {
  const decision = report.decision ?? 'error';
  const calibration = report.calibration;
  return (
    <Section id="outcome" title="Outcome" icon={ScrollText}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={DECISION_TONE[decision] ?? 'secondary'} className="px-2 py-1 text-xs">
          {report.mode === 'merge' && decision === 'eligible' ? 'Merged and verified' : DECISION_LABEL[decision] ?? decision}
        </Badge>
        {report.mode && <span className="text-xs text-muted-foreground">dyadrr {report.mode}</span>}
      </div>
      {(report.reasons ?? []).map((r) => (
        <div key={r.code} className="space-y-1 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Code code={r.code} tone={decision === 'error' ? 'destructive' : 'warning'} />
            {CODE_MEANINGS[r.code] && <span className="text-xs text-muted-foreground">{CODE_MEANINGS[r.code]}</span>}
          </div>
          <p className="break-words">{withClock(r.message)}</p>
        </div>
      ))}
      <Facts
        items={[
          ['Dyadrr', report.dyadrr ?? '—'],
          ['Duration', report.durationMs != null ? `${formatNumber(report.durationMs / 1000, 1)} s` : '—'],
          ['Started', report.startedAt ? new Date(report.startedAt).toLocaleString() : '—'],
          [
            'Calibration',
            calibration ? `v${calibration.version}${calibration.provisional?.length ? ` · ${calibration.provisional.length} provisional` : ''}` : '—',
            calibration?.provisional?.length ? `Provisional: ${calibration.provisional.join(', ')}` : undefined,
          ],
          ['Original language', report.arguments?.originalLanguage ?? '—'],
          ['Measured on', report.roles?.measureLanguage?.language ?? report.measurement?.language ?? '—', report.roles?.measureLanguage?.reason],
          ...(report.tools ? (Object.entries(report.tools).map(([k, v]) => [k, v ?? '—']) as [string, string][]) : []),
        ]}
      />
      {calibration && (
        <Collapsible label="Calibration values">
          <div className="grid grid-cols-1 gap-x-4 gap-y-0.5 font-mono text-[11px] sm:grid-cols-2 lg:grid-cols-3">
            {Object.entries(calibration.values ?? {}).map(([k, v]) => (
              <div key={k} className="flex justify-between gap-2">
                <span className={cn(calibration.provisional?.includes(k) ? 'text-warning' : 'text-muted-foreground')}>{k}</span>
                <span className="tabular">{String(v)}</span>
              </div>
            ))}
          </div>
        </Collapsible>
      )}
    </Section>
  );
}

const trackFlags = (t: InputTrack) =>
  [t.default && 'default', t.forced && 'forced', t.commentary && 'commentary', t.visualImpaired && 'AD'].filter(Boolean).join(', ');

function FileCard({ file, role, index }: { file: InputFile; role: 'reference' | 'donor' | null; index: number }) {
  const video = file.video;
  const tracks = file.tracks ?? [];
  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="flex min-w-0 items-center gap-2">
        <Badge variant="outline" className="shrink-0">
          {index === 0 ? 'A' : 'B'}
        </Badge>
        {role && (
          <Badge variant={role === 'reference' ? 'info' : 'success'} className="shrink-0">
            {role === 'reference' ? 'Video (reference)' : 'Italian (donor)'}
          </Badge>
        )}
        <span className="truncate text-sm font-medium" title={file.path}>
          {fileName(file.path)}
        </span>
      </div>
      <Facts
        items={[
          ['Video', video ? `${video.codec} ${video.width}×${video.height}` : '—'],
          ['HDR', video ? `${video.hdr}${video.dvProfile ? ` · DV profile ${video.dvProfile}` : ''}` : '—'],
          ['Frame rate', video ? `${video.fps.toFixed(3)} fps` : '—'],
          ['Bitrate', video?.bitrate ? formatBitrate(video.bitrate) : '—'],
          ['Duration', <Ms key="d" value={file.durationMs} />],
          ['Size', file.fingerprint ? formatBytes(file.fingerprint.size, 1) : '—'],
          [
            'Integrity',
            file.integrity ? <Result key="i" result={file.integrity.result} /> : '—',
            file.integrity?.detail,
          ],
          ['Italian', `${file.italianAudio ? 'audio' : 'no audio'}${file.italianSubtitles ? ' + subtitles' : ''}`],
        ]}
      />
      {tracks.length > 0 && (
        <Table head={['ID', 'Type', 'Language', 'Codec', 'Channels', 'Name', 'Flags']}>
          {tracks.map((t) => (
            <tr key={t.id} className={cn(t.language === 'ita' || t.language === 'it' ? 'bg-success/5' : '')}>
              <Td className="tabular">{t.id}</Td>
              <Td>{t.type}</Td>
              <Td>{t.language}</Td>
              <Td>
                {t.codec}
                {t.profile && <span className="text-muted-foreground"> · {t.profile}</span>}
              </Td>
              <Td>{t.channels ? `${t.channels}${t.channelLayout ? ` (${t.channelLayout})` : ''}` : undefined}</Td>
              <Td className="max-w-[16rem] truncate">{t.name}</Td>
              <Td>{trackFlags(t) || undefined}</Td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}

function Files({ report }: { report: DyadrrReport }) {
  const inputs = report.inputs ?? [];
  const roleOf = (i: number) =>
    report.roles ? (report.roles.reference === i ? 'reference' : report.roles.donor === i ? 'donor' : null) : null;
  return (
    <Section id="files" title="Files" icon={FileVideo}>
      {report.roles?.reason && <p className="text-xs text-muted-foreground">Roles: {report.roles.reason}</p>}
      {report.roles?.video && (
        <p className="text-xs text-muted-foreground">
          Video comparison: <Result result={report.roles.video.result} /> {report.roles.video.detail}
        </p>
      )}
      {inputs.length === 0 && (report.arguments?.files ?? []).length > 0 && (
        <ul className="text-sm">
          {report.arguments!.files!.map((f) => (
            <li key={f} className="truncate" title={f}>
              {fileName(f)} <span className="text-muted-foreground">(not read)</span>
            </li>
          ))}
        </ul>
      )}
      <div className="grid gap-3 2xl:grid-cols-2">
        {inputs.map((file, i) =>
          file ? (
            <FileCard key={i} file={file} role={roleOf(i)} index={i} />
          ) : (
            <p key={i} className="rounded-md border p-3 text-sm text-muted-foreground">
              File {i === 0 ? 'A' : 'B'}: not read
            </p>
          )
        )}
      </div>
    </Section>
  );
}

const checkOrder = (c: Check) => (c.result === 'fail' ? (c.blocking ? 0 : 1) : c.result === 'pass' ? 2 : 3);

function Checks({ checks }: { checks: Check[] }) {
  const sorted = [...checks].sort((a, b) => checkOrder(a) - checkOrder(b));
  return (
    <Section id="checks" title="Checks" icon={ListChecks}>
      <Table head={['Check', 'Result', 'Blocking', 'Code', 'Measured', 'Threshold', 'Detail']}>
        {sorted.map((c) => (
          <tr key={c.name} className={cn(c.result === 'fail' && (c.blocking ? 'bg-destructive/5' : 'bg-warning/5'))}>
            <Td className="font-mono">{c.name}</Td>
            <Td>
              <Result result={c.result} />
            </Td>
            <Td>{c.blocking ? 'yes' : 'no'}</Td>
            <Td>{c.code ? <Code code={c.code} /> : undefined}</Td>
            <Td className="tabular">{c.measured !== undefined ? String(c.measured) : undefined}</Td>
            <Td className="tabular">{c.threshold !== undefined ? String(c.threshold) : undefined}</Td>
            <Td className="min-w-[12rem] break-words">{c.detail}</Td>
          </tr>
        ))}
      </Table>
    </Section>
  );
}

function Measure({ report }: { report: DyadrrReport }) {
  const m = report.measurement!;
  const transfer = m.transfer;
  return (
    <Section id="measure" title="Measure" icon={Gauge}>
      <Facts
        items={[
          ['Language', m.language],
          ['Tracks', m.pair ? `${m.pair.referenceTrackId} → ${m.pair.donorTrackId}${m.pair.mix ? ` (${m.pair.mix})` : ''}` : '—', 'Reference track → donor track, signal used'],
          ['Offset S', m.offset ? ms(m.offset.offsetMs) : '—', 'Final offset, for mkvmerge --sync'],
          ['Anchor S', m.offset ? ms(m.offset.anchorMs) : '—'],
          ['Median', m.offset ? ms(m.offset.medianMs, 1) : '—', 'Median of the consistent checkpoints'],
          ['Dispersion', m.offset ? `${formatNumber(m.offset.dispersionMs, 1)} ms` : '—', 'Median absolute deviation of the consistent checkpoints'],
          ['Speed ratio', m.speedRatio != null ? m.speedRatio.toFixed(5) : '—'],
          ['Drift', m.drift ? `${formatNumber(m.drift.msPerHour, 2)} ms/h` : '—', m.drift ? `${formatNumber(m.drift.totalMs, 1)} ms over ${formatClock(m.drift.spanMs)}` : undefined],
          ['Coverage', m.commonMaterial ? `${Math.round(m.commonMaterial.coverage * 100)}%` : '—'],
          ['In common', m.commonMaterial ? <span key="c"><Ms value={m.commonMaterial.startMs} /> – <Ms value={m.commonMaterial.endMs} /></span> : '—'],
          [
            'Verified',
            m.commonMaterial && m.commonMaterial.verifiedStartMs !== null ? (
              <span key="v">
                <Ms value={m.commonMaterial.verifiedStartMs} /> – <Ms value={m.commonMaterial.verifiedEndMs} />
              </span>
            ) : (
              '—'
            ),
            'From the first to the last consistent checkpoint',
          ],
          [
            'Continues elsewhere',
            m.commonMaterial?.continuesElsewhere
              ? [m.commonMaterial.continuesElsewhere.start && 'start', m.commonMaterial.continuesElsewhere.end && 'end'].filter(Boolean).join(', ') || 'no'
              : '—',
          ],
        ]}
      />
      {m.contradiction && (
        <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-xs">
          <p className="font-medium">Contradiction: {m.contradiction.kind}</p>
          <ul className="mt-1 space-y-0.5">
            {m.contradiction.jumps.map((j, i) => (
              <li key={i} className="tabular">
                <Ms value={j.afterMs} /> → <Ms value={j.beforeMs} />: {ms(j.fromOffsetMs)} → {ms(j.toOffsetMs)} ({ms(j.amountMs, 1)}, {j.frames} frame(s))
              </li>
            ))}
          </ul>
        </div>
      )}
      {(m.anchors ?? []).length > 0 && (
        <>
          <p className="text-xs font-medium">Anchors</p>
          <Table head={['Position', 'Outcome', 'Offset', 'NCC', 'Ratio']}>
            {m.anchors.map((a, i) => (
              <tr key={i}>
                <Td>
                  <Ms value={a.positionMs} />
                </Td>
                <Td>
                  <Badge variant={a.outcome === 'accepted' || a.outcome === 'agrees' ? 'success' : a.outcome === 'shifted' ? 'info' : 'warning'}>{a.outcome}</Badge>
                </Td>
                <Td className="tabular">{ms(a.offsetMs)}</Td>
                <Td className="tabular">{a.ncc?.toFixed(3)}</Td>
                <Td className="tabular">{a.ratio?.toFixed(2)}</Td>
              </tr>
            ))}
          </Table>
        </>
      )}
      {(report.roles?.pairs ?? []).length > 0 && (
        <Collapsible label={`Track pairs tried (${report.roles!.pairs!.length})`}>
          <Table head={['Tracks', 'Mix', 'Position', 'Offset', 'NCC', 'Ratio']}>
            {report.roles!.pairs!.map((p, i) => (
              <tr key={i}>
                <Td className="tabular">
                  {p.referenceTrackId} → {p.donorTrackId}
                </Td>
                <Td>{p.mix}</Td>
                <Td>
                  <Ms value={p.positionMs} />
                </Td>
                <Td className="tabular">{p.match ? ms(p.match.offsetMs) : 'no audio'}</Td>
                <Td className="tabular">{p.match?.ncc.toFixed(3)}</Td>
                <Td className="tabular">{p.match?.ratio.toFixed(2)}</Td>
              </tr>
            ))}
          </Table>
        </Collapsible>
      )}
      {transfer && (
        <>
          <p className="text-xs font-medium">Italian transfer check (inside the Italian file)</p>
          <Facts
            items={[
              ['Tracks', `${transfer.measureTrackId} ↔ ${transfer.italianTrackId}`, 'Measuring-language track ↔ Italian track'],
              ['Same format', yes(transfer.sameFormat)],
              ['Offset', ms(transfer.offsetMs, 1)],
              ['Sure peaks', `${transfer.confident}${transfer.probes?.length ? ` of ${transfer.probes.length}` : ''}`],
            ]}
          />
          {(transfer.candidates ?? []).length > 1 && (
            <Table head={['Track', 'Offset', 'Sure peaks']}>
              {transfer.candidates!.map((c) => (
                <tr key={c.trackId}>
                  <Td className="tabular">{c.trackId}</Td>
                  <Td className="tabular">{ms(c.offsetMs, 1)}</Td>
                  <Td className="tabular">{c.confident}</Td>
                </tr>
              ))}
            </Table>
          )}
        </>
      )}
    </Section>
  );
}

const EDGE_CASE: Record<string, [string, string]> = {
  aligned: ['Aligned', 'Both files start (or end) together'],
  'reference-longer': ['More video', 'The better video has more here than the Italian file'],
  'donor-longer': ['More Italian file', 'The Italian file has more here than the better video'],
};

// In the plan, a time left null depends on a choice still to make
const PENDING = 'to choose';

function Edge({ label, edge }: { label: string; edge: PlanEdge }) {
  return (
    <div className="space-y-1 rounded-md border p-3">
      <p className="text-xs font-medium">{label}</p>
      <Facts
        className="sm:grid-cols-3 lg:grid-cols-3"
        items={[
          ['Case', EDGE_CASE[edge.case]?.[0] ?? edge.case, EDGE_CASE[edge.case]?.[1] ?? edge.case],
          ['By', `${formatNumber(edge.amountMs)} ms`],
          ['Other intro/ending', edge.mismatchMs ? `${formatNumber(edge.mismatchMs)} ms` : 'no', 'Italian outside the material in common'],
          ['Cut', <Ms key="c" value={edge.cutMs} empty={edge.mismatchMs ? PENDING : 'none'} />],
          ['Without Italian', edge.gapMs === null ? PENDING : `${formatNumber(edge.gapMs)} ms`],
          ...(edge.cutLevelDbfs !== undefined ? ([['Level at the cut', edge.cutLevelDbfs === null ? '—' : `${edge.cutLevelDbfs.toFixed(1)} dBFS`]] as [string, string][]) : []),
          ...(edge.excess !== undefined
            ? ([['Past the video', `${edge.excess ?? 'to choose'}${edge.excessMs ? ` · ${formatNumber(edge.excessMs)} ms` : ''}`]] as [string, string][])
            : []),
        ]}
      />
    </div>
  );
}

function PlanSection({ report }: { report: DyadrrReport }) {
  const plan = report.plan!;
  return (
    <Section id="plan" title="Plan" icon={Route}>
      <Facts
        items={[
          ['Offset S', ms(plan.offsetMs)],
          ['Film', <span key="f"><Ms value={plan.film?.startMs} /> – <Ms value={plan.film?.endMs} /></span>],
          ['Italian', <span key="i"><Ms value={plan.italian?.startMs} empty={PENDING} /> – <Ms value={plan.italian?.endMs} empty={PENDING} /></span>],
          [
            'Pending',
            plan.pending?.length ? plan.pending.map((p) => MERGE_CHOICES[p as MergeChoiceName]?.label ?? p).join(', ') : 'none',
            plan.pending?.length ? plan.pending.map((p) => MERGE_CHOICES[p as MergeChoiceName]?.label ?? p).join(', ') : undefined,
          ],
        ]}
      />
      <div className="grid gap-3 lg:grid-cols-2">
        {plan.start && <Edge label="Start" edge={plan.start} />}
        {plan.end && <Edge label="End" edge={plan.end} />}
      </div>
      {(plan.audio ?? []).length > 0 && (
        <>
          <p className="flex items-center gap-1.5 text-xs font-medium">
            <AudioLines className="h-3.5 w-3.5" /> Italian audio
          </p>
          <Table head={['Track', 'Name', 'Role', 'Taken', 'From – to', 'Why']}>
            {plan.audio.map((a) => (
              <tr key={a.id}>
                <Td className="tabular">{a.id}</Td>
                <Td>{a.name}</Td>
                <Td>{a.role}</Td>
                <Td>{a.taken === null ? 'to choose' : yes(a.taken)}</Td>
                <Td>
                  <Ms value={a.startMs} empty={PENDING} /> – <Ms value={a.endMs} empty={PENDING} />
                </Td>
                <Td className="min-w-[12rem]">{a.reason}</Td>
              </tr>
            ))}
          </Table>
        </>
      )}
      {(plan.subtitles ?? []).length > 0 && (
        <>
          <p className="text-xs font-medium">Subtitles of the Italian file</p>
          <Table head={['Track', 'Language', 'Name', 'Kind', 'Forced', 'Taken', 'Why']}>
            {plan.subtitles.map((s) => (
              <tr key={s.id} className={cn(!s.taken && 'text-muted-foreground')}>
                <Td className="tabular">{s.id}</Td>
                <Td>{s.language}</Td>
                <Td>{s.name}</Td>
                <Td>{s.pgs ? 'PGS' : s.text ? 'text' : 'other'}</Td>
                <Td>{s.forced ? `yes${s.forcedBy ? ` (${s.forcedBy})` : ''}` : 'no'}</Td>
                <Td>{yes(s.taken)}</Td>
                <Td className="min-w-[12rem]">{s.reason}</Td>
              </tr>
            ))}
          </Table>
        </>
      )}
      {(plan.referenceItalianSubtitles ?? []).length > 0 && (
        <>
          <p className="text-xs font-medium">Italian subtitles already in the better video</p>
          <Table head={['Track', 'Name', 'Forced', 'Kept', 'Why']}>
            {plan.referenceItalianSubtitles.map((s) => (
              <tr key={s.id}>
                <Td className="tabular">{s.id}</Td>
                <Td>{s.name}</Td>
                <Td>{yes(s.forced)}</Td>
                <Td>{s.kept === null ? 'to choose' : yes(s.kept)}</Td>
                <Td>{s.reason}</Td>
              </tr>
            ))}
          </Table>
        </>
      )}
    </Section>
  );
}

const ORIGIN: Record<string, string> = { option: 'setting', env: 'environment', prompt: 'asked', default: 'default' };

function Choices({ report }: { report: DyadrrReport }) {
  const choices = report.choices ?? [];
  return (
    <Section id="choices" title="Choices" icon={SlidersHorizontal}>
      <Table head={['Choice', 'Status', 'Value', 'From', 'What each value does']}>
        {choices.map((c) => {
          const name = c.name as MergeChoiceName;
          return (
            <tr key={c.name} className={cn(!c.needed && 'text-muted-foreground')}>
              <Td>{MERGE_CHOICES[name]?.label ?? c.name}</Td>
              <Td>
                <Badge variant={c.status === 'pending' ? 'info' : c.status === 'decided' ? 'success' : 'secondary'}>{c.status}</Badge>
              </Td>
              <Td>{c.value ? choiceValueLabel(name, c.value) : undefined}</Td>
              <Td>{c.origin ? ORIGIN[c.origin] ?? c.origin : undefined}</Td>
              <Td className="min-w-[16rem]">
                {(c.effects ?? []).length ? (
                  <ul className="space-y-0.5">
                    {c.effects!.map((e) => (
                      <li key={e.value}>
                        <span className="font-medium">{choiceValueLabel(name, e.value)}</span>: Italian <Ms value={e.italianStartMs} /> –{' '}
                        <Ms value={e.italianEndMs} />
                        {e.audioTrackIds && <span className="text-muted-foreground"> · tracks {e.audioTrackIds.join(', ') || 'none'}</span>}
                        {e.warnings.length > 0 && <span className="text-warning"> · {e.warnings.join(', ')}</span>}
                      </li>
                    ))}
                  </ul>
                ) : undefined}
              </Td>
            </tr>
          );
        })}
      </Table>
    </Section>
  );
}

const SOURCE_LABEL: Record<string, string> = {
  analysis: 'Analysis',
  plan: 'Plan',
  build: 'Build',
  verify: 'Verification',
  inputs: 'Inputs',
};

function Warnings({ report }: { report: DyadrrReport }) {
  const warnings = report.warnings ?? [];
  const groups = new Map<string, typeof warnings>();
  for (const w of warnings) groups.set(w.source ?? 'other', [...(groups.get(w.source ?? 'other') ?? []), w]);
  return (
    <Section id="warnings" title={`Warnings (${warnings.length})`} icon={AlertTriangle}>
      {[...groups.entries()].map(([source, list]) => (
        <div key={source} className="space-y-1">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{SOURCE_LABEL[source] ?? source}</p>
          <ul className="space-y-1.5">
            {list.map((w, i) => (
              <li key={i} className="flex flex-wrap items-start gap-2 text-xs">
                <Code code={w.code} tone="warning" />
                <span className="min-w-0 flex-1 break-words">
                  {w.message}
                  {w.value !== undefined && <span className="text-muted-foreground tabular"> · {formatNumber(w.value, 1)}</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </Section>
  );
}

function MergeSection({ report }: { report: DyadrrReport }) {
  const output = report.output;
  const build = output?.build;
  const verification = output?.verification;
  return (
    <Section id="merge" title="Merge" icon={Merge}>
      {report.expect && (
        <div className="space-y-1 text-xs">
          <p>
            Same as the confirmed analysis (--expect): <Result result={report.expect.result} />
          </p>
          {report.expect.differences.length > 0 && (
            <ul className="list-inside list-disc text-warning">
              {report.expect.differences.map((d, i) => (
                <li key={i}>{d}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {output ? (
        <>
          <Facts
            items={[
              ['File', fileName(output.path), output.path],
              ['Delivered', yes(output.delivered)],
              ['Size', output.sizeBytes ? formatBytes(output.sizeBytes, 1) : '—'],
              ['Duration', <Ms key="d" value={output.durationMs} />],
              ['First cut', <Ms key="s" value={build?.startCutMs} />],
              ['Last cut', <Ms key="e" value={build?.endCutMs} />],
              ['Space', build?.space ? `${formatBytes(build.space.requiredBytes, 1)} needed, ${formatBytes(build.space.availableBytes, 1)} free` : '—'],
              ['Inputs after', output.inputs ? `${output.inputs.value} (${ORIGIN[output.inputs.origin] ?? output.inputs.origin})` : '—'],
            ]}
          />
          {(build?.tracks ?? []).length > 0 && (
            <>
              <p className="text-xs font-medium">Tracks of the merged file</p>
              <Table head={['#', 'From', 'Track', 'Type', 'Codec', 'Language', 'Name', 'Flags', 'Italian from – to']}>
                {build!.tracks.map((t, i) => (
                  <tr key={i} className={cn(t.source === 'donor' && 'bg-success/5')}>
                    <Td className="tabular">{i}</Td>
                    <Td>{t.source === 'donor' ? 'Italian file' : 'Video file'}</Td>
                    <Td className="tabular">{t.sourceTrackId}</Td>
                    <Td>{t.type}</Td>
                    <Td>{t.codec}</Td>
                    <Td>{t.language}</Td>
                    <Td>{t.name}</Td>
                    <Td>{[t.default && 'default', t.forced && 'forced'].filter(Boolean).join(', ') || undefined}</Td>
                    <Td>
                      {t.expectedStartMs != null ? (
                        <>
                          <Ms value={t.expectedStartMs} /> – <Ms value={t.expectedEndMs} />
                        </>
                      ) : undefined}
                    </Td>
                  </tr>
                ))}
              </Table>
            </>
          )}
          {(build?.droppedSubtitles ?? []).length > 0 && (
            <p className="text-xs text-warning">
              Subtitles lost at the cuts:{' '}
              {build!.droppedSubtitles.map((d) => `track ${d.trackId} at ${formatClock(d.subtitleStartMs)} (${d.edge})`).join(', ')}
            </p>
          )}
          {verification && (
            <>
              <p className="flex items-center gap-2 text-xs font-medium">
                Verification <Result result={verification.result} />
              </p>
              <Table head={['Check', 'Result', 'Blocking', 'Code', 'Details']}>
                {verification.checks.map((c) => (
                  <tr key={c.name}>
                    <Td className="font-mono">{c.name}</Td>
                    <Td>
                      <Result result={c.result} />
                    </Td>
                    <Td>{c.blocking ? 'yes' : 'no'}</Td>
                    <Td>{c.code ? <Code code={c.code} /> : undefined}</Td>
                    <Td className="min-w-[12rem]">{c.details.length ? c.details.join(' · ') : undefined}</Td>
                  </tr>
                ))}
              </Table>
              {verification.italian.length > 0 && (
                <Table head={['Italian track', 'Codec', 'Start (expected)', 'End (expected)', 'Tolerance']}>
                  {verification.italian.map((t) => (
                    <tr key={t.trackId}>
                      <Td className="tabular">
                        {t.trackId} (from {t.sourceTrackId})
                      </Td>
                      <Td>{t.codec}</Td>
                      <Td>
                        <Ms value={t.startMs} /> (<Ms value={t.expectedStartMs} />)
                      </Td>
                      <Td>
                        <Ms value={t.endMs} /> (<Ms value={t.expectedEndMs} />)
                      </Td>
                      <Td className="tabular">±{t.toleranceMs} ms</Td>
                    </tr>
                  ))}
                </Table>
              )}
              {verification.transfer && (
                <p className="text-xs text-muted-foreground">
                  Transfer in the merged file: {ms(verification.transfer.offsetMs, 1)}, {verification.transfer.confident} sure peak(s)
                </p>
              )}
            </>
          )}
          {(build?.commands ?? []).length > 0 && (
            <Collapsible label={`Commands (${build!.commands.length})`}>
              <ul className="space-y-2">
                {build!.commands.map((c, i) => (
                  <li key={i} className="space-y-1 rounded-md border p-2 text-[11px]">
                    <p className="flex items-center gap-2">
                      <span className="font-medium">{c.tool}</span>
                      <Badge variant={c.exitCode === 0 ? 'success' : c.exitCode === 1 ? 'warning' : 'destructive'}>
                        exit {c.exitCode ?? '—'}
                      </Badge>
                    </p>
                    <pre className="whitespace-pre-wrap break-all font-mono text-muted-foreground">{c.args.join(' ')}</pre>
                    {[...c.warnings, ...c.errors].map((m, j) => (
                      <p key={j} className={j < c.warnings.length ? 'text-warning' : 'text-destructive'}>
                        {m}
                      </p>
                    ))}
                  </li>
                ))}
              </ul>
            </Collapsible>
          )}
          {output.inputs && output.inputs.deleted.length > 0 && (
            <p className="text-xs text-muted-foreground">Deleted by Dyadrr: {output.inputs.deleted.map(fileName).join(', ')}</p>
          )}
        </>
      ) : (
        <p className="text-sm text-muted-foreground">No merged file: the merge stopped before building it.</p>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------- page body

/** The sections there is something to show in, for the table of contents */
export const reportSections = (report: DyadrrReport) =>
  [
    ['outcome', 'Outcome', true],
    ['merge', 'Merge', report.mode === 'merge'],
    ['files', 'Files', (report.inputs ?? []).length > 0 || (report.arguments?.files ?? []).length > 0],
    ['checks', 'Checks', (report.checks ?? []).length > 0],
    ['checkpoints', 'Checkpoints', Boolean(report.measurement)],
    ['measure', 'Measure', Boolean(report.measurement)],
    ['plan', 'Plan', Boolean(report.plan)],
    ['choices', 'Choices', (report.choices ?? []).length > 0],
    ['warnings', 'Warnings', (report.warnings ?? []).length > 0],
  ].filter(([, , shown]) => shown) as [string, string, true][];

/** Dyadrr's report in sections: what it decided and why, then everything it measured. */
export function ReportView({ report }: { report: DyadrrReport }) {
  const sections = reportSections(report);
  const filmEnd =
    report.plan?.film?.endMs ??
    (report.roles && report.inputs?.[report.roles.reference]?.durationMs) ??
    report.inputs?.find(Boolean)?.durationMs ??
    null;
  return (
    <div className="space-y-4">
      {report.format !== undefined && report.format !== REPORT_FORMAT && (
        <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          Report format {report.format}: this page reads format {REPORT_FORMAT}. Some fields may be missing or mean something
          else; the raw JSON has everything.
        </div>
      )}
      <nav className="flex flex-wrap gap-1.5">
        {sections.map(([id, label]) => (
          <a key={id} href={`#${id}`} className="rounded-md border px-2 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground">
            {label}
          </a>
        ))}
      </nav>
      {sections.map(([id]) => (
        <Fragment key={id}>
          {id === 'outcome' && <Outcome report={report} />}
          {id === 'merge' && <MergeSection report={report} />}
          {id === 'files' && <Files report={report} />}
          {id === 'checks' && <Checks checks={report.checks ?? []} />}
          {id === 'checkpoints' && (
            <Section id="checkpoints" title="Checkpoints" icon={Clapperboard}>
              <p className="text-xs text-muted-foreground">
                Each point is a stretch of the better video looked for in the Italian file: how far from the offset S it matched
                (or how similar, NCC), on the better video&apos;s timeline. Points without a value matched nowhere or were silent.
              </p>
              <CheckpointChart measurement={report.measurement!} plan={report.plan ?? null} filmEndMs={filmEnd} />
            </Section>
          )}
          {id === 'measure' && <Measure report={report} />}
          {id === 'plan' && <PlanSection report={report} />}
          {id === 'choices' && <Choices report={report} />}
          {id === 'warnings' && <Warnings report={report} />}
        </Fragment>
      ))}
    </div>
  );
}
