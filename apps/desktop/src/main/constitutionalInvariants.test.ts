/**
 * NP-014 — THE CONSTITUTIONAL INVARIANT SUITE (ARCHITECTURE-SPEC §53,
 * RULE-001..012; NP-012 §3 ruling slice 2 of 6, operator 20 Aug 2026).
 *
 * ONE named suite asserting every §53 rule THROUGH THE REAL SEAMS — each rule
 * imports the real module and drives the real function; nothing under test is
 * mocked and no rule is re-implemented. Each rule cites the deeper distributed
 * pin it derives from; those pins remain the exhaustive proof — this suite is
 * the spec's own demand made legible in one place ("These should become
 * automated tests", §53).
 *
 * RULE-008 is asserted VACUOUS-BY-CONSTRUCTION (no learning code exists) with
 * a recorded linkage: the moment the LB-6 experience-memory arc lands code,
 * that assertion FAILS BY DESIGN, and flipping RULE-008 from vacuous to a real
 * adversarial test is an ENTRY CRITERION of that arc (ROADMAP-HORIZON, LB-6).
 *
 * `cst/` is FROZEN: RULE-011 imports `governedSend` (import-only, this file
 * lives outside cst/, no gate is triggered) and edits nothing under it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// actionRecord (RULE-012) imports electron at module load; everything else in
// this suite is pure. One minimal hoisted mock serves the whole file.
vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }));

import { admitForExecution, type ExecutionDeps } from './liveBrain/proposalExecutionBoundary';
import {
  buildProposal,
  type AuthorityRequirement,
  type Proposal,
  type ProposalDeps,
  type ProposalRequest,
  type VerificationPlan,
} from './liveBrain/proposal';
import { composeLiveBrainState, type LiveBrainInputs } from './liveBrain/liveBrainState';
import { deriveAuthority, deriveOracle, l6ExecutionGate } from './liveBrain/executionGate';
import {
  runBrainProposeLane,
  type BrainProposeLaneDeps,
  type OperatorMandate,
} from './liveBrain/brainProposeLane';
import { clearProposals, proposalKey, takeProposal } from './liveBrain/proposalStore';
import {
  resolveCapabilitySelection,
  type AssistantCapability,
  type CapabilityCatalogView,
} from './capabilities/capabilityDiscoveryService';
import { M365_CONNECTOR_ID } from './capabilities/liveCapabilitySources';
import {
  fingerprint,
  verifyEffect,
  type SentItem,
  type VerificationTarget,
  type VerifyDeps,
} from './verification/verifyEffect';
import { scrubAccountMetadata } from './connectors/metadataCredentialGuard';
import {
  authorizeTenantRead,
  resetTenantStoreRegistryForTests,
  TenantOwnership,
} from './tenancy/tenantOwnedStore';
import { TEST_TENANT_SCOPE, OTHER_TENANT_SCOPE } from './tenancy/testScope';
import type { TenantStamp } from './tenancy/tenantStamp';
import { composeWorkspaceDomain } from './enterprise/workspaceFoundation/domainAggregate';
import { composeCapabilityGraph } from './capabilityGraph/capabilityGraph';
import { capabilityGraphSources } from './capabilityGraph/liveSources';
import type { ActionRecord } from './connectors/actionRecord';
import { actionRecord } from './connectors/actionRecord';
import type { GovernedSendResult } from './cst/sendTransition';
import { createGovernedSendPorts, governedSend, type GovernedSendArgs } from './cst/sendTransition';
import type { HttpClient, RateGate } from './unified/sync/http';
import type { WriteAction } from './connectors/m365/actionSdk';
import type { ConnectedAccount } from '@neuropause/shared';

/* ────────────────────────── shared fixtures ────────────────────────── */

const T = '2026-08-19T00:00:00.000Z';
const STAMP: TenantStamp = { tenantId: 'tenant-A', scope: 'ws-A', authoritySource: 'activeTenantScope', timestamp: T };
const AUTH: AuthorityRequirement = {
  requiresApproval: true,
  governanceStatus: 'governed-certified',
  requiredGate: 'human-confirm + CST admission',
  policyVersion: 'm365-send-policy-1',
};
const PLAN: VerificationPlan = { verifiable: 'send-corroboration', oracleId: 'verifyEffect', note: 'x', needs: null, productionWired: false };
const TARGET = { connector: 'microsoft-entra', account: 'acc', tenantId: 'tenant-A', scope: 'ws-A' };

