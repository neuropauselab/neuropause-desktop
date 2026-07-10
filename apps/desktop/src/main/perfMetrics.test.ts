import { describe, expect, it } from 'vitest';
import {
  percentile,
  summarizeDurations,
  buildPerfSnapshot,
  generatePerfRecommendations,
  emptyPerfSnapshot,
  formatBytesIEC,
  formatDurationMs,
  DEFAULT_PERF_THRESHOLDS,
  EMPTY_PERF_CONTEXT,
  type PerfContext,
  type PerfInput,
} from '@neuropause/shared';

const MB = 1024 * 1024;

const CTX: PerfContext = {
  appVersion: '1.4.0',
  releaseChannel: 'stable',
  isPackaged: false,
  flagsEnabled: 3,
  flagsTotal: 5,
};

function input(partial: Partial<PerfInput> = {}): PerfInput {
  return {
    fpsSamples: [],
    rendererUptimeMs: 0,
    memoryUsedBytes: null,
    memoryLimitBytes: null,
    ipcDurationsMs: [],
    ipcPending: 0,
    ipcChannels: [],
    renders: [],
    context: CTX,
    ...partial,
  };
}

describe('perfMetrics — percentile + summarizeDurations', () => {
  it('computes nearest-rank percentiles and handles the empty set', () => {
    expect(percentile([], 95)).toBe(0);
    const oneToHundred = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(oneToHundred, 95)).toBe(95);
    expect(percentile(oneToHundred, 50)).toBe(50);
    expect(percentile([10, 20, 30, 40], 100)).toBe(40);
  });

  it('summarizes durations and ignores non-finite/negative', () => {
    expect(summarizeDurations([])).toEqual({ count: 0, avgMs: 0, p50Ms: 0, p95Ms: 0, maxMs: 0 });
    const s = summarizeDurations([10, 20, 30, 40, -5, Number.NaN]);
    expect(s.count).toBe(4);
    expect(s.avgMs).toBe(25);
    expect(s.maxMs).toBe(40);
    expect(s.p50Ms).toBe(20);
  });
});

describe('perfMetrics — buildPerfSnapshot (healthy)', () => {
  it('produces a clean snapshot with no recommendations from good inputs', () => {
    const snap = buildPerfSnapshot(
      input({
        fpsSamples: [60, 59, 61, 60],
        rendererUptimeMs: 12_345,
        memoryUsedBytes: 100 * MB,
        memoryLimitBytes: 2048 * MB,
        ipcDurationsMs: [5, 8, 12, 20],
        ipcPending: 1,
        ipcChannels: [{ channel: 'app:getInfo', count: 4, avgMs: 11, maxMs: 20 }],
        renders: [{ id: 'shell', ms: 4 }],
      }),
    );
    expect(snap.fps.current).toBe(60);
    expect(snap.fps.average).toBe(60);
    expect(snap.fps.min).toBe(59);
    expect(snap.memory.supported).toBe(true);
    expect(snap.memory.usedPercent).toBe(round1((100 / 2048) * 100));
    expect(snap.ipc.p95Ms).toBe(20);
    expect(snap.ipc.pending).toBe(1);
    expect(snap.slowRenders).toEqual([]);
    expect(snap.recommendations).toEqual([]);
    expect(snap.healthy).toBe(true);
    expect(snap.rendererUptimeMs).toBe(12_345);
    expect(snap.context).toEqual(CTX);
  });

  it('reports memory unsupported when heap bytes are null', () => {
    const snap = buildPerfSnapshot(input({ memoryUsedBytes: null, memoryLimitBytes: null }));
    expect(snap.memory.supported).toBe(false);
    expect(snap.memory.usedPercent).toBeNull();
  });
});

