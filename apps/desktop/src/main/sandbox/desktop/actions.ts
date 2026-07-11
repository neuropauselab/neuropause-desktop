/**
 * AI Sandbox — Desktop Automation (S2): the reusable action interpreter.
 *
 * Executes one window-level {@link DesktopAction} against the driver port — clicks,
 * typing, key/shortcuts, hover/scroll, waits, in-app menu + command-palette, real
 * screenshots, element-state assertions, and console/network capture. Session-level
 * actions (launch/close/restart) are handled by the executor. Assertions return a
 * pass/fail verdict (the executor decides stop-on-failure); genuine automation errors
 * (missing / disabled element, timeout) throw and flow into recovery. Pure over its
 * injected driver window + capture sink + clock.
 */
import type { DesktopAction, LogLevel } from '@neuropause/shared';
import type { DesktopSession, DesktopWindow } from './driver';
import { captureConsole, captureNetwork, captureScreenshot, type CaptureDeps } from './capture';

export class AssertionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AssertionError';
  }
}

export class PerfCollector {
  private readonly interactions: number[] = [];
  private readonly screenshots: number[] = [];
  launchMs = 0;
  windowReadyMs = 0;
  assertions = 0;
  recoveries = 0;

  interaction(ms: number): void {
    this.interactions.push(ms);
  }
  screenshot(ms: number): void {
    this.screenshots.push(ms);
  }
  metrics(): Record<string, number> {
    const avg = (a: number[]): number => (a.length ? Math.round(a.reduce((s, x) => s + x, 0) / a.length) : 0);
    return {
      launchMs: this.launchMs,
      windowReadyMs: this.windowReadyMs,
      actions: this.interactions.length + this.screenshots.length,
      interactionMsAvg: avg(this.interactions),
      interactionMsMax: this.interactions.length ? Math.max(...this.interactions) : 0,
      screenshotMsAvg: avg(this.screenshots),
      screenshots: this.screenshots.length,
      assertions: this.assertions,
      recoveries: this.recoveries,
    };
  }
}

export interface ActionRunContext {
  session: DesktopSession;
  window: DesktopWindow;
  capture: CaptureDeps;
  emitStep: (name: string) => void;
  emitLog: (message: string, level?: LogLevel) => void;
  sleep: (ms: number) => Promise<void>;
  defaultTimeoutMs: number;
  perf: PerfCollector;
  now: () => number;
}

export interface ActionResult {
  assertion?: { ok: boolean; message: string };
}

const PALETTE_SHORTCUT = process.platform === 'darwin' ? 'Meta+k' : 'Control+k';

/** Run a single window-level action; returns an assertion verdict for assert* actions. */
export async function runAction(action: DesktopAction, ctx: ActionRunContext): Promise<ActionResult> {
  const timeoutMs = action.timeoutMs ?? ctx.defaultTimeoutMs;
  const label = action.label ?? describe(action);
  ctx.emitStep(label);
  const started = ctx.now();
  const w = ctx.window;

  switch (action.type) {
    case 'click':
      await w.click(action.selector!, { timeoutMs });
      break;
    case 'doubleClick':
      await w.click(action.selector!, { clickCount: 2, timeoutMs });
      break;
    case 'rightClick':
      await w.click(action.selector!, { button: 'right', timeoutMs });
      break;
    case 'hover':
      await w.hover(action.selector!, { timeoutMs });
      break;
    case 'fill':
      await w.fill(action.selector!, action.text ?? '', { timeoutMs });
      break;
    case 'type':
      await w.type(action.selector!, action.text ?? '', { timeoutMs });
      break;
    case 'press':
      await w.press(action.key!);
      break;
    case 'openCommandPalette':
      await w.press(action.key ?? PALETTE_SHORTCUT);
      break;
    case 'selectMenu':
      for (const segment of (action.menuPath ?? '').split('>').map((s) => s.trim()).filter(Boolean)) {
        await w.click(`text=${segment}`, { timeoutMs });
      }
      break;
    case 'scroll':
      await w.scroll(action.deltaY ?? 300);
      break;
    case 'navigate':
      if (action.selector) await w.click(action.selector, { timeoutMs });
      else ctx.emitLog(`navigate ${action.url ?? ''}`);
      break;
    case 'wait':
      await ctx.sleep(action.durationMs ?? 0);
      break;
    case 'waitFor':
      await w.waitForSelector(action.selector!, { timeoutMs, state: 'visible' });
      break;
    case 'screenshot': {
      const { ms } = await captureScreenshot(w, action.name ?? 'screenshot', ctx.capture);
      ctx.perf.screenshot(ms);
      return {};
    }
    case 'captureConsole':
      captureConsole(ctx.session, ctx.capture);
      return {};
    case 'captureNetwork':
      captureNetwork(ctx.session, ctx.capture);
      return {};
    case 'assertVisible':
    case 'assertExists':
    case 'assertEnabled':
    case 'assertText':
      return assert(action, ctx);
    default:
      ctx.emitLog(`unsupported action "${action.type}" at this scope`, 'warn');
      return {};
  }

  ctx.perf.interaction(ctx.now() - started);
  return {};
}

async function assert(action: DesktopAction, ctx: ActionRunContext): Promise<ActionResult> {
  ctx.perf.assertions += 1;
  const state = await ctx.window.elementState(action.selector!);
  let ok = false;
  let message = '';
  switch (action.type) {
    case 'assertExists':
      ok = state.exists;
      message = ok ? `exists: ${action.selector}` : `expected "${action.selector}" to exist`;
      break;
    case 'assertVisible':
      ok = state.exists && state.visible;
      message = ok ? `visible: ${action.selector}` : `expected "${action.selector}" to be visible`;
      break;
    case 'assertEnabled':
      ok = state.exists && state.enabled;
      message = ok ? `enabled: ${action.selector}` : `expected "${action.selector}" to be enabled`;
      break;
    case 'assertText':
      ok = (state.text ?? '').includes(action.text ?? '');
      message = ok ? `text matched: ${action.selector}` : `expected "${action.selector}" to contain "${action.text}" (was "${state.text ?? ''}")`;
      break;
    default:
      break;
  }
  ctx.emitLog(message, ok ? 'info' : 'error');
  return { assertion: { ok, message } };
}

function describe(action: DesktopAction): string {
  const target = action.selector ?? action.key ?? action.menuPath ?? action.url ?? action.name ?? '';
  return target ? `${action.type} ${target}` : action.type;
}
