import { describe, expect, it } from 'vitest';
import {
  buildPerfSnapshot,
  EMPTY_PERF_CONTEXT,
  type PerfInput,
  type RenderComponentStat,
} from '@neuropause/shared';

function input(renderComponents?: RenderComponentStat[]): PerfInput {
  return {
    fpsSamples: [60],
    rendererUptimeMs: 1000,
    memoryUsedBytes: null,
    memoryLimitBytes: null,
    ipcDurationsMs: [],
    ipcPending: 0,
    ipcChannels: [],
    renders: [],
    renderComponents,
    context: EMPTY_PERF_CONTEXT,
  };
}

describe('perfMetrics — slowestComponents (Profiler-fed)', () => {
  it('defaults to empty when no component stats are provided', () => {
    expect(buildPerfSnapshot(input()).slowestComponents).toEqual([]);
  });

  it('ranks components by worst render and caps at 5', () => {
    const comps: RenderComponentStat[] = [
      { id: 'enterprise:executive', count: 3, avgMs: 12, maxMs: 40 },
      { id: 'enterprise:trust', count: 5, avgMs: 8, maxMs: 22 },
      { id: 'enterprise:process', count: 2, avgMs: 30, maxMs: 90 },
      { id: 'a', count: 1, avgMs: 1, maxMs: 5 },
      { id: 'b', count: 1, avgMs: 1, maxMs: 7 },
      { id: 'c', count: 1, avgMs: 1, maxMs: 3 },
    ];
    const snap = buildPerfSnapshot(input(comps));
    expect(snap.slowestComponents.map((c) => c.id)).toEqual([
      'enterprise:process',
      'enterprise:executive',
      'enterprise:trust',
      'b',
      'a',
    ]);
    expect(snap.slowestComponents).toHaveLength(5);
  });

  it('does not mutate the input array', () => {
    const comps: RenderComponentStat[] = [
      { id: 'x', count: 1, avgMs: 1, maxMs: 1 },
      { id: 'y', count: 1, avgMs: 1, maxMs: 9 },
    ];
    const before = comps.map((c) => c.id);
    buildPerfSnapshot(input(comps));
    expect(comps.map((c) => c.id)).toEqual(before);
  });
});
