/**
 * Persists the main window's size and position between launches. State is
 * written to a small JSON file in the app's userData directory (debounced on
 * move/resize, and flushed on close). On restore we validate the saved bounds
 * against the currently-connected displays so the window never opens off-screen
 * (e.g. after unplugging an external monitor).
 */
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { app, screen, type BrowserWindow, type Rectangle } from 'electron';
import { createLogger } from './logger';
import { declareStoreScope } from './tenancy/storeScope';

/** P13C ROUND 9 — F18. The structural scope declaration. See tenancy/storeScope.ts. */
declareStoreScope({
  name: 'window-state',
  scope: 'INSTALL_GLOBAL',
  persistence: 'file',
  // The case `storeScope.ts` names explicitly when it refuses ORG_ROLE: a
  // USER-authority install-global row is the signed-in person's own machine
  // preference. Nothing organizational decides where a window sits.
  authority: 'USER',
  classification: 'USER_PREFERENCE',
  /** P13C ROUND 10. Nothing is ever removed: one rectangle, overwritten in place. recovery:run resetSettings deletes the whole file, but that is recoveryService's removal on cloud:operate, declared there, not this store's. */
  retentionScope: 'NONE',
  retentionAuthority: 'NONE',
  retention:
    'One record, overwritten in place on every move/resize — there is no list, no cap and no ' +
    'eviction, so no write can remove anything but the previous value of this same rectangle. ' +
    '`recovery:run resetSettings` deletes the whole file (it is in SETTINGS_FILES), which resets ' +
    'the window to defaults for the install and reaches no other data.',
  reason:
    'WHY GLOBAL: there is one main window on one machine, so there is one rectangle. WHAT DATA: ' +
    'width, height, x, y and isMaximized — geometry of a window on a display, measured from the ' +
    'window itself. It names no record, counts no activity and describes no customer; the file is ' +
    "under the OS account's userData directory, so it is already per-person by the filesystem. " +
    'CROSS-TENANT COST: none — a wrong value moves a window.',
});

const log = createLogger('window-state');

export interface WindowState {
  width: number;
  height: number;
  x?: number;
  y?: number;
  isMaximized?: boolean;
}

export const DEFAULT_WINDOW_STATE: WindowState = {
  width: 1680,
  height: 1050,
};

const MIN_WIDTH = 1024;
const MIN_HEIGHT = 700;

function statePath(): string {
  return join(app.getPath('userData'), 'window-state.json');
}

/** True when a saved rectangle is visible on at least one connected display. */
function isVisibleOnSomeDisplay(bounds: Rectangle): boolean {
  return screen.getAllDisplays().some((display) => {
    const wa = display.workArea;
    // Require a reasonable overlap, not just a single pixel.
    const overlapX = Math.max(0, Math.min(bounds.x + bounds.width, wa.x + wa.width) - Math.max(bounds.x, wa.x));
    const overlapY = Math.max(0, Math.min(bounds.y + bounds.height, wa.y + wa.height) - Math.max(bounds.y, wa.y));
    return overlapX > 100 && overlapY > 80;
  });
}

export function loadWindowState(): WindowState {
  try {
    if (!existsSync(statePath())) return { ...DEFAULT_WINDOW_STATE };
    const raw = JSON.parse(readFileSync(statePath(), 'utf-8')) as Partial<WindowState>;

    const width = Math.max(MIN_WIDTH, Math.round(raw.width ?? DEFAULT_WINDOW_STATE.width));
    const height = Math.max(MIN_HEIGHT, Math.round(raw.height ?? DEFAULT_WINDOW_STATE.height));
    const state: WindowState = { width, height, isMaximized: raw.isMaximized };

    if (typeof raw.x === 'number' && typeof raw.y === 'number') {
      const candidate: Rectangle = { x: Math.round(raw.x), y: Math.round(raw.y), width, height };
      if (isVisibleOnSomeDisplay(candidate)) {
        state.x = candidate.x;
        state.y = candidate.y;
      }
    }
    return state;
  } catch (err) {
    log.warn('Could not read window state; using defaults', err);
    return { ...DEFAULT_WINDOW_STATE };
  }
}

/** Attaches debounced persistence to a window. */
export function persistWindowState(win: BrowserWindow): void {
  let timer: NodeJS.Timeout | null = null;

  const save = (): void => {
    if (win.isDestroyed()) return;
    try {
      const bounds = win.getNormalBounds();
      const state: WindowState = {
        width: bounds.width,
        height: bounds.height,
        x: bounds.x,
        y: bounds.y,
        isMaximized: win.isMaximized(),
      };
      writeFileSync(statePath(), JSON.stringify(state, null, 2), 'utf-8');
    } catch (err) {
      log.warn('Failed to persist window state', err);
    }
  };

  const debouncedSave = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(save, 400);
  };

  win.on('resize', debouncedSave);
  win.on('move', debouncedSave);
  win.on('maximize', debouncedSave);
  win.on('unmaximize', debouncedSave);
  win.on('close', () => {
    if (timer) clearTimeout(timer);
    save();
  });
}
