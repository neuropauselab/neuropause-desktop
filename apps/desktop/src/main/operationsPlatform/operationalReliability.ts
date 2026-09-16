/**
 * S122 — Operational Reliability Intelligence (pure, deterministic).
 *
 * A READ-ONLY projection over the EXISTING tenant-scoped `DurableCommandJournal` records — the same
 * committed-command / outbox evidence the operator already reads via `QueryOperationalHistory` and
 * `QueryDeliveryOperations`. It computes the platform's *delivery-reliability posture*: per-status and
 * per-command-type counts, the definitional success / delivery-failure ratios, retry pressure, and the
 * recurring outbox error signatures — turning raw outbox rows into operator-actionable reliability
 * intelligence.
 *
 * WHAT THIS HARVESTS (concept, not architecture): the reliability-engineering / SLO concept from the
 * unwired `packages/reliability` spine (S106/S107 Rule 3 — never drag in a second infra spine). The
 * OPTIONAL request-based error budget reuses the ALREADY-HARVESTED pure calculator
 * `operationsPlatform/errorBudget.ts` (`computeErrorBudget`, itself harvested from
 * `packages/reliability/src/slo.ts`) — giving that previously-unwired harvest its first real caller.
 *
 * DISCIPLINE:
 *   • PURE + TOTAL: no store, no clock, no I/O, no mutation. Every input maps to a defined output.
 *   • DEFINITIONAL, never invented policy: the counts and ratios are arithmetic facts about the rows.
 *     A healthy/at-risk/breached VERDICT requires an explicit SLO `objective` supplied by the caller;
 *     with no objective it is simply not computed (no fabricated target — see DECISION-MEMO-S122).
 *   • TENANT-SAFE by construction: the caller passes rows ALREADY scoped to the server-resolved tenant
 *     (`journal.records(tenantId)`); this module neither resolves nor trusts any tenant claim.
 *   • CREDENTIAL-FREE: only ids / types / statuses / counts / trimmed error strings are surfaced —
 *     never a command payload/result, never a secret (the domain commands carry none regardless).
 */
import type { CommittedCommand } from '../platform/command/durableCommandJournal';
import { computeErrorBudget, AT_RISK_BURN, type ErrorBudgetStatus } from './errorBudget';

/** Cap on how many distinct error signatures we surface — bounded, never "return everything". */
export const MAX_ERROR_SIGNATURES = 10;

/** Trim an error string to a bounded, log-safe signature (mirrors operationalRead.trimError). */
export function errorSignature(e: string): string {
  return String(e).slice(0, 200);
}

export interface CommandTypeReliability {
  commandType: string;
  total: number;
  delivered: number;
  pending: number;
  processing: number;
  retryable: number;
  /** total outbox delivery attempts across this command type. */
  attempts: number;
  /** records that took more than one attempt. */
  retried: number;
  /** records that have EVER recorded a delivery error (includes ones later delivered). */
  everErrored: number;
}

export interface ErrorSignatureRollup {
  signature: string;
  count: number;
}

/**
 * The request-based error budget, present ONLY when the caller supplies a real SLO `objective`.
 * "Request-based" = the window is the total number of governed deliveries and the consumed budget is
 * the number currently failing (RETRYABLE) — a standard SRE request-based SLO. Delegates the math to
 * the harvested `computeErrorBudget`; fields are re-projected into count units (never ms) for honesty.
 */
export interface ReliabilityBudget {
  /** success objective in [0,1] supplied by the caller. */
  objective: number;
  /** total governed deliveries in the window (denominator). */
  totalRequests: number;
  /** tolerated failures = round((1−objective)·total). */
  budgetFailures: number;
  /** observed failures currently consuming the budget (RETRYABLE). */
  consumedFailures: number;
  /** budget left = max(0, budget − consumed). */
  remainingFailures: number;
  /** consumed / budget (>1 ⇒ over budget). */
  burnRate: number;
  status: ErrorBudgetStatus;
}

