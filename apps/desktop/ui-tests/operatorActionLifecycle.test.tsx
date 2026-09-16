/**
 * NeuroPause OS — Wave 2 / Increment 4. The full AI → proposal → approval → governance → admission → execution →
 * outcome → hold → reconciliation lifecycle, composed from EXISTING records by AUTHORITATIVE ids only, never across
 * tenants. Pins: approval ≠ governance verdict ≠ execution success; ACKNOWLEDGED ≠ VERIFIED_SUCCESS; UNKNOWN stays
 * uncertain; cross-tenant / different-decisionId never correlate; missing links are said (NOT_LINKED / NOT_AVAILABLE).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { route, clearRoutes } from './setup';
import { IpcChannel } from '@neuropause/shared';
import type { ExecutionSession, HoldCenterView, HoldRecord, Job, JobProposal } from '@neuropause/shared';
import {
  buildActionLifecycle,
  correlateJobForSession,
  correlateProposalForSession,
} from '@renderer/understanding/operatorConsole';
import { HoldsView } from '@renderer/understanding/HoldsView';

const DEC = 'req-1';
function session(over: Partial<ExecutionSession> = {}): ExecutionSession {
  return {
    id: 'exec-1', kind: 'connector', label: 'Send email', state: 'completed', steps: [],
    startedAt: '2026-01-01T00:00:00.000Z', completedAt: null, durationMs: null, error: null,
    resultSummary: null, result: null, correlationId: 'job-1', currentStep: -1, tenantId: 'org-A',
    decisionId: DEC, bindingDigest: 'b', claimNonce: 'n', ...over,
  } as ExecutionSession;
}
function proposal(over: Partial<JobProposal> = {}): JobProposal {
  return {
    id: 'prop-1', title: 'Send follow-up email', summary: 's', sideEffects: true, risk: 'medium',
    evidence: [], payload: {},
    verdict: { requestId: DEC, workerId: 'w', skillId: 'k', decision: 'allow', reasons: [], checks: [], evaluations: [], trustScore: 1, risk: 'medium', decidedAt: 'now' } as JobProposal['verdict'],
    approval: { decision: 'approved', decidedBy: 'ada@example.com', decidedAt: 'now', note: null },
    ...over,
  } as JobProposal;
}
function job(over: Partial<Job> = {}): Job {
  return { tenantId: 'org-A', id: 'job-1', workerId: 'w', workerRole: 'operations', skillId: 'k', status: 'succeeded', proposals: [proposal()], executionId: 'exec-1', ...over } as unknown as Job;
}
function hold(over: Partial<HoldRecord> = {}): HoldRecord {
  return {
    reason: 'verification_unavailable', why: 'w', known: [], unknown: [], resolution: 'r', ifProceeding: '',
    tenantId: 'org-A', id: 'h1', at: 'now', actor: 'ada', title: 'M365 worker', subject: `m365-worker:${DEC}`,
    decisionId: DEC, status: 'open', resolvedAt: null, resolvedOutcome: null, resolvedNote: null, ...over,
  };
}

describe('correlation helpers — authoritative ids only, never cross-tenant', () => {
  it('correlateJobForSession matches by executionId within the same tenant', () => {
    expect(correlateJobForSession(session(), [job()])?.id).toBe('job-1');
  });
  it('does NOT correlate across tenants even when executionId matches', () => {
    expect(correlateJobForSession(session({ tenantId: 'org-A' }), [job({ tenantId: 'org-B' })])).toBeNull();
  });
  it('correlateProposalForSession matches by verdict.requestId === session.decisionId', () => {
    expect(correlateProposalForSession(session(), job())?.id).toBe('prop-1');
  });
  it('no decisionId → no proposal correlation (never guessed)', () => {
    expect(correlateProposalForSession(session({ decisionId: undefined }), job())).toBeNull();
  });
});

describe('buildActionLifecycle — honest composition', () => {
  const stagesOf = (lc: ReturnType<typeof buildActionLifecycle>) => Object.fromEntries(lc.stages.map((s) => [s.key, s]));

  it('full slice: approval ≠ governance ≠ execution; effect NOT_VERIFIED; no VERIFIED_SUCCESS', () => {
    const lc = buildActionLifecycle({ session: session({ state: 'completed' }), proposal: proposal(), requestText: 'Send the follow-up to attendees' });
    const s = stagesOf(lc);
    expect(s.request.value).toContain('follow-up');
    expect(s.approval.value).toContain('Approved by ada@example.com'); // human approval
    expect(s.governance.value).toBe('allow'); // verdict, distinct from approval
    expect(s.execution.value).toBe('Acknowledged'); // execution, distinct from governance
    expect(s.effect.fact).toBe('NOT_VERIFIED');
    expect(lc.stages.some((x) => x.value.toLowerCase().includes('verified success'))).toBe(false);
  });

  it('UNKNOWN slice: failed governed session + hold → OUTCOME_UNCERTAIN + reconciliation required, no success', () => {
    const lc = buildActionLifecycle({ session: session({ state: 'failed' }), proposal: proposal(), hold: hold() });
    const s = stagesOf(lc);
    expect(s.execution.value).toBe('Outcome uncertain');
    expect(lc.reconciliationRequired).toBe(true);
    expect(s.hold).toBeTruthy();
    expect(s.reconciliation.value.toLowerCase()).toContain('do not blindly retry');
    expect(s.disposition.value).toContain('Open');
  });

  it('resolved hold → disposition is an operator decision, NOT proof of external effect', () => {
    const lc = buildActionLifecycle({ session: session({ state: 'failed' }), proposal: proposal(), hold: hold({ status: 'resolved', resolvedOutcome: 'cancelled' }) });
    const disp = lc.stages.find((x) => x.key === 'disposition')!;
    expect(disp.value.toLowerCase()).toContain('not proof of external effect');
  });

  it('no proposal/job (e.g. IPC action) → ai/proposal/approval/governance are NOT_LINKED, admission NOT_OBSERVED without decisionId', () => {
    const lc = buildActionLifecycle({ session: session({ kind: 'connector', decisionId: undefined }), proposal: null });
    const s = stagesOf(lc);
    expect(s.ai.fact).toBe('NOT_LINKED');
    expect(s.proposal.fact).toBe('NOT_LINKED');
    expect(s.governance.fact).toBe('NOT_LINKED');
    expect(s.admission.fact).toBe('NOT_OBSERVED');
  });

  it('proposal awaiting approval → approval NOT_OBSERVED (AI proposed ≠ human approved)', () => {
    const lc = buildActionLifecycle({ session: session(), proposal: proposal({ approval: null }) });
    const appr = lc.stages.find((x) => x.key === 'approval')!;
    expect(appr.fact).toBe('NOT_OBSERVED');
    expect(appr.value.toLowerCase()).toContain('approval required');
  });
});

// ── Mounted HoldsView — the full lifecycle card composed from real records ─────
describe('HoldsView — composed action lifecycle card', () => {
  beforeEach(() => {
    cleanup();
    clearRoutes();
  });
  afterEach(() => cleanup());

  const centerView = (open: HoldRecord[]): HoldCenterView => ({ open, resolved: [], assessmentLive: true, relationshipsDeclared: 1 });
  function routeAll(open: HoldRecord[], sessions: ExecutionSession[], jobs: Job[]): void {
    route(IpcChannel.HoldList, () => centerView(open));
    route(IpcChannel.DecisionRecordList, () => []);
    route(IpcChannel.ExecuteSessions, () => ({ sessions, stats: {} }));
    route(IpcChannel.WorkforceJobs, () => ({ jobs, total: jobs.length }));
  }

  it('reconstructs USER→AI→PROPOSAL→APPROVAL→GOVERNANCE→ADMISSION→EXECUTION→OUTCOME→HOLD from real records', async () => {
    routeAll([hold()], [session({ state: 'failed' })], [job()]);
    render(<HoldsView />);
    // The composed card is present with each authoritative stage — and the human approval, governance verdict,
    // and execution state read as three DISTINCT facts (approval ≠ governance ≠ execution success).
    const summary = await screen.findByText(/Full lifecycle/);
    fireEvent.click(summary);
    await waitFor(() => expect(screen.getByText('Approved by ada@example.com')).toBeTruthy());
    expect(screen.getByText('allow')).toBeTruthy(); // governance verdict, distinct
    expect(screen.getAllByText(/Outcome uncertain/).length).toBeGreaterThan(0); // execution, distinct
    // ACKNOWLEDGED/UNKNOWN never rendered as verified success; no credential/token ever leaks into the details.
    const body = document.body.textContent?.toLowerCase() ?? '';
    expect(body).not.toContain('verified success');
    expect(body).not.toContain('sent successfully');
    expect(body).not.toContain('access_token');
    expect(body).not.toContain('bearer ');
    expect(body).not.toContain('password');
  });

  it('a hold with no linked session shows no fabricated lifecycle card (NOT_LINKED, never guessed)', async () => {
    // decisionId present on the hold but NO session carries it → linkHoldToSession is NOT_LINKED → no card.
    routeAll([hold({ decisionId: 'other-dec' })], [session({ decisionId: DEC })], [job()]);
    render(<HoldsView />);
    await screen.findByText(/Execution: not linked/);
    expect(screen.queryByText(/Full lifecycle/)).toBeNull();
  });

  it('does not compose a job from another tenant even when its executionId matches', async () => {
    // Session (org-A) links the hold; the only job carries the same executionId but a DIFFERENT tenant → no job/
    // proposal stages. The card still renders (execution is authoritative) but AI/proposal read NOT_LINKED.
    routeAll([hold()], [session({ state: 'failed' })], [job({ tenantId: 'org-B' })]);
    render(<HoldsView />);
    fireEvent.click(await screen.findByText(/Full lifecycle/));
    await waitFor(() => expect(screen.getAllByText('NOT LINKED').length).toBeGreaterThan(0));
    expect(screen.queryByText('Approved by ada@example.com')).toBeNull();
  });
});
