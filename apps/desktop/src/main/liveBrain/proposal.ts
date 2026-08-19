/**
 * L6 · S4.1 · THE PROPOSAL ENGINE — a data-only, deterministic proposal ARTIFACT.
 *
 * `buildProposal(request, deps)` → a certified `Proposal` (or a REFUSED/EXPIRED/BLOCKED verdict).
 * The proposal is DATA: no callable, token, credential, oracle handle, or `confirmed`; the Brain
 * proposes, it never reaches (§2#13). Consumed only by the existing proposal→confirm→CST→admission→
 * executor→verification→ActionRecord path (§2#7); S5 wires that, behind its own hard stop.
 *
 * DERIVATION RULES (built in, so attacks pass by construction — the request CANNOT carry these):
 *  (a) `authorityRequired` is DERIVED from the governance substrate (`deps.authorityFor`, RBAC/CST via
 *      the L4 graph) — a reasoning-/model-declared authority has NO field to enter and is discarded.
 *  (b) `verificationPlan` is DERIVED from the oracle registry (`deps.oracleFor`) — an oracle exists →
 *      a concrete plan; none → `{ verifiable:false, needs:… }` "UNVERIFIABLE today" — never free-text,
 *      never a false VERIFIED promise (§2#14 read-back honesty).
 *  (c) every `evidence[]` entry must RESOLVE to a real record (`deps.resolveEvidence`) — a claimed
 *      verification with no resolvable record BLOCKS the artifact.
 *  (d) EXPIRY: evidence older than the freshness window, OR state changed since reasoning → EXPIRED →
 *      HOLD (never governance-eligible).
 *  (e) TENANT: forms ONLY from a `tenantProvable` state — else REFUSED (S4.0 wired end to end).
 *
 * Deterministic (D-14): pure over (request, deps); `nowMs` + the state hashes are INJECTED, never read.
 * Zero-runtime-import: TYPES only — no value import at all, the strictest pin.
 */
import type { LiveBrainState } from './liveBrainState';

/** A reference that MUST resolve to a real record (ActionRecord id, or a substrate snapshot ref). */
export interface EvidenceRef {
  readonly kind: 'action-record' | 'snapshot';
  readonly id: string;
  readonly asOfMs: number;
}
/** A real policy fact the proposal traces to (never asserted). */
export interface PolicyFact {
  readonly kind: 'assurance' | 'rbac' | 'cst';
  readonly ref: string;
}
export interface ProposalOption {
  readonly id: string;
  readonly summary: string;
}
export interface ProposedAction {
  /** Non-authoritative hint — governance RE-RESOLVES it. */
  readonly capabilityId: string;
  /** Untrusted — RE-VALIDATED server-side. */
  readonly params: Readonly<Record<string, unknown>>;
}
export interface ProposalTarget {
  readonly connector: string;
  readonly account: string;
  readonly tenantId: string;
  readonly scope: string;
}
/** DERIVED — never authored by the request/reasoning. */
export interface AuthorityRequirement {
  readonly requiresApproval: boolean;
  readonly governanceStatus: string;
  readonly requiredGate: string;
  readonly policyVersion: string | null;
}
/** DERIVED from the oracle registry — honest when no oracle exists. */
export interface VerificationPlan {
  readonly verifiable: 'send-corroboration' | 'per-recipient' | false;
  readonly oracleId: string | null;
  readonly note: string;
  /** What is missing when `verifiable === false` (UNVERIFIABLE today). */
  readonly needs: string | null;
  readonly productionWired: boolean;
}
export interface ProposalExpiry {
  readonly freshnessWindowMs: number;
  readonly evidenceAsOfMs: number;
  readonly builtAtMs: number;
  readonly expiresAtMs: number;
}

/** The certified artifact — EXACTLY the reviewed field set. */
export interface Proposal {
  readonly proposalId: string;
  readonly tenantId: string;
  readonly purpose: string;
  readonly observation: string;
  readonly diagnosis: string;
  readonly evidence: readonly EvidenceRef[];
  readonly policyFacts: readonly PolicyFact[];
  readonly options: readonly ProposalOption[];
  readonly selectedOption: string;
  readonly proposedAction: ProposedAction;
  readonly target: ProposalTarget;
  readonly scope: string;
  readonly authorityRequired: AuthorityRequirement;
  readonly risk: string;
  readonly reversibility: 'reversible' | 'irreversible' | 'unknown';
  readonly expectedEffect: string;
  readonly verificationPlan: VerificationPlan;
  readonly expiry: ProposalExpiry;
}

/**
 * The request = the INTENT (from the L5 bridge / reasoning). It carries NO `authorityRequired` and NO
 * `verificationPlan` — those have no field here, so a caller CANNOT inject them (attacks 2 & 8 fail by
 * construction). Narrative fields (observation/diagnosis/expectedEffect) and params are inert DATA.
 */
