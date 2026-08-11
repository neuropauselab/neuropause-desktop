/**
 * AI Sandbox — Desktop Automation (S2): the first production executor.
 *
 * A `SandboxExecutor` (registered on the S1 engine via `engine.registerExecutor`) that
 * runs a desktop scenario end-to-end: parse the spec → launch an isolated session →
 * interpret each action against the driver → capture real screenshots + console +
 * network into S1 artifacts → recover from recoverable failures once → return a
 * structured result with performance metrics. It REUSES the S1 pipeline entirely — the
 * timeline/log/artifact hooks come from the S1 run context; there is no second engine,
 * queue, artifact store, or report generator here.
 */
import { join } from 'node:path';
import { parseDesktopSpec, type DesktopAction, type RunOutcome } from '@neuropause/shared';
import type { SandboxExecutor, SandboxRunContext, SandboxRunOutcome } from '../executionEngine';
import type { DesktopDriver, DesktopWindow } from './driver';
import { SessionManager, type LaunchTarget, type ManagedSession } from './sessionManager';
import { selectWindow } from './windowManager';
import { captureConsole, captureNetwork, type CaptureDeps } from './capture';
import { PerfCollector, runAction, type ActionRunContext } from './actions';
import { classifyDesktopFailure, collectDiagnostics } from './recovery';

export interface DesktopExecutorDeps {
  driver: DesktopDriver;
  /** Base dir for isolated session profiles. */
  profilesDir: string;
  /** The tenant a persistent profile belongs to. See SessionManagerDeps. */
  tenantId: () => string | null;
  /** Base dir for per-run binary artifacts (a per-execution subdir is created). */
  artifactsBaseDir: string;
  launchTarget: LaunchTarget;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export function createDesktopExecutor(deps: DesktopExecutorDeps): SandboxExecutor {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  return async (ctx: SandboxRunContext): Promise<SandboxRunOutcome> => {
    const parsed = parseDesktopSpec(ctx.version.spec);
    if (!parsed.ok) return { outcome: 'error', summary: `Invalid desktop scenario: ${parsed.error}` };
    const spec = parsed.value;

    const perf = new PerfCollector();
    const sessions = new SessionManager({ driver: deps.driver, profilesDir: deps.profilesDir, tenantId: deps.tenantId, launchTarget: deps.launchTarget, now });
    const capture: CaptureDeps = { artifactsDir: join(deps.artifactsBaseDir, ctx.execution.id), attach: ctx.attachArtifact, now };

    // A stable state object (not `let`) so TS keeps the declared union type across the
    // async closures that mutate it.
    const st: { managed: ManagedSession | null; window: DesktopWindow | null } = { managed: null, window: null };
    let assertionsFailed = 0;
    let recoveriesUsed = 0;

    const launch = async (recovering = false): Promise<void> => {
      const t0 = now();
      const managed = await sessions.launch(spec.launch);
      perf.launchMs = now() - t0;
      const t1 = now();
      const window = await managed.session.firstWindow({ timeoutMs: spec.launch.timeoutMs });
      perf.windowReadyMs = now() - t1;
      st.managed = managed;
      st.window = window;
      if (recovering) perf.recoveries += 1;
      ctx.log(`session launched (${managed.profile} profile, ${perf.launchMs}ms)`);
    };

    const actionCtx = (): ActionRunContext => {
      if (!st.managed || !st.window) throw new Error('no active desktop session');
      return {
        session: st.managed.session,
        window: st.window,
        capture,
        emitStep: (name) => ctx.step(name),
        emitLog: (message, level) => ctx.log(message, level),
        sleep,
        defaultTimeoutMs: spec.launch.timeoutMs,
        perf,
        now,
      };
    };

    const runWithRecovery = async (action: DesktopAction): Promise<{ assertion?: { ok: boolean; message: string } }> => {
      try {
        return await runAction(action, actionCtx());
      } catch (err) {
        const failure = classifyDesktopFailure(err, st.managed?.session.isRunning() ?? false);
        if (!failure.recoverable || recoveriesUsed >= 1) throw err;
        recoveriesUsed += 1;
        ctx.log(`recovering from ${failure.kind}: relaunching session`, 'warn');
        if (st.managed) await sessions.close(st.managed.id).catch(() => undefined);
        await launch(true);
        return runAction(action, actionCtx());
      }
    };

    try {
      await launch();
      for (const action of spec.actions) {
        if (ctx.signal.cancelled) break;

        if (action.type === 'launch') {
          if (st.managed) await sessions.close(st.managed.id).catch(() => undefined);
          await launch();
          continue;
        }
        if (action.type === 'close') {
          if (st.managed) await sessions.close(st.managed.id).catch(() => undefined);
          st.managed = null;
          st.window = null;
          continue;
        }
        if (action.type === 'restart') {
          if (st.managed) {
            const next = await sessions.restart(st.managed.id, spec.launch);
            st.managed = next;
            st.window = next ? await next.session.firstWindow({ timeoutMs: spec.launch.timeoutMs }) : null;
          }
          continue;
        }

        if (!st.managed || !st.window) await launch();
        if (action.window !== undefined && st.managed) {
          const win = await selectWindow(st.managed.session, action.window);
          if (win) st.window = win;
        }

        const res = await runWithRecovery(action);
        if (res.assertion && !res.assertion.ok) {
          assertionsFailed += 1;
          ctx.log(res.assertion.message, 'error');
          break; // stop-on-first-failure
        }
      }

      if (st.managed) {
        captureConsole(st.managed.session, capture);
        captureNetwork(st.managed.session, capture);
      }

      const outcome: RunOutcome = assertionsFailed > 0 ? 'fail' : 'pass';
      return {
        outcome,
        summary: outcome === 'pass'
          ? `Desktop scenario passed — ${spec.actions.length} actions, ${perf.assertions} assertion(s).`
          : 'Desktop scenario failed — an assertion did not hold.',
        assertions: { total: perf.assertions, passed: perf.assertions - assertionsFailed, failed: assertionsFailed },
        metrics: perf.metrics(),
      };
    } catch (err) {
      const failure = classifyDesktopFailure(err, st.managed?.session.isRunning() ?? false);
      const diagnostics = await collectDiagnostics(st.managed?.session ?? null, failure);
      ctx.attachArtifact({ kind: 'log', name: 'diagnostics.json', mimeType: 'application/json', inline: JSON.stringify(diagnostics, null, 2), metadata: { failure: failure.kind } });
      ctx.log(`desktop failure [${failure.kind}]: ${failure.message}`, 'error');
      return {
        outcome: 'error',
        summary: `${failure.kind}: ${failure.message}`,
        assertions: { total: perf.assertions, passed: Math.max(0, perf.assertions - 1), failed: perf.assertions > 0 ? 1 : 0 },
        metrics: perf.metrics(),
      };
    } finally {
      await sessions.closeAll().catch(() => undefined);
    }
  };
}
