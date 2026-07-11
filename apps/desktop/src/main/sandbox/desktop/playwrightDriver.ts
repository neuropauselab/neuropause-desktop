/**
 * AI Sandbox — Desktop Automation (S2): the PRODUCTION driver.
 *
 * Real desktop automation via Playwright's Electron support (`_electron`). Nothing is
 * simulated: it launches a genuine Electron instance of the app against an isolated
 * user-data dir and drives real windows. Playwright is imported dynamically (a
 * `@vite-ignore` variable import) so it is NOT bundled and the build/typecheck/lint
 * gates pass without it installed — but if it is absent at run time the driver throws
 * a clear {@link DesktopUnavailableError} rather than faking anything. Because the gate
 * environment has no display, this adapter is integration-tested on a real machine;
 * its callers are unit-tested through the driver port with an in-memory driver.
 */
import {
  DesktopUnavailableError,
  type DesktopConsoleMessage,
  type DesktopDriver,
  type DesktopElementState,
  type DesktopLaunchConfig,
  type DesktopNetworkMessage,
  type DesktopSession,
  type DesktopWindow,
} from './driver';
import { createLogger } from '../../logger';

const log = createLogger('sandbox-desktop-playwright');

/* Minimal structural types for the bits of Playwright we use — avoids a compile-time
 * dependency on @playwright/test while keeping the adapter fully typed. */
interface PwLocator {
  first(): PwLocator;
  count(): Promise<number>;
  isVisible(): Promise<boolean>;
  isEnabled(): Promise<boolean>;
  textContent(): Promise<string | null>;
}
interface PwPage {
  title(): Promise<string>;
  url(): string;
  isClosed(): boolean;
  click(selector: string, opts?: { button?: 'left' | 'right'; clickCount?: number; timeout?: number }): Promise<void>;
  hover(selector: string, opts?: { timeout?: number }): Promise<void>;
  fill(selector: string, value: string, opts?: { timeout?: number }): Promise<void>;
  type(selector: string, text: string, opts?: { timeout?: number }): Promise<void>;
  waitForSelector(selector: string, opts?: { timeout?: number; state?: 'visible' | 'attached' }): Promise<unknown>;
  locator(selector: string): PwLocator;
  screenshot(opts?: { fullPage?: boolean }): Promise<Buffer>;
  keyboard: { press(key: string): Promise<void> };
  mouse: { wheel(x: number, y: number): Promise<void> };
  on(event: 'console' | 'request' | 'response', cb: (arg: PwEventArg) => void): void;
}
interface PwEventArg {
  type?(): string;
  text?(): string;
  method?(): string;
  url?(): string;
  status?(): number;
}
interface PwElectronApp {
  firstWindow(opts?: { timeout?: number }): Promise<PwPage>;
  windows(): PwPage[];
  close(): Promise<void>;
  on(event: 'window' | 'close', cb: (arg: PwPage) => void): void;
}
interface PwElectron {
  launch(opts: { executablePath?: string; args: string[]; env?: Record<string, string>; timeout?: number; cwd?: string }): Promise<PwElectronApp>;
}
interface PwModule {
  _electron: PwElectron;
}

async function loadPlaywright(): Promise<PwModule | null> {
  try {
    const moduleName = 'playwright';
    const mod = (await import(/* @vite-ignore */ moduleName)) as unknown as Partial<PwModule>;
    return mod && mod._electron ? (mod as PwModule) : null;
  } catch {
    return null;
  }
}

