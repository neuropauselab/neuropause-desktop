/**
 * Phase 8 (RC hardening 8.16) — startup metrics tests: monotonic marks with
 * deltas, duplicate marks ignored, completeness derived from the boot mark,
 * and deterministic diagnostics rendering (injected clock; no wall-clock
 * budgets in CI — those belong on target hardware).
 */
import { describe, expect, it } from 'vitest';
import { createStartupMetrics, formatStartupLines } from './startupMetrics';

function clock(...ticks: number[]) {
  let i = 0;
  return () => ticks[Math.min(i++, ticks.length - 1)];
}

describe('startup metrics', () => {
  it('records phases with at/delta from the first mark; duplicates ignored', () => {
    const m = createStartupMetrics(clock(1000, 1120, 1600, 2400));
    m.mark('app-ready'); // at 120
    m.mark('app-ready'); // ignored — duplicate returns before consuming a tick
    m.mark('window-created'); // at 600
    m.mark('runtime-core-ready'); // at 1400
    const s = m.snapshot();
    expect(s.phases.map((p) => p.name)).toEqual(['app-ready', 'window-created', 'runtime-core-ready']);
    expect(s.phases[0]).toEqual({ name: 'app-ready', atMs: 120, deltaMs: 120 });
    expect(s.phases[1]).toEqual({ name: 'window-created', atMs: 600, deltaMs: 480 });
    expect(s.totalMs).toBe(1400);
    expect(s.complete).toBe(true);
  });

  it('an incomplete boot says so; an empty recorder renders nothing', () => {
    const m = createStartupMetrics(clock(0, 50));
    m.mark('app-ready');
    const s = m.snapshot();
    expect(s.complete).toBe(false);
    const lines = formatStartupLines(s);
    expect(lines[0]).toBe('## Startup');
    expect(lines[lines.length - 1]).toContain('boot incomplete');
    expect(formatStartupLines(createStartupMetrics(clock(0)).snapshot())).toEqual([]);
  });
});
