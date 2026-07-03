import type { ReactNode } from 'react';
import type { ActionEvidence, GovernanceVerdict, WorkerRole } from '@neuropause/shared';
import { cn } from '@renderer/lib/cn';
import { Icon, type IconName } from '@renderer/components/ui/Icon';
import { StatusDot, Bar } from '@renderer/operations/primitives';
import {
  decisionMeta,
  formatTrust,
  type Meta,
  roleIcon,
  roleTone,
  TEXT_TONE,
  TINT_TONE,
  trustTone,
  type OpsTone,
} from './lib';

/** A role glyph in a tinted rounded square. */
export function WorkerGlyph({ role, size = 32 }: { role: WorkerRole; size?: number }): JSX.Element {
  return (
    <span
      className={cn('flex shrink-0 items-center justify-center rounded-xl', TINT_TONE[roleTone(role)])}
      style={{ width: size, height: size }}
    >
      <Icon name={roleIcon(role)} size={Math.round(size * 0.5)} />
    </span>
  );
}

/** A dot + label rendered from a {label, tone} meta. */
export function MetaDot({ meta, pulse = false }: { meta: Meta; pulse?: boolean }): JSX.Element {
  return (
    <span className="inline-flex items-center gap-1.5">
      <StatusDot tone={meta.tone} pulse={pulse} />
      <span className={cn('text-xs font-medium', TEXT_TONE[meta.tone])}>{meta.label}</span>
    </span>
  );
}

/** A small chip. */
export function Pill({
  tone = 'gray',
  icon,
  children,
}: {
  tone?: OpsTone;
  icon?: IconName;
  children: ReactNode;
}): JSX.Element {
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-2xs font-medium', TINT_TONE[tone])}>
      {icon && <Icon name={icon} size={11} />}
      {children}
    </span>
  );
}

/** Trust score as a meter + percentage. */
export function TrustMeter({ score, className }: { score: number; className?: string }): JSX.Element {
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div className="w-16">
        <Bar value={score} tone={trustTone(score)} />
      </div>
      <span className={cn('tabular text-2xs font-medium', TEXT_TONE[trustTone(score)])}>{formatTrust(score)}</span>
    </div>
  );
}

/** Evidence references as compact chips. */
export function EvidencePills({ evidence, max = 8 }: { evidence: ActionEvidence[]; max?: number }): JSX.Element {
  if (evidence.length === 0) {
    return <span className="text-2xs text-faint">no evidence</span>;
  }
  const shown = evidence.slice(0, max);
  const rest = evidence.length - shown.length;
  return (
    <div className="flex flex-wrap gap-1">
      {shown.map((e, i) => (
        <span
          key={`${e.kind}:${e.id}:${i}`}
          className="inline-flex items-center gap-1 rounded-md border border-[var(--hairline)] px-1.5 py-0.5 text-2xs text-muted"
          title={`${e.kind}: ${e.id}`}
        >
          <span className="text-faint">{e.kind}</span>
          <span className="max-w-[120px] truncate font-mono">{e.id}</span>
        </span>
      ))}
      {rest > 0 && <span className="px-1 py-0.5 text-2xs text-faint">+{rest} more</span>}
    </div>
  );
}

/** The governance verdict: decision, the four checks, and the policies that fired. */
export function VerdictBlock({ verdict }: { verdict: GovernanceVerdict }): JSX.Element {
  const meta = decisionMeta(verdict.decision);
  return (
    <div className="rounded-xl border border-[var(--hairline)] [background:var(--fill-1)] p-3">
      <div className="mb-2 flex items-center gap-2">
        <span className={cn('flex h-5 w-5 items-center justify-center rounded-md', TINT_TONE[meta.tone])}>
          <Icon name="shield" size={12} />
        </span>
        <span className={cn('text-xs font-semibold', TEXT_TONE[meta.tone])}>Governance: {meta.label}</span>
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        {verdict.checks.map((c) => (
          <div key={c.kind} className="flex items-start gap-1.5" title={c.detail}>
            <Icon
              name={c.outcome === 'allow' ? 'check' : c.outcome === 'deny' ? 'close' : 'info'}
              size={12}
              className={cn('mt-0.5 shrink-0', TEXT_TONE[decisionMeta(c.outcome).tone])}
            />
            <div className="min-w-0">
              <div className="text-2xs font-medium capitalize text-ink">{c.kind}</div>
              <div className="truncate text-2xs text-faint">{c.detail}</div>
            </div>
          </div>
        ))}
      </div>
      {verdict.evaluations.some((e) => e.matched) && (
        <div className="mt-2 border-t border-[var(--hairline)] pt-2">
          <div className="mb-1 text-2xs uppercase tracking-wide text-faint">Policies applied</div>
          <div className="flex flex-wrap gap-1">
            {verdict.evaluations
              .filter((e) => e.matched)
              .map((e) => (
                <Pill key={e.ruleId} tone={e.effect === 'allow' ? 'green' : e.effect === 'deny' ? 'red' : 'orange'}>
                  {e.title}
                </Pill>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
