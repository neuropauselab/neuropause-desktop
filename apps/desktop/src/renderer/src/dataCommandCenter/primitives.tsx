/**
 * Data Command Center — shared presentational leaves.
 *
 * These wrap the EXISTING design primitives (`components/ui`). Nothing here
 * introduces a second design system: `Tone` is the view-model's vocabulary
 * mapped onto the Badge tones the app already uses, and every block below is a
 * composition of Card / Badge / Icon / EmptyState.
 */
import type { ReactNode } from 'react';
import { cn } from '@renderer/lib/cn';
import { Card } from '@renderer/components/ui/Card';
import { Badge } from '@renderer/components/ui/controls';
import { Button } from '@renderer/components/ui/Button';
import { Icon, type IconName } from '@renderer/components/ui/Icon';

export type Tone = 'good' | 'warn' | 'bad' | 'neutral';

/** The view-model's tone vocabulary, in the app's existing Badge tones. */
const BADGE_TONE = {
  good: 'green',
  warn: 'orange',
  bad: 'pink',
  neutral: 'neutral',
} as const;

const TEXT_TONE: Record<Tone, string> = {
  good: 'text-sysgreen',
  warn: 'text-sysorange',
  bad: 'text-syspink',
  neutral: 'text-ink',
};

export function StatusPill({ tone, children }: { tone: Tone; children: ReactNode }): JSX.Element {
  return <Badge tone={BADGE_TONE[tone]}>{children}</Badge>;
}

/** A single number with its label. Only ever rendered from a real measurement. */
export function MetricTile({
  label,
  value,
  hint,
  tone = 'neutral',
}: {
  label: string;
  value: number;
  hint?: string;
  tone?: Tone;
}): JSX.Element {
  return (
    <Card variant="dashboard" className="p-4">
      <div className={cn('text-2xl font-semibold tabular-nums tracking-tight', TEXT_TONE[tone])}>
        {value.toLocaleString()}
      </div>
      <div className="mt-1 text-sm font-medium text-muted">{label}</div>
      {hint && <div className="mt-1 text-xs text-faint">{hint}</div>}
    </Card>
  );
}

/** A titled section with an optional trailing action. */
export function Section({
  title,
  subtitle,
  icon,
  right,
  children,
}: {
  title: string;
  subtitle?: string;
  icon?: IconName;
  right?: ReactNode;
  children: ReactNode;
}): JSX.Element {
  return (
    <section className="mb-6">
      <div className="mb-3 flex items-end justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold tracking-tight">
            {icon && <Icon name={icon} size={15} />}
            {title}
          </h2>
          {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

/** A failure the user can read and act on. Never a raw stack or code. */
export function ErrorBlock({
  title,
  detail,
  onRetry,
}: {
  title: string;
  detail: string;
  onRetry?: (() => void) | undefined;
}): JSX.Element {
  return (
    <Card variant="flat" className="border-syspink/20">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-syspink/15 text-syspink">
          <Icon name="info" size={15} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-base font-semibold">{title}</div>
          <p className="mt-1 text-sm text-muted">{detail}</p>
          {onRetry && (
            <Button size="sm" icon="refresh" className="mt-3" onClick={onRetry}>
              Try again
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}

/**
 * A statement about something the product deliberately does NOT do, or cannot
 * do in this build. Visually quiet — it is information, not a failure.
 */
export function NoticeBlock({ icon = 'info', children }: { icon?: IconName; children: ReactNode }): JSX.Element {
  return (
    <div className="flex items-start gap-2.5 rounded-xl border border-[var(--hairline)] [background:var(--fill-1)] px-3.5 py-3 text-sm text-muted">
      <Icon name={icon} size={14} className="mt-0.5 shrink-0 text-faint" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** A confidence figure with its band, always shown together. */
export function Confidence({ pct, band }: { pct: number; band: 'high' | 'medium' | 'low' }): JSX.Element {
  const tone: Tone = band === 'high' ? 'good' : band === 'medium' ? 'warn' : 'bad';
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-sm tabular-nums', TEXT_TONE[tone])}>
      <span className="font-semibold">{pct}%</span>
      <span className="text-xs uppercase tracking-wider text-faint">{band}</span>
    </span>
  );
}

/** A simple definition row used by the provenance and detail views. */
export function DetailRow({ label, value }: { label: string; value: ReactNode }): JSX.Element {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-[var(--hairline)] py-2 last:border-0">
      <span className="shrink-0 text-sm text-muted">{label}</span>
      <span className="min-w-0 break-words text-right text-sm font-medium">{value}</span>
    </div>
  );
}

/** A dense table shell with the app's hairline styling. */
export function DataTable({ head, children }: { head: ReactNode; children: ReactNode }): JSX.Element {
  return (
    <Card variant="flat" flush className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-[var(--hairline)] text-xs uppercase tracking-wider text-faint">
            {head}
          </thead>
          <tbody>{children}</tbody>
        </table>
      </div>
    </Card>
  );
}

/** `children` is optional so an action column can carry a blank header cell. */
export function Th({ children, className }: { children?: ReactNode; className?: string }): JSX.Element {
  return <th className={cn('px-4 py-2.5 font-medium', className)}>{children}</th>;
}

export function Td({ children, className }: { children: ReactNode; className?: string }): JSX.Element {
  return <td className={cn('border-b border-[var(--hairline)] px-4 py-2.5 align-top', className)}>{children}</td>;
}
