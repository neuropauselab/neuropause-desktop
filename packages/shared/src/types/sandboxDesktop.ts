/**
 * AI Sandbox — Desktop Automation (S2): the scenario contract.
 *
 * A desktop scenario's opaque S1 `spec` gets meaning here: `{ kind: 'desktop',
 * launch, actions[] }`. These types + the pure `parseDesktopSpec` are the shared,
 * validated shape the executor interprets and the SDK / portal author against. No
 * runtime, no Playwright — just the contract + its validator.
 */
import type { ScenarioSpec } from './sandbox';

export type DesktopActionType =
  | 'launch'
  | 'close'
  | 'restart'
  | 'navigate'
  | 'click'
  | 'doubleClick'
  | 'rightClick'
  | 'hover'
  | 'type'
  | 'fill'
  | 'press'
  | 'scroll'
  | 'selectMenu'
  | 'openCommandPalette'
  | 'wait'
  | 'waitFor'
  | 'screenshot'
  | 'assertVisible'
  | 'assertText'
  | 'assertExists'
  | 'assertEnabled'
  | 'captureConsole'
  | 'captureNetwork';

export const DESKTOP_ACTION_TYPES: readonly DesktopActionType[] = [
  'launch', 'close', 'restart', 'navigate', 'click', 'doubleClick', 'rightClick', 'hover',
  'type', 'fill', 'press', 'scroll', 'selectMenu', 'openCommandPalette', 'wait', 'waitFor',
  'screenshot', 'assertVisible', 'assertText', 'assertExists', 'assertEnabled', 'captureConsole', 'captureNetwork',
];

/** A single automation step. Flat + JSON-serializable (it lives in the scenario spec). */
export interface DesktopAction {
  type: DesktopActionType;
  /** Element selector (CSS or Playwright text= selector) for element actions. */
  selector?: string;
  /** Text to type, or the expected substring for assertText. */
  text?: string;
  /** Key / shortcut for press, e.g. `Enter` or `Meta+K`. */
  key?: string;
  /** Menu path for selectMenu, e.g. `File>New Window`. */
  menuPath?: string;
  /** URL/path for navigate. */
  url?: string;
  /** Artifact name for screenshot. */
  name?: string;
  /** Wait duration (ms) for `wait`. */
  durationMs?: number;
  /** Scroll delta (px, positive = down) for `scroll`. */
  deltaY?: number;
  /** Per-action timeout (ms); falls back to the launch timeout. */
  timeoutMs?: number;
  /** Target window index (0 = first) for multi-window scenarios. */
  window?: number;
  /** Human label for the timeline. */
  label?: string;
}

export type DesktopProfileMode = 'fresh' | 'temporary' | 'persistent';

export interface DesktopLaunchOptions {
  /** `fresh`/`temporary` = an isolated throwaway user-data dir; `persistent` = a named, reused one. */
  profile: DesktopProfileMode;
  /** Named profile key when `profile: 'persistent'`. */
  profileKey: string | null;
  /** Extra CLI args passed to the launched Electron app. */
  args: string[];
  /** Wall-clock budget for the whole launch (ms). */
  timeoutMs: number;
  /** Capture the renderer/main console for the run. */
  captureConsole: boolean;
}

export const DEFAULT_DESKTOP_LAUNCH: DesktopLaunchOptions = {
  profile: 'temporary',
  profileKey: null,
  args: [],
  timeoutMs: 30_000,
  captureConsole: true,
};

export interface DesktopScenarioSpec {
  kind: 'desktop';
  launch: DesktopLaunchOptions;
  actions: DesktopAction[];
}

/** Live info the launcher/window-manager report. */
export interface DesktopSessionInfo {
  id: string;
  profile: DesktopProfileMode;
  profileDir: string;
  running: boolean;
  windows: number;
  startedAt: string;
}

export interface DesktopWindowInfo {
  id: string;
  index: number;
  title: string;
  url: string;
}

