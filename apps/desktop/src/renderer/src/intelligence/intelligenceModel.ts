/**
 * Enterprise Intelligence Workspace v1.0 — the intelligence model (pure data; no React, no I/O; tested).
 *
 * The Enterprise Intelligence workspace is a READ-ONLY LENS that composes the already-real intelligence the
 * platform produces — the Enterprise Brain report, the Executive snapshot + Executive Center, NeuroCore system
 * health, release/validation diagnostics, the commercial projection, cloud/enterprise compliance, the AI
 * workforce aggregation, the enterprise module framework, and the ecosystem/developer-platform analytics — and
 * deep-links to the sections that own each surface. It creates NO runtime, engine, or store and duplicates no
 * system. This file only labels/tones/summarises that real data and records — honestly — the executive metrics
 * the platform does NOT source in-app, so the workspace never fabricates a number.
 */
import type { ComplianceFinding, EnterpriseModuleSummary, ExecutiveKpi, SigningState } from '@neuropause/shared';
import type { IconName } from '@renderer/components/ui/Icon';
import type { OpsTone } from '@renderer/operations/lib';

/** The non-null Executive-KPI band union — bands already encode severity. */
export type Band = NonNullable<ExecutiveKpi['band']>;

/* ── status → tone maps (reuse the ops tone system) ─────────────────────────── */

/**
 * A KPI/health/risk band → tone. Bands are severity-ordered, so map directly onto the tone palette:
 * healthy → green, watch → orange, at-risk / critical → red. Nullish (a KPI with no band) → gray, never
 * fabricated as healthy. Accepts the optional band shape so `bandTone(kpi.band)` works at every call site.
 */
export function bandTone(band: Band | null | undefined): OpsTone {
  switch (band) {
    case 'healthy':
      return 'green';
    case 'watch':
      return 'orange';
    case 'at-risk':
      return 'red';
    case 'critical':
      return 'red';
    default:
      return 'gray';
  }
}

/**
 * Generic keyword tone for the many varying string states this lens renders (system-health level, diagnostic
 * status, backend state, compliance status, certification level, workforce state, risk level). Honest and
 * defensive: negatives are checked FIRST because they often contain a positive substring ("unhealthy" ⊃
 * "healthy", "disconnected" ⊃ "connected", "invalid" ⊃ "valid"), which must never read as green. Unknown → gray.
 */
export function stateTone(raw: string | null | undefined): OpsTone {
  const s = (raw ?? '').toLowerCase();
  if (/(critical|invalid|error|fail|offline|blocked|revoked|disconnected|expired|down|denied|unhealthy)/.test(s)) return 'red';
  if (/(degrad|grace|warn|pending|preview|reauth|recover|starting|invited|queued|watch|elevated)/.test(s)) return 'orange';
  if (/(healthy|active|valid|connected|ok|enabled|running|production|pass|trusted|online|completed|allowed)/.test(s)) return 'green';
  return 'gray';
}

/** Short, human code-signing label (the Engineering lens shows only the label). */
export function signingLabel(state: SigningState): string {
  switch (state) {
    case 'signed-notarized':
      return 'Signed & notarized';
    case 'signed':
      return 'Signed';
    case 'unsigned':
      return 'Unsigned';
    case 'not-applicable':
      return 'N/A (dev)';
    default:
      return 'Unknown';
  }
}

/** Code-signing state → tone (signed posture is green, unsigned is a warning, dev/unknown is neutral). */
export function signingTone(state: SigningState): OpsTone {
  switch (state) {
    case 'signed-notarized':
    case 'signed':
      return 'green';
    case 'unsigned':
      return 'orange';
    default:
      return 'gray';
  }
}

/* ── the honest intelligence-gap catalog (executive metrics ABSENT in-app; never fabricated) ── */

/**
 * Why a metric is absent, mapped to the honest badge the UI renders (all tone 'blue'):
 *   telemetry     — the signal exists off-device (CI, per-plugin runtime) but no in-app telemetry channel.
 *   aggregation   — the raw records exist but no roll-up (billing → MRR/ARR, cancellations → churn) is computed.
 *   architecture  — no subsystem produces the metric at all (surveys, cost ledgers, SLA history).
 */
export type IntelGapKind = 'telemetry' | 'aggregation' | 'architecture';

export interface IntelGap {
  /** The lens tab this gap belongs to (matches the workspace tab id, for per-lens filtering). */
  lens: string;
  /** The absent executive metric. */
  metric: string;
  kind: IntelGapKind;
  reason: string;
}

/**
 * Executive metrics the platform does NOT source in-app — each verified ABSENT from the real IPC surface and
 * shown as an honest, labeled "Requires …" row rather than a fabricated figure (the Configuration Visibility
 * Principle applied to intelligence). Covers CI/coverage, MRR/ARR/churn, and per-plugin telemetry, among others.
 */
