/**
 * AI Sandbox — Desktop Automation (S2) composition root.
 *
 * Registers the FIRST real executor onto the S1 engine via `engine.registerExecutor`.
 * By default it wires the production `PlaywrightDesktopDriver` (real Electron automation)
 * — the in-memory driver is injectable only for tests. No new engine/queue/store: this
 * is purely "give S1's engine an executor". The launch target (host Electron binary +
 * app path) is injected from the running app.
 */
import { join } from 'node:path';
import { createLogger } from '../../logger';
import type { SandboxExecutionEngine } from '../executionEngine';
import { PlaywrightDesktopDriver } from './playwrightDriver';
import { createDesktopExecutor } from './desktopExecutor';
import type { DesktopDriver } from './driver';
import type { LaunchTarget } from './sessionManager';

const log = createLogger('sandbox-desktop');

export interface DesktopAutomationDeps {
  /** P13C Round 7 — the tenant a persistent browser profile belongs to. */
  tenantId: () => string | null;
  engine: SandboxExecutionEngine;
  /** Sandbox base dir (e.g. <userData>/sandbox); profiles + artifacts live under it. */
  baseDir: string;
  /** How to launch a fresh instance of the host app (Electron binary + app entry). */
  launchTarget: LaunchTarget;
  /** Override the automation backend (tests inject the in-memory driver). */
  driver?: DesktopDriver;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export interface DesktopAutomationSubsystem {
  driver: DesktopDriver;
}

export function initDesktopAutomation(deps: DesktopAutomationDeps): DesktopAutomationSubsystem {
  const driver = deps.driver ?? new PlaywrightDesktopDriver();
  const executor = createDesktopExecutor({
    driver,
    profilesDir: join(deps.baseDir, 'profiles'),
    tenantId: deps.tenantId,
    artifactsBaseDir: join(deps.baseDir, 'artifacts'),
    launchTarget: deps.launchTarget,
    now: deps.now,
    sleep: deps.sleep,
  });
  deps.engine.registerExecutor(executor);
  log.info('desktop automation executor registered', { driver: driver.kind });
  return { driver };
}

export { PlaywrightDesktopDriver } from './playwrightDriver';
export { FakeDesktopDriver } from './fakeDriver';
export { createDesktopExecutor } from './desktopExecutor';
export { SessionManager } from './sessionManager';
