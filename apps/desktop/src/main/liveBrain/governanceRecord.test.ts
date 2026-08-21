/**
 * ROUTE A (F-P24) — THE L6 GATE'S SILENT DECISIONS NOW MINT DURABLE GOVERNANCE EVIDENCE.
 *
 * The gate refused and skipped in silence: the refusal returned BEFORE `governedSend` and therefore before the
 * execution-class observer at `connectors/index.ts:641`, and the skip did not decide at all. **An audit saw a send
 * that was never gated and never refused.** These pins drive the REAL gate, the REAL store and the REAL counter.
 *
 * THE SHARPEST CONSTRAINT, pinned directly: **A SKIP IS NOT A REFUSAL.** Writing `DENY` for a skip would assert a
 * refusal that never happened and make an ungated send look governed — worse than the silence it replaces.
 *
 * NO EXTERNAL EFFECT: a temp dir and a real store. Nothing is sent; the gate's decisions are unchanged.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { l6ExecutionGate } from './executionGate';
import { stashProposal, clearProposals } from './proposalStore';
import { buildProposal, type ProposalRequest, type ProposalDeps, type AuthorityRequirement, type VerificationPlan, type Proposal } from './proposal';
import { composeLiveBrainState } from './liveBrainState';
import { actionRecord, type ActionRecord } from '../connectors/actionRecord';
import { deriveWriteStates } from '../connectors/m365WriteStates';
import { awaitingVerification, type ReconcilableRecord } from '../reconciliation/readBackReconciler';
import type { TenantStamp } from '../tenancy/tenantStamp';
import { composeWorkspaceDomain } from '../enterprise/workspaceFoundation/domainAggregate';
import { composeCapabilityGraph } from '../capabilityGraph/capabilityGraph';
import { capabilityGraphSources } from '../capabilityGraph/liveSources';
import { TEST_TENANT_SCOPE } from '../tenancy/testScope';

const T = '2026-08-19T00:00:00.000Z';
const WS = 'tenant-A'; // the value `workspaceId()` returns — the WORKSPACE key, per F-P45
const STAMP: TenantStamp = { tenantId: 'tenant-A', scope: 'ws-A', authoritySource: 'activeTenantScope', timestamp: T };
const AUTH_MATCH: AuthorityRequirement = { requiresApproval: true, governanceStatus: 'governed-certified', requiredGate: 'human-confirm + CST admission', policyVersion: 'm365-send-policy-1' };
const PLAN_MATCH: VerificationPlan = { verifiable: 'send-corroboration', oracleId: 'verifyEffect', note: 'send-corroboration, not delivery', needs: null, productionWired: false };
const PARAMS = { to: ['op@ex.com'], subject: 'hi', body: 'hello' };

const action = (): ActionRecord => ({
  id: 'act_1', at: T, requestId: 'r', transitionId: 'tr', actor: 'local:x', tenantId: 'tenant-A', connectorId: 'microsoft-entra', accountId: 'acc',
  actionId: 'mail.send', recipients: { to: [], cc: [], bcc: [] }, subjectFingerprint: '', bodyFingerprint: '', verdict: 'ALLOW', executed: true,
  outcome: 'ACKNOWLEDGED', admissionRef: 'tr', verification: { terminal: 'VERIFIED_SUCCESS', internetMessageId: null, at: T },
});
const provable = () =>
  composeLiveBrainState({
    workspace: { ...composeWorkspaceDomain([{ domain: 'people', moduleId: 'hr-employees', label: 'People' }], { scope: () => TEST_TENANT_SCOPE, now: () => T, moduleCount: () => 3 }), tenant: STAMP },
    capabilities: { ...composeCapabilityGraph(capabilityGraphSources({ mutations: () => [{ capabilityId: 'mail.send', connectorId: 'microsoft-entra' }], scope: () => true })), tenant: STAMP },
    environment: null, purpose: null, discovery: null, actions: [action()],
  });
const buildWith = (auth: AuthorityRequirement, plan: VerificationPlan): Proposal => {
  const req: ProposalRequest = {
    purpose: 'send-email', observation: 'obs', diagnosis: 'diag', options: [{ id: 'o1', summary: 'send' }], selectedOptionId: 'o1',
    proposedAction: { capabilityId: 'mail.send', params: PARAMS }, target: { connector: 'microsoft-entra', account: 'acc', tenantId: 'tenant-A', scope: 'ws-A' },
    scope: 'ws-A', risk: 'low', reversibility: 'irreversible', expectedEffect: 'email left the mailbox', evidence: [{ kind: 'action-record', id: 'act_1', asOfMs: 1000 }],
  };
  const deps: ProposalDeps = { state: provable(), authorityFor: () => auth, oracleFor: () => plan, resolveEvidence: () => ({ tenantId: 'tenant-A' }), policyFacts: [], nowMs: 5000, freshnessWindowMs: 60_000, stateHashAtReasoning: 'tenant-A', currentStateHash: 'tenant-A' };
  const r = buildProposal(req, deps);
  if (r.status !== 'PROPOSED') throw new Error('setup');
  return r.proposal;
};

/** The production request shape — carries connectorId, exactly as `connectors/index.ts` passes it. */
const req = { actionId: 'mail.send', accountId: 'acc', params: PARAMS, connectorId: 'microsoft-entra' };
const runtime = { workspaceId: () => WS as string | null, actor: () => 'user:ops' as string | null };

