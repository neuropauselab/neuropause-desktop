/**
 * AI Sandbox — Desktop Automation (S2): in-memory driver (TEST DOUBLE, not shipped
 * as production automation).
 *
 * A deterministic implementation of the {@link DesktopDriver} port used to unit-test
 * the session manager, action interpreter, window manager, capture, recovery, and the
 * executor — the same dependency-injection pattern the whole app uses for its OS/
 * network boundaries. The PRODUCTION executor always registers the real
 * `PlaywrightDesktopDriver`; this fake is injected only by tests (and is available for
 * a future UI dry-run). It performs no OS I/O and uses no real clock/timers.
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

export interface FakeElement {
  selector: string;
  visible?: boolean;
  enabled?: boolean;
  text?: string | null;
}
export interface FakeWindowSpec {
  title?: string;
  url?: string;
  elements?: FakeElement[];
}
export interface FakeDriverScript {
  windows?: FakeWindowSpec[];
  console?: DesktopConsoleMessage[];
  network?: DesktopNetworkMessage[];
  /** When set, `launch` rejects (simulates a launch crash for recovery tests). */
  failLaunch?: string;
  /** When true, the session launches but no windows ever appear (missing-window recovery). */
  noWindows?: boolean;
  /** When false, `available()` reports the backend as unavailable. */
  available?: boolean;
  /** From the 2nd launch on, use `healedWindows` (models a flaky launch recovering). */
  healOnRelaunch?: boolean;
  healedWindows?: FakeWindowSpec[];
}

/** Records every action the interpreter drove, for test assertions. */
export interface FakeCall {
  window: string;
  op: string;
  args: Record<string, string | number | boolean>;
}

class FakeWindow implements DesktopWindow {
  constructor(
    readonly id: string,
    private readonly spec: FakeWindowSpec,
    private readonly calls: FakeCall[],
  ) {}

  private el(selector: string): FakeElement | undefined {
    return (this.spec.elements ?? []).find((e) => e.selector === selector);
  }
  private record(op: string, args: Record<string, string | number | boolean> = {}): void {
    this.calls.push({ window: this.id, op, args });
  }
  private require(selector: string, op: string): FakeElement {
    const el = this.el(selector);
    if (!el) throw new Error(`Timeout: selector "${selector}" not found (${op})`);
    return el;
  }

  title(): Promise<string> {
    return Promise.resolve(this.spec.title ?? 'Untitled');
  }
  url(): Promise<string> {
    return Promise.resolve(this.spec.url ?? 'app://home');
  }
  click(selector: string, opts: { button?: 'left' | 'right'; clickCount?: number } = {}): Promise<void> {
    const el = this.require(selector, 'click');
    if (el.enabled === false) throw new Error(`Element "${selector}" is disabled`);
    this.record('click', { selector, button: opts.button ?? 'left', clickCount: opts.clickCount ?? 1 });
    return Promise.resolve();
  }
  hover(selector: string): Promise<void> {
    this.require(selector, 'hover');
    this.record('hover', { selector });
    return Promise.resolve();
  }
  fill(selector: string, text: string): Promise<void> {
    this.require(selector, 'fill');
    this.record('fill', { selector, text });
    return Promise.resolve();
  }
  type(selector: string, text: string): Promise<void> {
    this.require(selector, 'type');
    this.record('type', { selector, text });
    return Promise.resolve();
  }
  press(key: string): Promise<void> {
    this.record('press', { key });
    return Promise.resolve();
  }
  scroll(deltaY: number): Promise<void> {
    this.record('scroll', { deltaY });
    return Promise.resolve();
  }
  waitForSelector(selector: string): Promise<void> {
    const el = this.el(selector);
    if (!el || el.visible === false) throw new Error(`Timeout: waiting for "${selector}"`);
    this.record('waitForSelector', { selector });
    return Promise.resolve();
  }
  elementState(selector: string): Promise<DesktopElementState> {
    const el = this.el(selector);
    if (!el) return Promise.resolve({ exists: false, visible: false, enabled: false, text: null });
    return Promise.resolve({ exists: true, visible: el.visible !== false, enabled: el.enabled !== false, text: el.text ?? null });
  }
  screenshot(): Promise<Buffer> {
    this.record('screenshot', {});
    // Deterministic test bytes (the production driver returns real PNG bytes).
    return Promise.resolve(Buffer.from(`fake-shot:${this.id}:${this.spec.title ?? ''}`));
  }
}

class FakeSession implements DesktopSession {
  private running = true;
  constructor(
    readonly id: string,
    private readonly script: FakeDriverScript,
    private readonly calls: FakeCall[],
    private readonly launchIndex: number,
  ) {}

  private buildWindows(): FakeWindow[] {
    if (this.script.noWindows) return [];
    const healed = this.script.healOnRelaunch && this.launchIndex >= 2 && this.script.healedWindows;
    const specs = (healed ? this.script.healedWindows : this.script.windows) ?? [{ title: 'NeuroPause', url: 'app://home', elements: [] }];
    return specs.map((s, i) => new FakeWindow(`${this.id}:w${i}`, s, this.calls));
  }
  windows(): Promise<DesktopWindow[]> {
    return Promise.resolve(this.buildWindows());
  }
  firstWindow(): Promise<DesktopWindow> {
    const w = this.buildWindows()[0];
    if (!w) throw new Error('Timeout: no window appeared');
    return Promise.resolve(w);
  }
  consoleMessages(): DesktopConsoleMessage[] {
    return [...(this.script.console ?? [])];
  }
  networkMessages(): DesktopNetworkMessage[] {
    return [...(this.script.network ?? [])];
  }
  isRunning(): boolean {
    return this.running;
  }
  /** Test hook: simulate an app/renderer crash mid-run. */
  crash(): void {
    this.running = false;
  }
  close(): Promise<void> {
    this.running = false;
    return Promise.resolve();
  }
}

export class FakeDesktopDriver implements DesktopDriver {
  readonly kind = 'fake';
  readonly calls: FakeCall[] = [];
  readonly sessions: FakeSession[] = [];
  private seq = 0;

  constructor(private readonly script: FakeDriverScript = {}) {}

  available(): Promise<boolean> {
    return Promise.resolve(this.script.available !== false);
  }
  launch(_config: DesktopLaunchConfig): Promise<DesktopSession> {
    if (this.script.failLaunch) throw new DesktopUnavailableError(this.script.failLaunch);
    this.seq += 1;
    const session = new FakeSession(`fake_${this.seq}`, this.script, this.calls, this.seq);
    this.sessions.push(session);
    return Promise.resolve(session);
  }
}
