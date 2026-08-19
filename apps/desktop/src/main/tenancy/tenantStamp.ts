/**
 * S4.0 · Tenant Authority Unification — the ONE authoritative tenant context threaded L1→L6.
 *
 * Every read-model snapshot that feeds Live Brain carries a `TenantStamp`. L6 reconciles the stamps
 * across substrates: if any two DISAGREE on tenant, that is a first-class CONFLICTING and NO proposal
 * may be formed (the confused-deputy defense the fleet audit ranked #1). Deny-by-default: with NO
 * stamp present, the tenant is NOT provable, so a proposal is refused.
 *
 * PURE: no store/Electron/governance import — safe to reference from the observation layers.
 */
export interface TenantStamp {
  readonly tenantId: string;
  /** The workspace/scope id the snapshot was read under. */
  readonly scope: string;
  /** Which resolver produced this identity (e.g. 'activeTenantScope', 'local', 'session-catalog'). */
  readonly authoritySource: string;
  readonly timestamp: string;
}

export interface TenantMismatch {
  readonly a: TenantStamp;
  readonly b: TenantStamp;
  readonly field: 'tenantId' | 'scope';
}

export interface TenantReconciliation {
  /** The single agreed tenant, or null when unprovable/conflicting. */
  readonly tenant: TenantStamp | null;
  readonly conflict: TenantMismatch | null;
  /** True iff ≥1 stamp is present AND all present stamps agree. Deny-by-default. */
  readonly provable: boolean;
}

/** Two stamps agree iff same tenantId AND same scope (authoritySource/timestamp may differ). */
export function stampsAgree(a: TenantStamp, b: TenantStamp): boolean {
  return a.tenantId === b.tenantId && a.scope === b.scope;
}

/**
 * Reconcile the tenant stamps present across substrates. No stamp → NOT provable (deny-by-default).
 * The first disagreement is surfaced as a mismatch; the reconciliation is never silently resolved.
 */
export function reconcileTenant(stamps: readonly (TenantStamp | null | undefined)[]): TenantReconciliation {
  const present = stamps.filter((s): s is TenantStamp => s != null);
  if (present.length === 0) return { tenant: null, conflict: null, provable: false };
  const first = present[0];
  for (const s of present.slice(1)) {
    if (!stampsAgree(first, s)) {
      return { tenant: null, conflict: { a: first, b: s, field: first.tenantId !== s.tenantId ? 'tenantId' : 'scope' }, provable: false };
    }
  }
  return { tenant: first, conflict: null, provable: true };
}
