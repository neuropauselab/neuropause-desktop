/**
 * S5.4 · THE BRAIN-PROPOSE LANE — the production wiring that turns a VALIDATED operator mandate into a
 * certified L6 `Proposal`, stashes it for the FG-10 execution gate, and returns the FG-9 `brainReview`
 * display fields for the confirm panel.
 *
 * This is the wiring layer (like `executionGate.ts`), not a pinned-pure core: it composes the REAL substrate
 * (workspace domain snapshot · capability graph over the real assurance predicate · the S34a ActionRecord) into a
 * `LiveBrainState`, then drives the pure, S4-certified `buildProposal`. Every S4 refusal stands: an unprovable or
 * conflicted tenant, unresolvable evidence, stale state, or a non-approval authority yields NO proposal — the lane
 * returns null, the propose response carries no `brainReview`, and the panel behaves exactly as today (the send can
 * still proceed as a human-composed governed send; it is simply not Brain-proposed).
 *
 * ── ALIGNMENT INVARIANTS (each one pinned in brainProposeLane.test.ts) ────────────────────────────────────────
 * 1. TENANCY KEY = the WORKSPACE id — the SAME value the FG-10 gate re-derives at execute (`deps.workspaceId()`,
 *    which is also the ActionRecord's tenant key in the live wiring). A mismatch would make the gate SKIP.
 * 2. DERIVATIONS — authority/oracle come from LITERALLY the `executionGate` functions (single source), so the
 *    execution-time re-derivation comparison is an equality of the same substrate, not a coincidence of copies.
 * 3. PARAMS — the stash carries the VALIDATED artifact's params in the EXACT execute shape ({to[], subject, body}),
 *    so an UNEDITED confirm re-derives the same fingerprint (ADMIT) and ANY operator edit yields a different
 *    fingerprint (SKIP — an edited send is no longer the Brain's proposal; it proceeds as human-composed).
 * 4. PROPOSE-SIDE ONLY — no executor / CST / send-transition import (the Brain proposes; it never reaches, §2#13).
 *
 * Zero authority: the lane can only produce data (a stashed artifact + display strings). Memory note (§2#15): the
 * ActionRecords cited here are EVIDENCE for the proposal — they grant nothing; authorization is re-derived at
 * execution time by the gate regardless of any history.
 */
import type { TenantScope } from '@neuropause/shared';
import type { ActionRecord } from '../connectors/actionRecord';
import { composeLiveBrainState } from './liveBrainState';
import { buildProposal, type EvidenceRef, type ProposalDeps, type ProposalRequest } from './proposal';
import { stashProposal } from './proposalStore';
import { toBrainReview, type BrainReviewFields } from './toBrainReview';
import { deriveAuthority, deriveOracle } from './executionGate';
import { workspaceDomainSnapshot, type ScopedCountStore } from '../enterprise/workspaceFoundation/domainSources';
import { composeCapabilityGraph } from '../capabilityGraph/capabilityGraph';
import { capabilityGraphSources } from '../capabilityGraph/liveSources';
import { mutationAssuranceFor, M365_CONNECTOR_ID } from '../capabilities/liveCapabilitySources';
import type { TenantStamp } from '../tenancy/tenantStamp';
import { createLogger } from '../logger';

const log = createLogger('brain-propose-lane');

/** GOVERNED freshness/expiry window (10 min): the operator's reading time at the ASK panel; enforced at confirm. */
const FRESHNESS_WINDOW_MS = 10 * 60_000;

/** The VALIDATED operator mandate — from the producer's artifact, never the raw request (S13 literalism upstream). */
export interface OperatorMandate {
  readonly capabilityId: string;
  readonly accountId: string;
  readonly to: readonly string[];
  readonly subject: string;
  readonly body: string;
  readonly purpose: string | null;
}

export interface BrainProposeLaneDeps {
  readonly scope: () => TenantScope | null;
  /** The enterprise module registry accessor, or a null-store fallback (modules read UNAVAILABLE — honest absence). */
  readonly moduleStore: (moduleId: string) => ScopedCountStore | null;
  /** The S34a ActionRecord query for this tenant key (already tenant-isolated). */
  readonly actions: (tenantKey: string) => Promise<readonly ActionRecord[]>;
  readonly nowMs: () => number;
}

