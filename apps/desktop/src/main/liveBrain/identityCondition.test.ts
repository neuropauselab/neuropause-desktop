/**
 * F-P48 — GOVERN THE IDENTITY CONDITION, NOT THE LOOKUP RESULT.
 *
 * The gate skipped on a proposal-lookup miss and the send PROCEEDED — including when the miss happened because
 * IDENTITY DID NOT RESOLVE, i.e. exactly when the gate mattered most. **A gate that skips on a key miss is not a
 * gate, it is a lookup with a permissive default.**
 *
 * The fix distinguishes the two skips rather than governing the miss:
 *   identity RESOLVED   + no proposal → LEGITIMATE SKIP, the send proceeds (the primary send path)
 *   identity UNRESOLVED + no proposal → GOVERNANCE FAILURE, REFUSE with `IDENTITY_UNRESOLVED`
 *
 * **THIS IS THE FIRST DECISION-CHANGING GATE SLICE.** Route A added evidence and changed nothing; this changes
 * whether the system sends. Route A's byte-identical-return baseline is what makes that change measurable.
 *
 * NO EXTERNAL EFFECT: a temp dir and the real store. Nothing is sent.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { l6ExecutionGate } from './executionGate';
import { stashProposal, clearProposals } from './proposalStore';
import { buildProposal, type ProposalRequest, type ProposalDeps, type AuthorityRequirement, type VerificationPlan, type Proposal } from './proposal';
import { composeLiveBrainState } from './liveBrainState';
import { actionRecord, type ActionRecord } from '../connectors/actionRecord';
import { deriveWriteStates } from '../connectors/m365WriteStates';
import type { TenantStamp } from '../tenancy/tenantStamp';
import { composeWorkspaceDomain } from '../enterprise/workspaceFoundation/domainAggregate';
import { composeCapabilityGraph } from '../capabilityGraph/capabilityGraph';
import { capabilityGraphSources } from '../capabilityGraph/liveSources';
import { TEST_TENANT_SCOPE } from '../tenancy/testScope';

const T = '2026-08-19T00:00:00.000Z';
const WS = 'tenant-A';
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
const matchingProposal = (): Proposal => {
  const req: ProposalRequest = {
    purpose: 'send-email', observation: 'obs', diagnosis: 'diag', options: [{ id: 'o1', summary: 'send' }], selectedOptionId: 'o1',
    proposedAction: { capabilityId: 'mail.send', params: PARAMS }, target: { connector: 'microsoft-entra', account: 'acc', tenantId: 'tenant-A', scope: 'ws-A' },
    scope: 'ws-A', risk: 'low', reversibility: 'irreversible', expectedEffect: 'email left the mailbox', evidence: [{ kind: 'action-record', id: 'act_1', asOfMs: 1000 }],
  };
  const deps: ProposalDeps = { state: provable(), authorityFor: () => AUTH_MATCH, oracleFor: () => PLAN_MATCH, resolveEvidence: () => ({ tenantId: 'tenant-A' }), policyFacts: [], nowMs: 5000, freshnessWindowMs: 60_000, stateHashAtReasoning: 'tenant-A', currentStateHash: 'tenant-A' };
  const r = buildProposal(req, deps);
  if (r.status !== 'PROPOSED') throw new Error('setup');
  return r.proposal;
};

const req = { actionId: 'mail.send', accountId: 'acc', params: PARAMS, connectorId: 'microsoft-entra' };
/** Identity RESOLVES — the ordinary signed-in case. */
const resolved = { workspaceId: () => WS as string | null, actor: () => 'user:ops' as string | null };
/** Identity DOES NOT resolve — `workspaceId()` is total in production and yields '' (runtimeCore.ts:474-478). */
const unresolved = { workspaceId: () => '' as string | null, actor: () => 'user:ops' as string | null };