export interface ProposalRequest {
  readonly purpose: string;
  readonly observation: string;
  readonly diagnosis: string;
  readonly options: readonly ProposalOption[];
  readonly selectedOptionId: string;
  readonly proposedAction: ProposedAction;
  readonly target: ProposalTarget;
  readonly scope: string;
  readonly risk: string;
  readonly reversibility: 'reversible' | 'irreversible' | 'unknown';
  readonly expectedEffect: string;
  readonly evidence: readonly EvidenceRef[];
  readonly freshnessWindowMs: number;
}

export interface ProposalDeps {
  readonly state: LiveBrainState;
  /** DERIVED authority (RBAC/CST via L4). Reasoning/model output is NEVER a source. */
  readonly authorityFor: (capabilityId: string, target: ProposalTarget) => AuthorityRequirement;
  /** DERIVED verification plan (oracle registry). No oracle → UNVERIFIABLE. */
  readonly oracleFor: (capabilityId: string, params: Readonly<Record<string, unknown>>) => VerificationPlan;
  /** Does an evidence ref resolve to a real record? */
  readonly resolveEvidence: (ref: EvidenceRef) => boolean;
  readonly policyFacts: readonly PolicyFact[];
  readonly nowMs: number;
  readonly stateHashAtReasoning: string;
  readonly currentStateHash: string;
}

export type ProposalResult =
  | { readonly status: 'PROPOSED'; readonly proposal: Proposal }
  | { readonly status: 'REFUSED'; readonly reason: string }
  | { readonly status: 'EXPIRED'; readonly reason: string }
  | { readonly status: 'BLOCKED'; readonly reason: string };

export function buildProposal(request: ProposalRequest, deps: ProposalDeps): ProposalResult {
  const { state } = deps;

  // (e) TENANT — form ONLY from a provably single-tenant state (S4.0). Deny-by-default.
  if (!state.tenantProvable || state.tenantId === null) {
    return { status: 'REFUSED', reason: 'tenant not provably single — no proposal object created' };
  }
  // Attack 9 — scope escalation: the target scope must equal the requested scope.
  if (request.target.scope !== request.scope) {
    return { status: 'REFUSED', reason: `scope escalation — requested scope ${request.scope}, target resolves to ${request.target.scope}` };
  }
  // Attack 1 — cross-tenant target: the target tenant must be the state's tenant.
  if (request.target.tenantId !== state.tenantId) {
    return { status: 'REFUSED', reason: `cross-tenant target — state tenant ${state.tenantId}, target ${request.target.tenantId}` };
  }
  // Attack 7 — conflicting evidence: a conflicted state cannot produce a proposal.
  if (state.conflicts.length > 0) {
    return { status: 'BLOCKED', reason: `unresolved conflict(s): ${state.conflicts.map((c) => c.about).join(', ')}` };
  }
  // (c) EVIDENCE — every ref must resolve to a real record (attack 3).
  const unresolved = request.evidence.find((e) => !deps.resolveEvidence(e));
  if (unresolved) {
    return { status: 'BLOCKED', reason: `evidence does not resolve to a real record: ${unresolved.kind}(${unresolved.id})` };
  }
  // (d) EXPIRY — state changed since reasoning (attack 5) OR stale evidence (attack 4) → EXPIRED → HOLD.
  if (deps.stateHashAtReasoning !== deps.currentStateHash) {
    return { status: 'EXPIRED', reason: 'state changed since reasoning — HOLD (not governance-eligible)' };
  }
  const evidenceAsOfMs = request.evidence.reduce((min, e) => Math.min(min, e.asOfMs), deps.nowMs);
  const expiresAtMs = evidenceAsOfMs + request.freshnessWindowMs;
  if (deps.nowMs > expiresAtMs) {
    return { status: 'EXPIRED', reason: 'evidence older than freshness window — HOLD (not governance-eligible)' };
  }

  // (a) authorityRequired DERIVED; (b) verificationPlan DERIVED — the request cannot author either.
  const authorityRequired = deps.authorityFor(request.proposedAction.capabilityId, request.target);
  const verificationPlan = deps.oracleFor(request.proposedAction.capabilityId, request.proposedAction.params);

  const proposal: Proposal = {
    // Deterministic id — same identity → same id (idempotent), no random/clock.
    proposalId: `prop:${state.tenantId}:${request.purpose}:${request.proposedAction.capabilityId}:${evidenceAsOfMs}`,
    tenantId: state.tenantId,
    purpose: request.purpose,
    observation: request.observation,
    diagnosis: request.diagnosis,
    evidence: request.evidence,
    policyFacts: deps.policyFacts,
    options: request.options,
    selectedOption: request.selectedOptionId,
    proposedAction: request.proposedAction,
    target: request.target,
    scope: request.scope,
    authorityRequired,
    risk: request.risk,
    reversibility: request.reversibility,
    expectedEffect: request.expectedEffect,
    verificationPlan,
    expiry: { freshnessWindowMs: request.freshnessWindowMs, evidenceAsOfMs, builtAtMs: deps.nowMs, expiresAtMs },
  };
  return { status: 'PROPOSED', proposal };
}