export interface ReliabilitySummary {
  totals: {
    commands: number;
    delivered: number;
    pending: number;
    processing: number;
    retryable: number;
    /** sum of outbox attempts across all commands. */
    attempts: number;
    /** commands that took more than one attempt. */
    retried: number;
    /** commands that have ever recorded a delivery error. */
    everErrored: number;
  };
  /** delivered / commands, in [0,1]; 0 when there are no commands. Definitional fact, not a verdict. */
  successRatio: number;
  /** retryable / commands, in [0,1]; 0 when there are no commands. Definitional fact, not a verdict. */
  deliveryFailureRatio: number;
  /** per-command-type rollup, sorted by most-at-risk (retryable desc, then total desc). */
  byCommandType: CommandTypeReliability[];
  /** recurring outbox error signatures, most-frequent first, bounded to MAX_ERROR_SIGNATURES. */
  topErrors: ErrorSignatureRollup[];
  /** present only when an SLO objective was supplied — otherwise absent (no invented target). */
  budget?: ReliabilityBudget;
}

export interface ReliabilityOptions {
  /** optional SLO success objective in [0,1]; if omitted, no verdict/budget is computed. */
  objective?: number;
  /** optional at-risk burn threshold; defaults to the harvested AT_RISK_BURN display default. */
  atRiskBurn?: number;
}

const ratio = (num: number, den: number): number => (den > 0 ? num / den : 0);

/**
 * Summarize the delivery-reliability posture of a set of ALREADY-tenant-scoped committed commands.
 * Pure and total. Passing `options.objective` additionally computes a request-based error budget via
 * the harvested `computeErrorBudget`.
 */
export function summarizeReliability(
  records: readonly CommittedCommand[],
  options: ReliabilityOptions = {},
): ReliabilitySummary {
  const totals = { commands: 0, delivered: 0, pending: 0, processing: 0, retryable: 0, attempts: 0, retried: 0, everErrored: 0 };
  const byType = new Map<string, CommandTypeReliability>();
  const errorCounts = new Map<string, number>();

  for (const rec of records) {
    const status = rec.outbox.status;
    const attempts = Number.isFinite(rec.outbox.attempts) ? rec.outbox.attempts : 0;
    const hasError = typeof rec.outbox.lastError === 'string' && rec.outbox.lastError.length > 0;

    totals.commands += 1;
    totals.attempts += attempts;
    if (attempts > 1) totals.retried += 1;
    if (hasError) totals.everErrored += 1;
    if (status === 'DELIVERED') totals.delivered += 1;
    else if (status === 'PENDING') totals.pending += 1;
    else if (status === 'PROCESSING') totals.processing += 1;
    else if (status === 'RETRYABLE') totals.retryable += 1;

    const t = byType.get(rec.commandType) ?? {
      commandType: rec.commandType, total: 0, delivered: 0, pending: 0, processing: 0, retryable: 0, attempts: 0, retried: 0, everErrored: 0,
    };
    t.total += 1;
    t.attempts += attempts;
    if (attempts > 1) t.retried += 1;
    if (hasError) t.everErrored += 1;
    if (status === 'DELIVERED') t.delivered += 1;
    else if (status === 'PENDING') t.pending += 1;
    else if (status === 'PROCESSING') t.processing += 1;
    else if (status === 'RETRYABLE') t.retryable += 1;
    byType.set(rec.commandType, t);

    if (hasError) {
      const sig = errorSignature(rec.outbox.lastError as string);
      errorCounts.set(sig, (errorCounts.get(sig) ?? 0) + 1);
    }
  }

  const byCommandType = [...byType.values()].sort(
    (a, b) => b.retryable - a.retryable || b.total - a.total || a.commandType.localeCompare(b.commandType),
  );

  const topErrors = [...errorCounts.entries()]
    .map(([signature, count]) => ({ signature, count }))
    .sort((a, b) => b.count - a.count || a.signature.localeCompare(b.signature))
    .slice(0, MAX_ERROR_SIGNATURES);

  const summary: ReliabilitySummary = {
    totals,
    successRatio: ratio(totals.delivered, totals.commands),
    deliveryFailureRatio: ratio(totals.retryable, totals.commands),
    byCommandType,
    topErrors,
  };

  // OPTIONAL request-based error budget — only when a real objective is supplied (no invented policy).
  if (options.objective !== undefined && Number.isFinite(options.objective)) {
    // Delegate to the harvested calculator (unit-agnostic math); re-project ms fields into counts.
    const eb = computeErrorBudget({
      target: options.objective,
      windowMs: totals.commands,
      observedDowntimeMs: totals.retryable,
      ...(options.atRiskBurn !== undefined ? { atRiskBurn: options.atRiskBurn } : {}),
    });
    summary.budget = {
      objective: eb.target,
      totalRequests: totals.commands,
      budgetFailures: eb.budgetMs,
      consumedFailures: eb.consumedMs,
      remainingFailures: eb.remainingMs,
      burnRate: eb.burnRate,
      status: eb.status,
    };
  }

  return summary;
}

