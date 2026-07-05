import { describe, expect, it, vi } from 'vitest';
import {
  buildTrayMenuTemplate,
  type RuntimeTrayActions,
  type RuntimeTrayState,
} from './runtimeTrayMenu';

function actions(): RuntimeTrayActions {
  return {
    openDashboard: vi.fn(),
    openExecutiveCenter: vi.fn(),
    startListening: vi.fn(),
    pauseListening: vi.fn(),
    restartRuntime: vi.fn(),
    exit: vi.fn(),
  };
}

const idle: RuntimeTrayState = {
  listening: false,
  automationActive: false,
  connectedServices: 2,
};

describe('buildTrayMenuTemplate (V4.0)', () => {
  it('shows idle status + Start Listening when not listening', () => {
    const t = buildTrayMenuTemplate(idle, actions());
    const labels = t.map((i) => i.label).filter(Boolean);
    expect(labels).toContain('AI ○ Idle');
    expect(labels).toContain('Automation ○ Paused');
    expect(labels).toContain('Connected services: 2');
    expect(labels).toContain('Start Listening');
    expect(labels).not.toContain('Pause Listening');
  });

  it('shows Listening status + Pause Listening when listening', () => {
    const t = buildTrayMenuTemplate({ ...idle, listening: true }, actions());
    const labels = t.map((i) => i.label).filter(Boolean);
    expect(labels).toContain('AI ● Listening');
    expect(labels).toContain('Pause Listening');
    expect(labels).not.toContain('Start Listening');
  });

  it('always offers the core quick actions', () => {
    const t = buildTrayMenuTemplate(idle, actions());
    const labels = t.map((i) => i.label).filter(Boolean);
    expect(labels).toContain('Open Executive Center');
    expect(labels).toContain('Open Dashboard');
    expect(labels).toContain('Restart Runtime');
    expect(labels).toContain('Quit NeuroPause');
  });

  it('surfaces a truncated executive summary when present', () => {
    const long = 'CI failing on 8 branches, 10 items need attention across three teams today';
    const t = buildTrayMenuTemplate({ ...idle, executiveSummary: long }, actions());
    const header = t[0].label as string;
    expect(header.startsWith('Executive: ')).toBe(true);
    expect(header.length).toBeLessThanOrEqual('Executive: '.length + 48);
  });

  it('wires click handlers to the injected actions', () => {
    const a = actions();
    const t = buildTrayMenuTemplate(idle, a);
    const byLabel = (l: string) => t.find((i) => i.label === l);
    (byLabel('Open Executive Center')!.click as () => void)();
    (byLabel('Start Listening')!.click as () => void)();
    (byLabel('Quit NeuroPause')!.click as () => void)();
    expect(a.openExecutiveCenter).toHaveBeenCalledOnce();
    expect(a.startListening).toHaveBeenCalledOnce();
    expect(a.exit).toHaveBeenCalledOnce();
  });
});
