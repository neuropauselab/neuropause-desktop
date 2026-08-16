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
import { verifyBoundaryB } from './boundaryB';

/** Runs a binding on the matching existing executor; returns a compact result. */
export type RunBinding = (
  binding: ExecutionBinding,
  confirmed: boolean,
) => Promise<{ ok: boolean; summary?: string; error?: string }>;

/**
 * Build the executor. Fails soft when a request carries no binding (defensive).
 *
 * P13C I-A.3 Step 4 — BOUNDARY B. A request that carries a `binding` is a consequential worker
 * action; it may reach `runBinding` ONLY after `verifyBoundaryB` independently validates the
 * transported Bound Decision Claim against the actual binding + authoritative actor/tenant +
 * temporal validity. A DENY returns a governance refusal and `runBinding` is NOT called (no
 * consequential effect). `now` is the authoritative runtime clock (main-process `Date.now` by
 * default; injectable for tests). Requests WITHOUT a binding never reach Boundary B — they
 * soft-fail above, preserving the existing non-consequential/legacy behavior.
 */
export function createWorkforceActionExecutor(runBinding: RunBinding, now: () => number = Date.now): ExecutionExecutor {
  return async (req, ctx) => {
    const binding = (req.params?.binding ?? null) as ExecutionBinding | null;
    if (!binding || typeof binding.executor !== 'string') {
      return { ok: false, error: 'No execution binding on request' };
    }
    // Boundary B — enforce BEFORE the consequential executor is reachable. Deny ⇒ no runBinding.
    const verdict = verifyBoundaryB(req, now());
    if (!verdict.ok) {
      return { ok: false, error: `Governance denied at Boundary B: ${verdict.reason}` };
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
