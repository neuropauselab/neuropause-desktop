import { describe, it, expect, beforeEach } from 'vitest';
import { toBrainReview } from './toBrainReview';
import { stashProposal, gateL6Execution, clearProposals, type L6ExecuteRequestLike } from './proposalStore';
import { buildProposal, type ProposalRequest, type ProposalDeps, type AuthorityRequirement, type VerificationPlan, type Proposal } from './proposal';
import { admitForExecution, type ExecutionDeps } from './proposalExecutionBoundary';
import { composeLiveBrainState } from './liveBrainState';
import type { ActionRecord } from '../connectors/actionRecord';
import type { TenantStamp } from '../tenancy/tenantStamp';
import { composeWorkspaceDomain } from '../enterprise/workspaceFoundation/domainAggregate';
import { composeCapabilityGraph } from '../capabilityGraph/capabilityGraph';
import { capabilityGraphSources } from '../capabilityGraph/liveSources';
import { TEST_TENANT_SCOPE } from '../tenancy/testScope';

const T = '2026-08-19T00:00:00.000Z';
const STAMP: TenantStamp = { tenantId: 'tenant-A', scope: 'ws-A', authoritySource: 'activeTenantScope', timestamp: T };
const AUTH: AuthorityRequirement = { requiresApproval: true, governanceStatus: 'governed-certified', requiredGate: 'human-confirm + CST admission', policyVersion: 'm365-send-policy-1' };
const PLAN: VerificationPlan = { verifiable: 'send-corroboration', oracleId: 'verifyEffect', note: 'x', needs: null, productionWired: false };
const UNVERIFIABLE: VerificationPlan = { verifiable: false, oracleId: null, note: '', needs: 'a per-capability oracle', productionWired: false };
const action = (): ActionRecord => ({
  id: 'act_1', at: T, requestId: 'r', transitionId: 'tr', actor: 'local:x', tenantId: 'tenant-A',
  connectorId: 'microsoft-entra', accountId: 'acc', actionId: 'mail.send', recipients: { to: [], cc: [], bcc: [] },
  subjectFingerprint: '', bodyFingerprint: '', verdict: 'ALLOW', executed: true, outcome: 'ACKNOWLEDGED', admissionRef: 'tr',
  verification: { terminal: 'VERIFIED_SUCCESS', internetMessageId: null, at: T },
});
const provable = () =>
  composeLiveBrainState({
    workspace: { ...composeWorkspaceDomain([{ domain: 'people', moduleId: 'hr-employees', label: 'People' }], { scope: () => TEST_TENANT_SCOPE, now: () => T, moduleCount: () => 3 }), tenant: STAMP },
    capabilities: { ...composeCapabilityGraph(capabilityGraphSources({ mutations: () => [{ capabilityId: 'mail.send', connectorId: 'microsoft-entra' }], scope: () => true })), tenant: STAMP },
    environment: null, purpose: null, discovery: null, actions: [action()],
  });
const PARAMS = { to: ['op@ex.com'], subject: 'hi', body: 'hello' };
const buildOne = (plan: VerificationPlan = PLAN): Proposal => {
  const req: ProposalRequest = {
    purpose: 'send-email', observation: 'obs', diagnosis: 'diag', options: [{ id: 'o1', summary: 'send' }], selectedOptionId: 'o1',
    proposedAction: { capabilityId: 'mail.send', params: PARAMS }, target: { connector: 'microsoft-entra', account: 'acc', tenantId: 'tenant-A', scope: 'ws-A' },
    scope: 'ws-A', risk: 'low', reversibility: 'irreversible', expectedEffect: 'email left the mailbox',
    evidence: [{ kind: 'action-record', id: 'act_1', asOfMs: 1000 }],
  };
  const deps: ProposalDeps = { state: provable(), authorityFor: () => AUTH, oracleFor: () => plan, resolveEvidence: () => ({ tenantId: 'tenant-A' }), policyFacts: [], nowMs: 5000, freshnessWindowMs: 60_000, stateHashAtReasoning: 'h1', currentStateHash: 'h1' };
  const r = buildProposal(req, deps);
  if (r.status !== 'PROPOSED') throw new Error('setup');
  return r.proposal;
};
const execReq: L6ExecuteRequestLike = { tenantId: 'tenant-A', capabilityId: 'mail.send', account: 'acc', params: PARAMS };
const execDeps = (o: Partial<ExecutionDeps> = {}): ExecutionDeps => ({
  nowMs: 5000, currentTenantId: 'tenant-A', currentStateHash: 'h1', stateHashAtProposal: 'h1',
  authorityFor: () => AUTH, oracleFor: () => PLAN, isCertifiedConsequential: (c) => c === 'mail.send', ...o,
});

beforeEach(() => clearProposals());

describe('S5.4 Phase 0 · toBrainReview projection', () => {
  it('projects the eight review fields verbatim; recipient shown; verification honest', () => {
    const b = toBrainReview(buildOne());
    expect(b.purpose).toBe('send-email');
    expect(b.target).toBe('microsoft-entra / acc / ws-A');
    expect(b.action).toContain('mail.send');
    expect(b.action).toContain('op@ex.com');
    expect(b.risk).toBe('low (irreversible)');
    expect(b.evidenceRefs).toEqual(['action-record:act_1']);
    expect(b.verificationPlan).toContain('send-corroboration');
    expect(b.expiry).toMatch(/expires at/);
  });
  it('an unverifiable plan reads "UNVERIFIABLE today: needs …" (never a false VERIFIED)', () => {
    expect(toBrainReview(buildOne(UNVERIFIABLE)).verificationPlan).toMatch(/UNVERIFIABLE today: needs/);
  });
});

describe('S5.4 Phase 0 · the execution gate (proposal store keyed by re-derivable fingerprint)', () => {
  it('a stashed proposal + matching request + matching re-derivation → ADMIT', () => {
    stashProposal(buildOne());
    expect(gateL6Execution(execReq, execDeps())).toEqual({ gate: 'admit', capabilityId: 'mail.send' });
  });
  it('a stashed proposal whose re-derivation drifts (authority) → REFUSE, no execution', () => {
    stashProposal(buildOne());
    const drift: AuthorityRequirement = { ...AUTH, requiredGate: 'changed' };
    expect(gateL6Execution(execReq, execDeps({ authorityFor: () => drift })).gate).toBe('refuse');
  });
  it('no stashed proposal (assistant-driven execute) → SKIP — the existing flow is unchanged', () => {
    expect(gateL6Execution(execReq, execDeps())).toEqual({ gate: 'skip' });
  });
  it('single-use — a proposal is consumed at execute (a second gate → SKIP)', () => {
    stashProposal(buildOne());
    expect(gateL6Execution(execReq, execDeps()).gate).toBe('admit');
    expect(gateL6Execution(execReq, execDeps()).gate).toBe('skip'); // consumed (at-most-once)
  });
  it('gate uses admitForExecution — a cross-tenant execDeps refuses even a stashed proposal', () => {
    stashProposal(buildOne());
    expect(gateL6Execution(execReq, execDeps({ currentTenantId: 'tenant-B' })).gate).toBe('refuse');
    // sanity: the boundary itself agrees
    expect(admitForExecution(buildOne(), execDeps({ currentTenantId: 'tenant-B' })).status).toBe('REFUSED');
  });
});