/** A VERIFIED_SUCCESS history record — RULE-007's "memory" the rules must ignore. */
const verifiedSuccessAction = (): ActionRecord => ({
  id: 'act_1', at: T, requestId: 'r', transitionId: 'tr', actor: 'local:x', tenantId: 'tenant-A',
  connectorId: 'microsoft-entra', accountId: 'acc', actionId: 'mail.send',
  recipients: { to: [], cc: [], bcc: [] }, subjectFingerprint: '', bodyFingerprint: '',
  verdict: 'admit', executed: true, outcome: 'ACKNOWLEDGED', admissionRef: 'tr',
  verification: { terminal: 'VERIFIED_SUCCESS', internetMessageId: null, at: T },
});

const brainInputs = (capabilityId: string): LiveBrainInputs => ({
  workspace: {
    ...composeWorkspaceDomain([{ domain: 'people', moduleId: 'hr-employees', label: 'People' }], {
      scope: () => TEST_TENANT_SCOPE, now: () => T, moduleCount: () => 3,
    }),
    tenant: STAMP,
  },
  capabilities: {
    ...composeCapabilityGraph(capabilityGraphSources({ mutations: () => [{ capabilityId, connectorId: 'microsoft-entra' }], scope: () => true })),
    tenant: STAMP,
  },
  environment: null, purpose: null, discovery: null, actions: [verifiedSuccessAction()],
});

const mailRequest: ProposalRequest = {
  purpose: 'send-email', observation: 'obs', diagnosis: 'diag',
  options: [{ id: 'o1', summary: 'send' }], selectedOptionId: 'o1',
  proposedAction: { capabilityId: 'mail.send', params: { to: ['op@ex.com'] } },
  target: TARGET, scope: 'ws-A', risk: 'low', reversibility: 'irreversible',
  expectedEffect: 'email sent', evidence: [{ kind: 'action-record', id: 'act_1', asOfMs: 1000 }],
};

/** Canon equality demands the SAME authority/oracle functions at build and admit. */
const buildMailProposal = (
  authorityFor: ProposalDeps['authorityFor'],
  oracleFor: ProposalDeps['oracleFor'],
): Proposal => {
  const built = buildProposal(mailRequest, {
    state: composeLiveBrainState(brainInputs('mail.send')),
    authorityFor, oracleFor,
    resolveEvidence: () => ({ tenantId: 'tenant-A' }),
    policyFacts: [], nowMs: 5000, freshnessWindowMs: 60_000,
    stateHashAtReasoning: 'h1', currentStateHash: 'h1',
  });
  if (built.status !== 'PROPOSED') throw new Error(`setup: expected PROPOSED, got ${built.status}`);
  return built.proposal;
};

const execDeps = (o: Partial<ExecutionDeps> = {}): ExecutionDeps => ({
  nowMs: 5000, currentTenantId: 'tenant-A', currentStateHash: 'h1', stateHashAtProposal: 'h1',
  authorityFor: () => AUTH, oracleFor: () => PLAN,
  isCertifiedConsequential: (c) => c === 'mail.send', ...o,
});

/* ────────────────────────────── the rules ───────────────────────────── */

describe('RULE-001 — a proposal cannot authorize itself', () => {
  const PROPOSAL = buildMailProposal(() => AUTH, () => PLAN);

  it('hostile approval fields on the artifact are INERT DATA — the boundary still answers ASK, never ALLOW', () => {
    const hostile = { ...PROPOSAL, confirmed: true, authority: 'true', approved: true } as unknown as Proposal;
    const r = admitForExecution(hostile, execDeps());
    expect(r.status).toBe('ADMIT_FOR_ASK');
    if (r.status === 'ADMIT_FOR_ASK') expect(r.projection.disposition).toBe('ASK');
    // Deeper pins: proposalExecutionBoundary.test.ts (ASK-only structural), proposal.test.ts (zero-authority artifact).
  });

  it('a tampered authority CLAIM inside the artifact is refused by re-derivation from the live substrate', () => {
    const tampered = { ...PROPOSAL, authorityRequired: { ...AUTH, requiresApproval: false } } as Proposal;
    expect(admitForExecution(tampered, execDeps()).status).toBe('REFUSED');
  });

  it('even a substrate answering "no approval needed" is refused — approval is structural for consequential capabilities', () => {
    const noApproval: AuthorityRequirement = { requiresApproval: false, governanceStatus: 'x', requiredGate: 'none', policyVersion: null };
    expect(admitForExecution(PROPOSAL, execDeps({ authorityFor: () => noApproval })).status).toBe('REFUSED');
  });
});

