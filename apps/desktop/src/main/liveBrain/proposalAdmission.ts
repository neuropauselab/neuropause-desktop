/**
 * S4.0 · The proposal-admission guard — the S4 REFUSAL predicate (tenant precondition).
 *
 * A proposal may be formed ONLY from a PROVABLY single-tenant, non-tenant-conflicting state. This is
 * the confused-deputy defense the fleet audit ranked #1: a mixed-tenant state (evidence from A, target
 * in B) yields REFUSED → ACTION = NONE — no proposal object is created at all. Deny-by-default: if the
 * tenant is not provable, refuse.
 *
 * SCOPE: this is the S4.0 TENANT gate. Broader admission (stale evidence → EXPIRED, missing verification
 * → BLOCKED, conflicting evidence → BLOCKED) is S4.2's integrity pass and layers on top of this.
 *
 * PURE: reads the LiveBrainState via a type import; holds zero authority; imports nothing runtime.
 */
import type { LiveBrainState } from './liveBrainState';

export interface AdmissionVerdict {
  readonly admissible: boolean;
  readonly reason: string;
}

export function proposalAdmissible(state: LiveBrainState): AdmissionVerdict {
  if (!state.tenantProvable) {
    return { admissible: false, reason: 'REFUSED — tenant is not provably single (deny-by-default); no proposal object is created' };
  }
  // Belt-and-suspenders: a tenant conflict must never coexist with tenantProvable, but never emit a
  // proposal while one is surfaced.
  const tenantConflict = state.conflicts.find((c) => c.about.startsWith('tenant identity'));
  if (tenantConflict) {
    return { admissible: false, reason: `REFUSED — ${tenantConflict.about} CONFLICTING; no proposal object is created` };
  }
  return { admissible: true, reason: `admissible — provably single tenant ${state.tenantId ?? '?'}` };
}
