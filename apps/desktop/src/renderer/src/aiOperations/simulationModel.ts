/**
 * AI Operating Platform — Simulation tab lens (Phase 3).
 *
 * IDEAL: before executing an action, simulate its expected outcome, risk, business
 * impact, cost, resource usage, and policy violations, attach a calibrated confidence,
 * then recommend.
 *
 * REALITY (from recon): the platform has NO generic pre-execution simulator. There is no
 * simulation engine, automations have no dry-run, and there is no cost/resource forecast,
 * no calibration model, and no forward policy-violation prediction. What genuinely exists
 * and is surfaced here — REAL signals only:
 *   • the continuous-validation pipeline (the platform validating ITSELF) — real totals + pass rate;
 *   • a what-if strategy simulation whose BASELINE is real but whose scenario deltas are
 *     HARDCODED coefficients — surfaced only under an explicit "illustrative, not a prediction" label;
 *   • current metered cost/quota ACTUALS — labeled as current actuals, never a per-action forecast.
 *
 * This is the HIGHEST fabrication-risk tab: "simulation" invites invented outcome/risk/impact/
 * cost/confidence numbers. This model emits NONE. Every stat/row is derived from a real source
 * field; every genuinely-absent capability is an honest {@link OpGap}; the closest real
 * blast-radius / change-impact analysis is deep-linked to the Digital Twin Center rather than
 * re-implemented or faked here. When no real signal is present, the honest empty state shows
 * through (empty stats/groups) while the gaps still explain what would be required.
 *
 * PURE derivation over already-fetched data — no ipc, no React, no DOM.
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
  count,
  pctText,
} from './aiOperationsModel';

/* ─────────────────────────── honest, load-bearing labels ─────────────────────────── */

/**
 * Attached to EVERY what-if row and the what-if group note. The strategy simulation's
 * scenario deltas are hardcoded coefficients, NOT a model prediction — so no scenario value
 * may ever be presented without this exact label.
 */
export const ILLUSTRATIVE_LABEL = 'illustrative coefficient, not a prediction';

/** Attached to every metered-cost row: these are current actuals, never a per-action forecast. */
export const CURRENT_ACTUALS_LABEL = 'current actuals — not a per-action forecast';

/** Marks the single real anchor row inside the what-if group (distinguishes it from illustrative rows). */
export const BASELINE_REAL_NOTE = 'real baseline — measured current state';

/** Stable label for the pass-rate stat (real; higher-is-better via healthTone). */
const PASS_RATE_STAT_LABEL = 'Validation pass rate';

/** Stable title so the view (and tests) can locate the illustrative-only group. */
const WHATIF_GROUP_TITLE = 'What-if (illustrative only)';

/* ─────────────────────────── minimal structural input ─────────────────────────── */
/* Deliberately a MINIMAL structural echo of the real ipc payloads, every field defensively
 * optional. The parent surface fetches the real ipc.* results and passes the relevant slices;
 * this model never invents a field that a real source does not provide. */

/** Structural echo of a `ValidationHistoryEntry` (sandbox continuous-validation). */
export interface SimValidationHistoryEntry {
  passed?: number;
  failed?: number;
  status?: string;
  pipeline?: string;
}

/** Structural echo of `ValidationSummary` — the real continuous-validation projection. */
export interface SimValidationSummary {
  totalRuns?: number;
  latestCertification?: string | null;
  pipelines?: { kind?: string; name?: string; stages?: number; certifies?: boolean }[];
  recent?: SimValidationHistoryEntry[];
}

/** Structural echo of `ValidationDashboard` — richer real continuous-validation projection. */
export interface SimValidationDashboard {
  queueDepth?: number;
  certificationStatus?: string | null;
  latest?: SimValidationHistoryEntry | null;
  history?: SimValidationHistoryEntry[];
}

/** Structural echo of a strategy `ScenarioProjection`. Baseline values are real; scenario deltas are coefficients. */
export interface SimScenarioProjection {
  costUsd?: number;
  riskScore?: number;
  timeDays?: number;
  resourceUtilizationPct?: number;
  complianceScore?: number;
  probabilityPct?: number;
}

/** Structural echo of a strategy `SimulationScenario`. */
export interface SimScenario {
  id?: string;
  name?: string;
  focus?: string;
  projected?: SimScenarioProjection;
  deltaVsBaseline?: SimScenarioProjection;
}

/** Structural echo of `SimulationReport` — baseline REAL, scenario deltas HARDCODED coefficients. */
export interface SimStrategySimulation {
  baseline?: SimScenario | null;
  scenarios?: SimScenario[];
  note?: string;
}

/** Structural echo of `CommercialMetering` — current metered ACTUALS only. */
export interface SimMetering {
  monthlySpend?: number;
  aiCostUsd?: number;
  requests30d?: number;
  currency?: string;
}

