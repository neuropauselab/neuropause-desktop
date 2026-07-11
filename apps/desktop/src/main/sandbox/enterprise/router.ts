/**
 * AI Sandbox — Enterprise Scenario Runner (S3): the executor router.
 *
 * The S1 engine holds a single executor slot, so multiple executor "stages" coexist by
 * registering ONE router that dispatches by scenario `kind`: `desktop` → the S2 desktop
 * executor, `enterprise` → the S3 enterprise executor. This is the minimal extension of
 * the existing `engine.registerExecutor` seam — no second engine, no parallel dispatch.
 */
import type { SandboxExecutor } from '../executionEngine';

export interface ExecutorRoute {
  kind: string;
  executor: SandboxExecutor;
}

/** Build a composite executor that routes a run to the executor for its scenario `kind`. */
export function createExecutorRouter(routes: ExecutorRoute[], fallback?: SandboxExecutor): SandboxExecutor {
  const map = new Map<string, SandboxExecutor>(routes.map((r) => [r.kind, r.executor]));
  return async (ctx) => {
    const kind = (ctx.version.spec as { kind?: unknown }).kind;
    const executor = typeof kind === 'string' ? map.get(kind) : undefined;
    if (executor) return executor(ctx);
    if (fallback) return fallback(ctx);
    return { outcome: 'error', summary: `No executor registered for scenario kind "${String(kind)}"` };
  };
}