/** Re-export the harvested display banding default so a caller can surface it without a second constant. */
export { AT_RISK_BURN };

// ─────────────────────────────────────────────────────────────────────────────
// S123 — Reliability TREND intelligence (pure, deterministic, policy-free).
//
// A deterministic comparison of TWO chronological windows over the SAME committed-command evidence —
// an older ("previous") half and a newer ("recent") half of the bounded read window, split by
// `committedAt`. It surfaces DESCRIPTIVE deltas (retry pressure, delivery-failure rate, total failures,
// per-command-type reliability, and error-signature appearance/persistence/resolution). It invents NO
// SLO objective, NO acceptable failure percentage, and NO alert/severity/incident threshold: every
// direction is the pure sign of a measured delta (§2/§3 of the S123 directive; DECISION-MEMO-S122).
// ─────────────────────────────────────────────────────────────────────────────

/** Default number of records considered per side of the comparison; bounded by MAX_TREND_WINDOW. */
export const DEFAULT_TREND_WINDOW = 25;
export const MAX_TREND_WINDOW = 100;

/** Descriptive direction of a delta — never a verdict, never a threshold. */
export type TrendDirection = 'INCREASE' | 'DECREASE' | 'STABLE';
/** Descriptive reliability movement for a command type. */
export type CommandTypeTrend = 'IMPROVING' | 'DEGRADING' | 'STABLE';

/** Pure sign → direction. Uses an exact zero test; no epsilon, no business threshold. */
function direction(delta: number): TrendDirection {
  if (!Number.isFinite(delta) || delta === 0) return 'STABLE';
  return delta > 0 ? 'INCREASE' : 'DECREASE';
}

export interface TrendMetric {
  previous: number;
  recent: number;
  delta: number; // recent − previous
  direction: TrendDirection;
}

export interface CommandTypeTrendRow {
  commandType: string;
  previousSuccessRatio: number;
  recentSuccessRatio: number;
  delta: number; // recent − previous success ratio
  trend: CommandTypeTrend;
}

export interface ReliabilityTrend {
  /** whether a two-window comparison was possible (≥2 records). */
  comparable: boolean;
  /** records considered in each window. */
  window: { previous: number; recent: number };
  /** delivery-failure rate (retryable / commands) movement — the headline posture trend. */
  deliveryFailureRate: TrendMetric;
  /** retry pressure (retried / commands) movement. */
  retryPressure: TrendMetric;
  /** success ratio (delivered / commands) movement. */
  successRatio: TrendMetric;
  /** absolute count of currently-failing (RETRYABLE) deliveries. */
  totalFailures: TrendMetric;
  /** overall posture: DEGRADING if failure rate rose, IMPROVING if it fell, STABLE if unchanged. */
  posture: 'IMPROVING' | 'DEGRADING' | 'STABLE';
  /** error signatures appearing only in the recent window. */
  newSignatures: string[];
  /** error signatures present in BOTH windows. */
  persistingSignatures: string[];
  /** error signatures present only in the previous window (no longer recurring). */
  resolvedSignatures: string[];
  /** per-command-type reliability movement, most-changed (by |delta|) first, bounded. */
  byCommandType: CommandTypeTrendRow[];
}

export interface ReliabilityTrendOptions {
  /** records per side of the comparison; bounded to (0, MAX_TREND_WINDOW]. */
  window?: number;
}

function boundTrendWindow(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) return DEFAULT_TREND_WINDOW;
  return Math.min(n, MAX_TREND_WINDOW);
}

const failureRate = (s: ReliabilitySummary): number => s.deliveryFailureRatio;
const retryRate = (s: ReliabilitySummary): number => (s.totals.commands > 0 ? s.totals.retried / s.totals.commands : 0);
const metric = (prev: number, rec: number): TrendMetric => ({ previous: prev, recent: rec, delta: rec - prev, direction: direction(rec - prev) });

