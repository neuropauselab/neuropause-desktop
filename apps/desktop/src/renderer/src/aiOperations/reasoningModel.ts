/**
 * Reasoning lens — AI Operating Platform, Phase 3.
 *
 * A PURE, IO-free derivation over three EXISTING read-only ipc returns:
 *   - ipc.strategyPlatform.reasoning()           -> ReasoningReport   (findings: severity + evidence[])
 *   - ipc.enterpriseIntel.report()               -> EnterpriseIntelligenceReport (recommendations + evidence[])
 *   - ipc.intelligence.executiveCenterSnapshot() -> ExecutiveCenterSnapshot (recommendations? + evidence[])
 *
 * It reasons ABOUT the platform's reasoning: how many findings/recommendations were
 * produced, how they split by real severity, and — the dominant signal — how much of
 * that reasoning is EVIDENCE-GROUNDED (carries >=1 real evidence reference). Every stat
 * and row reads a REAL field on one of those returns; no metric is invented. The two
 * things the reasoning layer genuinely cannot do are surfaced as honest OpGaps rather
 * than faked numbers:
 *   - LLM-narrated explanation  (findings are deterministic/templated, not generated prose)
 *   - Calibrated confidence     (confidence is heuristic: evidence-count / fixed constants)
 *
 * Confidence IS a real field, but it is HEURISTIC at the source (mean of per-finding
 * heuristic confidences — see main/strategy/strategyModel.buildReasoningReport, which
 * returns 1.0 for an empty report). Wherever confidence is surfaced here it is LABELED
 * 'heuristic' and is only shown when findings actually exist, so the empty-report 1.0
 * artifact is never presented as certainty. When every source is empty the lens shows
 * an honest empty state (no stats/groups) while the architectural gaps + reuse links —
 * which are truths independent of data — persist.
 */
import {
  type OpStat,
  type OpRow,
  type OpGroup,
  type OpGap,
  type OpLink,
  type OpLens,
  type OpsTone,
  healthTone,
  riskTone,
  count,
  pctText,
} from './aiOperationsModel';

/* ── Minimal structural input (every field defensively optional) ──────────────── */

/** Structural subset of ReasoningFinding (strategyPlatform.reasoning().findings[]). */
export interface ReasoningFindingLike {
  dimension?: string;
  title?: string;
  /** StrategyBand: 'healthy' | 'watch' | 'at-risk' | 'critical'. */
  severity?: string;
  /** 0..1 — HEURISTIC at the source, never calibrated. */
  confidence?: number;
  /** Real platform ids / signal keys backing the finding. */
  evidence?: readonly unknown[];
}

/** Structural subset of ReasoningReport (strategyPlatform.reasoning()). */
export interface ReasoningReportLike {
  findings?: readonly ReasoningFindingLike[];
  /** 0..1 mean finding confidence — HEURISTIC (1.0 when there are no findings). */
  confidence?: number;
}

/** Structural subset of any evidence-bearing recommendation (intel + executive). */
export interface RecommendationLike {
  /** 'critical' | 'high' | 'medium' | 'low' in the real types. */
  priority?: string;
  /** Real ids / references backing the recommendation. */
  evidence?: readonly unknown[];
}

/** Structural subset of EnterpriseIntelligenceReport (enterpriseIntel.report()). */
export interface IntelReportLike {
  recommendations?: readonly RecommendationLike[];
}

/** Structural subset of ExecutiveCenterSnapshot (intelligence.executiveCenterSnapshot()). */
export interface ExecutiveSnapshotLike {
  /** Optional in the real type — always guard. */
  recommendations?: readonly RecommendationLike[];
}

/** The three real read-only signals this lens composes. All optional/defensive. */
export interface ReasoningInput {
  reasoning?: ReasoningReportLike | null;
  intel?: IntelReportLike | null;
  executive?: ExecutiveSnapshotLike | null;
}

/* ── Severity vocabulary (StrategyBand, higher = worse) ───────────────────────── */

const SEVERITY_ORDER = ['critical', 'at-risk', 'watch', 'healthy'] as const;
type Severity = (typeof SEVERITY_ORDER)[number];

const SEVERITY_LABEL: Record<Severity, string> = {
  critical: 'Critical',
  'at-risk': 'At risk',
  watch: 'Watch',
  healthy: 'Healthy',
};

