/**
 * P13C I-A.3 Step 3A — authoritative actor/tenant claim TRANSPORT (not enforcement).
 *
 * Proves that an approved consequential proposal is dispatched with a minted BoundDecisionClaim
 * plus the SAME authoritative actor + tenant attached to the live ExecutionRequest (closing D1),
 * and that Boundary B can independently reconstruct the exact eight-field binding and re-derive
 * `claim.bindingDigest` from what is transported (closing D2 at the transport layer). Fail-closed:
 * no actor / no tenant / not approved / no or incomplete binding ⇒ NO claim, NO dispatch. The
 * renderer cannot inject claim/actor/tenant/binding (ExecuteRunRequest `.strict()`).
 *
 * This gate does NOT verify or consume the claim — that is Boundary B (a later gate), untested here.
 */
import { describe, expect, it } from 'vitest';
import type { ExecutionBinding, GovernanceVerdict, Job, JobProposal, ProposalApproval } from '@neuropause/shared';
import { ExecuteRunRequest } from '@neuropause/shared';
import { bindingToRequest, governedRequests, type DispatchAuthority } from './router';
import { computeBindingDigest, type EffectBinding } from '../../cst/boundDecisionClaim';

const job = (over: Partial<Job> = {}): Job =>
  ({
    id: 'job-1',
    workerId: 'w',
    workerRole: 'operations',
    skillId: 's',
    status: 'running',
    input: {},
    requestedBy: 'u',
    summary: null,
    evidence: [],
    proposals: [],
    logs: [],
    error: null,
    grounded: true,
    createdAt: 'x',
    startedAt: 'x',
    finishedAt: null,
    durationMs: null,
    correlationId: 'goal-9',
    ...over,
  }) as Job;

const binding: ExecutionBinding = {
  executor: 'm365',
  target: 'connector-1',
  accountId: 'acct-1',
  actionId: 'mail.send',
  params: { to: 'x@y.z', subject: 'hi' },
};

/** An APPROVED consequential proposal with an authoritative governance decision id. */
const approved = (over: Partial<JobProposal> = {}): JobProposal =>
  ({
    id: 'p1',
    title: 'Send mail',
    summary: 's',
    sideEffects: true,
    risk: 'medium',
    evidence: [],
    payload: {},
    verdict: { requestId: 'req-decision-42', decision: 'require_approval' } as GovernanceVerdict,
    approval: { decision: 'approved', decidedBy: 'approver-1', decidedAt: 't', note: null } as ProposalApproval,
    execution: binding,
    ...over,
  }) as JobProposal;

const AUTH: DispatchAuthority = {
  actor: 'user-approver-1',
  tenantId: 'org-authoritative',
  nowMs: 1_700_000_000_000,
  ttlMs: 5 * 60_000,
  nonce: () => 'nonce-fixed',
};

/** Reconstruct the eight-field binding from ONLY what the request transports (as Boundary B would). */
function reconstructFromRequest(req: { params?: Record<string, unknown> }): EffectBinding {
  const p = req.params as { binding: ExecutionBinding; actor: string; tenantId: string; claim: { decisionId: string } };
  return {
    executor: p.binding.executor,
    target: p.binding.target,
    accountId: p.binding.accountId!,
    actionId: p.binding.actionId!,
    params: p.binding.params!,
    actor: p.actor,
    tenantId: p.tenantId,
    decisionId: p.claim.decisionId,
  };
}

describe('bindingToRequest — governance attachment (additive, back-compatible)', () => {
  it('without governance: no claim/actor/tenant on params (unchanged behavior)', () => {
    const req = bindingToRequest(job(), approved())!;
    const p = req.params as Record<string, unknown>;
    expect(p.claim).toBeUndefined();
    expect(p.actor).toBeUndefined();
    expect(p.tenantId).toBeUndefined();
    expect((p.binding as ExecutionBinding).actionId).toBe('mail.send');
  });

  it('with governance: attaches claim + actor + tenantId, binding UNCHANGED', () => {
    const gov = { claim: { decisionId: 'd', nonce: 'n', bindingDigest: 'x', issuedAt: 1, expiresAt: 2 }, actor: 'a', tenantId: 't' };
    const req = bindingToRequest(job(), approved(), gov)!;
    const p = req.params as Record<string, unknown>;
    expect(p.claim).toBe(gov.claim);
    expect(p.actor).toBe('a');
    expect(p.tenantId).toBe('t');
    expect(p.binding).toBe(approved().execution ?? binding); // same shape; binding untouched
  });
});

