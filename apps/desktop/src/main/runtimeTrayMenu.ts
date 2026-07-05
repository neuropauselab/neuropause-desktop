/**
 * Pure tray-menu construction (V4.0), split out so it imports only Electron TYPES
 * (never the runtime module) and can be unit-tested in a plain Node environment.
 * The stateful Electron `Tray` wiring lives in runtimeTray.ts.
 */
import type { MenuItemConstructorOptions } from 'electron';

/** Observable runtime status the tray reflects. */
export interface RuntimeTrayState {
  listening: boolean;
  automationActive: boolean;
  connectedServices: number;
  /** Short one-line executive summary, if available. */
  executiveSummary?: string;
}

/** Actions the tray can invoke, injected so the tray stays decoupled. */
export interface RuntimeTrayActions {
  openDashboard: () => void;
  openExecutiveCenter: () => void;
  startListening: () => void;
  pauseListening: () => void;
  restartRuntime: () => void;
  exit: () => void;
}

export const DEFAULT_TRAY_STATE: RuntimeTrayState = {
  listening: false,
  automationActive: false,
  connectedServices: 0,
};

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

/**
 * Build the tray context-menu template (PURE). `onError` lets the caller log
 * action failures without this module depending on a logger.
 */
export function buildTrayMenuTemplate(
  state: RuntimeTrayState,
  actions: RuntimeTrayActions,
  onError: (name: string, err: unknown) => void = () => {},
): MenuItemConstructorOptions[] {
  const safe = (fn: () => void, name: string) => () => {
    try {
      fn();
    } catch (err) {
      onError(name, err);
    }
  };
  const summary = state.executiveSummary?.trim();
  return [
    {
      label: summary ? `Executive: ${truncate(summary, 48)}` : 'NeuroPause Runtime',
      enabled: false,
    },
    { type: 'separator' },
    { label: `AI ${state.listening ? '● Listening' : '○ Idle'}`, enabled: false },
    {
      label: `Automation ${state.automationActive ? '● Active' : '○ Paused'}`,
      enabled: false,
    },
    { label: `Connected services: ${state.connectedServices}`, enabled: false },
    { type: 'separator' },
    state.listening
      ? { label: 'Pause Listening', click: safe(actions.pauseListening, 'pauseListening') }
      : { label: 'Start Listening', click: safe(actions.startListening, 'startListening') },
    {
      label: 'Open Executive Center',
      click: safe(actions.openExecutiveCenter, 'openExecutiveCenter'),
    },
    { label: 'Open Dashboard', click: safe(actions.openDashboard, 'openDashboard') },
    { type: 'separator' },
    { label: 'Restart Runtime', click: safe(actions.restartRuntime, 'restartRuntime') },
    { label: 'Quit NeuroPause', click: safe(actions.exit, 'exit') },
  ];
}
