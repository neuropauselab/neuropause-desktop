/**
 * Main process entry point. Owns the application lifecycle, installs security
 * policy, creates the window, wires IPC, and bridges main-process events
 * (auth + theme) to the renderer.
 */
import { join } from 'node:path';
import { app, BrowserWindow, Menu, nativeTheme } from 'electron';
import type {
  AuthStatus,
  IpcBroadcastChannelName,
  IpcBroadcastOf,
  ThemeSource,
} from '@neuropause/shared';
import { IpcChannel } from '@neuropause/shared';
import { config } from './config';
import { attachLogFileSink, createLogger } from './logger';
import { createBoundedLog } from './storage/boundedLog';
import { installContentSecurityPolicy } from './security/csp';
import { registerIpcHandlers, setAllowedSenderOrigins } from './ipc/router';
import { registerEarlyReachabilityHandler } from './ipc/earlyReachability';
import { markRuntimeFailed, markRuntimeReady, safeInitFailureMessage } from './runtimeReadiness';
import { registerShutdownFlush, runShutdownFlush } from './shutdownFlush';
import { authService } from './auth/authService';
import { createMainWindow, rendererDevUrl } from './window';
import { buildAppMenu } from './menu';
import { initRuntimeCore } from './runtimeCore';
import { startupMetrics } from './diagnostics/startupMetrics';
import { RuntimeService, setActiveRuntimeService } from './runtimeService';

const log = createLogger('main');

/**
 * GATE 1 (round 48) — BOOT-WINDOW CRASH CAPTURE.
 *
 * Before this, the main process had NO `uncaughtException`/`unhandledRejection`
 * handlers: a crash during the boot window (or any time after) was a silent
 * process death — no log line, no flush, nothing for a support bundle to read.
 * Both handlers are LOCAL-ONLY (they write to the app log, never send
 * anything anywhere — crash-report consent is a separate, opt-in toggle and is
 * untouched). An uncaught exception quits through `app.quit()` so the Gate-16
 * flush barrier still drains pending writes on the way down — strictly better
 * than the default hard crash. The `crashed` latch prevents a quit loop if the
 * quit path itself throws. Rejections are logged, never fatal (Node warns by
 * default; a background subsystem's failed promise must not take the app down).
 */
let crashed = false;
process.on('uncaughtException', (err) => {
  try {
    log.error('Uncaught exception (main process)', err);
  } catch {
    /* the logger itself may be the casualty — still attempt the orderly quit */
  }
  if (!crashed) {
    crashed = true;
    app.quit();
  }
});
process.on('unhandledRejection', (reason) => {
  try {
    log.error('Unhandled rejection (main process)', reason);
  } catch {
    /* never rethrow from a crash handler */
  }
});

let mainWindow: BrowserWindow | null = null;
let runtimeService: RuntimeService | null = null;

/**
 * Sends a payload to the renderer if a window exists.
 *
 * The only `webContents.send` in the process: every subsystem receives this as an
 * `IpcBroadcaster` dependency rather than reaching for the window, so the window
 * stays owned here and there is exactly one place a push can originate.
 *
 * A7 — this took `(channel: string, payload: unknown)`, which made the push half of
 * the IPC boundary undescribed: any string was a channel, any value was a payload,
 * and the renderer's `subscribe` asserted a shape that nothing here had to agree
 * with. `IpcBroadcastMap` is now that agreement — the channel must be one the map
 * declares, and the payload must be what it declares for that channel.
 */
function broadcast<C extends IpcBroadcastChannelName>(
  channel: C,
  payload: IpcBroadcastOf<C>,
): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

/** Show + focus the main window, recreating it if it was closed (macOS). */
function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = createMainWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function wireEventBridges(): void {
  // Auth state changes -> renderer.
  authService.on('statusChanged', (status: AuthStatus) => {
    broadcast(IpcChannel.AuthStatusChanged, status);
  });

  // OS / user theme changes -> renderer (covers system-appearance switches).
  nativeTheme.on('updated', () => {
    const source = nativeTheme.themeSource as ThemeSource;
    broadcast(IpcChannel.ThemeChanged, { source });
  });
}

// Wave-2 Slice-14 — build-time constant (see electron.vite.config.ts `define`); false in every release build.
declare const __NP_E2E__: boolean;

