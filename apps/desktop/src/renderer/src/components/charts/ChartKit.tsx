/**
 * ChartKit — the ONE chart layer of NeuroPause (Phase 7.2).
 *
 * Thin, token-styled wrappers over recharts so every dashboard reads as one
 * system: recessive hairline grid, text in text tokens (never series color),
 * 2px lines, 4px rounded bar ends, 2px gaps between donut segments, a glass
 * tooltip on hover by default, and a legend whenever two or more series are
 * on the plot.
 *
 * COLOR CONTRACT (validated, not eyeballed):
 *  • CHART_SERIES is the FIXED categorical order — assigned by position,
 *    never cycled. All six palette checks pass in dark mode (lightness band,
 *    chroma floor, CVD ΔE, normal-vision floor, ≥3:1 contrast on the app
 *    surface). More than 8 categories must fold to "Other" upstream.
 *  • Status/tone colors come from the app's reserved --c-* tokens and are
 *    used ONLY when the data itself is status-shaped (a record's own select
 *    tones) — never as extra series colors.
 *  • Sequential magnitude uses the single blue hue. No dual axes, ever.
 *
 * Every component renders REAL data handed to it — this file computes
 * nothing and fabricates nothing.
 */
import type { ReactNode } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Card } from '@renderer/components/ui/Card';
import { EmptyState } from '@renderer/components/ui/EmptyState';

/** The fixed categorical order (dark-mode validated). Assign by position; never cycle. */
export const CHART_SERIES = [
  '#3987e5', // 1 blue
  '#d95926', // 2 orange
  '#199e70', // 3 aqua
  '#c98500', // 4 yellow
  '#d55181', // 5 magenta
  '#008300', // 6 green
  '#9085e9', // 7 violet
  '#e66767', // 8 red
] as const;

/** Reserved status tones (the app's own --c-* semantics) for status-shaped data. */
export const TONE_COLORS: Record<string, string> = {
  blue: 'rgb(64 156 255)',
  green: 'rgb(48 209 88)',
  orange: 'rgb(255 159 10)',
  purple: 'rgb(191 90 242)',
  teal: 'rgb(100 210 255)',
  pink: 'rgb(255 55 95)',
  yellow: 'rgb(255 214 10)',
  neutral: 'rgb(150 150 156)',
};

export const toneColor = (tone: string | undefined, fallbackIndex: number): string =>
  (tone && TONE_COLORS[tone]) || CHART_SERIES[fallbackIndex % CHART_SERIES.length];

const AXIS_TICK = { fill: 'var(--text-3, #96969c)', fontSize: 11 } as const;
const GRID_STROKE = 'var(--hairline)';

