/**
 * S5.3 · THE FULL MOCK LOOP — the whole chain wired through the REAL modules, external boundaries mocked.
 *
 * Brain state (composeLiveBrainState) → proposal (buildProposal) → ASK (admitForExecution + brainReview
 * projection) → [human confirm, simulated] → mock executor (actionRecord.observe) → mock read-back
 * (verifyEffect with a mock Graph reader) → verification attaches (recordVerification) → the five-state
 * derivation moves (m365WriteStates). VERIFIED_SUCCESS, VERIFY_FAILED, and HOLD(UNKNOWN) each exercised.
 * ZERO real contact — the ONLY mocks are the executor result + the Graph reader.
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { actionRecord, type ActionRecord } from '../connectors/actionRecord';
import { verifyEffect, fingerprint, type VerificationTarget, type VerifyDeps } from '../verification/verifyEffect';
import { m365WriteStates } from '../connectors/m365WriteStates';
import { composeLiveBrainState } from './liveBrainState';
import { buildProposal, type ProposalRequest, type ProposalDeps, type AuthorityRequirement, type VerificationPlan, type Proposal } from './proposal';
import { admitForExecution, type ExecutionDeps } from './proposalExecutionBoundary';
import type { GovernedSendResult } from '../cst/sendTransition';
import type { TenantStamp } from '../tenancy/tenantStamp';
import { composeWorkspaceDomain } from '../enterprise/workspaceFoundation/domainAggregate';
import { composeCapabilityGraph } from '../capabilityGraph/capabilityGraph';
import { capabilityGraphSources } from '../capabilityGraph/liveSources';
import { TEST_TENANT_SCOPE } from '../tenancy/testScope';

const T = '2026-08-19T00:00:00.000Z';
const STAMP: TenantStamp = { tenantId: 'tenant-A', scope: 'ws-A', authoritySource: 'activeTenantScope', timestamp: T };
const AUTH: AuthorityRequirement = { requiresApproval: true, governanceStatus: 'governed-certified', requiredGate: 'human-confirm + CST admission', policyVersion: 'm365-send-policy-1' };
const PLAN: VerificationPlan = { verifiable: 'send-corroboration', oracleId: 'verifyEffect', note: '≤~37s, no NDR — NOT delivery', needs: null, productionWired: false };
const priorAction = (): ActionRecord => ({
  id: 'act_prior', at: T, requestId: 'r', transitionId: 'tr0', actor: 'local:x', tenantId: 'tenant-A',
  connectorId: 'microsoft-entra', accountId: 'acc', actionId: 'mail.send',
  recipients: { to: [], cc: [], bcc: [] }, subjectFingerprint: '', bodyFingerprint: '',
  verdict: 'ALLOW', executed: true, outcome: 'ACKNOWLEDGED', admissionRef: 'tr0',
  verification: { terminal: 'VERIFIED_SUCCESS', internetMessageId: null, at: T },
});
const provableState = () =>
  composeLiveBrainState({
    workspace: { ...composeWorkspaceDomain([{ domain: 'people', moduleId: 'hr-employees', label: 'People' }], { scope: () => TEST_TENANT_SCOPE, now: () => T, moduleCount: () => 3 }), tenant: STAMP },
    capabilities: { ...composeCapabilityGraph(capabilityGraphSources({ mutations: () => [{ capabilityId: 'mail.send', connectorId: 'microsoft-entra' }], scope: () => true })), tenant: STAMP },
    environment: null, purpose: null, discovery: null, actions: [priorAction()],
  });

// ── Step 1–2: Brain state → certified proposal. ────────────────────────────────────────
const proposalRequest: ProposalRequest = {
  purpose: 'send-email', observation: 'obs', diagnosis: 'diag', options: [{ id: 'o1', summary: 'send' }], selectedOptionId: 'o1',
  proposedAction: { capabilityId: 'mail.send', params: { to: ['op@ex.com'], subject: 'hi', body: 'hello' } },
  target: { connector: 'microsoft-entra', account: 'acc', tenantId: 'tenant-A', scope: 'ws-A' },
  scope: 'ws-A', risk: 'low', reversibility: 'irreversible', expectedEffect: 'email left the mailbox',
  evidence: [{ kind: 'action-record', id: 'act_prior', asOfMs: 1000 }],
};
const proposalDeps: ProposalDeps = {
  state: provableState(), authorityFor: () => AUTH, oracleFor: () => PLAN, resolveEvidence: () => ({ tenantId: 'tenant-A' }),
  policyFacts: [{ kind: 'assurance', ref: 'governed-certified' }], nowMs: 5000, freshnessWindowMs: 60_000, stateHashAtReasoning: 'h1', currentStateHash: 'h1',
};
const PROPOSAL: Proposal = (() => {
  const r = buildProposal(proposalRequest, proposalDeps);
  if (r.status !== 'PROPOSED') throw new Error('setup: expected PROPOSED');
  return r.proposal;
})();
const execDeps: ExecutionDeps = {
  nowMs: 5000, currentTenantId: 'tenant-A', currentStateHash: 'h1', stateHashAtProposal: 'h1',
  authorityFor: () => AUTH, oracleFor: () => PLAN, isCertifiedConsequential: (c) => c === 'mail.send',
};

const mockGraph = (kind: 'success' | 'fail' | 'hold'): VerifyDeps => {
  const base: VerifyDeps = { now: () => 0, sleep: async () => {}, backoffMs: [0], readInbox: async () => [], readSentItems: async () => [] };
  if (kind === 'success') return { ...base, readSentItems: async () => [{ internetMessageId: '<m1>', toRecipients: ['op@ex.com'], subject: 'hi', bodyPreview: 'hello', sentDateTime: T }] };
  if (kind === 'fail') return { ...base, readInbox: async () => [{ from: 'postmaster@outlook.com', subject: 'Undeliverable', bodyPreview: '5.1.1 op@ex.com not found', receivedDateTime: '2026-08-19T00:00:01.000Z' }] };
  return base; // hold — neither a Sent Items match nor a bounce
};

// ── Steps 3–7: ASK → confirm → mock executor → mock read-back → verification → five states. ──
async function runLoop(kind: 'success' | 'fail' | 'hold'): Promise<{ terminal: string; externallyObserved: number; requested: number; providerAcknowledged: number }> {
  actionRecord.useDirForTests(mkdtempSync(join(tmpdir(), 's5-mockloop-')));
  const admit = admitForExecution(PROPOSAL, execDeps);
  expect(admit.status).toBe('ADMIT_FOR_ASK'); // the ASK gate (human MUST confirm)
  // [human confirm — simulated] → mock executor result → ActionRecord (real store, temp dir):
  const result = { semanticOutcome: 'ACKNOWLEDGED', outcome: { transitionId: 'tr-1', requestId: 'req-1', verdict: 'ALLOW', executed: true } } as unknown as GovernedSendResult;
  await actionRecord.observe({ connectorId: 'microsoft-entra', accountId: 'acc', actionId: 'mail.send', params: { to: ['op@ex.com'], subject: 'hi', body: 'hello' } }, result, { actor: 'local:x', tenantId: 'tenant-A' });
  // mock read-back (real verifyEffect, mock Graph reader):
  const target: VerificationTarget = { internetMessageId: null, recipient: 'op@ex.com', subjectFingerprint: fingerprint('hi'), bodyFingerprint: fingerprint('hello'), sentAtWindow: { fromMs: 0, toMs: Number.MAX_SAFE_INTEGER } };
  const verify = await verifyEffect(target, mockGraph(kind));
  await actionRecord.recordVerification('tenant-A', 'tr-1', { terminal: verify.state, internetMessageId: verify.matchedMessageId, at: '2026-08-19T00:00:02.000Z' });
  const states = await m365WriteStates('tenant-A');
  return { terminal: verify.state, externallyObserved: states.externallyObserved, requested: states.requested, providerAcknowledged: states.providerAcknowledged };
}

describe('S5.3 · full mock loop — Brain state → proposal → ASK (zero real contact)', () => {
  it('the ASK gate admits for human confirmation, and the brainReview projection carries the artifact fields', () => {
    const admit = admitForExecution(PROPOSAL, execDeps);
    expect(admit.status).toBe('ADMIT_FOR_ASK');
    // The brainReview the confirm panel would render, projected VERBATIM from the artifact:
    expect(PROPOSAL.purpose).toBe('send-email');
    expect(PROPOSAL.verificationPlan.verifiable).toBe('send-corroboration');
    expect(PROPOSAL.proposedAction.capabilityId).toBe('mail.send');
  });
});

describe('S5.3 · full mock loop — read-back drives the five states (failure is first-class)', () => {
  it('VERIFIED_SUCCESS → EXTERNALLY_OBSERVED moves', async () => {
    const r = await runLoop('success');
    expect(r.terminal).toBe('VERIFIED_SUCCESS');
    expect(r.requested).toBe(1);
    expect(r.providerAcknowledged).toBe(1);
    expect(r.externallyObserved).toBe(1); // the five-state panel moves to externally-observed
  });
  it('VERIFY_FAILED → recorded, but EXTERNALLY_OBSERVED does NOT move (a verified failure is never success)', async () => {
    const r = await runLoop('fail');
    expect(r.terminal).toBe('VERIFY_FAILED');
    expect(r.requested).toBe(1);
    expect(r.externallyObserved).toBe(0);
  });
  it('HOLD (UNKNOWN) → recorded, EXTERNALLY_OBSERVED does NOT move (uncertainty is never success — §2#9)', async () => {
    const r = await runLoop('hold');
    expect(r.terminal).toBe('HOLD');
    expect(r.requested).toBe(1);
    expect(r.externallyObserved).toBe(0);
  });
});