async function bootstrap(): Promise<void> {
  startupMetrics.mark('app-ready');
  installContentSecurityPolicy();

  // Restrict which origins may send us IPC (dev server in dev; file:// always).
  const devUrl = rendererDevUrl();
  setAllowedSenderOrigins(devUrl ? [new URL(devUrl).origin] : []);

  registerIpcHandlers();
  // P13C O-3 — the reachability channel must answer before the window can ask.
  // Runtime core replaces this with the sampler-backed handler when it is up.
  registerEarlyReachabilityHandler();
  wireEventBridges();

  mainWindow = createMainWindow();
  // The mark belongs at the PRIMARY creation site. It used to sit only inside
  // the tray-recreation branch of showMainWindow(), so a normal launch never
  // recorded time-to-first-window — the one number startup diagnostics exist
  // to capture. createMainWindow() is called from three sites; marking here
  // and not in the recreation paths keeps the metric meaning "first window of
  // this process", which is what boot analysis needs.
  startupMetrics.mark('window-created');

  // Native menu bar: its accelerators dispatch commands to the renderer.
  Menu.setApplicationMenu(buildAppMenu((payload) => broadcast(IpcChannel.MenuCommand, payload)));

  // Runtime service (V4.2): owns the tray, power (sleep/resume/lock/unlock)
  // recovery, and launch-at-login. Composes the V4.0 tray; no duplicated logic.
  runtimeService = new RuntimeService({
    broadcast,
    trayActions: {
      openDashboard: () => {
        showMainWindow();
        broadcast(IpcChannel.MenuCommand, { action: 'navigate-section', section: 'intent-home' });
      },
      openExecutiveCenter: () => {
        showMainWindow();
        broadcast(IpcChannel.MenuCommand, { action: 'navigate-section', section: 'enterprise' });
      },
      startListening: () => {
        showMainWindow();
        broadcast(IpcChannel.TrayCommand, { action: 'start-listening' });
        runtimeService?.updateStatus({ listening: true });
      },
      pauseListening: () => {
        broadcast(IpcChannel.TrayCommand, { action: 'pause-listening' });
        runtimeService?.updateStatus({ listening: false });
      },
      restartRuntime: () => {
        app.relaunch();
        // `app.quit()`, not `app.exit(0)`: exit() skips `before-quit`, which
        // is where pending store flushes drain. A restart that loses the
        // 300ms-debounced session snapshot is a restart that forgets state.
        app.quit();
      },
      exit: () => app.quit(),
    },
  });
  runtimeService.start();
  runtimeService.syncLoginAtStartup();
  setActiveRuntimeService(runtimeService);

  // Attempt to silently restore a prior session from the keychain.
  await authService.restoreSession();

  // NP-007 (compile-stripped like the seed itself): the e2e principal must be established BETWEEN restoreSession and
  // the runtime/enterprise bootstrap — on a fresh profile, S17 local mode has just entered, and if the bootstrap runs
  // first it binds the org owner row to the LOCAL principal, leaving the later-seeded session permanently
  // not_a_member (the 19 Aug 2026 ceremony divergence; reproduced in e2e/freshProfileBootstrap.e2e.cjs). Mode
  // resolution HARD-FAILS here, before any init, preserving the original coupling semantics.
  let e2eMode: 'full-e2e' | 'app-principal' | 'off' = 'off';
  if (__NP_E2E__) {
    try {
      const { resolveE2eMode } = await import('./e2e/e2eMode');
      e2eMode = resolveE2eMode(process.env); // HARD-FAILS (throws) on an invalid flag coupling — see e2eMode.ts
      if (e2eMode !== 'off') {
        const { installE2eSeedPrincipal } = await import('./e2e/e2eSeed');
        await installE2eSeedPrincipal(e2eMode);
      }
    } catch (err) {
      // HARD-FAIL at startup: an invalid mode coupling (or a seed failure) must NOT run.
      log.error('E2E mode/seed failure — exiting', err);
      app.exit(1);
      return;
    }
  }

  // Bring up the trusted execution layer: secure catalog IPC, the Local
  // Application Registry, the NeuroPause Package Service, the runtime, and the
  // background services. Failures here must not take down the window.
  try {
    await initRuntimeCore({ broadcast });
    startupMetrics.mark('runtime-core-ready');
    log.info('Startup complete', startupMetrics.snapshot());
    /**
     * P13C ROUND 36 — GATE 1. The renderer has been up for seconds against
     * base channels only; this transition + broadcast is what lets it retry
     * anything that raced the ~650 secure channels (the sticky `xp:profile.get`
     * class) the moment they exist.
     */
    broadcast(IpcChannel.RuntimeStateChanged, markRuntimeReady());
  } catch (err) {
    log.error('Runtime core failed to initialize', err);
    /**
     * P13C ROUND 36 — GATE 1. The window deliberately stays up, but the
     * failure is no longer SILENT: the renderer gets the state over the base
     * router (which registered before the window) and shows a real failure
     * notice instead of rendering a complete UI over ~650 dead channels. The
     * message is the sanitized first line only — the full error is in the log.
     */
    broadcast(IpcChannel.RuntimeStateChanged, markRuntimeFailed(safeInitFailureMessage(err)));
  }

  // Wave-2 Slice-14 — E2E LATE seams (mock Graph + fake governed account; they need the initialized runtime).
  // `__NP_E2E__` folds to `false` in every release build, so this branch and its dynamic import are dead-code-
  // eliminated (never shipped). The mode was resolved (and the PRINCIPAL seeded) BEFORE the bootstrap — NP-007.
  if (__NP_E2E__ && e2eMode !== 'off') {
    try {
      const { installE2eSeeds } = await import('./e2e/e2eSeed');
      await installE2eSeeds(e2eMode);
      // Anti-masquerade stamp: window title carries `-e2e` + the mode so a seeded build is visibly not a release.
      mainWindow?.setTitle(`NeuroPause -e2e (${e2eMode} — not for release)`);
    } catch (err) {
      // HARD-FAIL at startup: a seed failure must NOT run.
      log.error('E2E mode/seed failure — exiting', err);
      app.exit(1);
    }
  }

  // Wave-2 Slice-16 — in-session read-back verification runner. Compile-stripped from release (__NP_E2E__ false);
  // NEUROPAUSE_VERIFY_S15-gated so a normal launch never runs it. READ-ONLY (Sent Items + Inbox of the own mailbox).
  if (__NP_E2E__ && process.env.NEUROPAUSE_VERIFY_S15 === '1') {
    try {
      const { runS16Verification } = await import('./e2e/s16VerifyRun');
      await runS16Verification();
    } catch (err) {
      log.error('S16 verification run failed', err);
    }
  }
}

