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
import { authService } from './auth/authService';
import { createMainWindow, rendererDevUrl } from './window';
import { buildAppMenu } from './menu';
import { initRuntimeCore } from './runtimeCore';
import { startupMetrics } from './diagnostics/startupMetrics';
import { RuntimeService, setActiveRuntimeService } from './runtimeService';

const log = createLogger('main');

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
  startupMetrics.mark('window-created');
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

async function bootstrap(): Promise<void> {
  startupMetrics.mark('app-ready');
  installContentSecurityPolicy();

  // Restrict which origins may send us IPC (dev server in dev; file:// always).
  const devUrl = rendererDevUrl();
  setAllowedSenderOrigins(devUrl ? [new URL(devUrl).origin] : []);

  registerIpcHandlers();
  wireEventBridges();

  mainWindow = createMainWindow();

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
        app.exit(0);
      },
      exit: () => app.quit(),
    },
  });
  runtimeService.start();
  runtimeService.syncLoginAtStartup();
  setActiveRuntimeService(runtimeService);

  // Attempt to silently restore a prior session from the keychain.
  await authService.restoreSession();

  // Bring up the trusted execution layer: secure catalog IPC, the Local
  // Application Registry, the NeuroPause Package Service, the runtime, and the
  // background services. Failures here must not take down the window.
  try {
    await initRuntimeCore({ broadcast });
    startupMetrics.mark('runtime-core-ready');
    log.info('Startup complete', startupMetrics.snapshot());
  } catch (err) {
    log.error('Runtime core failed to initialize', err);
  }
}

// Enforce a single running instance; focus the existing window otherwise.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
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
}

// Harden: forbid creation of additional web contents we didn't intend.
app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
});

if (config.isDev) {
  log.info('Starting in development mode', { backendUrl: config.backendUrl });
}
