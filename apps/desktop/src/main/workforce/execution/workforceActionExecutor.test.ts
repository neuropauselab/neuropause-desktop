/**
 * P8.3 — the ExecuteEngine executor for approved worker actions.
 * P13C I-A.3 Step 4 — the executor now enforces Boundary B: a binding-bearing request runs
 * runBinding ONLY with a valid governed claim; without one it is denied (no runBinding call).
 */
import { describe, expect, it, vi } from 'vitest';
import type { ExecutionBinding, ExecutionRequest } from '@neuropause/shared';
import { mintBoundDecisionClaim, type EffectBinding } from '../../cst/boundDecisionClaim';
import { createWorkforceActionExecutor } from './workforceActionExecutor';

const ctx = { setStep: (): void => {} };
const ACTOR = 'user-1';
const TENANT = 'org-1';
const DECISION = 'dec-1';
const ISSUED = 1_000_000;
const NOW_OK = ISSUED + 5_000;
const BINDING: ExecutionBinding = { executor: 'infra', target: 'aws', accountId: 'acct-1', actionId: 'stop', params: {} };

/** A governed request: a claim minted over the exact binding + authoritative actor/tenant. */
function req(over: Partial<ExecutionRequest> = {}, binding: ExecutionBinding = BINDING): ExecutionRequest {
  const effect: EffectBinding = {
    executor: binding.executor,
    target: binding.target,
    accountId: binding.accountId!,
    actionId: binding.actionId!,
    params: binding.params ?? {},
    actor: ACTOR,
    tenantId: TENANT,
    decisionId: DECISION,
  };
  const claim = mintBoundDecisionClaim({ binding: effect, nonce: 'n1', issuedAt: ISSUED, ttlMs: 60_000 });
  return { kind: 'connector', params: { binding, actor: ACTOR, tenantId: TENANT, claim }, confirmed: true, ...over };
}

const exec = (runBinding: Parameters<typeof createWorkforceActionExecutor>[0]) => createWorkforceActionExecutor(runBinding, () => NOW_OK);

describe('createWorkforceActionExecutor (Boundary B enforced)', () => {
  it('routes a GOVERNED binding to runBinding with the confirmed flag', async () => {
    const runBinding = vi.fn(async () => ({ ok: true, summary: 'stopped' }));
    const res = await exec(runBinding)(req(), ctx);
    expect(runBinding).toHaveBeenCalledWith(BINDING, true);
    expect(res).toEqual({ ok: true, summary: 'stopped', error: undefined });
  });

  it('forwards confirmed:false so a mutating gate can still reject', async () => {
    const runBinding = vi.fn(async () => ({ ok: false, error: 'needs confirmation' }));
    const res = await exec(runBinding)(req({ confirmed: false }), ctx);
    expect(runBinding).toHaveBeenCalledWith(expect.anything(), false);
    expect(res.ok).toBe(false);
    expect(res.error).toBe('needs confirmation');
  });

  it('fails soft (no runBinding call) when the request carries no binding', async () => {
    const runBinding = vi.fn();
    const res = await exec(runBinding)({ kind: 'connector' }, ctx);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/No execution binding/);
    expect(runBinding).not.toHaveBeenCalled();
  });

  it('DENIES a binding-bearing request with NO claim (Boundary B) — runBinding not called', async () => {
    const runBinding = vi.fn();
    const res = await exec(runBinding)({ kind: 'connector', params: { binding: BINDING }, confirmed: true }, ctx);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/Boundary B: MISSING_CLAIM/);
    expect(runBinding).not.toHaveBeenCalled();
  });

  it('DENIES a tampered binding (claim/binding mismatch) — runBinding not called', async () => {
    const runBinding = vi.fn();
    const tampered = req();
    (tampered.params as { binding: ExecutionBinding }).binding = { ...BINDING, target: 'other-account' };
    const res = await exec(runBinding)(tampered, ctx);
    expect(res.error).toMatch(/Boundary B: BINDING_MISMATCH/);
    expect(runBinding).not.toHaveBeenCalled();
  });

  it('catches a throwing runBinding (governed)', async () => {
    const res = await exec(async () => {
      throw new Error('kaboom');
    })(req(), ctx);
    expect(res).toEqual({ ok: false, error: 'kaboom' });
  });

  it('supplies a default summary when the executor returns none (governed)', async () => {
    const res = await exec(async () => ({ ok: true }))(req(), ctx);
    expect(res.summary).toBe('Executed via infra');
  });
});