function severityTone(sev: Severity): OpsTone {
  switch (sev) {
    case 'critical':
      return 'red';
    case 'at-risk':
      return 'orange';
    case 'watch':
      return 'blue';
    case 'healthy':
      return 'green';
  }
}

/* ── Evidence-grounding helpers ───────────────────────────────────────────────── */

interface Coverage {
  grounded: number;
  total: number;
}

function isFiniteNumber(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

/** A unit is grounded when it carries at least one non-empty evidence reference. */
function isGrounded(unit: { evidence?: readonly unknown[] } | null | undefined): boolean {
  const ev = unit?.evidence;
  return Array.isArray(ev) && ev.some((r) => r != null && String(r).trim() !== '');
}

function coverage(
  units: readonly { evidence?: readonly unknown[] }[],
): Coverage {
  let grounded = 0;
  for (const u of units) if (isGrounded(u)) grounded += 1;
  return { grounded, total: units.length };
}

/** grounded/total as a 0..1 ratio, or NaN when there is nothing to cover. */
function coverageRatio(c: Coverage): number {
  return c.total > 0 ? c.grounded / c.total : Number.NaN;
}

function coverageRow(label: string, c: Coverage): OpRow {
  const r = coverageRatio(c);
  return {
    label,
    value: pctText(r),
    tone: healthTone(r),
    sub: `${count(c.grounded)} of ${count(c.total)} grounded`,
  };
}

function severityCounts(findings: readonly ReasoningFindingLike[]): Record<Severity, number> {
  const counts: Record<Severity, number> = { critical: 0, 'at-risk': 0, watch: 0, healthy: 0 };
  for (const f of findings) {
    const s = f?.severity;
    if (s === 'critical' || s === 'at-risk' || s === 'watch' || s === 'healthy') counts[s] += 1;
  }
  return counts;
}

function priorityCounts(recs: readonly RecommendationLike[]): { critical: number; high: number } {
  let critical = 0;
  let high = 0;
  for (const r of recs) {
    if (r?.priority === 'critical') critical += 1;
    else if (r?.priority === 'high') high += 1;
  }
  return { critical, high };
}

/* ── Always-present honesty: architectural gaps + canonical reuse links ───────── */

const GAPS: OpGap[] = [
  {
    capability: 'LLM-narrated explanation',
    requires:
      'wiring the existing AI engine into the reasoning layer — reasoning today is deterministic/templated',
    note: 'Findings are composed from fixed templates over real signals, not generated prose.',
  },
  {
    capability: 'Calibrated confidence',
    requires:
      'a calibration model — confidence today is heuristic (evidence-count / fixed constants)',
    note: 'Surfaced confidence is labeled heuristic and must not be read as calibrated probability.',
  },
];

const LINKS: OpLink[] = [
  { label: 'Strategy Reasoning', section: 'strategy-center', icon: 'sparkles' },
  { label: 'Founder intelligence', section: 'operations', icon: 'gauge' },
  { label: 'Enterprise Intelligence', section: 'intelligence', icon: 'lightbulb' },
];

/* ── The lens ─────────────────────────────────────────────────────────────────── */

export function summarizeReasoning(input: ReasoningInput): OpLens {
  const reasoning = input?.reasoning ?? null;
  const intel = input?.intel ?? null;
  const executive = input?.executive ?? null;

  const findings: readonly ReasoningFindingLike[] =
    reasoning && Array.isArray(reasoning.findings) ? reasoning.findings : [];
  const intelRecs: readonly RecommendationLike[] =
    intel && Array.isArray(intel.recommendations) ? intel.recommendations : [];
  const execRecs: readonly RecommendationLike[] =
    executive && Array.isArray(executive.recommendations) ? executive.recommendations : [];

  const findingCov = coverage(findings);
  const intelCov = coverage(intelRecs);
  const execCov = coverage(execRecs);
  const overall: Coverage = {
    grounded: findingCov.grounded + intelCov.grounded + execCov.grounded,
    total: findingCov.total + intelCov.total + execCov.total,
  };

  // Honest empty state: no reasoned unit exists on ANY source. Gaps + reuse links are
  // architectural truths (independent of data) and persist; stats/groups stay empty.
  if (overall.total === 0) {
    return { stats: [], groups: [], gaps: GAPS, links: LINKS };
  }

  const sev = severityCounts(findings);
  const highSeverity = sev.critical + sev['at-risk'];
  const crossModuleTotal = intelCov.total + execCov.total;

  const dimensions = new Set<string>();
  for (const f of findings) {
    if (typeof f?.dimension === 'string' && f.dimension) dimensions.add(f.dimension);
  }

  // Report confidence is HEURISTIC and only meaningful when findings exist (the source
  // returns 1.0 for an empty report — never surface that as certainty).
  const reportConfidence: number | undefined =
    reasoning && isFiniteNumber(reasoning.confidence) ? reasoning.confidence : undefined;

  /* stats — every value reads a real field */
  const stats: OpStat[] = [];

  if (findingCov.total > 0) {
    stats.push({
      icon: 'lightbulb',
      label: 'Reasoning findings',
      value: count(findingCov.total),
      tone: riskTone(highSeverity / findingCov.total),
      hint: `${count(dimensions.size)} dimension(s), ${count(highSeverity)} critical/at-risk`,
    });
  }

  // Dominant signal: evidence coverage across every reasoned unit.
  stats.push({
    icon: 'checklist',
    label: 'Evidence coverage',
    value: pctText(coverageRatio(overall)),
    tone: healthTone(coverageRatio(overall)),
    hint: `${count(overall.grounded)}/${count(overall.total)} carry >=1 evidence ref`,
  });

  if (crossModuleTotal > 0) {
    stats.push({
      icon: 'layers',
      label: 'Cross-module signals',
      value: count(crossModuleTotal),
      tone: 'blue',
      hint: `${count(intelCov.total)} intelligence, ${count(execCov.total)} executive rec(s)`,
    });
  }

  if (findingCov.total > 0 && reportConfidence !== undefined) {
    stats.push({
      icon: 'pulse',
      label: 'Confidence (heuristic)',
      value: pctText(reportConfidence),
      tone: healthTone(reportConfidence),
      hint: 'heuristic - evidence-count / fixed constants, not calibrated',
    });
  }

  /* groups */
  const groups: OpGroup[] = [];

  // Group 1 — Reasoning findings: real severity split.
  if (findingCov.total > 0) {
    const rows: OpRow[] = [];
    for (const band of SEVERITY_ORDER) {
      if (sev[band] > 0) {
        rows.push({ label: SEVERITY_LABEL[band], value: count(sev[band]), tone: severityTone(band) });
      }
    }
    if (rows.length > 0) {
      groups.push({
        title: 'Reasoning findings',
        rows,
        note: `${count(findingCov.total)} finding(s) across ${count(dimensions.size)} dimension(s)`,
      });
    }
  }

  // Group 2 — Evidence coverage: grounded vs total per source (the dominant lens).
  {
    const rows: OpRow[] = [];
    if (findingCov.total > 0) rows.push(coverageRow('Reasoning findings', findingCov));
    if (intelCov.total > 0) rows.push(coverageRow('Intelligence recommendations', intelCov));
    if (execCov.total > 0) rows.push(coverageRow('Executive recommendations', execCov));
    if (rows.length > 1) rows.push(coverageRow('Overall', overall));
    if (rows.length > 0) {
      groups.push({
        title: 'Evidence coverage',
        rows,
        note: 'Grounded = carries >=1 real evidence reference',
      });
    }
  }

  // Group 3 — Cross-module signals: intel report + executive snapshot recommendations.
  {
    const rows: OpRow[] = [];
    if (intelCov.total > 0) {
      const p = priorityCounts(intelRecs);
      rows.push({
        label: 'Enterprise intelligence',
        value: `${count(intelCov.total)} rec(s)`,
        tone: p.critical > 0 ? 'red' : p.high > 0 ? 'orange' : 'gray',
        sub: `${count(p.critical)} critical, ${count(p.high)} high, ${count(intelCov.grounded)} grounded`,
      });
    }
    if (execCov.total > 0) {
      const p = priorityCounts(execRecs);
      rows.push({
        label: 'Executive center',
        value: `${count(execCov.total)} rec(s)`,
        tone: p.critical > 0 ? 'red' : p.high > 0 ? 'orange' : 'gray',
        sub: `${count(p.critical)} critical, ${count(p.high)} high, ${count(execCov.grounded)} grounded`,
      });
    }
    if (rows.length > 0) groups.push({ title: 'Cross-module signals', rows });
  }

  return { stats, groups, gaps: GAPS, links: LINKS };
}
