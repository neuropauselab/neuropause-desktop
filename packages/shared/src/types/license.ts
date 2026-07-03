/**
 * License validation: for a SaaS org, the "license" is its subscription entitlement.
 * This module evaluates a subscription snapshot (plan, status, period/trial ends)
 * plus a clock into a license state: valid, in grace, or invalid — with the reason
 * and the entitled plan tier. Evaluation is pure and shared so the backend (issuing
 * license status) and the desktop (validating, including offline with a persisted
 * last-known-good snapshot) agree exactly.
 *
 * Grace semantics: a past_due subscription, or an expired current period, stays
 * usable at its plan tier for GRACE_DAYS after the period end, then falls to free.
 * A canceled subscription falls to free immediately once the paid period is over.
 */
import type { PlanTier } from './ecosystem';

export type LicenseSubscriptionStatus = 'active' | 'trialing' | 'past_due' | 'canceled';

/** The subscription snapshot the license evaluation consumes. */
export interface LicenseSnapshot {
  planTier: PlanTier;
  status: LicenseSubscriptionStatus;
  /** ISO timestamp when the current paid period ends (null = no fixed end). */
  currentPeriodEnd: string | null;
  /** ISO timestamp when the trial ends (null = not trialing / unknown). */
  trialEndsAt: string | null;
}

export type LicenseState = 'valid' | 'grace' | 'invalid';

export type LicenseReason =
  | 'active'
  | 'trialing'
  | 'past_due_grace'
  | 'expired_grace'
  | 'trial_expired'
  | 'period_expired'
  | 'canceled';

export interface LicenseEvaluation {
  state: LicenseState;
  reason: LicenseReason;
  /** The plan tier the org is entitled to right now (free when invalid). */
  entitledPlan: PlanTier;
  /** When the current state lapses (grace end / period end / trial end), if known. */
  expiresAt: string | null;
  /** Days remaining in a grace window (0 outside grace). */
  graceDaysRemaining: number;
}

/**
 * The license status the backend issues for an org: the snapshot it was computed
 * from, its evaluation, and when it was checked. The desktop persists this as its
 * last-known-good license and re-evaluates the snapshot locally while offline.
 */
export interface OrgLicense {
  orgId: string;
  snapshot: LicenseSnapshot;
  evaluation: LicenseEvaluation;
  checkedAt: string;
}

/** Where a validated license answer came from. */
export type LicenseSource = 'remote' | 'cache' | 'none';

/**
 * The desktop validator's view of an org's license: where the answer came from,
 * the snapshot it rests on, and the evaluation recomputed at read time — so grace
 * decays and expiry happens even while offline, and a fresh fetch is never required
 * just to notice that time has passed.
 */
export interface LicenseValidationStatus {
  orgId: string;
  source: LicenseSource;
  snapshot: LicenseSnapshot | null;
  evaluation: LicenseEvaluation | null;
  /** When the backend last confirmed the snapshot (null if never fetched). */
  checkedAt: string | null;
  /** Message from the most recent failed refresh, if any. */
  lastError: string | null;
}

/** How long a lapsed subscription keeps its plan before falling to free. */
export const GRACE_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

function addDays(iso: string, days: number): string {
  return new Date(new Date(iso).getTime() + days * DAY_MS).toISOString();
}

function daysBetween(nowMs: number, untilIso: string): number {
  return Math.max(0, Math.ceil((new Date(untilIso).getTime() - nowMs) / DAY_MS));
}

/**
 * Evaluate a subscription snapshot into a license state at `now` (defaults to the
 * real clock; injectable for tests and for offline re-evaluation of a stored
 * snapshot).
 */
export function evaluateLicense(snap: LicenseSnapshot, now: Date = new Date()): LicenseEvaluation {
  const nowMs = now.getTime();
  const periodEndMs = snap.currentPeriodEnd ? new Date(snap.currentPeriodEnd).getTime() : null;

  if (snap.status === 'trialing') {
    const trialEndMs = snap.trialEndsAt ? new Date(snap.trialEndsAt).getTime() : null;
    if (trialEndMs === null || nowMs < trialEndMs) {
      return {
        state: 'valid',
        reason: 'trialing',
        entitledPlan: snap.planTier,
        expiresAt: snap.trialEndsAt,
        graceDaysRemaining: 0,
      };
    }
    // Trials do not get a grace window; they fall straight to free.
    return {
      state: 'invalid',
      reason: 'trial_expired',
      entitledPlan: 'free',
      expiresAt: snap.trialEndsAt,
      graceDaysRemaining: 0,
    };
  }

  if (snap.status === 'canceled') {
    // Cancellation keeps the paid plan until the period the org already paid for
    // ends, then falls to free with no grace.
    if (periodEndMs !== null && nowMs < periodEndMs) {
      return {
        state: 'valid',
        reason: 'active',
        entitledPlan: snap.planTier,
        expiresAt: snap.currentPeriodEnd,
        graceDaysRemaining: 0,
      };
    }
    return {
      state: 'invalid',
      reason: 'canceled',
      entitledPlan: 'free',
      expiresAt: snap.currentPeriodEnd,
      graceDaysRemaining: 0,
    };
  }

  // active or past_due from here.
  const withinPeriod = periodEndMs === null || nowMs < periodEndMs;

  if (snap.status === 'active' && withinPeriod) {
    return {
      state: 'valid',
      reason: 'active',
      entitledPlan: snap.planTier,
      expiresAt: snap.currentPeriodEnd,
      graceDaysRemaining: 0,
    };
  }

  // Lapsed: past_due (payment failing) or active-but-period-expired (stale data).
  // Both keep the plan through a grace window anchored at the period end; with no
  // known period end, past_due anchors the grace window at `now` evaluation start.
  const anchorIso = snap.currentPeriodEnd ?? now.toISOString();
  const graceEndIso = addDays(anchorIso, GRACE_DAYS);
  const inGrace = nowMs < new Date(graceEndIso).getTime();
  const reason: LicenseReason = snap.status === 'past_due' ? 'past_due_grace' : 'expired_grace';

  if (inGrace) {
    return {
      state: 'grace',
      reason,
      entitledPlan: snap.planTier,
      expiresAt: graceEndIso,
      graceDaysRemaining: daysBetween(nowMs, graceEndIso),
    };
  }

  return {
    state: 'invalid',
    reason: snap.status === 'past_due' ? 'past_due_grace' : 'period_expired',
    entitledPlan: 'free',
    expiresAt: graceEndIso,
    graceDaysRemaining: 0,
  };
}
