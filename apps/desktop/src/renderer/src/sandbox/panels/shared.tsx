/**
 * Shared building blocks for the Sandbox workspace panels: tone→surface helpers, pills,
 * section cards, a KPI grid, copy/download affordances, and the run-detail drawer that
 * several panels open. Everything reuses the existing design system (Operations primitives,
 * ui/Card, ui/Button, ui/Icon) — no new visual language, just Sandbox-specific compositions.
 */
import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { useFocusTrap } from '@renderer/lib/useFocusTrap';
import { AnimatePresence, motion } from 'framer-motion';
import type { CertificationReport, RegressionAnalysis, ValidationRunDetail } from '@neuropause/shared';
import { cn } from '@renderer/lib/cn';
import { Icon, type IconName } from '@renderer/components/ui/Icon';
import { Card, CardHeader } from '@renderer/components/ui/Card';
import { Button } from '@renderer/components/ui/Button';
import { EmptyState } from '@renderer/components/ui/EmptyState';
import { TEXT_TONE, TINT_TONE, type OpsTone } from '@renderer/operations/lib';
import {
  certMeta,
  formatDuration,
  formatMs,
  relativeTime,
  runStatusMeta,
  severityMeta,
  stageKindLabel,
  stageStatusMeta,
  pipelineLabel,
  type SandboxTone,
} from '@renderer/sandbox/sandboxModel';

type CardTint = 'accent' | 'blue' | 'green' | 'orange' | 'purple' | 'teal' | 'pink';

/** Map the model's tone union onto the CardHeader tint palette (monochrome brightness). */
export function toneTint(tone: SandboxTone): CardTint {
  switch (tone) {
    case 'green':
      return 'green';
    case 'orange':
      return 'orange';
    case 'red':
      return 'pink';
    case 'blue':
      return 'blue';
    case 'purple':
      return 'purple';
    default:
      return 'accent';
  }
}

/** A filled/hairline status pill. Tone conveys brightness; the label carries the meaning. */
export function Pill({ tone, label, subtle = false }: { tone: OpsTone; label: string; subtle?: boolean }): JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-2xs font-semibold',
        subtle ? cn('[background:var(--fill-2)]', TEXT_TONE[tone]) : TINT_TONE[tone],
      )}
    >
      {label}
    </span>
  );
}

/** A dot + label, for inline row status. */
export function Dot({ tone, label }: { tone: OpsTone; label: string }): JSX.Element {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn('h-1.5 w-1.5 rounded-full', TINT_TONE[tone].split(' ')[0])} />
      <span className={cn('text-xs font-medium', TEXT_TONE[tone])}>{label}</span>
    </span>
  );
}

/** A titled section card (hairline surface + header), the workhorse container for panels. */
export function SectionCard({
  title,
  subtitle,
  icon,
  tint = 'accent',
  action,
  children,
  className,
}: {
  title: string;
  subtitle?: string;
  icon: IconName;
  tint?: CardTint;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}): JSX.Element {
  return (
    <Card variant="hairline" className={cn('mb-5', className)}>
      <CardHeader
        icon={<Icon name={icon} size={15} />}
        title={title}
        tint={tint}
        action={
          <div className="flex items-center gap-2">
            {subtitle && <span className="text-2xs text-faint">{subtitle}</span>}
            {action}
          </div>
        }
      />
      {children}
    </Card>
  );
}

/** Responsive KPI grid. */
export function KpiGrid({ children, className }: { children: ReactNode; className?: string }): JSX.Element {
  return (
    <div className={cn('grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4', className)}>{children}</div>
  );
}

/** A dense metric tile (label + value + optional caption), monochrome. */
export function Metric({
  label,
  value,
  tone = 'accent',
  caption,
}: {
  label: string;
  value: ReactNode;
  tone?: OpsTone;
  caption?: string;
}): JSX.Element {
  return (
    <div className="rounded-xl border border-[var(--hairline)] [background:var(--fill-1)] p-3.5">
      <div className="text-2xs font-medium uppercase tracking-wider text-faint">{label}</div>
      <div className={cn('mt-1 text-xl font-semibold tracking-tight', TEXT_TONE[tone])}>{value}</div>
      {caption && <div className="mt-0.5 text-2xs text-faint">{caption}</div>}
    </div>
  );
}

export function copyText(value: string): void {
  void navigator.clipboard?.writeText(value);
}

