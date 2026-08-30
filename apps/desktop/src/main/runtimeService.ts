/**
 * RuntimeService (V4.2).
 *
 * Centralizes the always-on runtime concerns so NeuroPause behaves like an OS
 * service rather than a plain app: owns the tray, reacts to power events
 * (sleep/resume, lock/unlock) by updating tray state + broadcasting a recovery
 * signal to the renderer (so voice/automation can reconnect), and manages
 * launch-at-login via Electron's login-item API with a persisted preference.
 *
 * Composition only — it wraps the existing RuntimeTray and reuses the broadcast
 * channel already used for tray→renderer commands. No duplicated runtime logic.
 */
import { app, powerMonitor } from 'electron';
import { IpcChannel } from '@neuropause/shared';
import type { IpcBroadcaster } from '@neuropause/shared';
import { createLogger } from './logger';
import { RuntimeTray, type RuntimeTrayActions, type RuntimeTrayState } from './runtimeTray';
import { loadLoginAtStartup, persistLoginAtStartup } from './runtimePreferences';
import { reactToPowerEvent, type RuntimePowerEvent } from './runtimePower';
import { runSuspendFlush } from './shutdownFlush';

export { reactToPowerEvent, type RuntimePowerEvent } from './runtimePower';

const log = createLogger('runtime-service');

export interface RuntimeServiceDeps {
  trayActions: RuntimeTrayActions;
  /** Broadcast a payload to the renderer (reuses the main→renderer bridge). */
  broadcast: IpcBroadcaster;
}

export class RuntimeService {
  private readonly tray: RuntimeTray;
  private started = false;

  constructor(private readonly deps: RuntimeServiceDeps) {
    this.tray = new RuntimeTray(deps.trayActions);
  }

  /** Bring up the tray + power listeners. Idempotent. */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.tray.init();
    this.wirePowerEvents();
    log.info('RuntimeService started', { loginAtStartup: this.getLoginAtStartup() });
  }

  /** Merge live status into the tray (executive summary, services, automation). */
  updateStatus(patch: Partial<RuntimeTrayState>): void {
    this.tray.setState(patch);
  }

  private wirePowerEvents(): void {
    const handle = (event: RuntimePowerEvent) => {
      const { trayPatch, recover } = reactToPowerEvent(event);
      this.tray.setState(trayPatch);
      if (recover) {
        // Tell the renderer to reconnect voice/automation after wake/unlock.
        this.deps.broadcast(IpcChannel.TrayCommand, { action: 'start-listening' });
      }
      if (event === 'suspend') {
        // GATE 16 (round 46) — a lid close or OS sleep never fires `will-quit`,
        // so drain every registered flush now: a battery death while asleep, or
        // an OS-initiated shutdown from sleep, loses nothing. Best-effort and
        // time-boxed; the drain must never block the suspend itself.
        void runSuspendFlush()
          .then((s) => {
            if (s.failed.length > 0 || s.timedOut.length > 0) {
              log.warn('Suspend flush incomplete', s);
            } else {
              log.info('Suspend flush complete', { ran: s.ran, durationMs: s.durationMs });
            }
          })
          .catch(() => undefined);
      }
      log.info(`power event: ${event}`, { recover });
    };
    try {
      powerMonitor.on('suspend', () => handle('suspend'));
      powerMonitor.on('resume', () => handle('resume'));
      powerMonitor.on('lock-screen', () => handle('lock'));
      powerMonitor.on('unlock-screen', () => handle('unlock'));
    } catch (err) {
      // powerMonitor requires a ready app; guard so startup never fails.
      log.warn('powerMonitor wiring unavailable', { err: String(err) });
    }
  }

  // ── Launch-at-login (STEP 3) ──

  /** The effective preference (persisted), defaulting to false. */
  getLoginAtStartup(): boolean {
    return loadLoginAtStartup();
  }

  /** Apply + persist the launch-at-login preference via Electron's login item. */
  setLoginAtStartup(enabled: boolean): void {
    try {
      app.setLoginItemSettings({ openAtLogin: enabled, openAsHidden: true });
      persistLoginAtStartup(enabled);
      log.info('login-at-startup updated', { enabled });
    } catch (err) {
      log.warn('setLoginItemSettings failed', { err: String(err) });
    }
  }

  /** Reconcile the OS login-item state with the persisted preference on boot. */
  syncLoginAtStartup(): void {
    const pref = loadLoginAtStartup();
    try {
      const current = app.getLoginItemSettings().openAtLogin;
      if (current !== pref) {
        app.setLoginItemSettings({ openAtLogin: pref, openAsHidden: true });
      }
    } catch (err) {
      log.warn('login-item sync failed', { err: String(err) });
    }
  }

  destroy(): void {
    this.tray.destroy();
  }
}

// A module-level reference so the IPC router (static handler map) can reach the
// live service for the login-at-startup handlers without a circular import.
let activeRuntimeService: RuntimeService | null = null;
export function setActiveRuntimeService(svc: RuntimeService | null): void {
  activeRuntimeService = svc;
}
export function getActiveRuntimeService(): RuntimeService | null {
  return activeRuntimeService;
}
