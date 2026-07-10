/**
 * Runtime performance METRICS core — the pure, deterministic aggregation + analysis layer the developer
 * Performance Overlay and the Diagnostics "Runtime Performance" section render from. It owns NO measurement
 * itself: the renderer collector samples REAL values (rAF frame rate, `performance.memory` JS-heap, real
 * IPC round-trip durations captured by wrapping the IPC client, in-flight IPC count, React render
 * durations) and passes them in here; this module only summarizes them (averages, percentiles, worst
 * offenders), classifies them against thresholds, and derives recommendations. Nothing is fabricated,
 * timed, or simulated in this file — no clock read, no randomness, no I/O — so the same input always
 * produces the same snapshot and the unit tests pin it exactly.
 */

/** One React render measurement (from a Profiler onRender), identified by the profiled subtree id. */
export interface RenderSample {
  id: string;
  ms: number;
}

/** Rolled-up latency for one IPC channel over the sampling window. */
export interface IpcChannelStat {
  channel: string;
  count: number;
  avgMs: number;
  maxMs: number;
}

/** Rolled-up render cost for one profiled component/section over the session. */
export interface RenderComponentStat {
  id: string;
  count: number;
  avgMs: number;
  maxMs: number;
}

/** Distribution summary for a set of durations (ms). */
export interface DurationSummary {
  count: number;
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
}

/** Non-performance context shown alongside the metrics (sourced from P1.4 + app info). */
export interface PerfContext {
  appVersion: string;
  /** Release channel name (stable/beta/internal) or null if unknown. */
  releaseChannel: string | null;
  isPackaged: boolean;
  flagsEnabled: number;
  flagsTotal: number;
}

/** Tunable thresholds that decide what counts as "slow". */
export interface PerfThresholds {
  targetFps: number;
  lowFps: number;
  slowIpcMs: number;
  slowRenderMs: number;
  highMemoryPercent: number;
  manyPendingAsync: number;
}

export const DEFAULT_PERF_THRESHOLDS: PerfThresholds = {
  targetFps: 60,
  lowFps: 45,
  slowIpcMs: 200,
  slowRenderMs: 16,
  highMemoryPercent: 80,
  manyPendingAsync: 8,
};

export const EMPTY_PERF_CONTEXT: PerfContext = {
  appVersion: '',
  releaseChannel: null,
  // Default packaged=true so the developer overlay stays hidden until real app info arrives.
  isPackaged: true,
  flagsEnabled: 0,
  flagsTotal: 0,
};

/** The raw, REAL measurements the renderer collector feeds in each sampling tick. */
export interface PerfInput {
  /** Recent per-second frame-rate samples (real, from a requestAnimationFrame counter). */
  fpsSamples: number[];
  /** Renderer uptime in ms (real: performance.now()). */
  rendererUptimeMs: number;
  /** Renderer JS-heap used bytes (performance.memory.usedJSHeapSize), or null if unsupported. */
  memoryUsedBytes: number | null;
  /** Renderer JS-heap limit bytes (performance.memory.jsHeapSizeLimit), or null if unsupported. */
  memoryLimitBytes: number | null;
  /** Recent real IPC round-trip durations (ms). */
  ipcDurationsMs: number[];
  /** Number of IPC calls currently in flight (real). */
  ipcPending: number;
  /** Per-channel rolled-up IPC latency (real). */
  ipcChannels: IpcChannelStat[];
  /** Recent real React render durations. */
  renders: RenderSample[];
  /** Cumulative per-component render stats (from the Profiler-fed recorder). */
  renderComponents?: RenderComponentStat[];
  context: PerfContext;
}

export interface PerfFps {
  current: number;
  average: number;
  min: number;
  samples: number;
}

export interface PerfMemory {
  supported: boolean;
  usedBytes: number;
  limitBytes: number | null;
  usedPercent: number | null;
}

export interface PerfIpc extends DurationSummary {
  pending: number;
}

