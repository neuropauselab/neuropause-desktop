/**
 * S23 §2 · calendar.create DRY RUN — the SECOND capability through the kit, PROPOSAL-SIDE ONLY.
 *
 * CLAIM LANGUAGE (binding): this dry run produces PROPOSALS. It does NOT certify calendar.create. There is no
 * executor wiring, no send path, and nothing past ADMIT_FOR_ASK anywhere in this file.
 *
 * What it proves, at module level over the REAL S4/S5.1 machinery:
 *  1. A calendar.create proposal FORMS with the HONEST plan — "UNVERIFIABLE today: needs a calendar read-back
 *     oracle" — the first live proof of the honest-plan path (§2#14: no oracle → UNVERIFIABLE, stated).
 *  2. The S5.1 boundary with the PRODUCTION predicate REFUSES it ('not a certified consequential capability') —
 *     connector certified ≠ every action certified, held AT THE EXECUTION BOUNDARY, deny-by-default.
 *  3. Under a kit-modeled FUTURE state (test-only predicate override — a model, not a grant), the same machinery
 *     reaches ADMIT_FOR_ASK with disposition 'ASK' and nothing more — the pipeline is capability-generic and
 *     ASK-only is structural for any second capability.
 *  4. The S4.2 attack classes hold for the second capability: tenant, scope, expiry, evidence-resolution,
 *     authority derivation.
 *  5. The kit COMPLETES for the dry-run record with an HONEST UNVERIFIABLE oracle artifact.
 */
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { runKitChecks, kitComplete, type CapabilityCertificationRecord } from './certificationKit';
import { deriveAuthority, deriveOracle } from '../liveBrain/executionGate';
import { buildProposal, type ProposalDeps, type ProposalRequest, type Proposal } from '../liveBrain/proposal';
import { admitForExecution, type ExecutionDeps } from '../liveBrain/proposalExecutionBoundary';
import { toBrainReview } from '../liveBrain/toBrainReview';
import { composeLiveBrainState } from '../liveBrain/liveBrainState';
import { composeWorkspaceDomain } from '../enterprise/workspaceFoundation/domainAggregate';
import { composeCapabilityGraph } from '../capabilityGraph/capabilityGraph';
import { capabilityGraphSources } from '../capabilityGraph/liveSources';
import { TEST_TENANT_SCOPE } from '../tenancy/testScope';
import type { TenantStamp } from '../tenancy/tenantStamp';
import { runProposeM365Action } from './capabilityProposeCore';
import type { CapabilitySelectionOutcome, AssistantCapability } from './capabilityDiscoveryService';

const T = '2026-08-19T00:00:00.000Z';
const NOW = Date.parse(T) + 5000;
const STAMP: TenantStamp = { tenantId: 'tenant-A', scope: 'ws-A', authoritySource: 'activeTenantScope', timestamp: T };
const TARGET = { connector: 'microsoft-entra', account: 'acc', tenantId: 'tenant-A', scope: 'ws-A' };
const CAL_PARAMS = { subject: 'Team sync', start: '2026-08-20T10:00:00Z', end: '2026-08-20T10:30:00Z', attendees: ['neuropause033@gmail.com'] };

/** The PRODUCTION certified-consequential predicate, verbatim (mail.send only — see executionGate.ts). */
const PRODUCTION_CERTIFIED = (c: string): boolean => c === 'mail.send';

const provableState = () =>
  composeLiveBrainState({
    workspace: { ...composeWorkspaceDomain([{ domain: 'people', moduleId: 'hr-employees', label: 'People' }], { scope: () => TEST_TENANT_SCOPE, now: () => T, moduleCount: () => 3 }), tenant: STAMP },
    capabilities: { ...composeCapabilityGraph(capabilityGraphSources({ mutations: () => [{ capabilityId: 'calendar.create', connectorId: 'microsoft-entra' }], scope: () => true })), tenant: STAMP },
    environment: null, purpose: null, discovery: null, actions: [],
  });