describe('RULE-002 — connector identity cannot authorize capability execution', () => {
  /** The PRODUCTION certified-consequential predicate, verbatim (executionGate.ts). */
  const PRODUCTION_CERTIFIED = (c: string): boolean => c === 'mail.send';

  it('connector certified ≠ action certified: S5.1 REFUSES calendar.create on the certified M365 connector', () => {
    const built = buildProposal(
      {
        purpose: 'schedule-meeting', observation: 'operator mandate', diagnosis: 'uncertified second capability',
        options: [{ id: 'o1', summary: 'create the event' }], selectedOptionId: 'o1',
        proposedAction: { capabilityId: 'calendar.create', params: { subject: 'Team sync', start: '2026-08-20T10:00:00Z', end: '2026-08-20T10:30:00Z' } },
        target: TARGET, scope: 'ws-A', risk: 'consequential — one calendar event', reversibility: 'reversible',
        expectedEffect: 'one event appears in the operator calendar',
        evidence: [{ kind: 'snapshot', id: 'snap-1', asOfMs: 4000 }],
      },
      {
        state: composeLiveBrainState(brainInputs('calendar.create')),
        authorityFor: deriveAuthority, oracleFor: deriveOracle,
        resolveEvidence: (ref) => (ref.id === 'snap-1' ? { tenantId: 'tenant-A' } : null),
        policyFacts: [], nowMs: 5000, freshnessWindowMs: 60_000,
        stateHashAtReasoning: 'h1', currentStateHash: 'h1',
      },
    );
    if (built.status !== 'PROPOSED') throw new Error(`setup: expected PROPOSED, got ${built.status}`);
    const outcome = admitForExecution(built.proposal, execDeps({
      authorityFor: deriveAuthority, oracleFor: deriveOracle, isCertifiedConsequential: PRODUCTION_CERTIFIED,
    }));
    expect(outcome.status).toBe('REFUSED');
    if (outcome.status === 'REFUSED') expect(outcome.reason).toBe('not a certified consequential capability');
    // Deeper pin: capabilities/calendarCreateDryRun.test.ts.
  });
});

describe('RULE-003 — a capability cannot authorize itself (deny-by-default)', () => {
  const cap = (over: Partial<AssistantCapability> = {}): AssistantCapability => ({
    capabilityId: 'mail.send', title: 'Send email', connectorId: M365_CONNECTOR_ID, accountId: 'acct-1',
    accountLabel: 'ada@contoso.com', executor: 'm365', operation: 'mutate', consequential: true,
    approvalRequired: true, availability: 'available', executionAssurance: 'governed-certified',
    aiSelectable: true, unavailableReason: null, requiredScopes: ['Mail.Send'], ...over,
  });
  const view = (caps: AssistantCapability[], workspaceId: string | null = 'ws-A'): CapabilityCatalogView => ({ workspaceId, capabilities: caps });

  it('an invented/unregistered capability is NOT_FOUND — never guessed', () => {
    expect(resolveCapabilitySelection(view([cap()]), { capabilityId: 'mail.exfiltrateEverything' }).status).toBe('NOT_FOUND');
  });

  it('an empty catalog fails closed', () => {
    expect(resolveCapabilitySelection(view([]), { capabilityId: 'mail.send' }).status).toBe('NOT_FOUND');
  });

  it('governance-not-proven is never promoted to selectable', () => {
    const out = resolveCapabilitySelection(
      view([cap({ connectorId: 'aws', capabilityId: 'compute.restart', executionAssurance: 'governance-not-proven', aiSelectable: false })]),
      { capabilityId: 'compute.restart' },
    );
    expect(out.status).toBe('GOVERNANCE_NOT_PROVEN');
    expect(out.capability).toBeNull();
    // Deeper pin: capabilities/capabilitySelection.test.ts.
  });
});

