/**
 * Sandbox workspace — pure view-model (P4 Validation Experience).
 *
 * Every derivation the Sandbox UI needs that isn't rendering: status/severity/band → tone+label
 * maps, number/duration/relative-time formatters, safe metric reads off a persisted run, run
 * headline projection, and the reasoning-summary sanitiser that enforces the P4 rule "never expose
 * chain-of-thought — show only user-facing reasoning summaries". No React, no DOM, no `@renderer`
 * imports: it depends only on the shared domain types, so it is verified by the Node test gate.
 */
import type {
  CertificationLevel,
  ExecutionStatus,
  PipelineKind,
  RegressionSeverity,
  StageKind,
  StageStatus,
  TrendDirection,
  ValidationRun,
  ValidationRunStatus,
} from '@neuropause/shared';

/** Mirrors the Operations tone union so panels can hand these straight to the shared primitives. */
export type SandboxTone = 'green' | 'orange' | 'red' | 'blue' | 'purple' | 'accent' | 'gray';

export interface ToneLabel {
  label: string;
  tone: SandboxTone;
}

/* ─────────────────────────── status / level → tone + label ─────────────────────────── */

export function certMeta(level: CertificationLevel | null): ToneLabel {
  switch (level) {
    case 'pass':
      return { label: 'Certified', tone: 'green' };
    case 'warning':
      return { label: 'Certified · warnings', tone: 'orange' };
    case 'fail':
      return { label: 'Not certified', tone: 'red' };
    default:
      return { label: 'Uncertified', tone: 'gray' };
  }
}

export function runStatusMeta(status: ValidationRunStatus): ToneLabel {
  switch (status) {
    case 'passed':
      return { label: 'Passed', tone: 'green' };
    case 'warning':
      return { label: 'Warning', tone: 'orange' };
    case 'failed':
      return { label: 'Failed', tone: 'red' };
    case 'error':
      return { label: 'Error', tone: 'red' };
    case 'running':
      return { label: 'Running', tone: 'blue' };
  }
}

export function execStatusMeta(status: ExecutionStatus): ToneLabel {
  switch (status) {
    case 'passed':
      return { label: 'Passed', tone: 'green' };
    case 'failed':
      return { label: 'Failed', tone: 'red' };
    case 'error':
      return { label: 'Error', tone: 'red' };
    case 'timed_out':
      return { label: 'Timed out', tone: 'orange' };
    case 'cancelled':
      return { label: 'Cancelled', tone: 'gray' };
    case 'running':
      return { label: 'Running', tone: 'blue' };
    case 'queued':
      return { label: 'Queued', tone: 'gray' };
  }
}

export function stageStatusMeta(status: StageStatus): ToneLabel {
  switch (status) {
    case 'pass':
      return { label: 'Pass', tone: 'green' };
    case 'warn':
      return { label: 'Warn', tone: 'orange' };
    case 'fail':
      return { label: 'Fail', tone: 'red' };
    case 'error':
      return { label: 'Error', tone: 'red' };
    case 'skipped':
      return { label: 'Skipped', tone: 'gray' };
  }
}

export function severityMeta(sev: RegressionSeverity): ToneLabel {
  switch (sev) {
    case 'critical':
      return { label: 'Critical', tone: 'red' };
    case 'major':
      return { label: 'Major', tone: 'orange' };
    case 'minor':
      return { label: 'Minor', tone: 'blue' };
    case 'info':
      return { label: 'Info', tone: 'gray' };
  }
}

export function bandTone(band: 'healthy' | 'watch' | 'at-risk' | 'critical'): SandboxTone {
  switch (band) {
    case 'healthy':
      return 'green';
    case 'watch':
      return 'orange';
    case 'at-risk':
      return 'orange';
    case 'critical':
      return 'red';
  }
}

export interface TrendMeta {
  label: string;
  tone: SandboxTone;
  /** A plain arrow glyph safe to render anywhere (no icon dependency). */
  glyph: string;
  /** Positive = improving, 0 = stable, negative = declining. */
  direction: 1 | 0 | -1;
}

export function trendMeta(dir: TrendDirection): TrendMeta {
  switch (dir) {
    case 'improving':
      return { label: 'Improving', tone: 'green', glyph: '↑', direction: 1 };
    case 'declining':
      return { label: 'Declining', tone: 'red', glyph: '↓', direction: -1 };
    case 'stable':
      return { label: 'Stable', tone: 'gray', glyph: '→', direction: 0 };
  }
}

