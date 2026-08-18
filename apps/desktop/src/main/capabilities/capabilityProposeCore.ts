/**
 * Slice 11 core — the data-only body of the `capability:m365.propose` handler, kept free of singletons so it is unit-
 * testable. Given trusted-runtime deps (the authoritative capability resolver + the authenticated subject + the active
 * tenant scope) and the UNTRUSTED request, it re-resolves the capability, binds the authoritative human principal, and
 * validates the AI params through the Slice-8 producer — then returns DATA ONLY (reviewable proposal + provenance, or a
 * typed fail-closed refusal). It performs NO effect: it never touches the executor, CST, admission, IPC write, or
 * `confirmed`. The reason union is passed through losslessly (it equals the producer's union); sub-causes ride in the
 * producer's `detail` (carried by the caller when it maps to the response).
 */
import type { CapabilityProposeM365ActionRequest, CapabilityProposeM365ActionResponse } from '@neuropause/shared';
import type { CapabilitySelectionOutcome } from './capabilityDiscoveryService';
import { resolvePrincipal } from './capabilityPrincipal';
import { buildM365ActionProposal, toWritePanelProposal } from './m365ActionProposal';

export interface ProposeM365Deps {
  /** The authoritative, tenant-scoped capability resolver (re-resolves the AI-named capabilityId — never trusts it). */
  readonly resolveSelection: (req: { capabilityId: string; accountId?: string; purpose?: string }) => CapabilitySelectionOutcome;
  /** The authenticated human's stable id, or null when signed out. From the trusted runtime (authService). */
  readonly subjectId: () => string | null;
  /** The active tenant scope, or null when unresolved. From the trusted runtime (activeTenantScope()). */
  readonly scope: () => { readonly tenantId: string; readonly workspaceId: string } | null;
}

/** Pure. Data in → data out. No effect, no `confirmed`, no credential, no callable. */
export function runProposeM365Action(
  deps: ProposeM365Deps,
  req: CapabilityProposeM365ActionRequest,
): CapabilityProposeM365ActionResponse {
  const selection = deps.resolveSelection({
    capabilityId: req.capabilityId,
    accountId: req.accountId ?? undefined,
    purpose: req.purpose,
  });
  const principal = resolvePrincipal({ subjectId: deps.subjectId(), scope: deps.scope() });
  const built = buildM365ActionProposal({ selection, principal, params: req.params });
  if (!built.ok) return { ok: false, reason: built.reason, detail: built.detail };
  return {
    ok: true,
    proposal: toWritePanelProposal(built.proposal),
    provenance: { capabilityId: built.proposal.capabilityId, accountId: built.proposal.accountId },
  };
}
