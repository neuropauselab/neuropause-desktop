import type { ReactNode } from 'react';
import { cn } from '@renderer/lib/cn';
import { Icon, type IconName } from '@renderer/components/ui/Icon';
import { EmptyState as SharedEmptyState } from '@renderer/components/ui/EmptyState';
import { Spinner } from '@renderer/components/Spinner';
import { DOT_BG, TEXT_TONE, TINT_TONE, type OpsTone } from '@renderer/operations/lib';
import type { ExecutiveKpi } from '@neuropause/shared';
import { type HeatCell, type Tone, bandLabel } from './opsModel';

/** A quiet tint pill (tone-tinted background + label). */
export function Pill({ tone, label, icon }: { tone: Tone; label: string; icon?: IconName }): JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-2xs font-semibold uppercase tracking-wide',
        TINT_TONE[tone as OpsTone],
      )}
    >
      {icon && <Icon name={icon} size={11} />}
      {label}
    </span>
  );
}

/** A labeled key → value row (dense metadata). */
export function Field({ label, value }: { label: string; value: ReactNode }): JSX.Element {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <span className="text-xs text-faint">{label}</span>
      <span className="text-sm font-medium text-ink text-right tabular">{value}</span>
    </div>
  );
}

/** A labeled progress meter (0..1). */
export function Meter({
  value,
  tone = 'accent',
  label,
  trailing,
}: {
  value: number;
  tone?: Tone;
  label?: string;
  trailing?: ReactNode;
}): JSX.Element {
  const pctWidth = `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
  return (
    <div>
      {(label || trailing) && (
        <div className="mb-1 flex items-baseline justify-between gap-2">
          {label && <span className="text-xs text-muted">{label}</span>}
          {trailing && <span className="text-2xs text-faint tabular">{trailing}</span>}
        </div>
      )}
      <div className="h-1.5 w-full overflow-hidden rounded-full [background:var(--fill-2)]">
        <div
          className={cn('h-full rounded-full transition-all duration-500', DOT_BG[tone as OpsTone])}
          style={{ width: pctWidth }}
        />
      </div>
    </div>
  );
}

/** One cell in the risk heatmap — intensity-tinted, optionally selectable. */
export function HeatTile({
  cell,
  active = false,
  onClick,
}: {
  cell: HeatCell;
  active?: boolean;
  onClick?: () => void;
}): JSX.Element {
  const Comp = onClick ? 'button' : 'div';
  return (
    <Comp
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={cn(
        'relative flex flex-col items-start gap-1 overflow-hidden rounded-xl border p-3 text-left transition',
        active ? 'border-white/40' : 'border-white/5',
        onClick && 'hover:border-white/25',
      )}
    >
      <span
        className="pointer-events-none absolute inset-0"
        style={{ background: 'white', opacity: 0.03 + cell.intensity * 0.16 }}
      />
      <span className="relative text-2xs font-medium uppercase tracking-wide text-faint">
        {cell.label}
      </span>
      <span className={cn('relative text-2xl font-semibold tabular', TEXT_TONE[cell.tone as OpsTone])}>
        {Math.round(cell.score)}
      </span>
      <span className="relative text-2xs text-faint">
        {bandLabel(cell.band)} · n={cell.sampleSize}
      </span>
    </Comp>
  );
}

/** An executive-KPI card (value + label + band dot). */
export function KpiCard({ kpi, tone = 'accent' }: { kpi: ExecutiveKpi; tone?: Tone }): JSX.Element {
  return (
    <div className="surface-raised rounded-2xl p-4 shadow-card">
      <div className="flex items-start justify-between">
        <span className="text-2xs font-medium uppercase tracking-wide text-faint">{kpi.label}</span>
        <span className={cn('h-2 w-2 rounded-full', DOT_BG[tone as OpsTone])} />
      </div>
      <div className="mt-2 text-2xl font-semibold tracking-tight tabular">{kpi.display}</div>
      {kpi.value != null && (
        <div className="mt-2 h-1 w-full overflow-hidden rounded-full [background:var(--fill-2)]">
          <div
            className={cn('h-full rounded-full', DOT_BG[tone as OpsTone])}
            style={{ width: `${Math.max(0, Math.min(100, kpi.value))}%` }}
          />
        </div>
      )}
    </div>
  );
}

/**
 * A friendly empty state for a screen with no findings. Phase 7 (Product
 * Experience): now a thin adapter over the ONE shared EmptyState — same visual
 * language everywhere — keeping this surface's bordered container and its
 * `hint` prop name so every existing call site compiles unchanged.
 */
export function EmptyState({
  icon = 'sparkles',
  title,
  hint,
}: {
  icon?: IconName;
  title: string;
  hint?: string;
}): JSX.Element {
  return (
    <div className="rounded-2xl border border-[var(--hairline)]">
      <SharedEmptyState icon={icon} title={title} description={hint} />
    </div>
  );
}

/** A centered spinner block for first load. */
export function LoadingBlock({ label = 'Loading intelligence…' }: { label?: string }): JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
      <Spinner />
      <p className="text-xs text-faint">{label}</p>
    </div>
  );
}

/**
 * A hard-error block — shown only when a center has NO data to fall back on, so a
 * failed load is never mistaken for a healthy-but-empty state. `title` phrases the
 * headline for the center (defaults to the enterprise-intelligence copy so the
 * pre-existing call sites are unchanged).
 */
export function ErrorBlock({
  message,
  onRetry,
  title = 'Couldn’t load enterprise intelligence',
}: {
  message: string;
  onRetry: () => void;
  title?: string;
}): JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-[var(--hairline)] py-16 text-center">
      <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/[0.06] text-muted">
        <Icon name="info" size={20} />
      </span>
      <p className="text-sm font-medium text-ink">{title}</p>
      <p className="max-w-[440px] text-xs text-faint">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-1 inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-xs font-medium text-ink transition hover:bg-white/15"
      >
        <Icon name="refresh" size={14} />
        Try again
      </button>
    </div>
  );
}

/** A dense two/three/four-column responsive grid wrapper. */
export function Grid({ cols = 3, children }: { cols?: 2 | 3 | 4; children: ReactNode }): JSX.Element {
  const map = { 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-2 lg:grid-cols-3', 4: 'sm:grid-cols-2 lg:grid-cols-4' } as const;
  return <div className={cn('grid grid-cols-1 gap-3', map[cols])}>{children}</div>;
}
