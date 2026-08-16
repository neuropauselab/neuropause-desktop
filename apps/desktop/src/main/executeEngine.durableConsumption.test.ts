/**
 * P13C I-A.3 Step 5 — durable decision-consumption in the ExecuteEngine.
 *
 * Proves the governed single-use invariant: a BoundDecisionClaim's decisionId admits at
 * most one consequential execution, provable across concurrency and (via seedHistory
 * hydration from the durable store) process restart; persistence failure fails closed
 * (no effect); non-governed executions are unaffected; and CONSUMED ≠ effect success.
 */
import { describe, it, expect } from 'vitest';
import type { ExecutionRequest, ExecutionSession } from '@neuropause/shared';
import { ExecuteEngine } from './executeEngine';

function harness(opts: { fail?: boolean; effectOk?: boolean } = {}) {
  const persisted: ExecutionSession[] = [];
  const state = { fail: opts.fail ?? false, effects: 0 };
  const engine = new ExecuteEngine({
    tenantId: () => 'org-test',
    now: () => 1_000_000,
    persist: async (s) => {
      if (state.fail) throw new Error('disk full');
      persisted.push({ ...s });
    },
  });
  engine.register('connector', async () => {
    state.effects += 1;
    return opts.effectOk === false ? { ok: false, error: 'send failed' } : { ok: true, summary: 'sent' };
  });
  return { engine, persisted, state };
}

function req(decisionId: string | null): ExecutionRequest {
  const claim = decisionId ? { claim: { decisionId, bindingDigest: `digest-${decisionId}`, claimNonce: `nonce-${decisionId}` } } : {};
  return { kind: 'connector', label: 't', params: { binding: { executor: 'm365' }, ...claim } } as ExecutionRequest;
}

describe('ExecuteEngine — durable decision consumption (I-A.3 Step 5)', () => {
  it('first governed decision is admitted; decisionId/bindingDigest/nonce are stamped and persisted', async () => {
    const h = harness();
    const s = await h.engine.execute(req('dec-1'));
    expect(h.state.effects).toBe(1);
    expect(s.decisionId).toBe('dec-1');
    expect(s.bindingDigest).toBe('digest-dec-1');
    expect(s.claimNonce).toBe('nonce-dec-1');
    // The durable record carries the decision identity.
    expect(h.persisted.some((p) => p.decisionId === 'dec-1' && p.bindingDigest === 'digest-dec-1' && p.claimNonce === 'nonce-dec-1')).toBe(true);
  });

  it('same decisionId is REJECTED (single-use) — no second effect', async () => {
    const h = harness();
    await h.engine.execute(req('dec-1'));
    const second = await h.engine.execute(req('dec-1'));
    expect(second.state).toBe('failed');
    expect(second.error).toMatch(/already admitted/i);
    expect(h.state.effects).toBe(1); // no duplicate effect
  });

  it('different decision with the same binding is ALLOWED (decisionId is the key, not the binding)', async () => {
    const h = harness();
    await h.engine.execute(req('dec-1'));
    const s2 = await h.engine.execute(req('dec-2'));
    expect(s2.decisionId).toBe('dec-2');
    expect(h.state.effects).toBe(2);
  });

  it('restart: seedHistory hydrates consumed decisions ⇒ replay after restart is DENIED', async () => {
    const h1 = harness();
    await h1.engine.execute(req('dec-1'));
    // New engine ("process 2") hydrates from the durable store.
    const h2 = harness();
    h2.engine.seedHistory(h1.persisted);
    const replay = await h2.engine.execute(req('dec-1'));
    expect(replay.state).toBe('failed');
    expect(replay.error).toMatch(/already admitted/i);
    expect(h2.state.effects).toBe(0); // no effect on the replay
  });

  it('concurrent duplicate submissions admit EXACTLY ONE', async () => {
    const h = harness();
    const [a, b] = await Promise.all([h.engine.execute(req('dec-1')), h.engine.execute(req('dec-1'))]);
    const failed = [a, b].filter((s) => s.state === 'failed');
    expect(failed).toHaveLength(1);
    expect(h.state.effects).toBe(1); // exactly one admitted, one denied
  });

  it('persistence failure prevents the effect (fail closed) and does NOT falsely consume the decision', async () => {
    const h = harness({ fail: true });
    const s = await h.engine.execute(req('dec-1'));
    expect(s.state).toBe('failed');
    expect(s.error).toMatch(/durable admission failed/i);
    expect(h.state.effects).toBe(0); // NO effect on persistence failure
    // The decision was rolled back (not durably consumed) → a subsequent working attempt succeeds.
    h.state.fail = false;
    const retry = await h.engine.execute(req('dec-1'));
    expect(retry.decisionId).toBe('dec-1');
    expect(h.state.effects).toBe(1);
  });

  it('CONSUMED ≠ effect success: a consumed decision whose effect FAILED is still single-use', async () => {
    const h = harness({ effectOk: false });
    const first = await h.engine.execute(req('dec-1'));
    expect(first.state).toBe('failed'); // the effect failed
    expect(first.decisionId).toBe('dec-1'); // but it WAS admitted/consumed
    const replay = await h.engine.execute(req('dec-1'));
    expect(replay.error).toMatch(/already admitted/i); // still denied
    expect(h.state.effects).toBe(1); // no retry of the failed effect
  });

  it('non-governed execution (no claim) is unaffected — runs normally, no decisionId, no consumption', async () => {
    const h = harness();
    const s = await h.engine.execute(req(null));
    expect(s.decisionId).toBeUndefined();
    expect(h.state.effects).toBe(1);
    // A later governed execution still works (the non-governed one consumed nothing).
    const g = await h.engine.execute(req('dec-1'));
    expect(g.decisionId).toBe('dec-1');
    expect(h.state.effects).toBe(2);
  });

  it('legacy persisted sessions (no decisionId) do not block governed executions', async () => {
    const h = harness();
    const legacy = { id: 'exec_legacy', kind: 'connector', label: 'l', state: 'completed', steps: [], currentStep: -1, startedAt: '2020-01-01T00:00:00.000Z', completedAt: null, durationMs: null, error: null, resultSummary: null, result: null } as unknown as ExecutionSession;
    h.engine.seedHistory([legacy]);
    const s = await h.engine.execute(req('dec-1'));
    expect(s.decisionId).toBe('dec-1');
    expect(h.state.effects).toBe(1);
  });
});
