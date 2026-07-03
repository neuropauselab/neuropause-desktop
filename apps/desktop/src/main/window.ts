/**
 * Secure BrowserWindow factory. Hardened defaults: context isolation on, node
 * integration off, sandboxed renderer, and navigation locked to our own
 * content (any other URL opens in the system browser instead). Window size and
 * position are restored from disk and persisted across launches.
 */
import { join } from 'node:path';
import { BrowserWindow, shell } from 'electron';
import { config } from './config';
import { loadWindowState, persistWindowState } from './windowState';

export function createMainWindow(): BrowserWindow {
  const state = loadWindowState();

  const window = new BrowserWindow({
    width: state.width,
    height: state.height,
    x: state.x,
    y: state.y,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    backgroundColor: '#0b0b0f',
    // macOS: keep the native traffic lights but inset them so our custom,
    // draggable title bar can host them. Ignored on other platforms.
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 18 },
    // Translucent material behind the UI for the glassmorphism shell (macOS).
    vibrancy: 'under-window',
    visualEffectState: 'active',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
    },
  });

  if (state.isMaximized) window.maximize();

  // Remember size/position for next launch.
  persistWindowState(window);

  // Avoid a white flash: reveal only once the first paint is ready.
  window.once('ready-to-show', () => window.show());

  // Never open new Electron windows; route external links to the OS browser.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  // Block in-app navigation away from our own content.
  window.webContents.on('will-navigate', (event, url) => {
    const isDevServer = config.isDev && url.startsWith(rendererDevUrl() ?? '\0');
    if (!url.startsWith('file://') && !isDevServer) {
      event.preventDefault();
      if (url.startsWith('http')) void shell.openExternal(url);
    }
  });

  if (config.isDev && rendererDevUrl()) {
    void window.loadURL(rendererDevUrl() as string);
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'));
  }

  return window;
}

/** The Vite dev server URL, injected by electron-vite during development. */
export function rendererDevUrl(): string | undefined {
  return process.env['ELECTRON_RENDERER_URL'];
}