let dir: string;
beforeEach(() => {
  clearProposals();
  dir = mkdtempSync(join(tmpdir(), 'np-fp48-'));
  actionRecord.useDirForTests(dir);
});
afterEach(() => {
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

const rows = async (tenantId: string): Promise<readonly ActionRecord[]> =>
  (await actionRecord.query({ tenantId })) as readonly ActionRecord[];

describe('F-P48 · the identity condition governs, not the lookup result', () => {
  it('PIN 1 — resolved + proposal → ADMIT, and the send proceeds', () => {
    stashProposal(matchingProposal());
    expect(l6ExecutionGate(resolved, req, 5000)).toEqual({ ok: true });
  });

  /**
   * PIN 2 — THE REGRESSION GUARD FOR THE PRIMARY SEND PATH. It outranks every other pin here.
   *
   * DERIVED FROM THE CONSUMER, NOT FROM THE GATE'S OWN BRANCH (§2 #27). A pin written from the branch would only
   * assert that the branch is the branch. So this reads the CONSUMER'S ACTUAL STOPPING CONDITION out of
   * `connectors/index.ts` and asserts (a) that the consumer stops on `!ok` and nothing else, and (b) that the
   * human-composed case yields `ok: true`. If the consumer's guard is ever rewritten, this pin's premise fails
   * loudly instead of silently going stale.
   *
   * The path it protects: `M365WritePanel.tsx:106` → `IpcChannel.M365ActionExecute` → `connectors/index.ts:593`
   * → the gate — resolved workspace, no proposal, because the only production `stashProposal` caller is
   * `brainProposeLane.ts:165`. A blanket `skip → deny` would break every ordinary send in the product.
   */
  it('PIN 2 — resolved + NO proposal → SKIP, AND THE SEND STILL PROCEEDS', () => {
    const consumer = readFileSync(join(__dirname, '..', 'connectors', 'index.ts'), 'utf8');
    // The ONLY thing that stops the send at this seam, read from the consumer itself.
    expect(consumer).toContain('if (!l6.ok) return l6.refusal;');

    const result = l6ExecutionGate(resolved, req, 5000);
    expect(result).toEqual({ ok: true });
    expect(result.ok).toBe(true); // ⇒ the consumer does not return a refusal ⇒ the send proceeds
  });

  it('PIN 3 — unresolved identity → REFUSE, and the send does NOT proceed', () => {
    const result = l6ExecutionGate(unresolved, req, 5000);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusal.ok).toBe(false); // the consumer returns this, so the send stops
  });

  it('PIN 4 — the refusal carries IDENTITY_UNRESOLVED, never a proposal-boundary reason', () => {
    const result = l6ExecutionGate(unresolved, req, 5000);
    if (result.ok) throw new Error('expected a refusal');
    expect(result.refusal.data).toMatchObject({ outcome: 'DENIED', reason: 'IDENTITY_UNRESOLVED' });
    // They cannot share an enum because they cannot share a moment: the seven below are reachable only AFTER a
    // proposal is found; this one only BEFORE the lookup runs.
    const boundary = readFileSync(join(__dirname, 'proposalExecutionBoundary.ts'), 'utf8');
    expect(boundary).not.toContain('IDENTITY_UNRESOLVED');
    for (const seven of [
      'not a certified consequential capability', 'tenant drifted since the proposal was formed', 'proposal expired',
      'state changed since the proposal was formed', 'authority re-derivation mismatch',
      'a certified proposal must still require approval at execution time', 'verification-plan re-derivation mismatch',
    ]) {
      expect((result.refusal.data as { reason: string }).reason).not.toBe(seven);
    }
  });

  it('PIN 5 — the refusal MINTS Route A’s governance row, keyed by the EMPTY workspace', async () => {
    l6ExecutionGate(unresolved, req, 5000);
    const [row] = await rows(''); // the '' key is RULED AND KEPT — see §5.0d's OBSERVABLE ≠ RECORDED ≠ RETRIEVABLE
    expect(row.verdict).toBe('DENY');
    expect(row.executed).toBe(false);
    expect(row.outcome).toBe('NOT_STARTED');
    expect(row.verification).toBeNull();
    expect(row.tenantId).toBe(''); // honest: it records that identity was unresolved, and invents no workspace
    // KNOWN CONSEQUENCE, asserted so it is never discovered by surprise: no legitimate workspace can see it.
    expect(await rows(WS)).toHaveLength(0);
  });

  it('PIN 6 — the governance row moves NO counter', async () => {
    const executed = action();
    const before = deriveWriteStates([executed]);
    l6ExecutionGate(unresolved, req, 5000);
    const [governance] = await rows('');
    expect(deriveWriteStates([executed, governance])).toEqual(before);
  });

  it('PIN 7 — a throwing store does NOT change the decision: the refusal stands without its evidence', () => {
    vi.spyOn(actionRecord, 'observeGovernance').mockRejectedValue(new Error('disk full'));
    const result = l6ExecutionGate(unresolved, req, 5000);
    // Evidence is best-effort; REFUSAL IS NOT. A failed emit must never soften a governance decision.
    expect(result).toEqual({ ok: false, refusal: { ok: false, message: 'L6 execution gate refused', data: { outcome: 'DENIED', reason: 'IDENTITY_UNRESOLVED' } } });
  });
});