class PlaywrightWindow implements DesktopWindow {
  constructor(readonly id: string, private readonly page: PwPage) {}
  title(): Promise<string> {
    return this.page.title();
  }
  url(): Promise<string> {
    return Promise.resolve(this.page.url());
  }
  click(selector: string, opts: { button?: 'left' | 'right'; clickCount?: number; timeoutMs?: number } = {}): Promise<void> {
    return this.page.click(selector, { button: opts.button, clickCount: opts.clickCount, timeout: opts.timeoutMs });
  }
  hover(selector: string, opts: { timeoutMs?: number } = {}): Promise<void> {
    return this.page.hover(selector, { timeout: opts.timeoutMs });
  }
  fill(selector: string, text: string, opts: { timeoutMs?: number } = {}): Promise<void> {
    return this.page.fill(selector, text, { timeout: opts.timeoutMs });
  }
  type(selector: string, text: string, opts: { timeoutMs?: number } = {}): Promise<void> {
    return this.page.type(selector, text, { timeout: opts.timeoutMs });
  }
  press(key: string): Promise<void> {
    return this.page.keyboard.press(key);
  }
  scroll(deltaY: number): Promise<void> {
    return this.page.mouse.wheel(0, deltaY);
  }
  async waitForSelector(selector: string, opts: { timeoutMs?: number; state?: 'visible' | 'attached' } = {}): Promise<void> {
    await this.page.waitForSelector(selector, { timeout: opts.timeoutMs, state: opts.state ?? 'visible' });
  }
  async elementState(selector: string): Promise<DesktopElementState> {
    const loc = this.page.locator(selector).first();
    if ((await loc.count()) === 0) return { exists: false, visible: false, enabled: false, text: null };
    const [visible, enabled, text] = await Promise.all([loc.isVisible(), loc.isEnabled(), loc.textContent()]);
    return { exists: true, visible, enabled, text };
  }
  screenshot(opts: { fullPage?: boolean } = {}): Promise<Buffer> {
    return this.page.screenshot({ fullPage: opts.fullPage });
  }
}

class PlaywrightSession implements DesktopSession {
  private readonly console: DesktopConsoleMessage[] = [];
  private readonly network: DesktopNetworkMessage[] = [];
  private running = true;
  constructor(readonly id: string, private readonly appHandle: PwElectronApp, captureConsole: boolean) {
    appHandle.on('close', () => {
      this.running = false;
    });
    if (captureConsole) {
      void this.appHandle
        .firstWindow()
        .then((page) => {
          page.on('console', (msg) => this.console.push({ level: msg.type?.() ?? 'log', text: msg.text?.() ?? '', at: Date.now() }));
          page.on('request', (req) => this.network.push({ method: req.method?.() ?? 'GET', url: req.url?.() ?? '', status: null, at: Date.now() }));
          page.on('response', (res) => this.network.push({ method: res.method?.() ?? 'GET', url: res.url?.() ?? '', status: res.status?.() ?? null, at: Date.now() }));
        })
        .catch(() => undefined);
    }
  }
  networkMessages(): DesktopNetworkMessage[] {
    return [...this.network];
  }
  async windows(): Promise<DesktopWindow[]> {
    return this.appHandle.windows().map((p, i) => new PlaywrightWindow(`${this.id}:w${i}`, p));
  }
  async firstWindow(opts: { timeoutMs?: number } = {}): Promise<DesktopWindow> {
    const page = await this.appHandle.firstWindow({ timeout: opts.timeoutMs });
    return new PlaywrightWindow(`${this.id}:w0`, page);
  }
  consoleMessages(): DesktopConsoleMessage[] {
    return [...this.console];
  }
  isRunning(): boolean {
    return this.running;
  }
  async close(): Promise<void> {
    this.running = false;
    await this.appHandle.close().catch(() => undefined);
  }
}

export class PlaywrightDesktopDriver implements DesktopDriver {
  readonly kind = 'playwright';
  private seq = 0;

  async available(): Promise<boolean> {
    return (await loadPlaywright()) !== null;
  }

  async launch(config: DesktopLaunchConfig): Promise<DesktopSession> {
    const pw = await loadPlaywright();
    if (!pw) {
      throw new DesktopUnavailableError(
        'Desktop automation requires Playwright. Install it in apps/desktop (npm i -D playwright) to run desktop scenarios.',
      );
    }
    const args = [...config.args, `--user-data-dir=${config.userDataDir}`];
    log.info('launching electron via playwright', { userDataDir: config.userDataDir, args: args.length });
    const appHandle = await pw._electron.launch({
      executablePath: config.executablePath,
      args,
      env: config.env,
      timeout: config.timeoutMs,
      cwd: config.cwd,
    });
    this.seq += 1;
    return new PlaywrightSession(`pw_${this.seq}`, appHandle, true);
  }
}