let dir: string;
beforeEach(() => {
  clearProposals();
  dir = mkdtempSync(join(tmpdir(), 'np-routea-'));
  actionRecord.useDirForTests(dir);
});
afterEach(() => {
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

/**
 * Reads the store back with NO settle delay — and that is a RECORD OF A CLOSED DEFECT (F-P52), not an accident.
 *
 * **THIS FUNCTION USED TO WAIT 60 ms, AND THE WAIT WAS A WORKAROUND.** When these pins were first written they
 * polled immediately, lost, and read zero rows. The cause was not the test: `ActionRecordStore.ensureLoaded()`
 * had **no in-flight memo**, so the fire-and-forget emit and the query each performed their own first read and
 * **the second assignment overwrote the row the first had pushed.** The settle hid it by letting the writer
 * finish alone.
 *
 * F-P52 fixed the loader (one shared in-flight load) and **the settle was then REMOVED AND THESE PINS RE-RUN
 * WITHOUT IT** — the honest closure test, and the only way to know the workaround was for that defect and not
 * another. They pass immediately, because the emit registers its `await` on the shared load before the query
 * does, so its push is ordered first.
 *
 * If this ever needs a delay again, something regressed in the store — do not re-add one; measure why.
 */
async function rows(): Promise<readonly ActionRecord[]> {
  return (await actionRecord.query({ tenantId: WS })) as readonly ActionRecord[];
}

describe('Route A · the gate records what it decided — and what it did not', () => {
  it('CRITERION 3+4 — a SKIP mints NOT_EVALUATED and NEVER DENY (the fabrication guard)', async () => {
    expect(l6ExecutionGate(runtime, req, 5000)).toEqual({ ok: true }); // no stashed proposal ⇒ skip
    const [row] = await rows();
    expect(row.verdict).toBe('NOT_EVALUATED');
    expect(row.verdict).not.toBe('DENY'); // asserted directly: a skip must never claim a refusal happened
    expect(row.executed).toBe(false);
    expect(row.outcome).toBe('NOT_STARTED');
    expect(row.verification).toBeNull();
  });

  it('CRITERION 4 — a REFUSAL mints DENY, and the two are told apart BY FIELD, never by prose', async () => {
    stashProposal(buildWith({ ...AUTH_MATCH, requiredGate: 'a-different-gate' }, PLAN_MATCH));
    const r = l6ExecutionGate(runtime, req, 5000);
    expect(r.ok).toBe(false);
    const [row] = await rows();
    expect(row.verdict).toBe('DENY');
    // The discriminator is a FIELD both rows carry, not a message either one happens to contain.
    expect(['DENY', 'NOT_EVALUATED']).toContain(row.verdict);
    expect(row.outcome).toBe('NOT_STARTED'); // execution NOT_STARTED for both — never execution_failed
  });

  it('CRITERION 7+8 — transitionId is the ESTABLISHED empty form (never minted), keyed by the WORKSPACE id', async () => {
    l6ExecutionGate(runtime, req, 5000);
    const [row] = await rows();
    expect(row.transitionId).toBe(''); // no transition exists — absent, not fabricated
    expect(row.admissionRef).toBe(''); // no admission either
    expect(row.requestId).toBe(''); // no execution request was minted
    expect(row.requestTime).toBeNull(); // NP-015 — a time we were not told is ABSENT
    expect(row.tenantId).toBe(WS); // F-P45 — the key the writer writes
    expect(row.connectorId).toBe('microsoft-entra');
  });

  it('CRITERION 5 — a governance row moves NO counter (all five states unchanged across an emit)', async () => {
    const executed = action();
    const before = deriveWriteStates([executed]);
    l6ExecutionGate(runtime, req, 5000);
    const governance = (await rows())[0];
    const after = deriveWriteStates([executed, governance]);
    expect(after).toEqual(before); // requested included — a refusal is not a requested write
    expect(after.requested).toBe(1);
    // And a store holding ONLY governance rows reports an honest zero, never a phantom write.
    expect(deriveWriteStates([governance])).toMatchObject({ requested: 0, authorized: 0, executed: 0, providerAcknowledged: 0, externallyObserved: 0 });
  });

  it('CRITERION 6 — a governance row is NEVER selected by awaitingVerification', async () => {
    l6ExecutionGate(runtime, req, 5000);
    const governance = (await rows())[0];
    expect(awaitingVerification(governance as unknown as ReconcilableRecord)).toBe(false);
    // Control: the execution row this filter exists for still qualifies when unverified.
    expect(awaitingVerification({ ...action(), verification: null } as unknown as ReconcilableRecord)).toBe(true);
  });

  it('CRITERION 2+9 — a THROWING store never alters the gate return; the return is identical for all outcomes', async () => {
    vi.spyOn(actionRecord, 'observeGovernance').mockRejectedValue(new Error('disk full'));
    // SKIP with a failing store — byte-identical to the pre-Route-A return.
    expect(l6ExecutionGate(runtime, req, 5000)).toEqual({ ok: true });
    // REFUSE with a failing store — the refusal is unchanged in shape and content.
    stashProposal(buildWith({ ...AUTH_MATCH, requiredGate: 'a-different-gate' }, PLAN_MATCH));
    const refused = l6ExecutionGate(runtime, req, 5000);
    expect(refused).toEqual({ ok: false, refusal: { ok: false, message: 'L6 execution gate refused', data: { outcome: 'DENIED', reason: 'authority re-derivation mismatch' } } });
    // ADMIT with a failing store — still proceeds.
    clearProposals();
    stashProposal(buildWith(AUTH_MATCH, PLAN_MATCH));
    expect(l6ExecutionGate(runtime, req, 5000)).toEqual({ ok: true });
    // `observeGovernance` is `async`, so a store fault is ALWAYS a rejection and never a synchronous throw —
    // which is why `.catch` is sufficient and the gate's control flow cannot be reached by a failing store.
  });

  it('ADMIT MINTS NOTHING HERE — the execution observer records it, and one action is never double-recorded', async () => {
    stashProposal(buildWith(AUTH_MATCH, PLAN_MATCH));
    expect(l6ExecutionGate(runtime, req, 5000)).toEqual({ ok: true });
    await new Promise((res) => setTimeout(res, 20));
    expect(await actionRecord.query({ tenantId: WS })).toHaveLength(0);
  });
});
