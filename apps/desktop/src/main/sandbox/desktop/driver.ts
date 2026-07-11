/**
 * AI Sandbox — Desktop Automation (S2): the driver port.
 *
 * The single boundary between the sandbox and the OS/Playwright. Everything else in
 * S2 (session manager, action interpreter, window manager, capture, recovery, the
 * executor) is built against these interfaces and unit-tested with an in-memory
 * driver; the production `PlaywrightDesktopDriver` implements them with real
 * Playwright `_electron`. This is the same injected-boundary pattern the rest of the
 * app uses (the S1 engine's executor, the webhook dispatcher's `post`, …).
 */

export interface DesktopLaunchConfig {
  /** Electron binary to launch (the host app's `process.execPath`). */
  executablePath: string;
  /** App entry + CLI args (e.g. `[appPath, ...extraArgs]`). */
  args: string[];
  /** Isolated user-data dir for this session (session isolation). */
  userDataDir: string;
  env: Record<string, string>;
  timeoutMs: number;
  cwd?: string;
}

export interface DesktopElementState {
  exists: boolean;
  visible: boolean;
  enabled: boolean;
  text: string | null;
}

export interface DesktopClickOptions {
  button?: 'left' | 'right';
  clickCount?: number;
  timeoutMs?: number;
}

export interface DesktopWindow {
  readonly id: string;
  title(): Promise<string>;
  url(): Promise<string>;
  click(selector: string, opts?: DesktopClickOptions): Promise<void>;
  hover(selector: string, opts?: { timeoutMs?: number }): Promise<void>;
  fill(selector: string, text: string, opts?: { timeoutMs?: number }): Promise<void>;
  type(selector: string, text: string, opts?: { timeoutMs?: number }): Promise<void>;
  press(key: string): Promise<void>;
  scroll(deltaY: number): Promise<void>;
  waitForSelector(selector: string, opts?: { timeoutMs?: number; state?: 'visible' | 'attached' }): Promise<void>;
  elementState(selector: string): Promise<DesktopElementState>;
  /** Real PNG bytes of the window (or full page). */
  screenshot(opts?: { fullPage?: boolean }): Promise<Buffer>;
}

export interface DesktopConsoleMessage {
  level: string;
  text: string;
  at: number;
}

export interface DesktopNetworkMessage {
  method: string;
  url: string;
  status: number | null;
  at: number;
}

export interface DesktopSession {
  readonly id: string;
  windows(): Promise<DesktopWindow[]>;
  firstWindow(opts?: { timeoutMs?: number }): Promise<DesktopWindow>;
  /** Console messages buffered since launch (renderer + main). */
  consoleMessages(): DesktopConsoleMessage[];
  /** Network requests buffered since launch. */
  networkMessages(): DesktopNetworkMessage[];
  isRunning(): boolean;
  close(): Promise<void>;
}

export interface DesktopDriver {
  /** `playwright` in production, `fake` in tests. */
  readonly kind: string;
  /** Whether this driver can actually run here (e.g. Playwright installed). */
  available(): Promise<boolean>;
  launch(config: DesktopLaunchConfig): Promise<DesktopSession>;
}

/** Thrown by a driver when the automation backend is unavailable — never simulated. */
export class DesktopUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DesktopUnavailableError';
  }
}