/** The already-fetched real slices the Simulation tab derives from. Every field optional. */
export interface SimulationInput {
  /** Real continuous-validation summary (`ipc.sandbox.validationSummary`). */
  validationSummary?: SimValidationSummary;
  /** Real continuous-validation dashboard (`ipc.sandbox.validationDashboard`). */
  validationDashboard?: SimValidationDashboard;
  /** Real baseline + illustrative what-if scenarios (`ipc.strategyPlatform.simulation`). */
  strategySimulation?: SimStrategySimulation;
  /** Real current cost/quota actuals (`ipc.commercial.metering`). */
  metering?: SimMetering;
}

/* ─────────────────────────── pure helpers ─────────────────────────── */

/** Aggregate a REAL pass rate from recorded validation runs. Returns null when there is no real pass/fail data (never fabricates a rate). */
function aggregatePassRate(
  entries: SimValidationHistoryEntry[],
): { passed: number; total: number; ratio: number } | null {
  let passed = 0;
  let failed = 0;
  for (const e of entries) {
    if (e && Number.isFinite(e.passed)) passed += e.passed as number;
    if (e && Number.isFinite(e.failed)) failed += e.failed as number;
  }
  const total = passed + failed;
  if (total <= 0) return null;
  return { passed, total, ratio: passed / total };
}

/** Human label for a certification level (pass/warning/fail). */
function certLabel(level: string): string {
  switch (level) {
    case 'pass':
      return 'Pass';
    case 'warning':
      return 'Warning';
    case 'fail':
      return 'Fail';
    default:
      return level;
  }
}

/** Tone for a certification level. */
function certTone(level: string): OpsTone {
  switch (level) {
    case 'pass':
      return 'green';
    case 'warning':
      return 'orange';
    case 'fail':
      return 'red';
    default:
      return 'gray';
  }
}

/** Format a money actual. Never renders NaN. */
function money(n: number | undefined | null, currency?: string): string {
  if (!Number.isFinite(n)) return '—';
  const rounded = Math.round(n as number);
  const sign = rounded < 0 ? '-' : '';
  const body = Math.abs(rounded).toLocaleString('en-US');
  if (!currency || currency === 'USD') return `${sign}$${body}`;
  return `${sign}${body} ${currency}`;
}

/**
 * Build a what-if row for a scenario. The value is a STRUCTURAL descriptor (the scenario's real
 * focus/name) — never a coefficient number — and the row ALWAYS carries {@link ILLUSTRATIVE_LABEL}.
 * This makes it structurally impossible to emit a scenario value without the honest label.
 */
function illustrativeScenarioRow(s: SimScenario, index: number): OpRow {
  const name =
    (typeof s.name === 'string' && s.name) ||
    (typeof s.id === 'string' && s.id) ||
    `Scenario ${index + 1}`;
  const focus = typeof s.focus === 'string' && s.focus ? s.focus : 'what-if';
  return {
    label: name,
    value: `what-if · ${focus}`,
    tone: 'gray',
    sub: ILLUSTRATIVE_LABEL,
  };
}

/** The four genuine capability absences of this tab — present regardless of input (real architectural gaps). */
function simulationGaps(): OpGap[] {
  return [
    {
      capability: 'Generic pre-execution simulator',
      requires: 'a simulation engine — none exists; automations have no dry-run',
      note:
        'Real simulators are domain-scoped (manufacturing APS what-if, IaC plan, migration dry-run) and do not generalize to an arbitrary action. The closest blast-radius / change-impact analysis lives in the Digital Twin Center.',
    },
    {
      capability: 'Per-action cost & resource forecast',
      requires: 'a cost/resource model — only current aggregate actuals exist',
    },
    {
      capability: 'Calibrated confidence',
      requires: 'a calibration model',
    },
    {
      capability: 'Policy-violation prediction from a hypothetical action',
      requires: 'forward simulation — only current-state policy/compliance evaluation exists',
    },
  ];
}

/** Canonical deep-links: reuse the real surfaces rather than duplicate them here. */
function simulationLinks(): OpLink[] {
  return [
    { label: 'Sandbox & Validation', section: 'sandbox', icon: 'beaker' },
    { label: 'Digital Twin scenarios', section: 'twin-center', icon: 'layers' },
  ];
}

/* ─────────────────────────── the lens ─────────────────────────── */

/**
 * Derive the Simulation tab's view-ready lens from already-fetched REAL data.
 *
 * Groups (all real-backed or explicitly labeled):
 *   • 'Platform validation (real)'      — continuous-validation totals + pass rate.
 *   • 'What-if (illustrative only)'      — real baseline anchor + scenario rows, each labeled illustrative.
 *   • 'Cost context (current actuals)'   — metered actuals, never a per-action forecast.
 * Gaps: the four genuine absences (no generic simulator / cost model / calibration / forward policy sim).
 * Links: Sandbox & Validation, Digital Twin scenarios.
 */
