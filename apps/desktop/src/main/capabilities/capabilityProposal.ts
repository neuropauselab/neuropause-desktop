/**
 * Capability → proposal binding. The constitutional bridge from a VALIDATED capability (Slice 4) to the authoritative
 * identity the governed proposal lifecycle already recognizes — without inventing a new identity and without touching
 * a frozen contract.
 *
 * Why no new field / no frozen change (proven from source):
 *   - the catalog's `capabilityId` IS the connector action id (`capabilityCatalog.ts` sets `capabilityId: action.id`),
 *     and the frozen `ExecutionBinding.actionId` is that same "WriteAction.id / InfraAction.id" that the executor
 *     resolves authoritatively (`connectors/m365/executor.ts` `this.byId.get(actionId)`);
 *   - the frozen `ExecutionBinding` already carries `{ executor, target(=connectorId), accountId, actionId }`;
 *   - so the validated capability's identity `{ executor, connectorId, accountId, capabilityId }` maps EXACTLY onto
 *     existing binding fields. `capabilityId` is not a new axis — it is the `actionId` that already flows into the
 *     binding digest → decision → admission → evidence. Carrying the capability needs no frozen change.
 *
 * What this is, and is NOT:
 *   - it produces a `ProposalBindingDraft` — the authoritative correlation, mirroring the `ExecutionBinding` identity
 *     subset plus the political facts (purpose/mandate, consequential, approval, governance) taken from the
 *     AUTHORITATIVE catalog, never from the AI;
 *   - only a `SELECTED` outcome can be bound. A refused or governance-not-proven selection CANNOT become a proposal
 *     binding — capability selection is not authorization;
 *   - it is NON-EXECUTING and carries no parameters (Phase 9: a "send email" capability is not authority to send a
 *     specific message — the exact target/params are a separate, later concern), no credential, and no callable.
 *
 * Turning this draft into an actual `JobProposal` that enters governance still goes through the existing (frozen)
 * workforce proposal-creation path — that wiring is the NEXT gate, not this slice.
 */
import type { ExecutorKind } from '@neuropause/shared';
import type { CapabilityOperation } from './capabilityCatalog';
import type {
  CapabilityExecutionAssurance,
  CapabilitySelectionOutcome,
  CapabilitySelectionStatus,
} from './capabilityDiscoveryService';
import type { Principal, PrincipalResolution } from './capabilityPrincipal';

/**
 * The authoritative correlation between a validated capability and a governed proposal. The first four fields mirror
 * the frozen `ExecutionBinding` identity ({executor, target=connectorId, accountId, actionId}); the rest are the
 * political facts the governed pipeline and operator need. Plain data — no token, no callable, no parameters.
 */
export interface ProposalBindingDraft {
  readonly executor: ExecutorKind;
  /** == `ExecutionBinding.target` for connector executors (e.g. the M365 connector id). */
  readonly connectorId: string;
  readonly accountId: string;
  /** == `ExecutionBinding.actionId` — the validated capabilityId, resolved authoritatively by the executor. */
  readonly actionId: string;
  readonly operation: CapabilityOperation;
  readonly consequential: boolean;
  /** Authoritative — from governance classification, never lowered by the AI. */
  readonly requiresApproval: boolean;
  readonly governanceStatus: CapabilityExecutionAssurance;
  /** The user's purpose (mandate), carried as neutralized data — never authority. */
  readonly purpose: string | null;
}

export type ProposalBindingResult =
  | { readonly ok: true; readonly draft: ProposalBindingDraft }
  | { readonly ok: false; readonly status: Exclude<CapabilitySelectionStatus, 'SELECTED'>; readonly reason: string };

/**
 * Bind a validated capability selection to a proposal draft. Only a `SELECTED` outcome binds; every refusal (including
 * a governance-not-proven mutation) returns `ok:false` — selection is not authorization, so an unvalidated or
 * ungoverned capability can never become a proposal binding. Pure and non-executing.
 */
export function bindCapabilityToProposal(selection: CapabilitySelectionOutcome): ProposalBindingResult {
  if (selection.status !== 'SELECTED') {
    return { ok: false, status: selection.status, reason: selection.reason };
  }
  if (selection.capability === null) {
    // Defensive: a SELECTED outcome always carries its capability; a malformed one is unbindable, never guessed.
    return { ok: false, status: 'NOT_FOUND', reason: selection.reason };
  }
  const capability = selection.capability;
  return {
    ok: true,
    draft: {
      executor: capability.executor,
      connectorId: capability.connectorId,
      accountId: capability.accountId,
      actionId: capability.capabilityId, // capabilityId IS the ExecutionBinding.actionId — no new identity
      operation: capability.operation,
      consequential: capability.consequential,
      requiresApproval: selection.requiresApproval,
      governanceStatus: capability.executionAssurance,
      purpose: selection.purpose,
    },
  };
}

/**
 * A proposal that names WHO (the authoritative human principal), WHAT (the validated capability binding), and the
 * MANDATE (purpose). This is the constitutional record the governed pipeline needs: the principal is authoritative
 * provenance, the binding is a validated capability, the purpose is the human's mandate. It is NON-EXECUTING and grants
 * no authority — governance, approval and admission still run downstream. The principal is NOT the approver (approval
 * is a separate, later, authoritative act) and NOT a worker (a worker, if used as a mechanism, can never replace it).
 */
export interface PrincipalBoundProposal {
  readonly principal: Principal;
  readonly binding: ProposalBindingDraft;
  readonly purpose: string | null;
}

export type PrincipalBoundProposalResult =
  | { readonly ok: true; readonly proposal: PrincipalBoundProposal }
  | { readonly ok: false; readonly reason: 'PRINCIPAL_UNRESOLVED' | 'CAPABILITY_NOT_SELECTED'; readonly detail: string };

/**
 * Compose an authoritative principal with a validated capability selection into a principal-bound proposal. Both
 * halves must hold: the principal must resolve authoritatively (else PRINCIPAL_UNRESOLVED — fail-closed, no defaulting
 * to 'user'), and the capability must be SELECTED (else CAPABILITY_NOT_SELECTED — an invented / cross-tenant /
 * unavailable / governance-not-proven / ambiguous selection can never become a proposal). The principal is supplied
 * by the trusted runtime's resolver, never by the request. Pure and non-executing.
 */
export function bindPrincipalToProposal(input: {
  readonly principal: PrincipalResolution;
  readonly selection: CapabilitySelectionOutcome;
}): PrincipalBoundProposalResult {
  if (!input.principal.ok) {
    return { ok: false, reason: 'PRINCIPAL_UNRESOLVED', detail: input.principal.reason };
  }
  const binding = bindCapabilityToProposal(input.selection);
  if (!binding.ok) {
    return { ok: false, reason: 'CAPABILITY_NOT_SELECTED', detail: binding.status };
  }
  return {
    ok: true,
    proposal: { principal: input.principal.principal, binding: binding.draft, purpose: binding.draft.purpose },
  };
}