describe('RULE-004 / RULE-005 — expiry and fingerprint at the propose→execute lane', () => {
  const NOW = Date.parse('2026-08-19T12:00:00Z');
  const WS = 'ws-ceremony';
  const mandate: OperatorMandate = {
    capabilityId: 'mail.send', accountId: 'acct-1', to: ['neuropause033@gmail.com'],
    subject: 'NeuroPause brain-proposed send', body: 'The demo is Friday.', purpose: 'ceremony rehearsal',
  };
  const executeParams = { to: ['neuropause033@gmail.com'], subject: 'NeuroPause brain-proposed send', body: 'The demo is Friday.' };
  const laneDeps = (): BrainProposeLaneDeps => ({
    scope: () => ({ tenantId: 'org-1', workspaceId: WS }), moduleStore: () => null, actions: async () => [], nowMs: () => NOW,
  });
  beforeEach(() => clearProposals());

  it('RULE-004: an expired proposal cannot execute — the boundary refuses on expiry', () => {
    const proposal = buildMailProposal(() => AUTH, () => PLAN);
    expect(admitForExecution(proposal, execDeps({ nowMs: 10_000_000 })).status).toBe('REFUSED');
  });

  it('RULE-004 (end-to-end): confirm after the 10-min window → observable DENIED containing "expired"', async () => {
    await runBrainProposeLane(mandate, laneDeps());
    const gate = l6ExecutionGate({ workspaceId: () => WS }, { actionId: 'mail.send', accountId: 'acct-1', params: executeParams }, NOW + 11 * 60_000);
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(JSON.stringify(gate.refusal.data)).toContain('expired');
  });

  it('RULE-005: parameter mutation invalidates the fingerprint — the edit is no longer the Brain\'s proposal', async () => {
    // Control: the unedited confirm ADMITs and CONSUMES the stash.
    await runBrainProposeLane(mandate, laneDeps());
    const ok = l6ExecutionGate({ workspaceId: () => WS }, { actionId: 'mail.send', accountId: 'acct-1', params: executeParams }, NOW + 60_000);
    expect(ok.ok).toBe(true);
    expect(takeProposal(proposalKey(WS, 'mail.send', 'acct-1', executeParams))).toBeNull();

    // The attack: an edited param re-derives a DIFFERENT key → SKIP; the original authorization never silently applies.
    clearProposals();
    await runBrainProposeLane(mandate, laneDeps());
    const gate = l6ExecutionGate({ workspaceId: () => WS }, { actionId: 'mail.send', accountId: 'acct-1', params: { ...executeParams, subject: 'edited subject' } }, NOW + 60_000);
    expect(gate.ok).toBe(true); // proceeds as HUMAN-COMPOSED — not Brain-admitted
    expect(takeProposal(proposalKey(WS, 'mail.send', 'acct-1', executeParams))).not.toBeNull();
    // Deeper pins: brainProposeLane.test.ts (ADMIT / edit→SKIP / expiry→DENIED).
  });
});

describe('RULE-006 — unknown verification cannot become verified_success', () => {
  const NOW = 1_000_000;
  const target: VerificationTarget = {
    internetMessageId: '<msg-123@np>', recipient: 'neuropause033@gmail.com',
    subjectFingerprint: fingerprint('NeuroPause S15 first real send, 18 Aug 2026'),
    bodyFingerprint: fingerprint('the demo is friday'),
    sentAtWindow: { fromMs: NOW - 60_000, toMs: NOW + 60_000 },
  };
  const matching: SentItem = {
    internetMessageId: '<msg-123@np>', toRecipients: ['neuropause033@gmail.com'],
    subject: 'NeuroPause S15 first real send, 18 Aug 2026',
    bodyPreview: 'the demo is Friday — sent by NeuroPause', sentDateTime: new Date(NOW).toISOString(),
  };
  const deps = (over: Partial<VerifyDeps> = {}): VerifyDeps => ({
    readSentItems: () => Promise.resolve([]), readInbox: () => Promise.resolve([]),
    now: () => NOW, sleep: () => Promise.resolve(), backoffMs: [0, 0, 0], ...over,
  });

  it('an ABSENT read-back is HOLD — never auto-promoted', async () => {
    const r = await verifyEffect(target, deps());
    expect(r.state).toBe('HOLD');
    expect(r.matchedMessageId).toBeNull();
    expect(r.detail).toMatch(/never auto-promoted/i);
  });

  it('an UNRECOGNIZED read-back (right id, wrong recipient) is HOLD — an id is never evidence alone', async () => {
    const u = await verifyEffect(target, deps({ readSentItems: () => Promise.resolve([{ ...matching, toRecipients: ['someone-else@x.com'] }]) }));
    expect(u.state).toBe('HOLD');
  });

  it('a prior HOLD with still-empty readers stays HOLD — resolution requires evidence, never time', async () => {
    const first = await verifyEffect(target, deps());
    const again = await verifyEffect(target, deps(), first);
    expect(again.state).toBe('HOLD');
    // Deeper pins: verification/verifyEffect.test.ts (17 pins incl. fault injection).
  });
});