/** Deterministic canonical serialization (no crypto import) — the state-hash basis. */
function canon(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canon).join(',')}]`;
  return `{${Object.keys(value as Record<string, unknown>).sort().map((k) => `${JSON.stringify(k)}:${canon((value as Record<string, unknown>)[k])}`).join(',')}}`;
}

/**
 * Compose the real state, build the certified proposal, stash it for the FG-10 gate, and return the FG-9
 * review fields — or null when the S4 engine refuses (the response then honestly carries no brainReview).
 */
export async function runBrainProposeLane(
  mandate: OperatorMandate,
  deps: BrainProposeLaneDeps,
): Promise<BrainReviewFields | null> {
  const scope = deps.scope();
  if (scope === null) return null; // no resolved tenant scope → no Brain proposal (fail-closed, silent-honest)
  // ALIGNMENT 1 — the gate re-derives its tenant key as the WORKSPACE id; the lane must key identically.
  const tenantKey = scope.workspaceId;
  const nowMs = deps.nowMs();
  const nowIso = new Date(nowMs).toISOString();
  const stamp: TenantStamp = { tenantId: tenantKey, scope: tenantKey, authoritySource: 'activeTenantScope', timestamp: nowIso };

  let actions: readonly ActionRecord[];
  try {
    actions = await deps.actions(tenantKey);
  } catch (err) {
    log.warn('action-record query failed — proposing without action evidence', err);
    actions = [];
  }

  const workspace = { ...workspaceDomainSnapshot({ moduleStore: deps.moduleStore, scope: () => scope }), tenant: stamp };
  const capabilities = {
    ...composeCapabilityGraph(
      capabilityGraphSources({
        // The graph is scoped to the mandated capability on the certified connector — the route under review.
        mutations: () => [{ capabilityId: mandate.capabilityId, connectorId: M365_CONNECTOR_ID }],
        scope: () => true, // resolved: deps.scope() returned non-null above
      }),
    ),
    tenant: stamp,
  };
  const state = composeLiveBrainState({ workspace, capabilities, environment: null, purpose: null, discovery: null, actions });
  if (!state.tenantProvable || state.conflicts.length > 0) {
    log.warn(`no Brain proposal — tenant not provably single (provable=${state.tenantProvable}, conflicts=${state.conflicts.length})`);
    return null;
  }
  const stateHash = canon({ tenantId: state.tenantId, scope: state.tenantScope, sections: state.sections, uncertainty: state.uncertainty });

  // EVIDENCE — the state snapshot this proposal is formed FROM (always fresh, tenant-bound), plus the latest
  // in-window ActionRecord when one exists. An out-of-window record is NOT cited (it would honestly EXPIRE the
  // proposal via the min-asOf rule — old history is not fresh evidence).
  const snapshotId = `live-brain-state:${tenantKey}:${nowMs}`;
  const evidence: EvidenceRef[] = [{ kind: 'snapshot', id: snapshotId, asOfMs: nowMs }];
  const latest = actions.length > 0 ? actions[actions.length - 1] : null;
  if (latest !== null) {
    const atMs = Date.parse(latest.at);
    if (Number.isFinite(atMs) && nowMs - atMs <= FRESHNESS_WINDOW_MS) {
      evidence.push({ kind: 'action-record', id: latest.id, asOfMs: atMs });
    }
  }
  const resolveEvidence = (ref: EvidenceRef): { readonly tenantId: string } | null => {
    if (ref.kind === 'snapshot') return ref.id === snapshotId ? { tenantId: tenantKey } : null;
    const found = actions.find((a) => a.id === ref.id);
    return found ? { tenantId: found.tenantId } : null;
  };

  const recipients = mandate.to.join(', ');
  const request: ProposalRequest = {
    purpose: mandate.purpose !== null && mandate.purpose.trim().length > 0 ? mandate.purpose.trim() : 'send-email',
    observation: 'operator mandate received on the validated propose feed; a governed route exists for this capability',
    diagnosis: 'certified consequential capability — human confirmation and CST admission required',
    options: [{ id: 'send-mandated-email', summary: `send one email to ${recipients}` }],
    selectedOptionId: 'send-mandated-email',
    // ALIGNMENT 3 — EXACTLY the execute-request shape, from the VALIDATED artifact.
    proposedAction: { capabilityId: mandate.capabilityId, params: { to: [...mandate.to], subject: mandate.subject, body: mandate.body } },
    target: { connector: M365_CONNECTOR_ID, account: mandate.accountId, tenantId: tenantKey, scope: tenantKey },
    scope: tenantKey,
    risk: 'consequential — one external email',
    reversibility: 'irreversible',
    expectedEffect: `one message to ${recipients} appears in the sender's Sent Items`,
    evidence,
  };
  const proposalDeps: ProposalDeps = {
    state,
    authorityFor: deriveAuthority, // ALIGNMENT 2 — literally the gate's derivations
    oracleFor: deriveOracle,
    resolveEvidence,
    policyFacts: [{ kind: 'assurance', ref: mutationAssuranceFor(M365_CONNECTOR_ID) }],
    nowMs,
    freshnessWindowMs: FRESHNESS_WINDOW_MS,
    stateHashAtReasoning: stateHash, // one composition per call — reasoning and build share the hash
    currentStateHash: stateHash,
  };

  const built = buildProposal(request, proposalDeps);
  if (built.status !== 'PROPOSED') {
    log.warn(`no Brain proposal — S4 engine ${built.status}: ${built.reason}`);
    return null;
  }
  stashProposal(built.proposal);
  log.info(`Brain proposal stashed for the FG-10 gate — capability=${mandate.capabilityId} tenant=${tenantKey}`);
  return toBrainReview(built.proposal);
}