// Enforce a single running instance; focus the existing window otherwise.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    // `showMainWindow` handles all three states this handler used to get
    // wrong: a destroyed reference (macOS keeps the process alive with no
    // window — `isMinimized()` on it THROWS), a closed window (recreate),
    // and a minimized one (restore + show + focus).
    showMainWindow();
  });

  app
    .whenReady()
    .then(() => {
      // Phase 8 (8.4): rotating application log — packaged builds have no
      // console, and support bundles copy logs/, so app.log is what a field
      // diagnosis actually reads. Attached before bootstrap so startup lines land.
      const appLog = createBoundedLog(() => join(app.getPath('userData'), 'logs', 'app.log'), {
        maxBytes: 5 * 1024 * 1024,
        keep: 2,
      });
      attachLogFileSink((line) => appLog.append(line));
      // Round 37 — Gate 16: the log's own buffered tail drains at quit too.
      registerShutdownFlush('app-log', () => appLog.flush());
      return bootstrap();
    })
    .catch((err) => {
      log.error('Fatal error during startup', err);
      app.quit();
    });

  // macOS: re-create a window when the dock icon is clicked and none are open.
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow();
    }
  });

  // Follow platform convention: stay resident on macOS until Cmd+Q.
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  /**
   * P13C ROUND 37 — GATE 16. THE SHUTDOWN FLUSH BARRIER.
   *
   * 37 stores flush through coalesced background writers; before this, only
   * ONE had a shutdown hook and everything else raced app exit — up to a
   * debounce/interval of user state lost on every quit. `will-quit` fires
   * after all windows are gone and before exit: the first pass defers the
   * quit, drains every registered flush (time-boxed, failure-isolated —
   * shutdown is not the moment to refuse), then quits for real.
   */
  let shutdownFlushed = false;
  app.on('will-quit', (event) => {
    if (shutdownFlushed) return;
    event.preventDefault();
    void runShutdownFlush()
      .then((summary) => {
        if (summary.failed.length > 0 || summary.timedOut.length > 0) {
          log.warn('Shutdown flush completed with losses', summary);
        } else {
          log.info('Shutdown flush complete', summary);
        }
      })
      .catch(() => undefined)
      .finally(() => {
        shutdownFlushed = true;
        app.quit();
      });
  });
}

// Harden: forbid creation of additional web contents we didn't intend.
app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
});

if (config.isDev) {
  log.info('Starting in development mode', { backendUrl: config.backendUrl });
}