export type PerfRecommendationSeverity = 'info' | 'warning';

export interface PerfRecommendation {
  id: string;
  severity: PerfRecommendationSeverity;
  title: string;
  detail: string;
}

/** The complete, render-ready performance snapshot. */
export interface PerfSnapshot {
  fps: PerfFps;
  memory: PerfMemory;
  ipc: PerfIpc;
  slowestChannels: IpcChannelStat[];
  render: DurationSummary;
  slowRenders: RenderSample[];
  /** Profiled components ranked by worst render, for the diagnostics "slowest components" surface. */
  slowestComponents: RenderComponentStat[];
  rendererUptimeMs: number;
  context: PerfContext;
  recommendations: PerfRecommendation[];
  /** True when there are no warning-level recommendations. */
  healthy: boolean;
}

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

/** Nearest-rank percentile over an ascending-sorted array. p in [0,100]. Returns 0 for an empty set. */
export function percentile(sortedAsc: readonly number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const rank = Math.ceil((Math.max(0, Math.min(100, p)) / 100) * sortedAsc.length);
  const idx = Math.min(sortedAsc.length - 1, Math.max(0, rank - 1));
  return sortedAsc[idx];
}

/** Summarize a set of durations (ms): count, mean (1-dp), p50, p95, max. Ignores non-finite/negative. */
export function summarizeDurations(values: readonly number[]): DurationSummary {
  const vals = values.filter((v) => Number.isFinite(v) && v >= 0).slice().sort((a, b) => a - b);
  if (vals.length === 0) return { count: 0, avgMs: 0, p50Ms: 0, p95Ms: 0, maxMs: 0 };
  const sum = vals.reduce((a, b) => a + b, 0);
  return {
    count: vals.length,
    avgMs: round1(sum / vals.length),
    p50Ms: percentile(vals, 50),
    p95Ms: percentile(vals, 95),
    maxMs: vals[vals.length - 1],
  };
}

interface RecommendationInput {
  fps: PerfFps;
  memory: PerfMemory;
  ipc: PerfIpc;
  slowestChannels: readonly IpcChannelStat[];
  slowRenders: readonly RenderSample[];
}

/** Derive deterministic, non-destructive recommendations from the aggregated metrics. Never auto-fixes. */
export function generatePerfRecommendations(
  input: RecommendationInput,
  thresholds: PerfThresholds = DEFAULT_PERF_THRESHOLDS,
): PerfRecommendation[] {
  const out: PerfRecommendation[] = [];
  const { fps, memory, ipc, slowestChannels, slowRenders } = input;

  if (fps.samples > 0 && fps.average > 0 && fps.average < thresholds.lowFps) {
    out.push({
      id: 'low-fps',
      severity: 'warning',
      title: 'Low frame rate',
      detail: `Average ${fps.average} fps is below the ${thresholds.lowFps} fps target.`,
    });
  }
  if (ipc.count > 0 && ipc.p95Ms > thresholds.slowIpcMs) {
    const worst = slowestChannels[0];
    out.push({
      id: 'slow-ipc',
      severity: 'warning',
      title: 'Slow IPC calls',
      detail:
        `95th-percentile IPC latency is ${ipc.p95Ms}ms` +
        (worst ? ` (slowest: ${worst.channel} at ${worst.maxMs}ms).` : '.'),
    });
  }
  if (memory.usedPercent !== null && memory.usedPercent >= thresholds.highMemoryPercent) {
    out.push({
      id: 'high-memory',
      severity: 'warning',
      title: 'High renderer memory',
      detail: `Renderer heap is at ${memory.usedPercent}% of the JS heap limit.`,
    });
  }
  if (slowRenders.length > 0) {
    const worst = slowRenders[0];
    out.push({
      id: 'slow-renders',
      severity: 'info',
      title: 'Slow renders detected',
      detail: `${slowRenders.length} render(s) exceeded ${thresholds.slowRenderMs}ms (slowest: ${worst.id} at ${worst.ms}ms).`,
    });
  }
  if (ipc.pending >= thresholds.manyPendingAsync) {
    out.push({
      id: 'many-pending',
      severity: 'info',
      title: 'Many pending operations',
      detail: `${ipc.pending} IPC operations are in flight.`,
    });
  }
  return out;
}

