/**
 * AI Sandbox — Enterprise Scenario Runner (S3): the REAL desktop channel.
 *
 * Reuses the S2 machinery wholesale — the `PlaywrightDesktopDriver`, the `SessionManager`
 * (isolated profiles), and the `runAction` interpreter — to let an enterprise scenario's
 * desktop steps drive the real NeuroPause Electron app. No new automation engine; this is
 * a thin adapter that exposes S2 through the {@link EnterpriseDesktopChannel} port. Like
 * the rest of the real platform it is integration-tested on a machine with a display; the
 * gates exercise the fake channel through the same port.
 */
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { Artifact, DesktopAction } from '@neuropause/shared';
import { createLogger } from '../../logger';
import type { EnterpriseDesktopChannel } from './platform';
import { EnterprisePlatformError } from './platform';
import { PlaywrightDesktopDriver } from '../desktop/playwrightDriver';
import { SessionManager, type LaunchTarget, type ManagedSession } from '../desktop/sessionManager';
import { PerfCollector, runAction, type ActionRunContext } from '../desktop/actions';
import type { DesktopWindow } from '../desktop/driver';
import type { CaptureDeps } from '../desktop/capture';

const log = createLogger('sandbox-enterprise-desktop');

export interface RealDesktopChannelDeps {
  /** P13C Round 7 — the tenant a persistent browser profile belongs to. */
  tenantId: () => string | null;
  launchTarget: LaunchTarget;
  profilesDir: string;
  artifactsBaseDir: string;
  now?: () => number;
}

/** A no-op capture sink — enterprise desktop screenshots are written directly (below),
 *  and `runAction` never takes the 'screenshot' branch for the actions we send it. */
const NOOP_CAPTURE_ATTACH: CaptureDeps['attach'] = () => ({}) as Artifact;

export function createRealDesktopChannel(deps: RealDesktopChannelDeps): EnterpriseDesktopChannel {
  const now = deps.now ?? Date.now;
  const driver = new PlaywrightDesktopDriver();
  const sessions = new SessionManager({
    driver,
    profilesDir: deps.profilesDir,
    // P13C Round 7 — see SessionManagerDeps.tenantId. Required, not optional: an
    // optional tenant on a filesystem path defaults to a shared directory, which
    // is what the finding was.
    tenantId: deps.tenantId,
    launchTarget: deps.launchTarget,
    now,
  });
  const perf = new PerfCollector();
  const state: { managed: ManagedSession | null; window: DesktopWindow | null; shots: number } = { managed: null, window: null, shots: 0 };

  const actionCtx = (): ActionRunContext => {
    if (!state.managed || !state.window) throw new EnterprisePlatformError('desktop session not open', 'desktop_closed');
    return {
      session: state.managed.session,
      window: state.window,
      capture: { artifactsDir: deps.artifactsBaseDir, attach: NOOP_CAPTURE_ATTACH, now },
      emitStep: () => undefined,
      emitLog: () => undefined,
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      defaultTimeoutMs: 30_000,
      perf,
      now,
    };
  };

  return {
    open: async (opts) => {
      state.managed = await sessions.launch({ profile: 'temporary', profileKey: opts?.profile ?? null, args: [], timeoutMs: 30_000, captureConsole: true });
      state.window = await state.managed.session.firstWindow({ timeoutMs: 30_000 });
      log.info('enterprise desktop session opened', { id: state.managed.id });
    },
    action: async (action: DesktopAction) => runAction(action, actionCtx()),
    screenshot: async (name) => {
      if (!state.window) throw new EnterprisePlatformError('desktop session not open', 'desktop_closed');
      const bytes = await state.window.screenshot();
      state.shots += 1;
      await fs.mkdir(deps.artifactsBaseDir, { recursive: true }).catch(() => undefined);
      const file = join(deps.artifactsBaseDir, `${safe(name)}-${now()}-${state.shots}.png`);
      await fs.writeFile(file, bytes, { mode: 0o600 });
      return { storageRef: file, sizeBytes: bytes.length };
    },
    isOpen: () => !!state.managed && state.managed.session.isRunning(),
    close: async () => {
      if (state.managed) await sessions.close(state.managed.id).catch(() => undefined);
      state.managed = null;
      state.window = null;
    },
  };
}

function safe(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 60) || 'screenshot';
}