describe('RULE-007 — memory cannot create authorization', () => {
  it('the authority derivation admits NO history input — its signature is (capabilityId, target) and nothing else', () => {
    expect(deriveAuthority('mail.send', TARGET)).toEqual({
      requiresApproval: true, governanceStatus: 'governed-certified',
      requiredGate: 'human-confirm + CST admission', policyVersion: 'm365-send-policy-1',
    });
  });

  it('a proposal GROUNDED on a VERIFIED_SUCCESS record still admits only as ASK — history informed, never permitted', () => {
    // The state substrate carries verifiedSuccessAction(); real derivations on BOTH sides.
    const proposal = buildMailProposal(deriveAuthority, deriveOracle);
    const r = admitForExecution(proposal, execDeps({ authorityFor: deriveAuthority, oracleFor: deriveOracle }));
    expect(r.status).toBe('ADMIT_FOR_ASK');
    if (r.status === 'ADMIT_FOR_ASK') expect(r.projection.disposition).toBe('ASK');
  });

  it('the import graph carries no runtime edge from memory/evidence modules into governance or execution', () => {
    // proposal.ts: types only (empty value-import set).
    const src1 = readFileSync(join(__dirname, 'liveBrain', 'proposal.ts'), 'utf8');
    expect(src1.match(/^import(?!\s+type\b)[^\n]*/gm) ?? []).toEqual([]);
    expect(src1).not.toMatch(/\bimport\s*\(|\brequire\s*\(/);
    // actionRecord.ts (the memory/evidence store): no value import into cst/governance/executor.
    const src2 = readFileSync(join(__dirname, 'connectors', 'actionRecord.ts'), 'utf8');
    for (const line of src2.match(/^import\s+(?!type\b)[^;]*from\s+'[^']*'/gm) ?? []) {
      expect(line).not.toMatch(/cst\/|governance|executor|governedSend|governedAction|boundDecisionClaim|CstKernel/);
    }
    expect(src2).toMatch(/import type \{ GovernedSendResult \} from '\.\.\/cst\/sendTransition'/);
    // businessFacts.ts: the seeing/proposing module reaches no send machinery.
    const src3 = readFileSync(join(__dirname, 'liveBrain', 'businessFacts.ts'), 'utf8');
    expect(src3).not.toMatch(/from '\.\.\/cst\//);
    expect(src3).not.toMatch(/governedSend/);
    expect(src3).not.toMatch(/confirmed:/);
    // Deeper pins: proposal.test.ts, liveBrainState.test.ts, actionRecord.test.ts, businessFacts.test.ts.
  });
});

describe('RULE-008 — learning cannot create authorization (VACUOUS-BY-CONSTRUCTION, by ruling)', () => {
  /**
   * OPERATOR RULING (NP-014, 20 Aug 2026): this rule is asserted vacuous — it
   * PROVES no learning code exists, which is the strongest honest claim
   * available today. THE LINKAGE: when the LB-6 experience-memory arc lands
   * ANY learning/experience module, these assertions FAIL BY DESIGN, and
   * flipping RULE-008 to a real adversarial test (learning output driven at
   * the authority seams → refused) is an ENTRY CRITERION of that arc — see
   * ROADMAP-HORIZON.md, LB-6. Do not weaken these to keep them green.
   */
  it('no learning module exists anywhere under src/main', () => {
    expect(existsSync(join(__dirname, 'learning'))).toBe(false);
    const liveBrainFiles = readdirSync(join(__dirname, 'liveBrain'));
    expect(liveBrainFiles.filter((f) => /learn|experience/i.test(f))).toEqual([]);
  });

  it('the linkage is recorded in the horizon doc — RULE-008 flips vacuous→real as an LB-6 entry criterion', () => {
    const horizon = readFileSync(join(__dirname, '..', '..', '..', '..', 'ROADMAP-HORIZON.md'), 'utf8');
    expect(horizon).toContain('RULE-008');
    expect(horizon).toMatch(/ENTRY CRITERION/);
  });
});

describe('RULE-009 — credential material cannot appear in connector metadata', () => {
  const JWT = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJhdHRhY2tlciJ9.c2lnLXNpZy1zaWctc2ln';
  const account = (over: Partial<ConnectedAccount>): ConnectedAccount => ({
    id: 'acct_r009', connectorId: 'slack', workspaceId: 'ws_r009', label: 'Acme Workspace',
    externalId: null, avatarUrl: null, status: 'connected', health: 'healthy',
    grantedScopes: ['chat:write'], connectedAt: '2026-08-20T00:00:00.000Z', lastSyncAt: null,
    lastSyncState: 'never', accessTokenExpiresAt: '2026-08-20T01:00:00.000Z', error: null, ...over,
  });

  it('provider-controlled fields are scrubbed; identifiers survive', () => {
    const { account: safe, scrubbedFields } = scrubAccountMetadata(
      account({ label: `Acme ${JWT}`, error: 'provider rejected Bearer abc.def-ghi', grantedScopes: ['chat:write', 'xoxb-1234567890-abcDEF'] }),
    );
    expect(JSON.stringify(safe)).not.toContain(JWT);
    expect(JSON.stringify(safe)).not.toContain('xoxb-1234567890-abcDEF');
    expect([...scrubbedFields].sort()).toEqual(['error', 'grantedScopes', 'label']);
    expect(scrubAccountMetadata(account({ label: 'user@example.com' })).scrubbedFields).toEqual([]);
    // Deeper pins (incl. the REAL connectors.json disk path): connectors/rule009CredentialBoundary.test.ts.
  });
});

describe('RULE-010 — cross-tenant execution requires explicit authorization', () => {
  beforeEach(() => resetTenantStoreRegistryForTests());
  afterEach(() => resetTenantStoreRegistryForTests());

  it('an UNBOUND scope denies — reads nothing, owns nothing', () => {
    const t = new TenantOwnership('rule010-probe');
    expect(t.onlyMine([{ tenantId: 'org-a' }])).toEqual([]);
    expect(t.mine({ tenantId: 'org-a' })).toBe(false);
    expect(() => t.requireTenant()).toThrow(/no owner/i);
  });

  it('a cross-tenant read requires the EXPLICIT grant — an ordinary principal may only authorize itself', () => {
    const b = { tenantId: 'org-b', platformOperator: false };
    expect(() => authorizeTenantRead(b, 'org-b')).not.toThrow();
    expect(() => authorizeTenantRead(b, 'org-a')).toThrow(/not available to read/);
  });

  it('the stamp takes the owner from the scope, never from the payload', () => {
    const t = new TenantOwnership('rule010-probe').bindScope(() => TEST_TENANT_SCOPE);
    expect(t.stamp({ tenantId: OTHER_TENANT_SCOPE.tenantId, v: 1 }).tenantId).toBe(TEST_TENANT_SCOPE.tenantId);
    // Deeper pins: tenancy/storeScopeComposition.test.ts, crossTenant.test.ts (1,119 lines).
  });
});

describe('RULE-011 — the executor cannot bypass governance state', () => {
  const RATE = {} as unknown as RateGate;
  const okHttp = { postJson: async () => ({ data: {}, headers: {}, status: 202 }) } as unknown as HttpClient;
  const stubAction = (run: WriteAction['run']): WriteAction => ({ id: 'mail.send', label: 'Send email', domain: 'mail', scopes: ['Mail.Send'], mutates: true, run });
  const baseArgs = (over: Partial<GovernedSendArgs> = {}): GovernedSendArgs => ({
    connectorId: 'm365', accountId: 'acct-1',
    action: stubAction(async () => ({ ok: true, summary: 'Sent' })),
    params: { to: ['a@example.com'], subject: 'Hi', body: 'yo' },
    confirmed: true, tenantId: 'org-test', actorId: 'sender@np.example',
    policyVersion: 'm365-send-policy-1', ownsAccount: true, grantedScopes: ['Mail.Send'],
    getToken: async () => 'tok', makeHttp: () => okHttp, rate: RATE,
    now: () => '2026-01-01T00:00:00.000Z', ports: createGovernedSendPorts(), ...over,
  });

  it('unconfirmed ⇒ HOLD; the effect NEVER runs', async () => {
    let calls = 0;
    const g = await governedSend(baseArgs({ confirmed: false, action: stubAction(async () => { calls++; return { ok: true, summary: '' }; }) }));
    expect(g.semanticOutcome).toBe('HOLD');
    expect(g.outcome.executed).toBe(false);
    expect(g.effectCalls).toBe(0);
    expect(calls).toBe(0);
  });

  it('unauthorized (does not own the account) ⇒ DENIED; the effect never runs', async () => {
    let calls = 0;
    const g = await governedSend(baseArgs({ ownsAccount: false, action: stubAction(async () => { calls++; return { ok: true, summary: '' }; }) }));
    expect(g.semanticOutcome).toBe('DENIED');
    expect(g.effectCalls).toBe(0);
    expect(calls).toBe(0);
    // Deeper pins: cst/sendTransition.negative.test.ts (H-B, H-C and the full hostile alphabet).
  });
});

describe('RULE-012 — verification evidence must have provenance', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'np014-rule012-'));
    actionRecord.useDirForTests(dir);
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const gsr = {
    outcome: { transitionId: 't-verify', requestId: 'req:abc:1', verdict: 'ALLOW', executed: true },
    semanticOutcome: 'ACKNOWLEDGED', effectCalls: 1, providerAck: true,
  } as unknown as GovernedSendResult;

  it('a verification terminal carries WHO observed it and HOW — stored and queryable on the evidence record', async () => {
    await actionRecord.observe(
      { connectorId: 'conn-1', accountId: 'acct-1', actionId: 'mail.send', params: { to: ['bob@example.com'], subject: 'Q3', body: 'numbers' } },
      gsr,
      { actor: 'user-owner', tenantId: 'tenant-A' },
    );
    await actionRecord.recordVerification('tenant-A', 't-verify', {
      terminal: 'VERIFIED_SUCCESS', internetMessageId: '<id@host>', at: '2026-08-18T13:25:54Z',
      provenance: {
        source: 's16VerifyRun',
        method: 'corroborated-read-back (recipient+subject+timestamp window; never id alone)',
        oracle: 'm365ReadBack:sentItems+inbox',
      },
    });
    const [rec] = await actionRecord.query({ tenantId: 'tenant-A', transitionId: 't-verify' });
    expect(rec.verification?.terminal).toBe('VERIFIED_SUCCESS');
    expect(rec.verification?.provenance?.source).toBe('s16VerifyRun');
    expect(rec.verification?.provenance?.oracle).toBe('m365ReadBack:sentItems+inbox');
    expect(rec.verification?.provenance?.method).toMatch(/never id alone/);
  });

  /**
   * The PRODUCTION caller supplies provenance. `e2e/s16VerifyRun.ts` is a
   * GATE-class SENSITIVE surface (frozen-surfaces.json: "present to the
   * operator before editing"); the one-object diff was presented verbatim and
   * authorized by the operator (20 Aug 2026, NP-014 go).
   */
  // RULING D (operator, 21 Aug 2026) — RELABELLED. This title said "the PRODUCTION caller" while the body reads
  // `e2e/s16VerifyRun.ts`, which is COMPILE-STRIPPED from release. It passed identically whether or not the code
  // shipped, so it could never fail for the reason its name implied — a FALSE GREEN of the §2 #17 / F-N19-2
  // family. The assertion is unchanged and still useful as drift detection over a GATE-class file; only the
  // claim is corrected. (The genuine production caller now exists — `reconciliation/readBackReconciler.ts` —
  // and is pinned at runtime in `reconciliation/readBackReconciler.test.ts`, not by source text.)
  it('the compile-stripped e2e caller supplies provenance at its recordVerification call site (source-pinned; NOT a production path — F-P39)', () => {
    const src = readFileSync(join(__dirname, 'e2e', 's16VerifyRun.ts'), 'utf8');
    expect(src).toMatch(/recordVerification\([\s\S]{0,600}?provenance:\s*\{/);
    expect(src).toContain("oracle: 'm365ReadBack:sentItems+inbox'");
  });
});