/** Assemble the complete performance snapshot from the raw real measurements. Pure + deterministic. */
export function buildPerfSnapshot(
  input: PerfInput,
  thresholds: PerfThresholds = DEFAULT_PERF_THRESHOLDS,
): PerfSnapshot {
  const fpsVals = input.fpsSamples.filter((v) => Number.isFinite(v) && v >= 0);
  const fps: PerfFps = {
    current: fpsVals.length > 0 ? Math.round(fpsVals[fpsVals.length - 1]) : 0,
    average: fpsVals.length > 0 ? round1(fpsVals.reduce((a, b) => a + b, 0) / fpsVals.length) : 0,
    min: fpsVals.length > 0 ? Math.round(Math.min(...fpsVals)) : 0,
    samples: fpsVals.length,
  };

  const hasMem = input.memoryUsedBytes !== null && input.memoryUsedBytes !== undefined;
  const usedBytes = hasMem ? (input.memoryUsedBytes as number) : 0;
  const limitBytes =
    input.memoryLimitBytes !== null && input.memoryLimitBytes !== undefined && input.memoryLimitBytes > 0
      ? input.memoryLimitBytes
      : null;
  const memory: PerfMemory = {
    supported: hasMem,
    usedBytes,
    limitBytes,
    usedPercent: hasMem && limitBytes ? round1((usedBytes / limitBytes) * 100) : null,
  };

  const ipcSummary = summarizeDurations(input.ipcDurationsMs);
  const ipc: PerfIpc = { ...ipcSummary, pending: Math.max(0, Math.round(input.ipcPending)) };

  const slowestChannels = input.ipcChannels
    .slice()
    .sort((a, b) => b.maxMs - a.maxMs)
    .slice(0, 5);

  const slowestComponents = (input.renderComponents ?? [])
    .slice()
    .sort((a, b) => b.maxMs - a.maxMs)
    .slice(0, 5);

  const render = summarizeDurations(input.renders.map((r) => r.ms));
  const slowRenders = input.renders
    .filter((r) => Number.isFinite(r.ms) && r.ms > thresholds.slowRenderMs)
    .slice()
    .sort((a, b) => b.ms - a.ms)
    .slice(0, 5);

  const recommendations = generatePerfRecommendations(
    { fps, memory, ipc, slowestChannels, slowRenders },
    thresholds,
  );

  return {
    fps,
    memory,
    ipc,
    slowestChannels,
    render,
    slowRenders,
    slowestComponents,
    rendererUptimeMs: Math.max(0, Math.round(input.rendererUptimeMs)),
    context: input.context,
    recommendations,
    healthy: !recommendations.some((r) => r.severity === 'warning'),
  };
}

/** An all-zero snapshot for store initialization (before the first real sample). */
export function emptyPerfSnapshot(context: PerfContext = EMPTY_PERF_CONTEXT): PerfSnapshot {
  return buildPerfSnapshot({
    fpsSamples: [],
    rendererUptimeMs: 0,
    memoryUsedBytes: null,
    memoryLimitBytes: null,
    ipcDurationsMs: [],
    ipcPending: 0,
    ipcChannels: [],
    renders: [],
    context,
  });
}

/* ── deterministic formatters (shared so the overlay + tests agree) ─────────────────── */

/** Format a byte count as a compact IEC string. Null/≤0 → "—". */
export function formatBytesIEC(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

/** Format a millisecond duration for display. */
export function formatDurationMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  return `${s.toFixed(s >= 10 ? 0 : 1)}s`;
}
