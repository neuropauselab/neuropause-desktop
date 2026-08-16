/**
 * P13C I-A.3 Step 4 — Boundary-B enforcement through the REAL execution path.
 *
 * Drives the actual chokepoint: ExecuteEngine (Step-5 durable consumption) → the real
 * `createWorkforceActionExecutor` (Step-4 Boundary B) → a `runBinding` spy (the consequential
 * effect). Proves the certification invariant: NO valid claim / NO exact binding / NO admission
 * ⇒ the executor is UNREACHABLE (runBinding calls = 0, effect = 0). The valid path reaches the
 * executor exactly once. Requests are built with the live Step-3A transport (`governedRequests`).
 */
import { describe, expect, it, vi } from 'vitest';
import type { ExecutionBinding, ExecutionSession, GovernanceVerdict, Job, JobProposal, ProposalApproval } from '@neuropause/shared';
import { ExecuteEngine } from '../../executeEngine';
import { createWorkforceActionExecutor } from './workforceActionExecutor';
import { bindingToRequest, governedRequests, type DispatchAuthority } from './router';

const ACTOR = 'user-approver-1';
const TENANT = 'org-authoritative';
const DECISION = 'req-decision-42';
const ISSUED = 1_000_000;
const TTL = 60_000;
const NOW_OK = ISSUED + 5_000;

const BINDING: ExecutionBinding = { executor: 'm365', target: 'connector-1', accountId: 'acct-1', actionId: 'mail.send', params: { to: 'x@y.z' } };

const job = (): Job => ({ id: 'job-1', correlationId: 'goal-9' }) as Job;

const approved = (over: Partial<JobProposal> = {}): JobProposal =>
  ({
    id: 'p1',
    title: 'Send mail',
    summary: 's',
    sideEffects: true,
    risk: 'medium',
    evidence: [],
    payload: {},
    verdict: { requestId: DECISION, decision: 'require_approval' } as GovernanceVerdict,
    approval: { decision: 'approved', decidedBy: ACTOR, decidedAt: 't', note: null } as ProposalApproval,
    execution: BINDING,
    ...over,
  }) as JobProposal;

const AUTH: DispatchAuthority = { actor: ACTOR, tenantId: TENANT, nowMs: ISSUED, ttlMs: TTL, nonce: () => 'n1' };

function harness(opts: { fail?: boolean; boundaryNow?: () => number } = {}) {
  const persisted: ExecutionSession[] = [];
  const state = { fail: opts.fail ?? false, effects: 0 };
  const runBinding = vi.fn(async () => {
    state.effects += 1;
    return { ok: true, summary: 'sent' };
  });
  const engine = new ExecuteEngine({
    tenantId: () => TENANT,
    now: () => 2_000_000,
    persist: async (s) => {
      if (state.fail) throw new Error('disk full');
      persisted.push({ ...s });
    },
  });
  engine.register('connector', createWorkforceActionExecutor(runBinding, opts.boundaryNow ?? (() => NOW_OK)));
  return { engine, runBinding, persisted, state };
}

/** The live governed request (Step-3A transport) for the approved proposal. */
function validRequest() {
  const g = governedRequests(job(), [approved()], AUTH);
  if (!g.ok) throw new Error(`mint failed: ${g.reason}`);
  return g.requests[0];
}

describe('Boundary B enforcement — valid path (control 18/20)', () => {
  it('a valid governed request reaches the executor exactly once and completes', async () => {
    const h = harness();
    const s = await h.engine.execute(validRequest());
    expect(h.runBinding).toHaveBeenCalledTimes(1); // effect reached
    expect(h.runBinding).toHaveBeenCalledWith(BINDING, true);
    expect(h.state.effects).toBe(1);
    expect(s.state).toBe('completed');
    expect(s.decisionId).toBe(DECISION); // Step-5 stamped the governed decision
  });
});

describe('Boundary B enforcement — deny ⇒ executor UNREACHABLE (controls 1/5/3/19)', () => {
  it('control 1: a binding WITHOUT a claim is DENIED — runBinding = 0, effect = 0 (H-FINDING-3 worker path)', async () => {
    const h = harness();
    const ungoverned = bindingToRequest(job(), approved())!; // 2-arg: binding, NO claim/actor/tenant
    const s = await h.engine.execute(ungoverned);
    expect(h.runBinding).not.toHaveBeenCalled();
    expect(h.state.effects).toBe(0);
    expect(s.state).toBe('failed');
    expect(s.error).toMatch(/Boundary B: MISSING_CLAIM/);
  });

  it('control 5: a tampered binding (target changed after mint) is DENIED — runBinding = 0', async () => {
    const h = harness();
    const req = validRequest();
    (req.params as { binding: ExecutionBinding }).binding = { ...BINDING, target: 'connector-EVIL' };
    const s = await h.engine.execute(req);
    expect(h.runBinding).not.toHaveBeenCalled();
    expect(h.state.effects).toBe(0);
    expect(s.error).toMatch(/Boundary B: BINDING_MISMATCH/);
  });

  it('control 3: an expired claim is DENIED at the boundary clock — runBinding = 0', async () => {
    const h = harness({ boundaryNow: () => ISSUED + TTL + 1 });
    const s = await h.engine.execute(validRequest());
    expect(h.runBinding).not.toHaveBeenCalled();
    expect(h.state.effects).toBe(0);
    expect(s.error).toMatch(/Boundary B: EXPIRED/);
  });
});

describe('Boundary B + Step-5 durable admission — replay / concurrency / restart / persistence', () => {
  it('control 13: replay of the same decision → second effect = 0 (executor reached once total)', async () => {
    const h = harness();
    const req = validRequest();
    await h.engine.execute(req);
    const second = await h.engine.execute(req);
    expect(h.runBinding).toHaveBeenCalledTimes(1);
    expect(h.state.effects).toBe(1);
    expect(second.error).toMatch(/already admitted/i);
  });

  it('control 14: concurrent submissions of the same decision → exactly one effect', async () => {
    const h = harness();
    const req = validRequest();
    await Promise.all([h.engine.execute(req), h.engine.execute(req)]);
    expect(h.runBinding).toHaveBeenCalledTimes(1);
    expect(h.state.effects).toBe(1);
  });

  it('control 15: after restart (seedHistory hydration) the same claim is DENIED — executor = 0', async () => {
    const h1 = harness();
    await h1.engine.execute(validRequest());
    const h2 = harness();
    h2.engine.seedHistory(h1.persisted); // "process 2" hydrates consumed decisions
    const replay = await h2.engine.execute(validRequest());
    expect(h2.runBinding).not.toHaveBeenCalled();
    expect(h2.state.effects).toBe(0);
    expect(replay.error).toMatch(/already admitted/i);
  });

  it('control 16: durable-persistence failure refuses before the effect — runBinding = 0', async () => {
    const h = harness({ fail: true });
    const s = await h.engine.execute(validRequest());
    expect(h.runBinding).not.toHaveBeenCalled();
    expect(h.state.effects).toBe(0);
    expect(s.error).toMatch(/durable admission failed/i);
  });
});
