/**
 * S107 harvest — SLO error-budget calculator (pure).
 *
 * HARVESTED (adapted, not imported) from `packages/reliability/src/slo.ts` (`errorBudget`).
 * The source package is unwired and sits on the parallel `@neuropause/*` infrastructure spine
 * (runtime/cloud-core), so importing it would drag in a second spine (S106/S107 Rule 3). Only
 * the DEFINITIONAL math is harvested here, re-implemented with zero dependencies.
 *
 * The math is definitional, not invented policy:
 *   budget      = (1 − target) · window           (the tolerated error/downtime for the window)
 *   consumed    = observed error/downtime (clamped ≥ 0, and to ≤ window)
 *   remaining   = max(0, budget − consumed)
 *   burnRate    = consumed / budget                (fraction of the budget spent; >1 ⇒ over-budget)
 *   status      = 'breached' when the budget is exhausted (burnRate ≥ 1 — DEFINITIONAL),
 *                 'at-risk'  when burnRate ≥ AT_RISK_BURN (an operational DISPLAY default,
 *                            SRE-standard, carried from the harvested source; overridable),
 *                 'healthy'  otherwise.
 *
 * This module deliberately has NO store, NO clock, NO governance, NO business/accounting value:
 * `target` and `window` are inputs supplied by a caller that has a real objective + a real
 * observed-downtime source. It never invents a downtime measurement (that would violate the
 * SLA framework's "never estimated" law in `slaFramework.ts`); a caller with no real source must
 * not call it. Pure and total: every input maps to a defined output, no throws on numeric input.
 */

/** SRE-standard display banding default (harvested verbatim from reliability/slo.ts). Not a business/accounting value. */
export const AT_RISK_BURN = 0.75;

export type ErrorBudgetStatus = 'healthy' | 'at-risk' | 'breached';

export interface ErrorBudget {
  /** availability/success objective in [0,1] (e.g. 0.99 = 99%). */
  target: number;
  /** measurement window in ms. */
  windowMs: number;
  /** tolerated error/downtime for the window = (1−target)·window, rounded, ≥ 0. */
  budgetMs: number;
  /** observed error/downtime consumed, clamped to [0, windowMs], rounded. */
  consumedMs: number;
  /** budget left = max(0, budget − consumed). */
  remainingMs: number;
  /** consumed / budget. 0 when budget>0 and nothing consumed; Infinity when budget==0 and consumed>0. */
  burnRate: number;
  status: ErrorBudgetStatus;
}

export interface ErrorBudgetInput {
  /** objective in [0,1]; clamped into range. */
  target: number;
  /** window in ms; negatives treated as 0. */
  windowMs: number;
  /** observed error/downtime in ms; negatives treated as 0, and capped at windowMs. */
  observedDowntimeMs: number;
  /** at-risk burn threshold; defaults to AT_RISK_BURN. Must be in (0,1] to have effect. */
  atRiskBurn?: number;
}

function clamp(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return lo;
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Compute the error budget for an availability/success SLO from a REAL observed downtime.
 * Definitional and pure. The caller is responsible for supplying a genuine `observedDowntimeMs`;
 * this function never estimates one.
 */
export function computeErrorBudget(input: ErrorBudgetInput): ErrorBudget {
  const target = clamp(input.target, 0, 1);
  const windowMs = Math.max(0, Number.isFinite(input.windowMs) ? input.windowMs : 0);
  const budgetMs = Math.round(Math.max(0, (1 - target) * windowMs));
  const consumedMs = Math.round(clamp(input.observedDowntimeMs, 0, windowMs));
  const remainingMs = Math.max(0, budgetMs - consumedMs);
  const burnRate = budgetMs > 0 ? consumedMs / budgetMs : consumedMs > 0 ? Infinity : 0;
  const atRisk = input.atRiskBurn !== undefined && Number.isFinite(input.atRiskBurn) ? input.atRiskBurn : AT_RISK_BURN;
  const status: ErrorBudgetStatus = burnRate >= 1 ? 'breached' : burnRate >= atRisk ? 'at-risk' : 'healthy';
  return { target, windowMs, budgetMs, consumedMs, remainingMs, burnRate, status };
}
