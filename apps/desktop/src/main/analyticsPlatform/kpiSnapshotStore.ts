/**
 * S80 — Governed KPI Snapshot + Exception stores + capture engine.
 *
 * Reuses the canonical DurableJsonStore (S33 per-store serialized atomic writes) — NO new
 * persistence engine. Tenancy is authoritative and caller-resolved (the DurableJsonStore
 * design: "scoped resolve is the caller's"). Renderer never supplies a tenant. Snapshots are
 * IMMUTABLE historical observations (idempotent by deterministic id; a re-capture with the same
 * id is a no-op, never an overwrite). The engine emits NotificationIntents on state transitions
 * only (dedup), which the subsystem routes through the EXISTING notifications inbox.
 */
import type { DurableJsonStore } from '../platform/persistence/durableJsonStore';
import type { KpiSnapshot, KpiExceptionState, KpiCondition } from './kpiSnapshotModel';
import { snapshotId, exceptionId, evaluateCondition, nextExceptionState } from './kpiSnapshotModel';

export interface TenantScopeRef {
  tenantId: string | null;
  workspaceId: string | null;
}

/** A governed notification the exception engine wants delivered (routed to the existing inbox). */
export interface KpiNotificationIntent {
  tenantId: string;
  workspaceId: string | null;
  exceptionId: string;
  kpiKey: string;
  status: KpiExceptionState['status'];
  title: string;
  message: string;
  /** Dedup key: same exception + same transitionSeq ⇒ same notification, never re-delivered. */
  dedupeKey: string;
  at: string;
}

/** Immutable snapshot store. */
export class KpiSnapshotStore {
  constructor(private readonly store: DurableJsonStore<KpiSnapshot>) {}

  /** Hydrate from disk so a sync read sees persisted history after a restart. */
  async load(): Promise<void> { await this.store.load(); }

  /**
   * Record an observation. IDEMPOTENT + IMMUTABLE: if a snapshot with this deterministic id
   * already exists it is returned unchanged (never overwritten) — historical observations do not mutate.
   */
  async record(snap: KpiSnapshot): Promise<{ snapshot: KpiSnapshot; created: boolean }> {
    await this.store.load();
    const existing = this.store.get(snap.id);
    if (existing) return { snapshot: existing, created: false };
    await this.store.put(snap);
    return { snapshot: snap, created: true };
  }

  listForTenant(tenantId: string): KpiSnapshot[] {
    return this.store.all().filter((s) => s.tenantId === tenantId);
  }

  /** Latest snapshot per (kpiKey, dimensions) for a tenant, by calculatedAt. */
  latestForTenant(tenantId: string): KpiSnapshot[] {
    const byKey = new Map<string, KpiSnapshot>();
    for (const s of this.listForTenant(tenantId)) {
      const k = `${s.kpiKey}|${JSON.stringify(s.dimensions)}`;
      const cur = byKey.get(k);
      if (!cur || s.calculatedAt > cur.calculatedAt) byKey.set(k, s);
    }
    return [...byKey.values()];
  }
}

/** Exception-state store: current durable state per deterministic exception identity. */
export class KpiExceptionStore {
  constructor(private readonly store: DurableJsonStore<KpiExceptionState>) {}

  async load(): Promise<void> { await this.store.load(); }
  get(id: string): KpiExceptionState | undefined { return this.store.get(id); }
  async put(state: KpiExceptionState): Promise<void> { await this.store.put(state); }

  activeForTenant(tenantId: string): KpiExceptionState[] {
    return this.store.all().filter((e) => e.tenantId === tenantId && (e.status === 'WARNING' || e.status === 'EXCEPTION'));
  }
  allForTenant(tenantId: string): KpiExceptionState[] {
    return this.store.all().filter((e) => e.tenantId === tenantId);
  }
}

export interface KpiObservation {
  kpiKey: string;
  label: string;
  value: number | null;
  band?: string | null;
  dimensions?: Record<string, string>;
  source: string;
  sourceVersion?: string | null;
}

/**
 * The one governed capture+evaluate step. Tenant-scoped + FAIL-CLOSED: an unresolved tenant
 * refuses entirely (no snapshot, no exception, no notification). Reuses existing KPI values —
 * this engine never computes a metric itself.
 */
export async function captureAndEvaluate(deps: {
  scope: TenantScopeRef;
  now: () => string;
  periodKey: string;
  snapshots: KpiSnapshotStore;
  exceptions: KpiExceptionStore;
  observations: KpiObservation[];
  conditions: KpiCondition[];
}): Promise<{ recorded: KpiSnapshot[]; transitions: KpiExceptionState[]; notifications: KpiNotificationIntent[] } | { refused: 'NO_TENANT' }> {
  const tenantId = deps.scope.tenantId;
  if (!tenantId) return { refused: 'NO_TENANT' }; // deny-by-default: renderer/unscoped callers get nothing
  const workspaceId = deps.scope.workspaceId ?? null;
  const at = deps.now();
  await deps.exceptions.load();

  const recorded: KpiSnapshot[] = [];
  for (const obs of deps.observations) {
    const dims = obs.dimensions ?? {};
    const snap: KpiSnapshot = {
      id: snapshotId(tenantId, obs.kpiKey, deps.periodKey, dims),
      tenantId, workspaceId,
      kpiKey: obs.kpiKey, label: obs.label, value: obs.value, band: obs.band ?? null,
      calculatedAt: at, periodKey: deps.periodKey, dimensions: dims,
      source: obs.source, sourceVersion: obs.sourceVersion ?? null, recordedAt: at,
    };
    const { snapshot } = await deps.snapshots.record(snap);
    recorded.push(snapshot);
  }

  const transitions: KpiExceptionState[] = [];
  const notifications: KpiNotificationIntent[] = [];
  const valueFor = (kpiKey: string, dims: Record<string, string>) =>
    deps.observations.find((o) => o.kpiKey === kpiKey && JSON.stringify(o.dimensions ?? {}) === JSON.stringify(dims));

  for (const cond of deps.conditions) {
    const obs = valueFor(cond.kpiKey, {}); // conditions are evaluated on the aggregate (no-dimension) KPI here
    const value = obs ? obs.value : null;
    const { raw, threshold } = evaluateCondition(cond, value);
    const id = exceptionId(tenantId, cond.kpiKey, cond.conditionId);
    const prev = deps.exceptions.get(id);
    const message = raw === 'NORMAL'
      ? `${cond.label}: within limits`
      : `${cond.label}: ${value ?? 'n/a'} ${cond.direction} threshold ${threshold ?? 'n/a'}`;
    const { state, transitioned, notify } = nextExceptionState(prev, raw, {
      id, tenantId, workspaceId, kpiKey: cond.kpiKey, conditionId: cond.conditionId,
      observedValue: value, threshold, at, message,
    });
    // Persist state only when it changed (avoids churn); always keep lastEvaluatedAt fresh on transition.
    if (transitioned) { await deps.exceptions.put(state); transitions.push(state); }
    if (notify) {
      notifications.push({
        tenantId, workspaceId, exceptionId: id, kpiKey: cond.kpiKey, status: state.status,
        title: state.status === 'RECOVERED' ? `Recovered: ${cond.label}` : `${state.status}: ${cond.label}`,
        message, dedupeKey: `${id}#${state.transitionSeq}`, at,
      });
    }
  }
  return { recorded, transitions, notifications };
}
