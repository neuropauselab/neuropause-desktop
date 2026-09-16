/**
 * S80 — Governed KPI Snapshot + Exception Intelligence (pure model).
 *
 * This file is PURE (no I/O, no electron, no store). It defines the canonical
 * immutable KPI snapshot, the deterministic snapshot/exception identity, and the
 * NORMAL → WARNING → EXCEPTION → RECOVERED state machine. Persistence, tenancy and
 * notification delivery are layered on top by kpiSnapshotStore.ts / the subsystem —
 * this module invents no engine and no threshold.
 *
 * Reuse posture: snapshots are captured FROM existing KPI calculations (the
 * executive-center feed / inventory safety-stock derivation). This module does not
 * compute metrics; it records observations and evaluates a caller-supplied condition.
 */

export type KpiExceptionStatus = 'NORMAL' | 'WARNING' | 'EXCEPTION' | 'RECOVERED';

/** An immutable historical observation of one KPI for one (tenant, period). */
export interface KpiSnapshot {
  /** Deterministic identity — see snapshotId(). Same (tenant,kpi,period) ⇒ same id ⇒ idempotent. */
  id: string;
  /** Tenant owner. Authoritative — resolved in main, never renderer-supplied. */
  tenantId: string;
  workspaceId: string | null;
  /** KPI identity (e.g. 'inventory.belowSafetyStock'). */
  kpiKey: string;
  label: string;
  /** The observed metric value. null = unavailable (honest, not zero). */
  value: number | null;
  band: string | null;
  /** ISO instant the KPI was calculated. */
  calculatedAt: string;
  /** Coarse evaluation period this observation belongs to (e.g. '2026-09-03', 'P2026-W36'). */
  periodKey: string;
  /** Optional dimensional context (e.g. { warehouse: 'WH-1' }). */
  dimensions: Record<string, string>;
  /** Source producer + optional version, for provenance. */
  source: string;
  sourceVersion: string | null;
  /** Recorded provenance instant (when this row was written; distinct from calculatedAt). */
  recordedAt: string;
}

/** Durable exception state for one (tenant, kpi, condition) identity. */
export interface KpiExceptionState {
  /** Deterministic identity — see exceptionId(). Stable across evaluations of the same condition. */
  id: string;
  tenantId: string;
  workspaceId: string | null;
  kpiKey: string;
  conditionId: string;
  status: KpiExceptionStatus;
  /** The value + threshold at the last evaluation (context for the UI/notification). */
  observedValue: number | null;
  threshold: number | null;
  /** ISO instants of the last transition and the last evaluation. */
  lastTransitionAt: string;
  lastEvaluatedAt: string;
  /** Bumped only on a state TRANSITION — the notification-dedup key component. */
  transitionSeq: number;
  message: string;
}

/** A caller-supplied threshold condition. Undefined threshold ⇒ fail-closed (no exception). */
export interface KpiCondition {
  conditionId: string;
  kpiKey: string;
  /** Comparison direction: 'below' fires when value < threshold; 'above' when value > threshold. */
  direction: 'below' | 'above';
  /** EXCEPTION threshold. If null/undefined the condition is UNCONFIGURED → fail-closed. */
  exceptionThreshold: number | null;
  /** Optional softer WARNING threshold (same direction). */
  warningThreshold?: number | null;
  label: string;
}

const slug = (s: string): string => s.replace(/[^a-zA-Z0-9._-]/g, '_');

/** Deterministic, tenant-scoped snapshot identity — the idempotency key. */
export function snapshotId(tenantId: string, kpiKey: string, periodKey: string, dimensions: Record<string, string> = {}): string {
  const dimPart = Object.keys(dimensions).sort().map((k) => `${slug(k)}=${slug(dimensions[k])}`).join(',');
  return `kpisnap:${slug(tenantId)}:${slug(kpiKey)}:${slug(periodKey)}${dimPart ? ':' + dimPart : ''}`;
}

/** Deterministic, tenant-scoped exception identity — stable so re-evaluation updates, never duplicates. */
export function exceptionId(tenantId: string, kpiKey: string, conditionId: string, dimensions: Record<string, string> = {}): string {
  const dimPart = Object.keys(dimensions).sort().map((k) => `${slug(k)}=${slug(dimensions[k])}`).join(',');
  return `kpiexc:${slug(tenantId)}:${slug(kpiKey)}:${slug(conditionId)}${dimPart ? ':' + dimPart : ''}`;
}

/**
 * Evaluate a condition against a value → the raw status for THIS evaluation.
 * FAIL-CLOSED: an unconfigured threshold (null) NEVER produces an exception — no fabricated value.
 * A null value is UNAVAILABLE, never treated as breaching.
 */
export function evaluateCondition(cond: KpiCondition, value: number | null): { raw: 'NORMAL' | 'WARNING' | 'EXCEPTION'; threshold: number | null } {
  if (cond.exceptionThreshold === null || cond.exceptionThreshold === undefined) return { raw: 'NORMAL', threshold: null }; // unconfigured ⇒ fail-closed
  if (value === null) return { raw: 'NORMAL', threshold: cond.exceptionThreshold }; // unavailable ⇒ no breach claimed
  const breach = (t: number) => (cond.direction === 'below' ? value < t : value > t);
  if (breach(cond.exceptionThreshold)) return { raw: 'EXCEPTION', threshold: cond.exceptionThreshold };
  const warn = cond.warningThreshold;
  if (warn !== null && warn !== undefined && breach(warn)) return { raw: 'WARNING', threshold: warn };
  return { raw: 'NORMAL', threshold: cond.exceptionThreshold };
}

/**
 * Fold a raw evaluation into the persisted exception state → the NEXT state + whether a
 * NOTIFY transition occurred. Recovery = an active (WARNING/EXCEPTION) condition returning to NORMAL.
 * Dedup: a persistent condition at the SAME status does NOT bump transitionSeq and does NOT notify.
 */
export function nextExceptionState(
  prev: KpiExceptionState | undefined,
  raw: 'NORMAL' | 'WARNING' | 'EXCEPTION',
  ctx: { id: string; tenantId: string; workspaceId: string | null; kpiKey: string; conditionId: string; observedValue: number | null; threshold: number | null; at: string; message: string },
): { state: KpiExceptionState; transitioned: boolean; notify: boolean } {
  const wasActive = prev ? prev.status === 'WARNING' || prev.status === 'EXCEPTION' : false;
  const nowActive = raw === 'WARNING' || raw === 'EXCEPTION';
  let status: KpiExceptionStatus = raw;
  if (!nowActive && wasActive) status = 'RECOVERED';
  if (!nowActive && !wasActive) status = 'NORMAL';

  const prevStatus = prev?.status ?? 'NORMAL';
  const transitioned = prevStatus !== status;
  const seq = (prev?.transitionSeq ?? 0) + (transitioned ? 1 : 0);
  // Notify only on a transition INTO an active state, or on RECOVERED. Never on steady-state.
  const notify = transitioned && (nowActive || status === 'RECOVERED');

  const state: KpiExceptionState = {
    id: ctx.id,
    tenantId: ctx.tenantId,
    workspaceId: ctx.workspaceId,
    kpiKey: ctx.kpiKey,
    conditionId: ctx.conditionId,
    status,
    observedValue: ctx.observedValue,
    threshold: ctx.threshold,
    lastTransitionAt: transitioned ? ctx.at : (prev?.lastTransitionAt ?? ctx.at),
    lastEvaluatedAt: ctx.at,
    transitionSeq: seq,
    message: ctx.message,
  };
  return { state, transitioned, notify };
}