export const INTELLIGENCE_GAPS: IntelGap[] = [
  { lens: 'engineering', metric: 'CI pipeline & pass rate', kind: 'telemetry', reason: 'No source-control CI reports into the app; the validation dashboard tracks sandbox scenario runs, not repository CI.' },
  { lens: 'engineering', metric: 'Code coverage %', kind: 'telemetry', reason: 'No coverage instrumentation is wired to an IPC channel; coverage is measured in CI, off-device.' },
  { lens: 'commercial', metric: 'MRR / ARR', kind: 'aggregation', reason: 'Metering records session/cloud usage, not billing; there is no revenue aggregation over invoices.' },
  { lens: 'commercial', metric: 'Churn & retention', kind: 'aggregation', reason: 'No time-series of subscription cancellations is aggregated; only current customer health is projected.' },
  { lens: 'developer', metric: 'Per-plugin usage telemetry', kind: 'telemetry', reason: 'Ecosystem analytics count installs and listings; there is no per-plugin runtime usage meter.' },
  { lens: 'business', metric: 'NPS / CSAT', kind: 'architecture', reason: 'No survey or customer-feedback subsystem exists to source satisfaction scores.' },
  { lens: 'ai', metric: 'Token & cost budgets', kind: 'architecture', reason: 'AI usage is tracked in-memory for the session; there is no persisted per-model cost ledger or budget.' },
  { lens: 'operations', metric: 'Cross-run SLA / uptime history', kind: 'aggregation', reason: 'System health is a live snapshot; no historical SLA/uptime series is aggregated on-device.' },
];

export function intelGapKindMeta(kind: IntelGapKind): { label: string; tone: OpsTone; icon: IconName } {
  switch (kind) {
    case 'telemetry':
      return { label: 'Requires telemetry', tone: 'blue', icon: 'pulse' };
    case 'aggregation':
      return { label: 'Requires aggregation', tone: 'blue', icon: 'database' };
    case 'architecture':
      return { label: 'Requires architecture', tone: 'blue', icon: 'layers' };
  }
}

/* ── pure summaries over the real intelligence data ─────────────────────────── */

/** A family roll-up of enterprise modules — grouped by descriptor `group`, counts summed. */
export interface ModuleFamily {
  family: string;
  modules: number;
  records: number;
  active: number;
}

/**
 * Group the enterprise module summaries by their descriptor `group` (e.g. 'Finance', 'Operations'), summing
 * record + active counts per family. Modules with no group fall into 'Other'. Sorted by records desc, then name.
 */
export function groupModulesByFamily(modules: EnterpriseModuleSummary[]): ModuleFamily[] {
  const byFamily = new Map<string, ModuleFamily>();
  for (const m of modules) {
    const family = m.group ?? 'Other';
    const cur = byFamily.get(family) ?? { family, modules: 0, records: 0, active: 0 };
    cur.modules += 1;
    cur.records += m.recordCount;
    cur.active += m.activeCount;
    byFamily.set(family, cur);
  }
  return [...byFamily.values()].sort((a, b) => b.records - a.records || a.family.localeCompare(b.family));
}

/** Severity rank for the KPI bands (higher = worse), for finding the worst band present. */
const BAND_RANK: Record<Band, number> = { healthy: 0, watch: 1, 'at-risk': 2, critical: 3 };

export interface KpiSummary {
  total: number;
  healthy: number;
  watch: number;
  atRisk: number;
  critical: number;
  /** The most severe band present across the KPIs, or null when none carry a band. */
  worst: Band | null;
}

/** Tally executive KPIs by band and surface the worst band present. Un-banded KPIs count only toward `total`. */
export function summarizeKpis(kpis: ExecutiveKpi[]): KpiSummary {
  let healthy = 0;
  let watch = 0;
  let atRisk = 0;
  let critical = 0;
  let worst: Band | null = null;
  for (const k of kpis) {
    const b = k.band;
    if (!b) continue;
    if (b === 'healthy') healthy += 1;
    else if (b === 'watch') watch += 1;
    else if (b === 'at-risk') atRisk += 1;
    else critical += 1;
    if (worst === null || BAND_RANK[b] > BAND_RANK[worst]) worst = b;
  }
  return { total: kpis.length, healthy, watch, atRisk, critical, worst };
}

export interface FindingSummary {
  total: number;
  pass: number;
  warn: number;
  fail: number;
  /** Overall tone: red if any fail, orange if any warn, green otherwise (gray when empty). */
  tone: OpsTone;
}

/** Tally deterministic compliance findings (pass / warn / fail) with an honest overall tone. */
export function summarizeFindings(findings: ComplianceFinding[]): FindingSummary {
  const pass = findings.filter((f) => f.status === 'pass').length;
  const warn = findings.filter((f) => f.status === 'warn').length;
  const fail = findings.filter((f) => f.status === 'fail').length;
  const tone: OpsTone = findings.length === 0 ? 'gray' : fail > 0 ? 'red' : warn > 0 ? 'orange' : 'green';
  return { total: findings.length, pass, warn, fail, tone };
}

/** Mean of a set of 0–100 scores, rounded to an integer (0 for an empty set). Pure. */
export function averageHealth(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}

/** USD formatting for the metered money tiles (2 decimals). Nullish / non-finite → "$0.00". */
export function formatUsd(n: number | null | undefined): string {
  const v = n ?? 0;
  return Number.isFinite(v) ? `$${v.toFixed(2)}` : '$0.00';
}