/** Metric keys the executor exports into the run result (Step 11). */
export const DESKTOP_PERF_METRIC_KEYS = [
  'launchMs',
  'windowReadyMs',
  'actions',
  'interactionMsAvg',
  'interactionMsMax',
  'screenshotMsAvg',
  'screenshots',
  'assertions',
  'recoveries',
] as const;

/* ─────────────────────────── pure parse/validate ─────────────────────────── */

/** Actions that require a selector / text / key / duration respectively. */
const NEEDS_SELECTOR: ReadonlySet<DesktopActionType> = new Set(['click', 'doubleClick', 'rightClick', 'hover', 'type', 'fill', 'waitFor', 'assertVisible', 'assertText', 'assertExists', 'assertEnabled', 'scroll']);
const NEEDS_TEXT: ReadonlySet<DesktopActionType> = new Set(['type', 'fill', 'assertText']);
const NEEDS_KEY: ReadonlySet<DesktopActionType> = new Set(['press']);

export function isDesktopSpec(spec: ScenarioSpec | null | undefined): boolean {
  return !!spec && (spec as { kind?: unknown }).kind === 'desktop';
}

export type ParseDesktopResult =
  | { ok: true; value: DesktopScenarioSpec }
  | { ok: false; error: string };

/** Validate + normalize an opaque scenario spec into a typed desktop scenario. Pure. */
export function parseDesktopSpec(spec: ScenarioSpec): ParseDesktopResult {
  if (!isDesktopSpec(spec)) return { ok: false, error: 'scenario spec is not a desktop scenario (kind !== "desktop")' };
  const rawActions = (spec as { actions?: unknown }).actions;
  if (!Array.isArray(rawActions) || rawActions.length === 0) return { ok: false, error: 'desktop scenario requires a non-empty actions array' };

  const actions: DesktopAction[] = [];
  for (let i = 0; i < rawActions.length; i += 1) {
    const a = rawActions[i] as Record<string, unknown>;
    const type = a?.type as DesktopActionType;
    if (!DESKTOP_ACTION_TYPES.includes(type)) return { ok: false, error: `action[${i}]: unknown type "${String(a?.type)}"` };
    if (NEEDS_SELECTOR.has(type) && typeof a.selector !== 'string') return { ok: false, error: `action[${i}] (${type}): requires a "selector"` };
    if (NEEDS_TEXT.has(type) && typeof a.text !== 'string') return { ok: false, error: `action[${i}] (${type}): requires "text"` };
    if (NEEDS_KEY.has(type) && typeof a.key !== 'string') return { ok: false, error: `action[${i}] (${type}): requires a "key"` };
    if (type === 'wait' && typeof a.durationMs !== 'number') return { ok: false, error: `action[${i}] (wait): requires "durationMs"` };
    actions.push({
      type,
      selector: str(a.selector),
      text: str(a.text),
      key: str(a.key),
      menuPath: str(a.menuPath),
      url: str(a.url),
      name: str(a.name),
      durationMs: num(a.durationMs),
      deltaY: num(a.deltaY),
      timeoutMs: num(a.timeoutMs),
      window: num(a.window),
      label: str(a.label),
    });
  }

  const rawLaunch = ((spec as { launch?: unknown }).launch ?? {}) as Record<string, unknown>;
  const profile = (['fresh', 'temporary', 'persistent'] as const).includes(rawLaunch.profile as DesktopProfileMode)
    ? (rawLaunch.profile as DesktopProfileMode)
    : DEFAULT_DESKTOP_LAUNCH.profile;
  const launch: DesktopLaunchOptions = {
    profile,
    profileKey: profile === 'persistent' ? (str(rawLaunch.profileKey) ?? 'default') : null,
    args: Array.isArray(rawLaunch.args) ? rawLaunch.args.filter((x): x is string => typeof x === 'string') : [],
    timeoutMs: num(rawLaunch.timeoutMs) ?? DEFAULT_DESKTOP_LAUNCH.timeoutMs,
    captureConsole: typeof rawLaunch.captureConsole === 'boolean' ? rawLaunch.captureConsole : DEFAULT_DESKTOP_LAUNCH.captureConsole,
  };

  return { ok: true, value: { kind: 'desktop', launch, actions } };
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}
function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}
