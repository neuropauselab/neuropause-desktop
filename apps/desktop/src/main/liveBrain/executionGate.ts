/**
 * S5.4 Phase 0 · FG-10 · the L6 EXECUTION-TIME GATE — the non-frozen logic behind the one gated call
 * inside `connectors/index.ts` (before `governedSend`).
 *
 * For an L6-proposal-driven `mail.send`, it RE-DERIVES admissibility from the runtime substrate and
 * refuses on any mismatch (deny-by-default); the proposal's own words are never re-trusted. A refusal
 * returns an OBSERVABLE `DENIED` `ConnectorWriteResult` — the SAME shape the FG-4 guard denial returns,
 * never a silent drop (condition 3). Non-`mail.send`, or a `mail.send` with no stashed L6 proposal, →
 * `{ ok: true }` (SKIP): the existing assistant/deterministic path is behaviorally IDENTICAL (condition 2).
 *
 * GATE ≠ OBSERVER: the FG-5 ActionRecord observer stays best-effort and never blocks; THIS gate MAY
 * refuse — but only L6-proposal-driven executions, never the non-L6 path. Execution order in the handler:
 * FG-10 (this) runs FIRST, then the FG-4 first-real-send guard, then `governedSend` — so a refused
 * proposal never touches the latch.
 */
import type { ConnectorWriteResult } from '@neuropause/shared';
import { gateL6Execution } from './proposalStore';
import type { ExecutionDeps } from './proposalExecutionBoundary';
import type { AuthorityRequirement, VerificationPlan, ProposalTarget } from './proposal';
import { isCertifiedConsequentialCapability, mutationAssuranceFor } from '../capabilities/liveCapabilitySources';
import { createLogger } from '../logger';
import { actionRecord, type GovernanceVerdict } from '../connectors/actionRecord';

const log = createLogger('l6-gate');

export type L6GateResult = { readonly ok: true } | { readonly ok: false; readonly refusal: ConnectorWriteResult };

/**
 * Shared authority derivation (RBAC/CST via L4) — the SINGLE source both propose and execute use.
 * EXPORTED so the propose lane (`brainProposeLane`) builds with LITERALLY these functions — a proposal formed from any
 * other derivation would fail the execution-time re-derivation comparison (deny-by-default), which is the point.
 */
export function deriveAuthority(capabilityId: string, target: ProposalTarget): AuthorityRequirement {
  return {
    requiresApproval: true,
    governanceStatus: mutationAssuranceFor(target.connector),
    requiredGate: 'human-confirm + CST admission',
    /**
     * A recorded CONTRACT LABEL — never an authority input (F-N16-2).
     *
     * `null` means "no source for this capability", not "no policy": there is
     * no action→policy registry to consult, so only the one case with a known
     * literal is named. The ENFORCING paths carry their own values
     * (`connectors/index.ts` for the send path, `cst/governedAction.ts` for the
     * cohorts) and those are authoritative for "under which contract did this
     * execute" — this one answers only "what does the proposal claim".
     *
     * Nothing decides on it: the CST kernel's sole use interpolates it into an
     * evidence label, never a comparison, and `boundDecisionClaim` deliberately
     * excludes it (I-A3-STEP2-FINDING-1 — weaker provenance must not be
     * represented as stronger). Pinned in `authorityReconciliation.test.ts`.
     */
    policyVersion: capabilityId === 'mail.send' ? 'm365-send-policy-1' : null,
  };
}

/**
 * S23 — the oracle registry's HONEST needs-statement per capability: what independent read-back would have to exist
 * before this capability's effects could ever be VERIFIED. An entry here is an UNVERIFIABLE declaration, not an oracle.
 */
const ORACLE_NEEDS: Record<string, string> = {
  'calendar.create': 'a calendar read-back oracle (event GET-by-id corroboration)',
};

/** Shared oracle-registry derivation — mail.send → the S16 plan; else honestly UNVERIFIABLE with its need stated. */
export function deriveOracle(capabilityId: string): VerificationPlan {
  return capabilityId === 'mail.send'
    ? { verifiable: 'send-corroboration', oracleId: 'verifyEffect', note: 'send-corroboration, not delivery', needs: null, productionWired: false }
    : { verifiable: false, oracleId: null, note: 'no oracle for this capability', needs: ORACLE_NEEDS[capabilityId] ?? 'a per-capability oracle', productionWired: false };
}