export function formatCompact(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}k`;
  return `${Math.round(n * 100) / 100}`;
}

/** The glass hover tooltip — text in text tokens, a colored chip per series. */
function GlassTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number | string; color?: string }>;
  label?: string | number;
}): JSX.Element | null {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="glass-panel rounded-xl px-3 py-2 text-xs shadow-lg">
      {label !== undefined && label !== '' && <div className="mb-1 font-medium text-ink">{label}</div>}
      <div className="space-y-0.5">
        {payload.map((p, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ background: p.color }} />
            <span className="text-muted">{p.name}</span>
            <span className="ml-auto pl-3 tabular-nums text-ink">
              {typeof p.value === 'number' ? formatCompact(p.value) : p.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Compact legend row — shown whenever ≥ 2 series share a plot. */
function SeriesLegend({ items }: { items: { label: string; color: string }[] }): JSX.Element | null {
  if (items.length < 2) return null;
  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
      {items.map((s) => (
        <span key={s.label} className="inline-flex items-center gap-1.5 text-xs text-muted">
          <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ background: s.color }} />
          {s.label}
        </span>
      ))}
    </div>
  );
}

/** The card every chart lives in — title, real content, honest empty state. */
export function ChartCard({
  title,
  subtitle,
  empty,
  emptyHint,
  children,
  className,
}: {
  title: string;
  subtitle?: string;
  /** True when there is no real data to plot — renders the shared empty state instead. */
  empty?: boolean;
  emptyHint?: string;
  children: ReactNode;
  className?: string;
}): JSX.Element {
  return (
    <Card variant="hairline" className={className}>
      <div className="mb-2">
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        {subtitle && <p className="text-xs text-faint">{subtitle}</p>}
      </div>
      {empty ? (
        <EmptyState
          compact
          icon="analytics"
          title="No data yet"
          description={emptyHint ?? 'This chart draws from live records — it fills in as records are created.'}
        />
      ) : (
        children
      )}
    </Card>
  );
}

export interface SeriesDef {
  key: string;
  label: string;
}

/** Change over time — 2px lines, recessive grid, crosshair tooltip. */
export function NpLine({
  data,
  xKey,
  series,
  height = 200,
}: {
  data: Array<Record<string, unknown>>;
  xKey: string;
  series: SeriesDef[];
  height?: number;
}): JSX.Element {
  return (
    <div>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: -14 }}>
          <CartesianGrid stroke={GRID_STROKE} vertical={false} />
          <XAxis dataKey={xKey} tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: GRID_STROKE }} />
          <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} tickFormatter={formatCompact} width={54} />
          <Tooltip content={<GlassTooltip />} cursor={{ stroke: GRID_STROKE }} />
          {series.map((s, i) => (
            <Line
              key={s.key}
              dataKey={s.key}
              name={s.label}
              stroke={CHART_SERIES[i % CHART_SERIES.length]}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
      <SeriesLegend items={series.map((s, i) => ({ label: s.label, color: CHART_SERIES[i % CHART_SERIES.length] }))} />
    </div>
  );
}

/** Magnitude by category — 4px rounded ends, 2px gaps, per-bar hover. */
export function NpBars({
  data,
  xKey,
  bars,
  height = 200,
  colorByRow = false,
  tones,
}: {
  data: Array<Record<string, unknown>>;
  xKey: string;
  bars: SeriesDef[];
  height?: number;
  /** One-series identity charts: color each row by position (fixed order). */
  colorByRow?: boolean;
  /** Optional per-row status tones (status-shaped data only). */
  tones?: (string | undefined)[];
}): JSX.Element {
  return (
    <div>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} barGap={2} margin={{ top: 6, right: 8, bottom: 0, left: -14 }}>
          <CartesianGrid stroke={GRID_STROKE} vertical={false} />
          <XAxis
            dataKey={xKey}
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={{ stroke: GRID_STROKE }}
            interval={0}
            tickFormatter={(v: string) => (v.length > 9 ? `${v.slice(0, 8)}…` : v)}
          />
          <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} tickFormatter={formatCompact} width={54} />
          <Tooltip content={<GlassTooltip />} cursor={{ fill: 'var(--fill-1)' }} />
          {bars.map((b, i) => (
            <Bar
              key={b.key}
              dataKey={b.key}
              name={b.label}
              fill={CHART_SERIES[i % CHART_SERIES.length]}
              radius={[4, 4, 0, 0]}
              maxBarSize={28}
              isAnimationActive={false}
            >
              {colorByRow &&
                bars.length === 1 &&
                data.map((_, rowIndex) => (
                  <Cell
                    key={rowIndex}
                    fill={tones ? toneColor(tones[rowIndex], rowIndex) : CHART_SERIES[rowIndex % CHART_SERIES.length]}
                  />
                ))}
            </Bar>
          ))}
        </BarChart>
      </ResponsiveContainer>
      <SeriesLegend
        items={
          colorByRow && bars.length === 1
            ? []
            : bars.map((b, i) => ({ label: b.label, color: CHART_SERIES[i % CHART_SERIES.length] }))
        }
      />
    </div>
  );
}

export interface DonutSlice {
  name: string;
  value: number;
  /** Reserved status tone when the data is status-shaped; otherwise categorical order applies. */
  tone?: string;
}

/** Share of a whole — 2px segment gaps, center total, side legend with values. */
export function NpDonut({ data, height = 190 }: { data: DonutSlice[]; height?: number }): JSX.Element {
  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <div className="flex items-center gap-4">
      <div className="relative shrink-0" style={{ width: height, height }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Tooltip content={<GlassTooltip />} />
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              innerRadius="62%"
              outerRadius="92%"
              paddingAngle={2}
              stroke="none"
              isAnimationActive={false}
            >
              {data.map((d, i) => (
                <Cell key={d.name} fill={toneColor(d.tone, i)} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-lg font-semibold tabular-nums text-ink">{formatCompact(total)}</span>
          <span className="text-2xs text-faint">total</span>
        </div>
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        {data.map((d, i) => (
          <div key={d.name} className="flex items-center gap-1.5 text-xs">
            <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full" style={{ background: toneColor(d.tone, i) }} />
            <span className="truncate text-muted">{d.name}</span>
            <span className="ml-auto pl-2 tabular-nums text-ink">{formatCompact(d.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** A KPI stat tile with an optional real sparkline — the "hero number" form. */
export function TrendCard({
  label,
  value,
  hint,
  spark,
  sparkKey = 'count',
}: {
  label: string;
  value: string;
  hint?: string;
  /** Optional real series for the sparkline (e.g. monthly counts). */
  spark?: Array<Record<string, unknown>>;
  sparkKey?: string;
}): JSX.Element {
  return (
    <Card variant="hairline" className="min-w-0">
      <div className="text-xs text-faint">{label}</div>
      <div className="mt-0.5 truncate text-xl font-semibold tabular-nums tracking-tight text-ink">{value}</div>
      {hint && <div className="mt-0.5 text-2xs text-faint">{hint}</div>}
      {spark && spark.length > 1 && (
        <div className="mt-2 h-8">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={spark} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
              <Area
                dataKey={sparkKey}
                stroke={CHART_SERIES[0]}
                strokeWidth={2}
                fill={CHART_SERIES[0]}
                fillOpacity={0.14}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
}
