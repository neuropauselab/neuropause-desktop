import type { ReactNode } from 'react';
import { cn } from '@renderer/lib/cn';
import { Icon, type IconName } from '@renderer/components/ui/Icon';
import { DOT_BG, TEXT_TONE, TINT_TONE, type OpsTone } from './lib';

/** A small status dot. */
export function StatusDot({ tone, pulse = false }: { tone: OpsTone; pulse?: boolean }): JSX.Element {
  return (
    <span className="relative flex h-2 w-2">
      {pulse && (
        <span className={cn('absolute inline-flex h-full w-full animate-ping rounded-full opacity-60', DOT_BG[tone])} />
      )}
      <span className={cn('relative inline-flex h-2 w-2 rounded-full', DOT_BG[tone])} />
    </span>
  );
}

/** A dot + label status badge. */
export function StatusBadge({ tone, label, pulse }: { tone: OpsTone; label: string; pulse?: boolean }): JSX.Element {
  return (
    <span className="inline-flex items-center gap-1.5">
      <StatusDot tone={tone} pulse={pulse} />
      <span className={cn('text-xs font-medium', TEXT_TONE[tone])}>{label}</span>
    </span>
  );
}

/** A panel section with a header, optional actions, and a body. */
export function OpsPanel({
  title,
  subtitle,
  actions,
  children,
  className,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}): JSX.Element {
  return (
    <section className={cn('mb-6', className)}>
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
          {subtitle && <p className="text-xs text-faint">{subtitle}</p>}
        </div>
        {actions && <div className="flex items-center gap-1.5">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

/** A metric stat tile. */
export function Stat({
  icon,
  label,
  value,
  tone = 'accent',
  hint,
}: {
  icon: IconName;
  label: string;
  value: ReactNode;
  tone?: OpsTone;
  hint?: string;
}): JSX.Element {
  return (
    <div className="surface-raised rounded-2xl p-4 shadow-card">
      <span className={cn('flex h-8 w-8 items-center justify-center rounded-lg', TINT_TONE[tone])}>
        <Icon name={icon} size={16} />
      </span>
      <div className="mt-3 text-2xl font-semibold tracking-tight">{value}</div>
      <div className="text-xs text-faint">{label}</div>
      {hint && <div className="mt-0.5 text-2xs text-faint">{hint}</div>}
    </div>
  );
}

/** A compact, quiet icon button for row actions, with a tooltip. */
export function IconAction({
  icon,
  label,
  onClick,
  tone = 'gray',
  disabled = false,
}: {
  icon: IconName;
  label: string;
  onClick: () => void;
  tone?: OpsTone;
  disabled?: boolean;
}): JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex h-7 w-7 items-center justify-center rounded-lg outline-none transition fill-hover focus-visible:shadow-focus disabled:pointer-events-none disabled:opacity-40',
        tone === 'gray' ? 'text-muted hover:text-ink' : TEXT_TONE[tone],
      )}
    >
      <Icon name={icon} size={15} />
    </button>
  );
}

/** A horizontal scrollable table shell with a sticky header row. */
export function OpsTable({ head, children }: { head: ReactNode; children: ReactNode }): JSX.Element {
  return (
    <div className="overflow-hidden rounded-2xl border border-[var(--hairline)]">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="[background:var(--fill-1)] text-left text-2xs font-semibold uppercase tracking-wider text-faint">
            {head}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

/** A thin progress bar. */
export function Bar({ value, tone = 'accent' }: { value: number; tone?: OpsTone }): JSX.Element {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full [background:var(--fill-2)]">
      <div
        className={cn('h-full rounded-full transition-[background-color,color,border-color,box-shadow,transform,opacity] motion-reduce:transition-none', DOT_BG[tone])}
        style={{ width: `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%` }}
      />
    </div>
  );
}
