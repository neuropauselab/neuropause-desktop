/**
 * OS-track Layer 1 · Workspace Foundation — Slice 1 · the OBSERVABLE OBJECT.
 *
 * A queryable, tenant-scoped DOMAIN AGGREGATE over the governed enterprise-module
 * stores (people · organizations · customers · projects · tasks · documents ·
 * workflows · policies · approvals · actions · evidence · operational memory).
 * It is NOT a new persistence store — the data already lives in ~106 tenant-scoped
 * `EnterpriseRecordStore`s behind the registry. This is a READ/aggregate-ONLY
 * façade: it reads through each store's already-scoped `count`, computes no new
 * numbers, and never writes/executes/grants (writes stay in the governed module
 * stores). Pure over injected sources, so it is testable and honest by construction.
 *
 * Constraint (binding, L1): tenant-scoped; READ/aggregate-only.
 * Truth rules (Environment-Intelligence): four data states, never fabricated —
 *   - scope unresolved (no session/org) → the whole snapshot is UNKNOWN (empty),
 *     NEVER "all data";
 *   - a domain's store absent/unresolved → that slice is UNAVAILABLE, DISTINCT
 *     from present-but-empty (count 0);
 *   - present → a faithful scoped count that traces to its governed store.
 */
import type { TenantScope } from '@neuropause/shared';

/** A domain concept mapped to the governed module whose store holds it. */
export interface DomainModuleSpec {
  /** The domain concept, e.g. 'people', 'customers', 'projects'. */
  readonly domain: string;
  /** The governed module id whose scoped store holds this domain's records. */
  readonly moduleId: string;
  readonly label: string;
}

export type DomainSliceState = 'present' | 'unavailable';

export interface DomainSlice {
  readonly domain: string;
  readonly moduleId: string;
  readonly label: string;
  /** Scoped record count (0 = present-but-empty). Meaningful only when state='present'. */
  readonly count: number;
  /** 'unavailable' when the store/module is absent or unresolved — never a fabricated 0. */
  readonly state: DomainSliceState;
}

export interface WorkspaceDomainSnapshot {
  /** False when no tenant scope resolves — the whole snapshot is UNKNOWN, not "all data". */
  readonly scopeResolved: boolean;
  readonly tenantId: string | null;
  readonly slices: readonly DomainSlice[];
  readonly at: string;
}

export interface WorkspaceDomainSources {
  /** The active tenant scope, or null when unresolved (→ UNKNOWN snapshot). */
  readonly scope: () => TenantScope | null;
  /**
   * The SCOPED record count for a module, or null when the module/store is ABSENT
   * or unresolved (→ UNAVAILABLE). Callers wire this to `registry.get(id)?.store.count()`
   * so tenant isolation is inherited from the store's own scoped read.
   */
  readonly moduleCount: (moduleId: string) => number | null;
  readonly now: () => string;
}

/**
 * Compose the tenant's domain snapshot from the governed stores. READ-only, pure.
 * Every count is a faithful projection of a scoped store read — it computes no new
 * number and can reach no other tenant's rows (the scope + the stores enforce that).
 */
export function composeWorkspaceDomain(
  specs: readonly DomainModuleSpec[],
  sources: WorkspaceDomainSources,
): WorkspaceDomainSnapshot {
  const scope = sources.scope();
  if (scope === null) {
    // No tenant resolved (cold start / no session / unresolved org): UNKNOWN.
    // Never enumerate everything — an empty, explicitly-unresolved snapshot.
    return { scopeResolved: false, tenantId: null, slices: [], at: sources.now() };
  }
  const slices: DomainSlice[] = specs.map((spec) => {
    const c = sources.moduleCount(spec.moduleId);
    if (c === null) {
      // The store/module is absent or unresolved — UNAVAILABLE, distinct from empty.
      return { domain: spec.domain, moduleId: spec.moduleId, label: spec.label, count: 0, state: 'unavailable' };
    }
    return { domain: spec.domain, moduleId: spec.moduleId, label: spec.label, count: c, state: 'present' };
  });
  return { scopeResolved: true, tenantId: scope.tenantId, slices, at: sources.now() };
}