describe('governedRequests — Step 3A live transport (positive controls)', () => {
  it('1/3. an approved proposal mints a claim and ATTACHES it to the live request', () => {
    const r = governedRequests(job(), [approved()], AUTH);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const p = r.requests[0].params as Record<string, unknown>;
    expect(p.claim).toBeDefined(); // D1: the live path carries the claim
  });

  it('2. claim.decisionId equals the authoritative governance decision id (verdict.requestId)', () => {
    const r = governedRequests(job(), [approved()], AUTH);
    if (!r.ok) throw new Error('expected ok');
    const claim = (r.requests[0].params as { claim: { decisionId: string } }).claim;
    expect(claim.decisionId).toBe('req-decision-42');
  });

  it('4/5. actor + tenant on the request are the AUTHORITATIVE values (not the proposal/renderer)', () => {
    const r = governedRequests(job(), [approved()], AUTH);
    if (!r.ok) throw new Error('expected ok');
    const p = r.requests[0].params as { actor: string; tenantId: string };
    expect(p.actor).toBe('user-approver-1');
    expect(p.tenantId).toBe('org-authoritative');
  });

  it('6. the transported binding equals the approved ExecutionBinding (unchanged)', () => {
    const r = governedRequests(job(), [approved()], AUTH);
    if (!r.ok) throw new Error('expected ok');
    expect((r.requests[0].params as { binding: ExecutionBinding }).binding).toEqual(binding);
  });

  it('7 (D2). claim.bindingDigest is independently recomputable from the transported 8-field binding', () => {
    const r = governedRequests(job(), [approved()], AUTH);
    if (!r.ok) throw new Error('expected ok');
    const req = r.requests[0];
    const claim = (req.params as { claim: { bindingDigest: string } }).claim;
    const recomputed = computeBindingDigest(reconstructFromRequest(req));
    expect(recomputed).toBe(claim.bindingDigest); // Boundary B can reconstruct + match
  });

  it('8. issuedAt comes from the authoritative runtime clock', () => {
    const r = governedRequests(job(), [approved()], AUTH);
    if (!r.ok) throw new Error('expected ok');
    const claim = (r.requests[0].params as { claim: { issuedAt: number; expiresAt: number } }).claim;
    expect(claim.issuedAt).toBe(AUTH.nowMs);
    expect(claim.expiresAt).toBe(AUTH.nowMs + AUTH.ttlMs);
  });

  it('9. nonce comes from the injected authoritative nonce source', () => {
    const r = governedRequests(job(), [approved()], AUTH);
    if (!r.ok) throw new Error('expected ok');
    expect((r.requests[0].params as { claim: { nonce: string } }).claim.nonce).toBe('nonce-fixed');
  });
});

describe('governedRequests — fail-closed negative controls', () => {
  it('10. rejected proposal → no claim (NOT_APPROVED), no requests', () => {
    const r = governedRequests(job(), [approved({ approval: { decision: 'rejected', decidedBy: 'u', decidedAt: 't', note: null } })], AUTH);
    expect(r).toEqual({ ok: false, reason: 'NOT_APPROVED' });
  });

  it('11. undecided proposal (approval null) → NOT_APPROVED', () => {
    const r = governedRequests(job(), [approved({ approval: null })], AUTH);
    expect(r).toEqual({ ok: false, reason: 'NOT_APPROVED' });
  });

  it('12. advisory / no execution binding → NO_EXECUTION_BINDING', () => {
    const r = governedRequests(job(), [approved({ execution: undefined })], AUTH);
    expect(r).toEqual({ ok: false, reason: 'NO_EXECUTION_BINDING' });
  });

  it('13. incomplete execution binding → INCOMPLETE_BINDING', () => {
    const r = governedRequests(job(), [approved({ execution: { executor: 'm365', target: 'c' } })], AUTH);
    expect(r).toEqual({ ok: false, reason: 'INCOMPLETE_BINDING' });
  });

  it('14. actor === null → fail closed (NO_ACTOR), no requests', () => {
    const r = governedRequests(job(), [approved()], { ...AUTH, actor: null });
    expect(r).toEqual({ ok: false, reason: 'NO_ACTOR' });
  });

  it('15. tenantId === null → fail closed (NO_TENANT), no requests', () => {
    const r = governedRequests(job(), [approved()], { ...AUTH, tenantId: null });
    expect(r).toEqual({ ok: false, reason: 'NO_TENANT' });
  });

  it('fail-closed is ALL-OR-NOTHING: one ungovernable binding aborts the whole batch', () => {
    const r = governedRequests(job(), [approved(), approved({ id: 'p2', approval: null })], AUTH);
    expect(r).toEqual({ ok: false, reason: 'NOT_APPROVED' }); // no partial requests returned
  });
});

describe('governedRequests — provenance is authoritative, never renderer-derived', () => {
  it('16/17/20. a decoy actor/tenant on the proposal payload CANNOT override the authoritative values', () => {
    const decoy = approved({ payload: { actor: 'attacker', tenantId: 'evil-org' } });
    const r = governedRequests(job(), [decoy], AUTH);
    if (!r.ok) throw new Error('expected ok');
    const p = r.requests[0].params as { actor: string; tenantId: string };
    expect(p.actor).toBe('user-approver-1'); // from AUTH, not the payload
    expect(p.tenantId).toBe('org-authoritative');
  });
});

describe('renderer exclusion — ExecuteRunRequest .strict() rejects injected transport (controls 18/19)', () => {
  it('accepts only kind/targetId/input/label', () => {
    expect(ExecuteRunRequest.safeParse({ kind: 'connector', targetId: 't', input: 'i', label: 'l' }).success).toBe(true);
  });

  it('18. a renderer-supplied claim is rejected', () => {
    expect(ExecuteRunRequest.safeParse({ kind: 'connector', claim: { decisionId: 'x' } }).success).toBe(false);
  });

  it('19. renderer-supplied params/binding are rejected', () => {
    expect(ExecuteRunRequest.safeParse({ kind: 'connector', params: { binding } }).success).toBe(false);
  });

  it('renderer-supplied actor/tenantId/confirmed are rejected', () => {
    expect(ExecuteRunRequest.safeParse({ kind: 'connector', actor: 'x' }).success).toBe(false);
    expect(ExecuteRunRequest.safeParse({ kind: 'connector', tenantId: 'x' }).success).toBe(false);
    expect(ExecuteRunRequest.safeParse({ kind: 'connector', confirmed: true }).success).toBe(false);
  });
});
