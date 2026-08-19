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
}

export interface ProposalDeps {
  readonly state: LiveBrainState;
  /** DERIVED authority (RBAC/CST via L4). Reasoning/model output is NEVER a source. */
  readonly authorityFor: (capabilityId: string, target: ProposalTarget) => AuthorityRequirement;
  /** DERIVED verification plan (oracle registry). No oracle → UNVERIFIABLE. */
  readonly oracleFor: (capabilityId: string, params: Readonly<Record<string, unknown>>) => VerificationPlan;
  /** Resolve an evidence ref to its real record's TENANT, or null if it does not resolve. */
  readonly resolveEvidence: (ref: EvidenceRef) => { readonly tenantId: string } | null;
  readonly policyFacts: readonly PolicyFact[];
  readonly nowMs: number;
  /** GOVERNED staleness tolerance (a policy constant) — NOT request-controlled (S4.2 fix). */
  readonly freshnessWindowMs: number;
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

  // (e) TENANT — form ONLY from a provably single-tenant state (S4.0). Reject reasons are GENERIC
  // (they never echo the state's tenant/scope — S4.2 no-leak fix).
  if (!state.tenantProvable || state.tenantId === null || state.tenantScope === null) {
    return { status: 'REFUSED', reason: 'not a provably single tenant' };
  }
  // Attack 9 — scope confinement: request AND target scope must equal the STATE's PROVEN scope
  // (not merely each other — the S4.2 confused-deputy fix).
  if (request.scope !== state.tenantScope || request.target.scope !== state.tenantScope) {
    return { status: 'REFUSED', reason: 'scope escalation' };
  }
  // Attack 1 — cross-tenant target: the target tenant must be the state's tenant.
  if (request.target.tenantId !== state.tenantId) {
    return { status: 'REFUSED', reason: 'cross-tenant target' };
  }
  // Attack 7 — conflicting evidence: a conflicted state cannot produce a proposal.
  if (state.conflicts.length > 0) {
    return { status: 'BLOCKED', reason: 'unresolved conflict in state' };
  }
  // (c) EVIDENCE — a proposal MUST be grounded (≥1 evidence), every ref must RESOLVE to a real record,
  // and every record must belong to the STATE tenant (S4.2 cross-tenant-evidence fix).
  if (request.evidence.length === 0) {
    return { status: 'BLOCKED', reason: 'a proposal must cite at least one resolvable evidence record' };
  }
  for (const e of request.evidence) {
    const resolved = deps.resolveEvidence(e);
    if (resolved === null) return { status: 'BLOCKED', reason: 'evidence does not resolve to a real record' };
    if (resolved.tenantId !== state.tenantId) return { status: 'BLOCKED', reason: 'evidence belongs to another tenant' };
  }
  // (d) EXPIRY — state changed since reasoning (attack 5) OR stale evidence (attack 4) → EXPIRED → HOLD.
  // The freshness window is a GOVERNED deps constant (S4.2 fix), NOT request-controlled.
  if (deps.stateHashAtReasoning !== deps.currentStateHash) {
    return { status: 'EXPIRED', reason: 'state changed since reasoning' };
  }
  const evidenceAsOfMs = request.evidence.reduce((min, e) => Math.min(min, e.asOfMs), deps.nowMs);
  if (deps.nowMs > evidenceAsOfMs + deps.freshnessWindowMs) {
    return { status: 'EXPIRED', reason: 'evidence older than the governed freshness window' };
  }

  // (a) authorityRequired DERIVED; (b) verificationPlan DERIVED — then VALIDATED before embedding
  // (S4.2 fix: a crafted deps cannot smuggle a self-authorizing authority or a spoofed plan).
  const authorityRequired = deps.authorityFor(request.proposedAction.capabilityId, request.target);
  if (!authorityRequired.requiresApproval) {
    return { status: 'BLOCKED', reason: 'a proposal must require human approval — the Brain never proposes an auto-approved action' };
  }
  const verificationPlan = deps.oracleFor(request.proposedAction.capabilityId, request.proposedAction.params);
  if (
    (verificationPlan.verifiable !== false && verificationPlan.oracleId === null) ||
    (verificationPlan.verifiable === false && verificationPlan.needs === null)
  ) {
    return { status: 'BLOCKED', reason: 'verification plan is internally inconsistent (claims verifiable with no oracle, or unverifiable with no stated need)' };
  }

  const expiresAtMs = evidenceAsOfMs + deps.freshnessWindowMs;
  const proposal: Proposal = {
    // Deterministic + collision-resistant: includes a stable fingerprint of the executable core + target
    // (S4.2 fix — two proposals with different params/account no longer alias to one id).
    proposalId: `prop:${state.tenantId}:${request.purpose}:${bodyFingerprint(request)}:${evidenceAsOfMs}`,
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
    expiry: { freshnessWindowMs: deps.freshnessWindowMs, evidenceAsOfMs, builtAtMs: deps.nowMs, expiresAtMs },
  };
  return { status: 'PROPOSED', proposal };
}

/** A stable, deterministic fingerprint of a proposal's executable core + target (no crypto import). */
function bodyFingerprint(request: ProposalRequest): string {
  return stableStringify({
    capabilityId: request.proposedAction.capabilityId,
    params: request.proposedAction.params,
    target: request.target,
    selectedOption: request.selectedOptionId,
  });
}

/** Deterministic canonical serialization — object keys sorted recursively, so identical content → identical string. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.keys(value as Record<string, unknown>)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`);
  return `{${entries.join(',')}}`;
}