/**
 * Compute the reliability trend between two chronological windows of the SAME tenant-scoped records.
 * Pure and total. Records are ordered by `committedAt`; the last `2·window` are considered (bounded),
 * split into an older PREVIOUS half and a newer RECENT half. With fewer than 2 records the comparison
 * is not possible and `comparable:false` is returned (no fabricated trend).
 */
export function summarizeReliabilityTrend(
  records: readonly CommittedCommand[],
  options: ReliabilityTrendOptions = {},
): ReliabilityTrend {
  const window = boundTrendWindow(options.window);
  const empty: ReliabilityTrend = {
    comparable: false,
    window: { previous: 0, recent: 0 },
    deliveryFailureRate: metric(0, 0),
    retryPressure: metric(0, 0),
    successRatio: metric(0, 0),
    totalFailures: metric(0, 0),
    posture: 'STABLE',
    newSignatures: [],
    persistingSignatures: [],
    resolvedSignatures: [],
    byCommandType: [],
  };
  if (records.length < 2) return empty;

  // Stable chronological order by committedAt (ties keep input order).
  const ordered = records
    .map((r, i) => ({ r, i }))
    .sort((a, b) => (a.r.committedAt < b.r.committedAt ? -1 : a.r.committedAt > b.r.committedAt ? 1 : a.i - b.i))
    .map((x) => x.r);

  // Consider the last 2·window records, split in half (recent gets the extra on an odd count).
  const considered = ordered.slice(-2 * window);
  const mid = Math.floor(considered.length / 2);
  const previousRecs = considered.slice(0, mid);
  const recentRecs = considered.slice(mid);
  if (previousRecs.length === 0 || recentRecs.length === 0) return empty;

  const prev = summarizeReliability(previousRecs);
  const rec = summarizeReliability(recentRecs);

  const deliveryFailureRate = metric(failureRate(prev), failureRate(rec));
  const retryPressure = metric(retryRate(prev), retryRate(rec));
  const successRatio = metric(prev.successRatio, rec.successRatio);
  const totalFailures = metric(prev.totals.retryable, rec.totals.retryable);
  const posture: ReliabilityTrend['posture'] =
    deliveryFailureRate.direction === 'INCREASE' ? 'DEGRADING' : deliveryFailureRate.direction === 'DECREASE' ? 'IMPROVING' : 'STABLE';

  const prevSigs = new Set(prev.topErrors.map((e) => e.signature));
  const recSigs = new Set(rec.topErrors.map((e) => e.signature));
  const newSignatures = [...recSigs].filter((s) => !prevSigs.has(s)).sort();
  const persistingSignatures = [...recSigs].filter((s) => prevSigs.has(s)).sort();
  const resolvedSignatures = [...prevSigs].filter((s) => !recSigs.has(s)).sort();

  const prevByType = new Map(prev.byCommandType.map((t) => [t.commandType, t]));
  const recByType = new Map(rec.byCommandType.map((t) => [t.commandType, t]));
  const typeRatio = (t?: CommandTypeReliability): number => (t && t.total > 0 ? t.delivered / t.total : 0);
  const byCommandType: CommandTypeTrendRow[] = [...new Set([...prevByType.keys(), ...recByType.keys()])]
    .map((commandType) => {
      const p = typeRatio(prevByType.get(commandType));
      const r = typeRatio(recByType.get(commandType));
      const delta = r - p;
      const trend: CommandTypeTrend = delta > 0 ? 'IMPROVING' : delta < 0 ? 'DEGRADING' : 'STABLE';
      return { commandType, previousSuccessRatio: p, recentSuccessRatio: r, delta, trend };
    })
    .filter((row) => row.trend !== 'STABLE') // surface only the command types that actually changed
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || a.commandType.localeCompare(b.commandType))
    .slice(0, MAX_ERROR_SIGNATURES);

  return {
    comparable: true,
    window: { previous: previousRecs.length, recent: recentRecs.length },
    deliveryFailureRate,
    retryPressure,
    successRatio,
    totalFailures,
    posture,
    newSignatures,
    persistingSignatures,
    resolvedSignatures,
    byCommandType,
  };
}
