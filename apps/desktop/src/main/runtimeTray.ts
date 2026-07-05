/**
 * NeuroPause Runtime Tray (V4.0).
 *
 * Gives the app an always-on presence: a menu-bar/tray icon reflecting runtime
 * status (voice + automation + connected services) with quick actions. The pure
 * menu-template construction lives in runtimeTrayMenu.ts (unit-tested); this file
 * is the thin Electron `Tray` shell. Navigation reuses the existing MenuCommand
 * broadcast — no new renderer plumbing.
 */
import { Tray, Menu, nativeImage } from 'electron';
import { createLogger } from './logger';
import {
  buildTrayMenuTemplate,
  DEFAULT_TRAY_STATE,
  type RuntimeTrayActions,
  type RuntimeTrayState,
} from './runtimeTrayMenu';

export type { RuntimeTrayActions, RuntimeTrayState } from './runtimeTrayMenu';
export { buildTrayMenuTemplate } from './runtimeTrayMenu';

const log = createLogger('runtime-tray');

/**
 * Runtime Tray controller. Construct once after the app is ready; call
 * `setState` as runtime status changes to refresh the menu in place.
 */
export class RuntimeTray {
  private tray: Tray | null = null;
  private state: RuntimeTrayState = { ...DEFAULT_TRAY_STATE };

  constructor(private readonly actions: RuntimeTrayActions) {}

  /** Create the OS tray item. Safe to call once; no-op if already created. */
  init(): void {
    if (this.tray) return;
    try {
      // Empty template image keeps the tray functional without shipping a broken
      // asset reference; a real icon can replace this later.
      this.tray = new Tray(nativeImage.createEmpty());
      this.tray.setToolTip('NeuroPause — Enterprise AI Runtime');
      this.refresh();
      log.info('Runtime tray initialized');
    } catch (err) {
      // Tray creation can fail in headless/CI contexts; the runtime keeps working.
      log.warn('Runtime tray unavailable', { err: String(err) });
    }
  }

  /** Merge new status and refresh the menu. */
  setState(patch: Partial<RuntimeTrayState>): void {
    this.state = { ...this.state, ...patch };
    this.refresh();
  }

  getState(): RuntimeTrayState {
    return { ...this.state };
  }

  private refresh(): void {
    if (!this.tray) return;
    const template = buildTrayMenuTemplate(this.state, this.actions, (name, err) =>
      log.warn(`tray action failed: ${name}`, { err: String(err) }),
    );
    this.tray.setContextMenu(Menu.buildFromTemplate(template));
    if (process.platform === 'darwin') this.tray.setTitle(this.state.listening ? ' ●' : '');
  }

  destroy(): void {
    this.tray?.destroy();
    this.tray = null;
  }
}