const request = (over?: Partial<ProposalRequest>): ProposalRequest => ({
  purpose: 'schedule-meeting', observation: 'operator mandate', diagnosis: 'uncertified second capability — dry run',
  options: [{ id: 'o1', summary: 'create the event' }], selectedOptionId: 'o1',
  proposedAction: { capabilityId: 'calendar.create', params: CAL_PARAMS },
  target: TARGET, scope: 'ws-A', risk: 'consequential — one calendar event', reversibility: 'reversible',
  expectedEffect: 'one event appears in the operator calendar', evidence: [{ kind: 'snapshot', id: 'snap-1', asOfMs: NOW - 1000 }],
  ...over,
});

const deps = (over?: Partial<ProposalDeps>): ProposalDeps => ({
  state: provableState(), authorityFor: deriveAuthority, oracleFor: deriveOracle,
  resolveEvidence: (ref) => (ref.id === 'snap-1' ? { tenantId: 'tenant-A' } : null),
  policyFacts: [{ kind: 'assurance', ref: 'governed-certified' }], nowMs: NOW, freshnessWindowMs: 60_000,
  stateHashAtReasoning: 'h1', currentStateHash: 'h1',
  ...over,
});

const PROPOSAL: Proposal = (() => {
  const r = buildProposal(request(), deps());
  if (r.status !== 'PROPOSED') throw new Error(`setup: expected PROPOSED, got ${r.status}`);
  return r.proposal;
})();

const execDeps = (certified: (c: string) => boolean): ExecutionDeps => ({
  nowMs: NOW, currentTenantId: 'tenant-A', currentStateHash: 'h1', stateHashAtProposal: 'h1',
  authorityFor: deriveAuthority, oracleFor: deriveOracle, isCertifiedConsequential: certified,
});

describe('§2 · calendar.create dry run — S4 proposal with the HONEST UNVERIFIABLE plan', () => {
  it('the proposal FORMS, and its plan is honestly UNVERIFIABLE with the need stated', () => {
    expect(PROPOSAL.verificationPlan.verifiable).toBe(false);
    expect(PROPOSAL.verificationPlan.oracleId).toBeNull();
    expect(PROPOSAL.verificationPlan.needs).toBe('a calendar read-back oracle (event GET-by-id corroboration)');
  });

  it('the ASK projection renders the honest plan verbatim — never a false VERIFIED promise', () => {
    const review = toBrainReview(PROPOSAL);
    expect(review.verificationPlan).toBe('UNVERIFIABLE today: needs a calendar read-back oracle (event GET-by-id corroboration)');
    expect(review.verificationPlan).not.toMatch(/send-corroboration|VERIFIED/);
  });
});

describe('§2 · calendar.create dry run — the S5.1 boundary (the structural line)', () => {
  it('PRODUCTION predicate → REFUSED: connector certified ≠ every action certified, at the execution boundary', () => {
    const outcome = admitForExecution(PROPOSAL, execDeps(PRODUCTION_CERTIFIED));
    expect(outcome.status).toBe('REFUSED');
    if (outcome.status === 'REFUSED') expect(outcome.reason).toBe('not a certified consequential capability');
  });

  it('kit-modeled FUTURE state (test-only) → ADMIT_FOR_ASK, disposition ASK, and NOTHING past it', () => {
    const outcome = admitForExecution(PROPOSAL, execDeps((c) => c === 'calendar.create'));
    expect(outcome.status).toBe('ADMIT_FOR_ASK');
    if (outcome.status === 'ADMIT_FOR_ASK') {
      expect(outcome.projection.disposition).toBe('ASK'); // ASK-only is structural for the second capability too
      // The projection is DATA — no callable rides it toward any executor.
      expect(Object.values(outcome.projection).every((v) => typeof v !== 'function')).toBe(true);
    }
  });
});