export function downloadText(filename: string, mime: string, text: string): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** A right-side sliding drawer (macOS inspector idiom) with a backdrop. */
export function Drawer({
  open,
  title,
  subtitle,
  onClose,
  children,
  width = 560,
}: {
  open: boolean;
  title: string;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  width?: number;
}): JSX.Element {
  // GATE 12 (round 50) — the drawer traps focus while open, and Escape closes
  // it (parity with the backdrop click that always existed).
  const trapRef = useRef<HTMLDivElement>(null);
  useFocusTrap(trapRef, open);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-40">
          <motion.div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={onClose}
            aria-hidden
          />
          <motion.div
            ref={trapRef}
            role="dialog"
            aria-modal
            aria-label={title}
            className="surface-raised absolute right-0 top-0 flex h-full flex-col shadow-pop"
            style={{ width: `min(${width}px, 92vw)` }}
            initial={{ x: 32, opacity: 0.6 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 32, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
          >
            <div className="flex items-start justify-between gap-3 border-b border-[var(--hairline)] px-5 py-4">
              <div className="min-w-0">
                <h3 className="truncate text-base font-semibold tracking-tight">{title}</h3>
                {subtitle && <div className="mt-0.5 text-xs text-faint">{subtitle}</div>}
              </div>
              <button
                type="button"
                aria-label="Close"
                onClick={onClose}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted fill-hover hover:text-ink"
              >
                <Icon name="close" size={16} />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

/* ─────────────────────────── run-detail drawer ─────────────────────────── */

function CertBlock({ cert, exports }: { cert: CertificationReport; exports: ValidationRunDetail['exports'] }): JSX.Element {
  const meta = certMeta(cert.level);
  return (
    <div className="mb-5">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon name="verified" size={16} className={TEXT_TONE[meta.tone].split(' ')[0]} />
          <span className="text-sm font-semibold">Certification</span>
          <Pill tone={meta.tone} label={meta.label} />
        </div>
        {exports && (
          <div className="flex items-center gap-1.5">
            <Button size="sm" variant="ghost" icon="clipboard" onClick={() => copyText(exports.markdown)}>
              Copy
            </Button>
            <Button
              size="sm"
              variant="ghost"
              icon="download"
              onClick={() => downloadText(`certification-${cert.pipeline}.md`, 'text/markdown', exports.markdown)}
            >
              Export
            </Button>
          </div>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        <Metric label="Scenarios" value={`${cert.scenarioResults.passed}/${cert.scenarioResults.total}`} tone={cert.scenarioResults.failed ? 'orange' : 'green'} />
        <Metric label="AI QA bugs" value={cert.aiQaResults.bugs} tone={cert.aiQaResults.bugs ? 'orange' : 'green'} caption={`${cert.aiQaResults.sessions} sessions`} />
        <Metric label="Latency p95" value={formatMs(cert.performance.latencyP95Ms)} />
        <Metric label="Security" value={cert.security.failures ? `${cert.security.failures} failing` : 'Clean'} tone={cert.security.failures ? 'red' : 'green'} caption={`${cert.security.checks} checks`} />
        <Metric label="Recovery" value={`${cert.recovery.rate}%`} tone={cert.recovery.rate >= 90 ? 'green' : 'orange'} />
        <Metric label="Benchmarks" value={`${cert.benchmarks.regressed} regressed`} tone={cert.benchmarks.regressed ? 'orange' : 'green'} caption={`${cert.benchmarks.compared} compared`} />
      </div>
      {cert.summary && <p className="mt-3 text-xs leading-relaxed text-muted">{cert.summary}</p>}
    </div>
  );
}

function RegressionBlock({ regression }: { regression: RegressionAnalysis }): JSX.Element {
  if (!regression.findings.length) {
    return (
      <div className="mb-5">
        <div className="mb-2 text-sm font-semibold">Regression</div>
        <Dot tone="green" label={regression.summary || 'No regressions vs baseline'} />
      </div>
    );
  }
  return (
    <div className="mb-5">
      <div className="mb-2 text-sm font-semibold">Regression · {regression.findings.length}</div>
      <div className="space-y-1.5">
        {regression.findings.map((f, i) => {
          const m = severityMeta(f.severity);
          return (
            <div key={`${f.metric}-${i}`} className="flex items-center justify-between rounded-lg border border-[var(--hairline)] px-3 py-2">
              <div className="min-w-0">
                <div className="truncate text-xs font-medium">{f.detail || `${f.metric} regression`}</div>
                <div className="text-2xs text-faint">
                  {f.kind} · {f.baseline ?? '—'} → {f.current} ({f.deltaPct > 0 ? '+' : ''}{f.deltaPct}%)
                </div>
              </div>
              <Pill tone={m.tone} label={m.label} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function RunDetailDrawer({
  detail,
  open,
  onClose,
  nowMs,
}: {
  detail: ValidationRunDetail | null;
  open: boolean;
  onClose: () => void;
  nowMs: number;
}): JSX.Element {
  const run = detail?.run;
  const status = run ? runStatusMeta(run.status) : null;
  return (
    <Drawer
      open={open && !!detail}
      title={run ? pipelineLabel(run.pipeline) : 'Run'}
      subtitle={run ? `${run.trigger} · ${relativeTime(run.finishedAt ?? run.startedAt, nowMs)} · ${formatDuration(run.durationMs)}` : undefined}
      onClose={onClose}
    >
      {!run ? (
        <EmptyState icon="beaker" title="No run selected" compact />
      ) : (
        <div>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            {status && <Pill tone={status.tone} label={status.label} />}
            {run.certificationLevel && <Pill tone={certMeta(run.certificationLevel).tone} label={certMeta(run.certificationLevel).label} subtle />}
            <span className="text-2xs text-faint">{run.stages.length} stages</span>
          </div>

          {detail?.certification && <CertBlock cert={detail.certification} exports={detail.exports} />}
          {detail?.regression && <RegressionBlock regression={detail.regression} />}

          <div className="mb-2 text-sm font-semibold">Stages</div>
          {run.stages.length === 0 ? (
            <Dot tone="gray" label="No stages recorded" />
          ) : (
            <div className="space-y-1.5">
              {run.stages.map((s) => {
                const m = stageStatusMeta(s.status);
                return (
                  <div key={s.id} className="rounded-lg border border-[var(--hairline)] px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-xs font-medium">{s.name}</div>
                        <div className="text-2xs text-faint">{stageKindLabel(s.kind)} · {formatDuration(s.durationMs)}</div>
                      </div>
                      <Pill tone={m.tone} label={m.label} />
                    </div>
                    {s.summary && <p className="mt-1 text-2xs leading-relaxed text-muted">{s.summary}</p>}
                  </div>
                );
              })}
            </div>
          )}

          {!detail?.certification && (
            <p className="mt-4 text-2xs leading-relaxed text-faint">
              Full certification detail is produced by certifying pipelines (Certification, Release Candidate) and kept
              for runs from this session. This run shows its recorded metrics above.
            </p>
          )}
        </div>
      )}
    </Drawer>
  );
}