export function summarizeSimulation(input: SimulationInput): OpLens {
  const { validationSummary, validationDashboard, strategySimulation, metering } = input ?? {};

  const stats: OpStat[] = [];
  const groups: OpGroup[] = [];

  /* ── Platform validation (real) ── */
  {
    const vs = validationSummary;
    const vd = validationDashboard;

    // Prefer the richer dashboard history; fall back to the summary's recent runs; then the single latest.
    // Never combine sources (that would double-count real runs).
    let entries: SimValidationHistoryEntry[] = [];
    if (vd?.history?.length) entries = vd.history;
    else if (vs?.recent?.length) entries = vs.recent;
    else if (vd?.latest) entries = [vd.latest];

    const passRate = aggregatePassRate(entries);
    const totalRuns = vs?.totalRuns;
    const pipelines = vs?.pipelines ?? [];
    const cert =
      (vd && vd.certificationStatus != null ? vd.certificationStatus : undefined) ??
      (vs && vs.latestCertification != null ? vs.latestCertification : undefined);

    const rows: OpRow[] = [];
    if (Number.isFinite(totalRuns)) {
      rows.push({ label: 'Validation runs recorded', value: count(totalRuns) });
    }
    if (pipelines.length) {
      const certifying = pipelines.filter((p) => p?.certifies).length;
      rows.push({
        label: 'Validation pipelines',
        value: count(pipelines.length),
        sub: `${count(certifying)} certify a release`,
      });
    }
    if (passRate) {
      rows.push({
        label: 'Stage pass rate (recorded runs)',
        value: pctText(passRate.ratio),
        tone: healthTone(passRate.ratio),
        sub: `${count(passRate.passed)} of ${count(passRate.total)} stages passed`,
      });
    }
    if (cert) {
      rows.push({ label: 'Latest certification', value: certLabel(cert), tone: certTone(cert) });
    }
    if (Number.isFinite(vd?.queueDepth)) {
      rows.push({ label: 'Validation queue depth', value: count(vd?.queueDepth) });
    }

    if (rows.length) {
      groups.push({
        title: 'Platform validation (real)',
        rows,
        note:
          'Real results from the continuous-validation pipeline — the platform validating itself. Not a forecast of a hypothetical action.',
      });
    }

    // Real-backed headline stats.
    if (passRate) {
      stats.push({
        icon: 'gauge',
        label: PASS_RATE_STAT_LABEL,
        value: pctText(passRate.ratio),
        tone: healthTone(passRate.ratio),
        hint: 'real — continuous-validation pipeline',
      });
    }
    if (Number.isFinite(totalRuns)) {
      stats.push({
        icon: 'beaker',
        label: 'Validation runs',
        value: count(totalRuns),
        hint: 'real — recorded pipeline runs',
      });
    }
  }

  /* ── What-if (illustrative only) ── */
  {
    const sim = strategySimulation;
    if (sim) {
      const rows: OpRow[] = [];

      // Real anchor: the baseline reflects measured current state. No fabricated number is emitted —
      // just the honest fact that a real baseline exists (distinct from the illustrative scenarios).
      if (sim.baseline) {
        rows.push({
          label: 'Baseline',
          value: 'current strategic state',
          tone: 'gray',
          sub: BASELINE_REAL_NOTE,
        });
      }

      // Illustrative scenarios: every row carries ILLUSTRATIVE_LABEL and no coefficient number.
      (sim.scenarios ?? []).forEach((s, i) => {
        if (s) rows.push(illustrativeScenarioRow(s, i));
      });

      if (rows.length) {
        groups.push({
          title: WHATIF_GROUP_TITLE,
          rows,
          note:
            `Only the baseline reflects real current state. Every scenario delta is an ${ILLUSTRATIVE_LABEL} — a hardcoded coefficient, not simulated by any engine. No outcome, risk, cost, or confidence value here is a prediction.`,
        });

        const scenarioCount = (sim.scenarios ?? []).filter(Boolean).length;
        if (scenarioCount > 0) {
          stats.push({
            icon: 'lightbulb',
            label: 'What-if scenarios',
            value: count(scenarioCount),
            tone: 'gray',
            hint: 'illustrative coefficients — not predictions',
          });
        }
      }
    }
  }

  /* ── Cost context (current actuals) ── */
  {
    const m = metering;
    if (m) {
      const rows: OpRow[] = [];
      if (Number.isFinite(m.monthlySpend)) {
        rows.push({ label: 'Monthly spend', value: money(m.monthlySpend, m.currency), sub: CURRENT_ACTUALS_LABEL });
      }
      if (Number.isFinite(m.aiCostUsd)) {
        rows.push({ label: 'AI cost', value: money(m.aiCostUsd, m.currency), sub: CURRENT_ACTUALS_LABEL });
      }
      if (Number.isFinite(m.requests30d)) {
        rows.push({ label: 'Requests (30d)', value: count(m.requests30d), sub: CURRENT_ACTUALS_LABEL });
      }

      if (rows.length) {
        groups.push({
          title: 'Cost context (current actuals)',
          rows,
          note:
            'Current metered actuals — NOT a per-action cost forecast. No model forecasts the cost or resource use of a hypothetical action.',
        });

        if (Number.isFinite(m.monthlySpend)) {
          stats.push({
            icon: 'analytics',
            label: 'Monthly spend',
            value: money(m.monthlySpend, m.currency),
            hint: 'real — current actuals',
          });
        }
      }
    }
  }

  return {
    stats,
    groups,
    gaps: simulationGaps(),
    links: simulationLinks(),
  };
}
