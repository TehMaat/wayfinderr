'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  CHECKPOINT_OUTCOMES,
  formatClock,
  formatNumber,
  outcomeColor,
  type Checkpoint,
  type Match,
  type Measurement,
  type Plan,
} from '@/lib/dyadrr';
import { cn } from '@/lib/utils';

type Mode = 'deviation' | 'ncc';

const LABEL_W = 72;
const PAD_R = 12;
const LANE_H = 8;
const LANE_GAP = 6;
const PLOT_H = 200;
const NONE_H = 22; // the lane of the points without a value
const AXIS_H = 22;

const useWidth = () => {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
};

/** Ticks every 5, 10, 15 or 30 minutes, whichever gives about eight. */
const timeTicks = (endMs: number) => {
  const minutes = [5, 10, 15, 30, 60].find((m) => endMs / (m * 60_000) <= 9) ?? 60;
  const ticks: number[] = [];
  for (let t = 0; t <= endMs; t += minutes * 60_000) ticks.push(t);
  return ticks;
};

const hm = (ms: number) => {
  const m = Math.round(ms / 60_000);
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
};

const MatchLine = ({ label, match }: { label: string; match: Match | null | undefined }) => (
  <div className="flex justify-between gap-3">
    <span className="shrink-0 text-muted-foreground">{label}</span>
    <span className="text-right tabular">
      {match ? `${formatNumber(match.offsetMs)} ms · NCC ${match.ncc.toFixed(2)} · ×${match.ratio.toFixed(2)}` : 'none'}
    </span>
  </div>
);

function Details({ point, anchorOffset }: { point: Checkpoint; anchorOffset: number | null }) {
  const outcome = CHECKPOINT_OUTCOMES.find((o) => o.value === point.outcome);
  return (
    <div className="space-y-1 text-xs">
      <div className="flex items-center justify-between gap-3">
        <span className="font-medium tabular" title={`${point.positionMs} ms`}>
          {formatClock(point.positionMs)}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ background: outcomeColor(point.outcome) }} />
          {outcome?.label ?? point.outcome}
          {point.added && <span className="text-muted-foreground">· added</span>}
        </span>
      </div>
      {point.requestedMs !== undefined && point.requestedMs !== point.positionMs && (
        <div className="flex justify-between gap-3">
          <span className="text-muted-foreground">Requested</span>
          <span className="tabular">{formatClock(point.requestedMs)}</span>
        </div>
      )}
      <div className="flex justify-between gap-3">
        <span className="text-muted-foreground">Energy</span>
        <span className="tabular">{point.energyDbfs === null ? 'silence' : `${point.energyDbfs.toFixed(1)} dBFS`}</span>
      </div>
      <div className="flex justify-between gap-3">
        <span className="text-muted-foreground">Offset · deviation</span>
        <span className="tabular">
          {point.offsetMs === null ? '—' : `${formatNumber(point.offsetMs)} ms`} ·{' '}
          {point.deviationMs === null ? '—' : `${point.deviationMs > 0 ? '+' : ''}${formatNumber(point.deviationMs, 1)} ms`}
        </span>
      </div>
      <div className="flex justify-between gap-3">
        <span className="text-muted-foreground">NCC · ratio</span>
        <span className="tabular">
          {point.ncc === null ? '—' : point.ncc.toFixed(2)} · {point.ratio === null ? '—' : point.ratio.toFixed(2)}
        </span>
      </div>
      <MatchLine label="Local peak" match={point.local} />
      <MatchLine label="Wide peak" match={point.wide} />
      {anchorOffset !== null && point.wide && Math.abs(point.wide.offsetMs - anchorOffset) > 1000 && (
        <p className="text-muted-foreground">
          Wide peak {formatNumber((point.wide.offsetMs - anchorOffset) / 1000, 1)} s from S
        </p>
      )}
      {point.alternatePair && (
        <p className="text-muted-foreground">
          Decided by tracks {point.alternatePair.referenceTrackId} → {point.alternatePair.donorTrackId}
        </p>
      )}
      {(point.alternates ?? []).length > 0 && (
        <p className="text-muted-foreground">Second try on {point.alternates!.length} other pair(s)</p>
      )}
    </div>
  );
}