describe('perfMetrics — buildPerfSnapshot (problems → recommendations)', () => {
  it('flags low fps as a warning', () => {
    const snap = buildPerfSnapshot(input({ fpsSamples: [30, 32, 28] }));
    const rec = snap.recommendations.find((r) => r.id === 'low-fps');
    expect(rec?.severity).toBe('warning');
    expect(snap.healthy).toBe(false);
  });

  it('flags slow IPC and names the worst channel', () => {
    const snap = buildPerfSnapshot(
      input({
        ipcDurationsMs: [300, 320, 350, 400],
        ipcChannels: [
          { channel: 'enterprise:list', count: 4, avgMs: 342, maxMs: 400 },
          { channel: 'app:getInfo', count: 2, avgMs: 10, maxMs: 12 },
        ],
      }),
    );
    const rec = snap.recommendations.find((r) => r.id === 'slow-ipc');
    expect(rec?.severity).toBe('warning');
    expect(rec?.detail).toContain('enterprise:list');
    expect(snap.slowestChannels[0].channel).toBe('enterprise:list');
    expect(snap.slowestChannels).toHaveLength(2);
  });

  it('flags high renderer memory', () => {
    const snap = buildPerfSnapshot(
      input({ memoryUsedBytes: 900 * MB, memoryLimitBytes: 1000 * MB }),
    );
    const rec = snap.recommendations.find((r) => r.id === 'high-memory');
    expect(rec?.severity).toBe('warning');
    expect(snap.memory.usedPercent).toBe(90);
  });

  it('detects slow renders (sorted, capped at 5) as info', () => {
    const renders = [
      { id: 'a', ms: 4 },
      { id: 'b', ms: 40 },
      { id: 'c', ms: 25 },
      { id: 'd', ms: 60 },
      { id: 'e', ms: 18 },
      { id: 'f', ms: 90 },
      { id: 'g', ms: 17 },
    ];
    const snap = buildPerfSnapshot(input({ renders }));
    expect(snap.slowRenders.map((r) => r.id)).toEqual(['f', 'd', 'b', 'c', 'e']);
    const rec = snap.recommendations.find((r) => r.id === 'slow-renders');
    expect(rec?.severity).toBe('info');
    expect(rec?.detail).toContain('f');
  });

  it('flags many pending async operations as info', () => {
    const snap = buildPerfSnapshot(input({ ipcPending: 12 }));
    const rec = snap.recommendations.find((r) => r.id === 'many-pending');
    expect(rec?.severity).toBe('info');
    expect(rec?.detail).toContain('12');
  });

  it('is deterministic', () => {
    const i = input({ fpsSamples: [30], ipcDurationsMs: [300], memoryUsedBytes: 900 * MB, memoryLimitBytes: 1000 * MB });
    expect(buildPerfSnapshot(i)).toEqual(buildPerfSnapshot(i));
  });
});

describe('perfMetrics — generatePerfRecommendations respects thresholds', () => {
  it('does not warn when values are under custom thresholds', () => {
    const recs = generatePerfRecommendations(
      {
        fps: { current: 50, average: 50, min: 48, samples: 5 },
        memory: { supported: true, usedBytes: 1, limitBytes: 100, usedPercent: 50 },
        ipc: { count: 3, avgMs: 50, p50Ms: 50, p95Ms: 100, maxMs: 120, pending: 2 },
        slowestChannels: [],
        slowRenders: [],
      },
      { ...DEFAULT_PERF_THRESHOLDS, lowFps: 30, slowIpcMs: 500, highMemoryPercent: 95, manyPendingAsync: 10 },
    );
    expect(recs).toEqual([]);
  });
});

describe('perfMetrics — empty snapshot + formatters', () => {
  it('emptyPerfSnapshot is all-zero and healthy', () => {
    const snap = emptyPerfSnapshot();
    expect(snap.fps.current).toBe(0);
    expect(snap.ipc.count).toBe(0);
    expect(snap.memory.supported).toBe(false);
    expect(snap.recommendations).toEqual([]);
    expect(snap.healthy).toBe(true);
    expect(snap.context).toEqual(EMPTY_PERF_CONTEXT);
  });

  it('formats bytes (IEC) and durations', () => {
    expect(formatBytesIEC(null)).toBe('—');
    expect(formatBytesIEC(0)).toBe('—');
    expect(formatBytesIEC(1024)).toBe('1.0 KB');
    expect(formatBytesIEC(512)).toBe('512 B');
    expect(formatBytesIEC(1536 * 1024)).toBe('1.5 MB');
    expect(formatDurationMs(250)).toBe('250ms');
    expect(formatDurationMs(1500)).toBe('1.5s');
    expect(formatDurationMs(12_000)).toBe('12s');
    expect(formatDurationMs(-1)).toBe('—');
  });
});

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}