export function stageKindLabel(kind: StageKind): string {
  switch (kind) {
    case 'scenario':
      return 'Enterprise Scenario';
    case 'ai-qa':
      return 'AI QA';
    case 'lab':
      return 'Performance & Security';
  }
}

export function pipelineLabel(kind: PipelineKind): string {
  return kind
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/* ─────────────────────────── formatters ─────────────────────────── */

export function passRatePct(rate: number | null): string {
  if (rate === null || !Number.isFinite(rate)) return '—';
  return `${Math.round(Math.max(0, Math.min(1, rate)) * 100)}%`;
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)}s`;
  const m = Math.floor(s / 60);
  const rem = Math.round(s % 60);
  if (m < 60) return `${m}m ${rem}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

export function formatInt(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return Math.round(n).toLocaleString('en-US');
}

/** Milliseconds → a compact latency label. */
export function formatMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms <= 0) return '—';
  if (ms < 1) return '<1 ms';
  return `${Math.round(ms)} ms`;
}

export function relativeTime(iso: string | null | undefined, nowMs: number): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '—';
  const diff = nowMs - t;
  if (diff < 0) return 'scheduled';
  const s = Math.floor(diff / 1000);
  if (s < 45) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 1) return `${s}s ago`;
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
}

/* ─────────────────────────── run projections ─────────────────────────── */

/** Safe read of a numeric metric off a persisted run (metrics are best-effort). */
export function metricOf(run: Pick<ValidationRun, 'metrics'>, key: string, fallback = 0): number {
  const v = run.metrics[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

export interface RunHeadline {
  pipeline: PipelineKind;
  status: ValidationRunStatus;
  statusMeta: ToneLabel;
  durationLabel: string;
  latencyLabel: string;
  securityFailures: number;
  aiQaBugs: number;
  scenarioTotal: number;
  scenarioPassed: number;
  regressionCount: number;
  certificationLevel: CertificationLevel | null;
}

/** Condense a run (persisted or freshly produced) into the headline numbers the panels show. */
export function runHeadline(run: ValidationRun): RunHeadline {
  return {
    pipeline: run.pipeline,
    status: run.status,
    statusMeta: runStatusMeta(run.status),
    durationLabel: formatDuration(run.durationMs),
    latencyLabel: formatMs(metricOf(run, 'latencyP95Ms', 0) || null),
    securityFailures: metricOf(run, 'securityFailures', 0),
    aiQaBugs: metricOf(run, 'aiQaBugs', 0),
    scenarioTotal: metricOf(run, 'scenarioTotal', 0),
    scenarioPassed: metricOf(run, 'scenarioPassed', 0),
    regressionCount: run.regressionCount ?? metricOf(run, 'regressionCount', 0),
    certificationLevel: run.certificationLevel,
  };
}

/* ─────────────────────────── STEP 5: reasoning summaries only ─────────────────────────── */

const COT_BLOCK = /<(?:think|thinking|scratchpad|reasoning|cot)\b[^>]*>[\s\S]*?<\/(?:think|thinking|scratchpad|reasoning|cot)>/gi;
const COT_LABEL_LINE = /^\s*(?:chain[-\s]?of[-\s]?thought|thinking|thought|reasoning|scratchpad|internal|let me think|step[-\s]?by[-\s]?step)\s*[:>-].*$/gim;

/**
 * Enforce the P4 rule: the UI shows only a user-facing reasoning SUMMARY, never chain-of-thought.
 * This strips any embedded `<think>`-style blocks and leading internal-reasoning label lines,
 * collapses whitespace, and caps the length. Given already-clean summary text it is a no-op
 * (beyond trimming). It never throws and always returns a safe display string.
 */
export function reasoningSummary(raw: string | null | undefined, maxLen = 240): string {
  if (!raw) return '';
  let s = String(raw).replace(COT_BLOCK, ' ').replace(COT_LABEL_LINE, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  if (s.length <= maxLen) return s;
  return `${s.slice(0, maxLen - 1).trimEnd()}…`;
}

/** True when a string carries chain-of-thought markers this UI must not surface verbatim. */
export function containsChainOfThought(raw: string | null | undefined): boolean {
  if (!raw) return false;
  COT_BLOCK.lastIndex = 0;
  COT_LABEL_LINE.lastIndex = 0;
  return COT_BLOCK.test(raw) || COT_LABEL_LINE.test(raw);
}
