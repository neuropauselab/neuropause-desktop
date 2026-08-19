import { describe, it, expect, beforeEach } from 'vitest';
import { l6ExecutionGate } from './executionGate';
import { stashProposal, clearProposals } from './proposalStore';
import { buildProposal, type ProposalRequest, type ProposalDeps, type AuthorityRequirement, type VerificationPlan, type Proposal } from './proposal';
import { composeLiveBrainState } from './liveBrainState';
import type { ActionRecord } from '../connectors/actionRecord';
import type { TenantStamp } from '../tenancy/tenantStamp';
import { composeWorkspaceDomain } from '../enterprise/workspaceFoundation/domainAggregate';
import { composeCapabilityGraph } from '../capabilityGraph/capabilityGraph';
import { capabilityGraphSources } from '../capabilityGraph/liveSources';
import { TEST_TENANT_SCOPE } from '../tenancy/testScope';

const T = '2026-08-19T00:00:00.000Z';
const STAMP: TenantStamp = { tenantId: 'tenant-A', scope: 'ws-A', authoritySource: 'activeTenantScope', timestamp: T };
// Must EXACTLY match executionGate's deriveAuthority / deriveOracle for mail.send on microsoft-entra:
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
const runtime = { workspaceId: () => 'tenant-A' as string | null };
const req = { actionId: 'mail.send', accountId: 'acc', params: PARAMS };

beforeEach(() => clearProposals());

describe('S5.4 Phase 0 · FG-10 l6ExecutionGate', () => {
  it('non-mail.send → SKIP (ok) — never gates another capability', () => {
    expect(l6ExecutionGate(runtime, { actionId: 'calendar.create', accountId: 'acc', params: {} }, 5000)).toEqual({ ok: true });
  });
  it('mail.send with NO stashed proposal → SKIP (ok) — the existing flow is unchanged', () => {
    expect(l6ExecutionGate(runtime, req, 5000)).toEqual({ ok: true });
  });
  it('a stashed proposal whose re-derivation MATCHES → ADMIT (ok, proceed)', () => {
    stashProposal(buildWith(AUTH_MATCH, PLAN_MATCH));
    expect(l6ExecutionGate(runtime, req, 5000)).toEqual({ ok: true });
  });
  it('a stashed proposal whose authority DRIFTS → observable DENIED refusal (never a silent drop)', () => {
    stashProposal(buildWith({ ...AUTH_MATCH, requiredGate: 'a-different-gate' }, PLAN_MATCH));
    const r = l6ExecutionGate(runtime, req, 5000);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.refusal.data).toMatchObject({ outcome: 'DENIED' }); // same shape as the FG-4 guard denial
  });
  it('SINGLE-USE — after one admit, a replay of the same fingerprint → SKIP (consumed, never re-admit)', () => {
    stashProposal(buildWith(AUTH_MATCH, PLAN_MATCH));
    expect(l6ExecutionGate(runtime, req, 5000)).toEqual({ ok: true }); // admit consumes
    expect(l6ExecutionGate(runtime, req, 5000)).toEqual({ ok: true }); // replay → skip (no proposal)
  });
});