/**
 * The checkpoints along the better video's timeline: how far each is from the offset S
 * (or how similar, NCC), colored by outcome, over the film, the material in common and
 * the Italian of the plan. An unmatched point among consistent ones shows at a glance.
 */
export function CheckpointChart({ measurement, plan, filmEndMs }: { measurement: Measurement; plan: Plan | null; filmEndMs: number | null }) {
  const [ref, width] = useWidth();
  const [mode, setMode] = useState<Mode>('deviation');
  const [hover, setHover] = useState<number | null>(null);
  const points = measurement.checkpoints ?? [];
  const anchorOffset = measurement.offset?.anchorMs ?? measurement.offset?.offsetMs ?? null;

  const endMs = Math.max(
    filmEndMs ?? 0,
    plan?.film?.endMs ?? 0,
    measurement.commonMaterial?.endMs ?? 0,
    ...points.map((p) => p.positionMs)
  ) || 1;

  const value = (p: Checkpoint) => (mode === 'deviation' ? p.deviationMs : p.ncc);
  const [yMin, yMax] = useMemo(() => {
    if (mode === 'ncc') return [0, 1];
    const values = points.map((p) => p.deviationMs).filter((v): v is number => v !== null).map(Math.abs);
    const max = Math.max(5, ...values);
    // A long tail would squash the rest: the scale ends past the 98th percentile, beyond is drawn at the edge
    const sorted = [...values].sort((a, b) => a - b);
    const p98 = sorted[Math.floor(sorted.length * 0.98)] ?? max;
    const limit = Math.min(max, Math.max(5, p98 * 1.5));
    return [-limit, limit];
  }, [points, mode]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const p of points) c[p.outcome] = (c[p.outcome] ?? 0) + 1;
    return c;
  }, [points]);

  const plotW = Math.max(0, width - LABEL_W - PAD_R);
  const x = (ms: number) => LABEL_W + (Math.min(Math.max(ms, 0), endMs) / endMs) * plotW;
  const lanes = [
    {
      label: 'Film',
      ranges: plan?.film ? [{ ...plan.film, strong: true }] : filmEndMs ? [{ startMs: 0, endMs: filmEndMs, strong: true }] : [],
    },
    {
      label: 'In common',
      ranges: measurement.commonMaterial
        ? [
            { startMs: measurement.commonMaterial.startMs, endMs: measurement.commonMaterial.endMs, strong: false },
            ...(measurement.commonMaterial.verifiedStartMs !== null && measurement.commonMaterial.verifiedEndMs !== null
              ? [{ startMs: measurement.commonMaterial.verifiedStartMs, endMs: measurement.commonMaterial.verifiedEndMs, strong: true }]
              : []),
          ]
        : [],
    },
    {
      label: 'Italian',
      ranges:
        plan?.italian && plan.italian.startMs !== null && plan.italian.endMs !== null
          ? [{ startMs: plan.italian.startMs, endMs: plan.italian.endMs, strong: true }]
          : [],
    },
  ];
  const lanesH = lanes.length * (LANE_H + LANE_GAP);
  const plotTop = lanesH + 4;
  const y = (v: number) => plotTop + ((yMax - Math.min(Math.max(v, yMin), yMax)) / (yMax - yMin)) * PLOT_H;
  const noneY = plotTop + PLOT_H + NONE_H / 2 + 2;
  const height = plotTop + PLOT_H + NONE_H + AXIS_H;
  const pointY = (p: Checkpoint) => {
    const v = value(p);
    return v === null ? noneY : y(v);
  };

  const onMove = (event: React.MouseEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const mx = event.clientX - rect.left;
    const my = event.clientY - rect.top;
    let best: number | null = null;
    let bestDistance = Infinity;
    points.forEach((p, i) => {
      const dx = x(p.positionMs) - mx;
      const dy = (pointY(p) - my) / 4; // mostly by position
      const d = dx * dx + dy * dy;
      if (d < bestDistance) {
        bestDistance = d;
        best = i;
      }
    });
    setHover(bestDistance < 40 * 40 ? best : null);
  };

  const hovered = hover !== null ? points[hover] : null;
  const jumps = measurement.contradiction?.jumps ?? [];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          {CHECKPOINT_OUTCOMES.map((o) => (
            <span key={o.value} className={cn('flex items-center gap-1.5', !counts[o.value] && 'opacity-40')} title={o.hint}>
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: o.color }} />
              {o.label} <span className="text-muted-foreground tabular">{counts[o.value] ?? 0}</span>
            </span>
          ))}
        </div>
        <div className="flex rounded-md border p-0.5">
          {(['deviation', 'ncc'] as Mode[]).map((m) => (
            <Button
              key={m}
              variant={mode === m ? 'secondary' : 'ghost'}
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={() => setMode(m)}
            >
              {m === 'deviation' ? 'Deviation from S' : 'NCC'}
            </Button>
          ))}
        </div>
      </div>

      <div ref={ref} className="relative w-full">
        {width > 0 && (
          <svg width={width} height={height} onMouseMove={onMove} onMouseLeave={() => setHover(null)} className="select-none">
            {/* Lanes: the film, the material in common (the verified stretch darker), the Italian */}
            {lanes.map((lane, i) => {
              const top = i * (LANE_H + LANE_GAP);
              return (
                <g key={lane.label}>
                  <text x={0} y={top + LANE_H - 0.5} className="fill-muted-foreground text-[10px]">
                    {lane.label}
                  </text>
                  <rect x={LABEL_W} y={top} width={plotW} height={LANE_H} rx={2} className="fill-muted" />
                  {lane.ranges.map((r, j) => (
                    <rect
                      key={j}
                      x={x(r.startMs)}
                      y={top}
                      width={Math.max(1, x(r.endMs) - x(r.startMs))}
                      height={LANE_H}
                      rx={2}
                      className={r.strong ? 'fill-primary/70' : 'fill-primary/25'}
                    >
                      <title>
                        {lane.label}: {formatClock(r.startMs)} – {formatClock(r.endMs)}
                      </title>
                    </rect>
                  ))}
                </g>
              );
            })}

            {/* Plot frame and the zero line (S) */}
            <rect x={LABEL_W} y={plotTop} width={plotW} height={PLOT_H} className="fill-none stroke-border" />
            {mode === 'deviation' ? (
              <>
                <line x1={LABEL_W} x2={LABEL_W + plotW} y1={y(0)} y2={y(0)} className="stroke-muted-foreground/50" strokeDasharray="3 3" />
                <text x={LABEL_W - 6} y={y(0) + 3} textAnchor="end" className="fill-muted-foreground text-[10px]">
                  S
                </text>
                <text x={LABEL_W - 6} y={plotTop + 9} textAnchor="end" className="fill-muted-foreground text-[10px] tabular">
                  +{formatNumber(yMax, yMax < 10 ? 1 : 0)} ms
                </text>
                <text x={LABEL_W - 6} y={plotTop + PLOT_H - 2} textAnchor="end" className="fill-muted-foreground text-[10px] tabular">
                  −{formatNumber(yMax, yMax < 10 ? 1 : 0)} ms
                </text>
              </>
            ) : (
              <>
                {[0, 0.5, 1].map((v) => (
                  <g key={v}>
                    <line x1={LABEL_W} x2={LABEL_W + plotW} y1={y(v)} y2={y(v)} className="stroke-border" strokeDasharray="2 4" />
                    <text x={LABEL_W - 6} y={y(v) + 3} textAnchor="end" className="fill-muted-foreground text-[10px] tabular">
                      {v.toFixed(1)}
                    </text>
                  </g>
                ))}
              </>
            )}
            <text x={0} y={noneY + 3} className="fill-muted-foreground text-[10px]">
              No value
            </text>
            <line x1={LABEL_W} x2={LABEL_W + plotW} y1={noneY} y2={noneY} className="stroke-border" />

            {/* Jumps of a contradiction */}
            {jumps.map((j, i) => {
              const at = x((j.afterMs + j.beforeMs) / 2);
              return (
                <g key={i}>
                  <line x1={at} x2={at} y1={plotTop} y2={plotTop + PLOT_H} className="stroke-warning" strokeDasharray="4 3" />
                  <title>
                    Jump of {formatNumber(j.amountMs, 1)} ms ({j.frames} frame(s)) between {formatClock(j.afterMs)} and{' '}
                    {formatClock(j.beforeMs)}
                  </title>
                </g>
              );
            })}

            {/* Points: the rare outcomes last, on top */}
            {points
              .map((p, i) => ({ p, i }))
              .sort((a, b) => Number(a.p.outcome !== 'consistent') - Number(b.p.outcome !== 'consistent'))
              .map(({ p, i }) => {
                const v = value(p);
                const clipped = v !== null && (v > yMax || v < yMin);
                const loud = p.outcome === 'unmatched' || p.outcome === 'contradictory';
                return (
                  <circle
                    key={i}
                    cx={x(p.positionMs)}
                    cy={pointY(p)}
                    r={hover === i ? 5 : loud ? 4 : 2.5}
                    fill={outcomeColor(p.outcome)}
                    fillOpacity={p.outcome === 'consistent' ? 0.75 : 1}
                    stroke={clipped || hover === i ? 'hsl(var(--foreground))' : 'none'}
                    strokeWidth={1}
                  />
                );
              })}
            {hovered && (
              <line
                x1={x(hovered.positionMs)}
                x2={x(hovered.positionMs)}
                y1={0}
                y2={plotTop + PLOT_H + NONE_H}
                className="stroke-foreground/30"
              />
            )}

            {/* Time axis */}
            {timeTicks(endMs).map((t) => (
              <g key={t}>
                <line x1={x(t)} x2={x(t)} y1={plotTop + PLOT_H + NONE_H} y2={plotTop + PLOT_H + NONE_H + 4} className="stroke-muted-foreground/60" />
                <text x={x(t)} y={height - 4} textAnchor="middle" className="fill-muted-foreground text-[10px] tabular">
                  {hm(t)}
                </text>
              </g>
            ))}
          </svg>
        )}

        {hovered && (
          <div
            className="pointer-events-none absolute z-10 w-72 rounded-md border bg-popover p-2 shadow-md"
            style={{
              // Beside the point, inside the plot: to its right in the left half, to its left in the right half
              left:
                x(hovered.positionMs) < width / 2
                  ? x(hovered.positionMs) + 14
                  : Math.max(0, x(hovered.positionMs) - 14 - 288),
              top: plotTop + 6,
            }}
          >
            <Details point={hovered} anchorOffset={anchorOffset} />
          </div>
        )}
      </div>
      {points.length === 0 && <p className="text-xs text-muted-foreground">No checkpoints: the analysis stopped before them.</p>}
    </div>
  );
}

/** The checkpoints as a thin strip of ticks along the film, for the pair's card. */
export function CheckpointStrip({
  checkpoints,
  endMs,
}: {
  checkpoints: { positionMs: number; outcome: string }[];
  endMs: number | null;
}) {
  const end = Math.max(endMs ?? 0, ...checkpoints.map((c) => c.positionMs)) || 1;
  const sorted = [...checkpoints].sort((a, b) => Number(a.outcome !== 'consistent') - Number(b.outcome !== 'consistent'));
  return (
    <svg viewBox={`0 0 1000 10`} preserveAspectRatio="none" className="h-2.5 w-full rounded-sm bg-muted">
      {sorted.map((c, i) => (
        <rect
          key={i}
          x={(c.positionMs / end) * 1000 - (c.outcome === 'consistent' ? 1 : 2.5)}
          y={0}
          width={c.outcome === 'consistent' ? 2 : 5}
          height={10}
          fill={outcomeColor(c.outcome)}
          fillOpacity={c.outcome === 'consistent' ? 0.6 : 1}
        />
      ))}
    </svg>
  );
}
