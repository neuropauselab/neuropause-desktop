import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { admitForExecution, type ExecutionDeps } from './proposalExecutionBoundary';
import { buildProposal, type Proposal, type AuthorityRequirement, type VerificationPlan } from './proposal';
import { composeLiveBrainState, type LiveBrainInputs } from './liveBrainState';
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
const action = (): ActionRecord => ({
  id: 'act_1', at: T, requestId: 'r', transitionId: 'tr', actor: 'local:x', tenantId: 'tenant-A',
  connectorId: 'microsoft-entra', accountId: 'acc', actionId: 'mail.send',
  recipients: { to: [], cc: [], bcc: [] }, subjectFingerprint: '', bodyFingerprint: '',
  verdict: 'admit', executed: true, outcome: 'ACKNOWLEDGED', admissionRef: 'tr',
  verification: { terminal: 'VERIFIED_SUCCESS', internetMessageId: null, at: T },
});
const inputs: LiveBrainInputs = {
  workspace: { ...composeWorkspaceDomain([{ domain: 'people', moduleId: 'hr-employees', label: 'People' }], { scope: () => TEST_TENANT_SCOPE, now: () => T, moduleCount: () => 3 }), tenant: STAMP },
  capabilities: { ...composeCapabilityGraph(capabilityGraphSources({ mutations: () => [{ capabilityId: 'mail.send', connectorId: 'microsoft-entra' }], scope: () => true })), tenant: STAMP },
  environment: null, purpose: null, discovery: null, actions: [action()],
};

// A certified proposal built through the S4.1 engine.
const built = buildProposal(
  {
    purpose: 'send-email', observation: 'obs', diagnosis: 'diag', options: [{ id: 'o1', summary: 'send' }], selectedOptionId: 'o1',
    proposedAction: { capabilityId: 'mail.send', params: { to: ['op@ex.com'] } },
    target: { connector: 'microsoft-entra', account: 'acc', tenantId: 'tenant-A', scope: 'ws-A' },
    scope: 'ws-A', risk: 'low', reversibility: 'irreversible', expectedEffect: 'email sent',
    evidence: [{ kind: 'action-record', id: 'act_1', asOfMs: 1000 }],
  },
  { state: composeLiveBrainState(inputs), authorityFor: () => AUTH, oracleFor: () => PLAN, resolveEvidence: () => ({ tenantId: 'tenant-A' }), policyFacts: [], nowMs: 5000, freshnessWindowMs: 60_000, stateHashAtReasoning: 'h1', currentStateHash: 'h1' },
);
const PROPOSAL: Proposal = built.status === 'PROPOSED' ? built.proposal : (() => { throw new Error('setup: expected PROPOSED'); })();

const deps = (o: Partial<ExecutionDeps> = {}): ExecutionDeps => ({
  nowMs: 5000, currentTenantId: 'tenant-A', currentStateHash: 'h1', stateHashAtProposal: 'h1',
  authorityFor: () => AUTH, oracleFor: () => PLAN, isCertifiedConsequential: (c) => c === 'mail.send', ...o,
});

describe('S5.1 · execution boundary — ADMIT (mock)', () => {
  it('a certified proposal with matching re-derivation → ADMIT_FOR_ASK (disposition ASK; projects the executable core)', () => {
    const r = admitForExecution(PROPOSAL, deps());
    expect(r.status).toBe('ADMIT_FOR_ASK');
    if (r.status !== 'ADMIT_FOR_ASK') return;
    expect(r.projection.disposition).toBe('ASK');
    expect(r.projection.capabilityId).toBe('mail.send');
    expect(r.projection.params).toEqual({ to: ['op@ex.com'] });
    expect(r.projection.target.tenantId).toBe('tenant-A');
  });
});

describe('S5.1 · execution boundary — the proposal is NEVER re-trusted (re-derivation)', () => {
  it('non-certified capability → REFUSED', () => {
    expect(admitForExecution(PROPOSAL, deps({ isCertifiedConsequential: () => false })).status).toBe('REFUSED');
  });
  it('tenant drift → REFUSED', () => {
    expect(admitForExecution(PROPOSAL, deps({ currentTenantId: 'tenant-B' })).status).toBe('REFUSED');
  });
  it('expired at confirm time → REFUSED', () => {
    expect(admitForExecution(PROPOSAL, deps({ nowMs: 10_000_000 })).status).toBe('REFUSED');
  });
  it('state drift since the proposal was formed → REFUSED', () => {
    expect(admitForExecution(PROPOSAL, deps({ currentStateHash: 'h2' })).status).toBe('REFUSED');
  });
  it('authority re-derivation mismatch → REFUSED (proposal claim not re-confirmed)', () => {
    const drifted: AuthorityRequirement = { ...AUTH, requiredGate: 'changed' };
    expect(admitForExecution(PROPOSAL, deps({ authorityFor: () => drifted })).status).toBe('REFUSED');
  });
  it('a re-derived no-approval authority → REFUSED', () => {
    const noApproval: AuthorityRequirement = { requiresApproval: false, governanceStatus: 'x', requiredGate: 'none', policyVersion: null };
    expect(admitForExecution(PROPOSAL, deps({ authorityFor: () => noApproval })).status).toBe('REFUSED');
  });
  it('verification-plan re-derivation mismatch → REFUSED', () => {
    const drifted: VerificationPlan = { ...PLAN, oracleId: 'other' };
    expect(admitForExecution(PROPOSAL, deps({ oracleFor: () => drifted })).status).toBe('REFUSED');
  });
});

describe('S5.1 · execution boundary — single-path + ASK-only structural', () => {
  it('ASK-ONLY IS STRUCTURAL — the source contains NO ALLOW disposition/branch (absent, not configured off)', () => {
    const src = readFileSync(join(__dirname, 'proposalExecutionBoundary.ts'), 'utf8');
    expect(src).not.toMatch(/'ALLOW'|"ALLOW"|disposition:\s*'ALLOW'/);
  });
  it('SINGLE-PATH / ZERO-RUNTIME-IMPORT — types only (no value import → no runtime path to any executor/CST)', () => {
    const src = readFileSync(join(__dirname, 'proposalExecutionBoundary.ts'), 'utf8');
    // Types-only: an EMPTY value-import set means there is no runtime edge to ANY module, executors included.
    expect(src.match(/^import(?!\s+type\b)[^\n]*/gm) ?? []).toEqual([]);
    expect(src).not.toMatch(/\bimport\s*\(|\brequire\s*\(/); // no dynamic import()/require()
  });
});