describe('§2 · calendar.create dry run — the S4.2 attack classes hold for the second capability', () => {
  it('tenant: a cross-tenant target is REFUSED', () => {
    const r = buildProposal(request({ target: { ...TARGET, tenantId: 'tenant-B' } }), deps());
    expect(r.status).toBe('REFUSED');
  });
  it('scope: scope escalation is REFUSED', () => {
    const r = buildProposal(request({ scope: 'ws-OTHER', target: { ...TARGET, scope: 'ws-OTHER' } }), deps());
    expect(r.status).toBe('REFUSED');
  });
  it('expiry: stale evidence EXPIRES (never governance-eligible)', () => {
    const r = buildProposal(request({ evidence: [{ kind: 'snapshot', id: 'snap-1', asOfMs: NOW - 120_000 }] }), deps());
    expect(r.status).toBe('EXPIRED');
  });
  it('evidence-resolution: an unresolvable ref BLOCKS', () => {
    const r = buildProposal(request({ evidence: [{ kind: 'snapshot', id: 'ghost', asOfMs: NOW - 1000 }] }), deps());
    expect(r.status).toBe('BLOCKED');
  });
  it('authority derivation: a non-approval authority BLOCKS (the Brain never proposes auto-approval)', () => {
    const r = buildProposal(request(), deps({ authorityFor: () => ({ requiresApproval: false, governanceStatus: 'x', requiredGate: '', policyVersion: null }) }));
    expect(r.status).toBe('BLOCKED');
  });
});

describe('§2 · calendar.create dry run — the kit completes with an HONEST UNVERIFIABLE oracle artifact', () => {
  const selectedCalendar: CapabilitySelectionOutcome = {
    status: 'SELECTED',
    capability: {
      capabilityId: 'calendar.create', title: 'Create meeting', connectorId: 'microsoft-entra', accountId: 'acct-1',
      accountLabel: 'Mailbox', executor: 'm365', operation: 'mutate', consequential: true, approvalRequired: true,
      availability: 'available', executionAssurance: 'governed-certified',
    } as unknown as AssistantCapability,
    requiresApproval: true, governanceStatus: 'governed-certified', purpose: 'schedule', reason: 'selected',
  } as unknown as CapabilitySelectionOutcome;

  const calendarCreateDryRunRecord: CapabilityCertificationRecord = {
    entry: { capabilityId: 'calendar.create', connectorId: 'microsoft-entra', mutates: true, label: 'Create meeting' },
    authority: deriveAuthority,
    oracle: deriveOracle, // → HONEST UNVERIFIABLE (needs stated) — an oracle-registry declaration, not an oracle
    paramsSchema: z
      .object({
        subject: z.string().min(1),
        start: z.string().min(4),
        end: z.string().min(4),
        attendees: z.array(z.string().refine((s) => !s.includes(','), 'comma-hardened')).optional(),
      })
      .strict(),
    cstBindingFields: ['executor', 'target', 'accountId', 'actionId', 'params', 'actor', 'tenantId', 'decisionId'],
    refusalFixtures: [
      {
        // TODAY, the production propose edge refuses the second capability outright — the honest current boundary.
        name: 'production-propose-edge-refuses-today',
        expectReason: 'UNSUPPORTED_ACTION',
        run: () => {
          const r = runProposeM365Action(
            { resolveSelection: () => selectedCalendar, subjectId: () => 'user-1', scope: () => ({ tenantId: 'org-1', workspaceId: 'ws-1' }) },
            { capabilityId: 'calendar.create', accountId: 'acct-1', purpose: 'p', params: CAL_PARAMS },
          );
          return r.ok ? null : r.reason;
        },
      },
    ],
    readBackPlan:
      'UNVERIFIABLE today — no calendar read-back oracle is built. Verification requires an event GET-by-id ' +
      'corroboration oracle (the S24-class pattern); until it exists, no calendar effect can ever be claimed VERIFIED.',
    evidenceTemplate: 'certification/source-update/PHASE-I-A3-NEUROPAUSE-OS-S23-CALENDAR-DRY-RUN-EVIDENCE.md — TEST-VERIFIED at most; PROPOSALS only.',
  };

  it('the kit COMPLETES for the dry-run record — with the oracle artifact honestly UNVERIFIABLE', () => {
    const findings = runKitChecks(calendarCreateDryRunRecord, {
      target: TARGET,
      goodParams: CAL_PARAMS,
      badParams: [{}, { subject: '' }, { subject: 's', start: '2026', end: '2026', attendees: ['a,b@c.com'] }, { subject: 's', start: '2026-08-20', end: '2026-08-21', extra: 1 }],
    });
    expect(findings.filter((f) => !f.ok)).toEqual([]);
    expect(kitComplete(findings)).toBe(true);
    const oracle = findings.find((f) => f.artifact === 'oracle-entry');
    expect(oracle?.detail).toContain('HONEST UNVERIFIABLE');
  });
});