export interface RuntimeExecuteDeps {
  workspaceId(): string | null;
  /**
   * ROUTE A (F-P24) — OPTIONAL BY NECESSITY, NOT BY PREFERENCE. The production call site already supplies this
   * (the same `deps` object the send observer reads), so production rows carry a real actor. It is optional so
   * that existing callers passing only `workspaceId` keep type-checking unchanged — widening it to required
   * would have edited a dozen existing assertions to buy nothing.
   */
  actor?(): string | null;
}
export interface ExecuteRequestLike {
  readonly actionId: string;
  readonly accountId: string;
  readonly params: Readonly<Record<string, unknown>>;
  /** ROUTE A — present on every production request; optional here for the same reason as `actor`. */
  readonly connectorId?: string;
}

export function l6ExecutionGate(deps: RuntimeExecuteDeps, r: ExecuteRequestLike, nowMs?: number): L6GateResult {
  if (r.actionId !== 'mail.send') return { ok: true }; // only the certified consequential capability is gated
  const tenantId = deps.workspaceId() ?? '';
  // Phase-0 placeholder state hash (stable per tenant → no false drift); the propose seam supplies the real one.
  const stateHash = tenantId;
  const execDeps: ExecutionDeps = {
    nowMs: nowMs ?? Date.now(),
    currentTenantId: tenantId,
    currentStateHash: stateHash,
    stateHashAtProposal: stateHash,
    authorityFor: deriveAuthority,
    oracleFor: deriveOracle,
    // ONE named authority — the same predicate discovery uses (F-N16-1). A
    // second copy of this rule is how discovery and the boundary drifted apart.
    isCertifiedConsequential: isCertifiedConsequentialCapability,
  };
  const gate = gateL6Execution({ tenantId, capabilityId: r.actionId, account: r.accountId, params: r.params }, execDeps);
  /**
   * ROUTE A (F-P24) — MINT THE GOVERNANCE EVIDENCE WHERE THE GOVERNANCE DECISION IS MADE.
   *
   * §2 #19 keeps GOVERNANCE, EXECUTION and VERIFICATION as separate evidence classes. The observer at
   * `connectors/index.ts:641` is EXECUTION-class — it runs after `governedSend` returns and its subject is what
   * the executor did — and **a governance decision that produced no execution has nothing for it to observe.**
   * Recording it there would borrow an execution emitter to carry a governance fact, which is the collapse that
   * law forbids. So the record is minted here, at the moment the fact becomes true.
   *
   * DECISION-NEUTRAL BY CONSTRUCTION: fire-and-forget and self-catching, exactly the shape of the `:641`
   * observer. It returns nothing, alters no branch, and **the gate's return value is byte-identical for all
   * three outcomes** — a throwing store cannot change what this function decides.
   *
   * `admit` mints nothing HERE on purpose: an admitted send proceeds to `governedSend` and is recorded by the
   * execution-class observer. Emitting for it would double-record one action.
   */
  const emitGovernance = (verdict: GovernanceVerdict): void => {
    void actionRecord
      .observeGovernance(
        { connectorId: r.connectorId ?? '', accountId: r.accountId, actionId: r.actionId, params: r.params },
        verdict,
        { actor: deps.actor?.() ?? '', tenantId },
      )
      .catch(() => {});
  };
  if (gate.gate === 'refuse') {
    log.warn(`L6-GATE REFUSE capability=${r.actionId} tenant=${tenantId} — ${gate.reason}`);
    emitGovernance('DENY');
    return { ok: false, refusal: { ok: false, message: 'L6 execution gate refused', data: { outcome: 'DENIED', reason: gate.reason } } };
  }
  /**
   * A SKIP IS NOT A REFUSAL, AND THIS RECORD MUST NOT SAY IT WAS.
   *
   * F-P48: the gate did not DECIDE — the proposal lookup missed and the send proceeds. Writing `DENY` here would
   * assert a refusal that never happened and make an **ungated send look governed**, which is strictly worse than
   * the present silence. `NOT_EVALUATED` is a record whose purpose is to make **the ABSENCE of a decision**
   * visible. The two cases are told apart by the VERDICT FIELD, never by prose.
   *
   * This makes the skip VISIBLE. It does not make it refuse — F-P48 stays open until that behaviour is ruled.
   */
  if (gate.gate === 'skip') emitGovernance('NOT_EVALUATED');
  // Observability: ADMIT (a stashed L6 proposal re-derived clean and was consumed) is distinguishable from SKIP in the
  // main log — the running-app proof that a send was Brain-PROPOSED, not merely governed. Never alters the outcome.
  if (gate.gate === 'admit') log.info(`L6-GATE ADMIT capability=${gate.capabilityId} tenant=${tenantId}`);
  return { ok: true }; // 'admit' (proceed) or 'skip' (non-L6 / no stashed proposal — unchanged)
}
