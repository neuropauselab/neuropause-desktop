/**
 * P8.3 — the ExecuteEngine executor that runs an approved worker action.
 *
 * Registered on the engine (kind `connector`) in the composition root. It reads the
 * `ExecutionBinding` from the request and routes it — via the injected `runBinding`
 * — to the EXISTING confirmation-gated executor (InfraActionExecutor / M365Executor
 * / AutomationRunner). It performs NO execution itself and adds NO governance: the
 * binding was already approved, and `runBinding` forwards `confirmed` (true only when
 * the trusted dispatcher set it) so a mutating action still hits its confirmation gate.
 */
import type { ExecutionBinding } from '@neuropause/shared';
import type { ExecutionExecutor } from '../../executeEngine';

/** Runs a binding on the matching existing executor; returns a compact result. */
export type RunBinding = (
  binding: ExecutionBinding,
  confirmed: boolean,
) => Promise<{ ok: boolean; summary?: string; error?: string }>;

/** Build the executor. Fails soft when a request carries no binding (defensive). */
export function createWorkforceActionExecutor(runBinding: RunBinding): ExecutionExecutor {
  return async (req, ctx) => {
    const binding = (req.params?.binding ?? null) as ExecutionBinding | null;
    if (!binding || typeof binding.executor !== 'string') {
      return { ok: false, error: 'No execution binding on request' };
    }
    ctx.setStep(1); // "Call connector"
    try {
      const res = await runBinding(binding, req.confirmed === true);
      ctx.setStep(2); // "Record"
      return {
        ok: res.ok,
        summary: res.ok ? (res.summary ?? `Executed via ${binding.executor}`) : undefined,
        error: res.ok ? undefined : (res.error ?? `Execution via ${binding.executor} failed`),
      };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  };
}
