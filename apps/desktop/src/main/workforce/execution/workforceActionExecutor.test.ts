/**
 * P8.3 — the ExecuteEngine executor for approved worker actions.
 */
import { describe, expect, it, vi } from 'vitest';
import type { ExecutionRequest } from '@neuropause/shared';
import { createWorkforceActionExecutor } from './workforceActionExecutor';

const ctx = { setStep: (): void => {} };
const req = (over: Partial<ExecutionRequest> = {}): ExecutionRequest => ({
  kind: 'connector',
  params: { binding: { executor: 'infra', target: 'aws', actionId: 'stop', params: {} } },
  confirmed: true,
  ...over,
});

describe('createWorkforceActionExecutor', () => {
  it('routes the binding to runBinding with the confirmed flag', async () => {
    const runBinding = vi.fn(async () => ({ ok: true, summary: 'stopped' }));
    const res = await createWorkforceActionExecutor(runBinding)(req(), ctx);
    expect(runBinding).toHaveBeenCalledWith({ executor: 'infra', target: 'aws', actionId: 'stop', params: {} }, true);
    expect(res).toEqual({ ok: true, summary: 'stopped', error: undefined });
  });

  it('forwards confirmed:false so a mutating gate can still reject', async () => {
    const runBinding = vi.fn(async () => ({ ok: false, error: 'needs confirmation' }));
    const res = await createWorkforceActionExecutor(runBinding)(req({ confirmed: false }), ctx);
    expect(runBinding).toHaveBeenCalledWith(expect.anything(), false);
    expect(res.ok).toBe(false);
    expect(res.error).toBe('needs confirmation');
  });

  it('fails soft (no runBinding call) when the request carries no binding', async () => {
    const runBinding = vi.fn();
    const res = await createWorkforceActionExecutor(runBinding)({ kind: 'connector' }, ctx);
    expect(res.ok).toBe(false);
    expect(runBinding).not.toHaveBeenCalled();
  });

  it('catches a throwing runBinding', async () => {
    const res = await createWorkforceActionExecutor(async () => {
      throw new Error('kaboom');
    })(req(), ctx);
    expect(res).toEqual({ ok: false, error: 'kaboom' });
  });

  it('supplies a default summary when the executor returns none', async () => {
    const res = await createWorkforceActionExecutor(async () => ({ ok: true }))(req(), ctx);
    expect(res.summary).toBe('Executed via infra');
  });
});
