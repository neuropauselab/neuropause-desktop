/**
 * Operating-system platform identifier. Mirrors Node's process.platform values
 * but is declared locally so the shared package stays free of Node type
 * dependencies (it is also compiled in the renderer/DOM context).
 */
export type Platform =
  | 'aix'
  | 'android'
  | 'darwin'
  | 'freebsd'
  | 'haiku'
  | 'linux'
  | 'openbsd'
  | 'sunos'
  | 'win32'
  | 'cygwin'
  | 'netbsd';

/** Lightweight app metadata surfaced to the renderer. */
export interface AppInfo {
  name: string;
  version: string;
  electronVersion: string;
  platform: Platform;
  isPackaged: boolean;
}

/**
 * Commands dispatched by the native macOS menu (and its keyboard accelerators)
 * to the renderer. The renderer maps these onto shell actions, so the menu,
 * the keyboard, and in-app controls all drive the same behaviour.
 */
export type MenuCommandAction =
  | 'command-palette'
  | 'open-settings'
  | 'navigate'
  | 'new-tab'
  | 'close-tab'
  | 'zoom-in'
  | 'zoom-out'
  | 'zoom-reset';

export interface MenuCommandPayload {
  action: MenuCommandAction;
  /** For 'navigate': the 1-based section index (⌘1–⌘9). */
  index?: number;
}

/** Tray → renderer runtime control commands (V4.0/V4.1). */
export type TrayCommandAction = 'start-listening' | 'pause-listening';
export interface TrayCommandPayload {
  action: TrayCommandAction;
}
