/**
 * S5.4 · the Brain-propose lane — the production propose→gate ALIGNMENT, pinned end to end.
 *
 * The decisive pin is #1: a lane-stashed proposal is found, re-derived, and CONSUMED by the REAL FG-10
 * `l6ExecutionGate` for the EXACT execute-request shape the panel sends — proving propose and execute agree on
 * tenancy key (workspace id), derivations (literally shared functions), and the params fingerprint. Everything
 * else is deny-by-default honesty: edits break the fingerprint (SKIP), unprovable tenants refuse, and no
 * executor/CST import exists on the propose side.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runBrainProposeLane, type BrainProposeLaneDeps, type OperatorMandate } from './brainProposeLane';
import { l6ExecutionGate } from './executionGate';
import { clearProposals, takeProposal, proposalKey } from './proposalStore';
import type { ActionRecord } from '../connectors/actionRecord';

const NOW = Date.parse('2026-08-19T12:00:00Z');
const WS = 'ws-ceremony';

const mandate: OperatorMandate = {
  capabilityId: 'mail.send',
  accountId: 'acct-1',
  to: ['neuropause033@gmail.com'],
  subject: 'NeuroPause brain-proposed send',
  body: 'The demo is Friday.',
  purpose: 'ceremony rehearsal',
};

const executeParams = { to: ['neuropause033@gmail.com'], subject: 'NeuroPause brain-proposed send', body: 'The demo is Friday.' };

function laneDeps(over?: Partial<BrainProposeLaneDeps>): BrainProposeLaneDeps {
  return {
    scope: () => ({ tenantId: 'org-1', workspaceId: WS }),
    moduleStore: () => null,
    actions: async () => [],
    nowMs: () => NOW,
    ...over,
  };
}

const crossTenantAction: ActionRecord = {
  id: 'act_x', at: new Date(NOW - 1000).toISOString(), requestId: 'r', transitionId: 'tr0', actor: 'local:x',
  tenantId: 'ws-OTHER', connectorId: 'microsoft-entra', accountId: 'acct-1', actionId: 'mail.send',
  recipients: { to: [], cc: [], bcc: [] }, subjectFingerprint: '', bodyFingerprint: '',
  verdict: 'ALLOW', executed: true, outcome: 'ACKNOWLEDGED', admissionRef: 'tr0', verification: null,
};

beforeEach(() => clearProposals());

describe('S5.4 · brainProposeLane → FG-10 gate alignment (the production seam)', () => {
  it('END TO END: a lane proposal is ADMITTED and CONSUMED by the REAL execution gate for the exact execute request', async () => {
    const review = await runBrainProposeLane(mandate, laneDeps());
    expect(review).not.toBeNull();
    // The panel's execute request, verbatim shape: { actionId, accountId, params: {to[], subject, body} }.
    const gate = l6ExecutionGate({ workspaceId: () => WS }, { actionId: 'mail.send', accountId: 'acct-1', params: executeParams }, NOW + 60_000);
    expect(gate.ok).toBe(true);
    // ADMIT ≠ SKIP: the stash must be CONSUMED (a SKIP would have left the proposal in the store).
    expect(takeProposal(proposalKey(WS, 'mail.send', 'acct-1', executeParams))).toBeNull();
  });

  it('an OPERATOR EDIT breaks the fingerprint → the gate SKIPs and the original stash is untouched', async () => {
    await runBrainProposeLane(mandate, laneDeps());
    const edited = { ...executeParams, subject: 'edited subject' };
    const gate = l6ExecutionGate({ workspaceId: () => WS }, { actionId: 'mail.send', accountId: 'acct-1', params: edited }, NOW + 60_000);
    expect(gate.ok).toBe(true); // proceeds as a HUMAN-COMPOSED governed send — it is no longer the Brain's proposal
    expect(takeProposal(proposalKey(WS, 'mail.send', 'acct-1', executeParams))).not.toBeNull(); // original not consumed
  });

  it('an EXPIRED proposal (confirm after the 10-min window) is REFUSED by the gate — observable DENIED', async () => {
    await runBrainProposeLane(mandate, laneDeps());
    const gate = l6ExecutionGate({ workspaceId: () => WS }, { actionId: 'mail.send', accountId: 'acct-1', params: executeParams }, NOW + 11 * 60_000);
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(JSON.stringify(gate.refusal.data)).toContain('expired');
  });

  it('no resolved tenant scope → NO proposal, nothing stashed (fail-closed)', async () => {
    const review = await runBrainProposeLane(mandate, laneDeps({ scope: () => null }));
    expect(review).toBeNull();
    expect(takeProposal(proposalKey(WS, 'mail.send', 'acct-1', executeParams))).toBeNull();
  });

  it('cross-tenant action evidence → tenant not provably single → NO proposal (deny-by-default)', async () => {
    const review = await runBrainProposeLane(mandate, laneDeps({ actions: async () => [crossTenantAction] }));
    expect(review).toBeNull();
    expect(takeProposal(proposalKey(WS, 'mail.send', 'acct-1', executeParams))).toBeNull();
  });

  it('the review fields are display-honest: recipient in action, irreversible risk, ISO expiry, resolvable evidence', async () => {
    const review = await runBrainProposeLane(mandate, laneDeps());
    expect(review).not.toBeNull();
    expect(review!.purpose).toBe('ceremony rehearsal');
    expect(review!.action).toContain('mail.send');
    expect(review!.action).toContain('neuropause033@gmail.com');
    expect(review!.risk).toContain('irreversible');
    expect(review!.evidenceRefs.some((e) => e.startsWith('snapshot:live-brain-state:'))).toBe(true);
    expect(review!.expiry).toContain('2026-08-19T12:10:00');
    expect(review!.verificationPlan).toContain('send-corroboration');
  });

  it('PROPOSE-SIDE PURITY — the lane imports no executor / CST / governedSend value (the Brain never reaches)', () => {
    const src = readFileSync(join(__dirname, 'brainProposeLane.ts'), 'utf8');
    expect(src).not.toMatch(/from '\.\.\/connectors\/m365/);
    expect(src).not.toMatch(/from '\.\.\/cst\//);
    expect(src).not.toMatch(/governedSend/);
    expect(src).not.toMatch(/createM365Executor/);
    expect(src).not.toMatch(/confirmed/);
  });
});
