/**
 * AI Sandbox — Enterprise Scenario Runner (S3) composition root.
 *
 * Registers the enterprise executor onto the S1 engine THROUGH a router so it coexists
 * with the S2 desktop executor (the engine has a single executor slot). The production
 * caller (runtimeCore) builds the REAL platform via `createRealEnterprisePlatform` and
 * the S2 desktop executor via `createDesktopExecutor`, and passes both here. No new
 * engine/queue/store/report system — this only gives S1's engine a router.
 */
import { createLogger } from '../../logger';
import type { SandboxExecutionEngine } from '../executionEngine';
import type { SandboxExecutor } from '../executionEngine';
import type { EnterprisePlatform } from './platform';
import { createEnterpriseExecutor } from './enterpriseExecutor';
import { createExecutorRouter, type ExecutorRoute } from './router';

const log = createLogger('sandbox-enterprise');

export interface EnterpriseRunnerDeps {
  engine: SandboxExecutionEngine;
  platform: EnterprisePlatform;
  /** The S2 desktop executor, so `kind:'desktop'` scenarios keep working (reused, not rebuilt). */
  desktopExecutor?: SandboxExecutor;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export interface EnterpriseRunnerSubsystem {
  executor: SandboxExecutor;
  platformKind: string;
}

export function initEnterpriseRunner(deps: EnterpriseRunnerDeps): EnterpriseRunnerSubsystem {
  const enterprise = createEnterpriseExecutor({ platform: deps.platform, now: deps.now, sleep: deps.sleep });
  const routes: ExecutorRoute[] = [{ kind: 'enterprise', executor: enterprise }];
  if (deps.desktopExecutor) routes.push({ kind: 'desktop', executor: deps.desktopExecutor });
  const router = createExecutorRouter(routes);
  deps.engine.registerExecutor(router);
  log.info('enterprise scenario runner registered', { platform: deps.platform.kind, kinds: routes.map((r) => r.kind) });
  return { executor: router, platformKind: deps.platform.kind };
}

export { createEnterpriseExecutor } from './enterpriseExecutor';
export { createExecutorRouter } from './router';
export { FakeEnterprisePlatform, type FakePlatformScript } from './fakePlatform';
export type { EnterprisePlatform } from './platform';
