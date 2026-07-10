/**
 * perfRecorder — the renderer's REAL raw-sample capture for runtime performance. A tiny, React-free
 * singleton the IPC client reports into (real per-call round-trip latency + in-flight count) and that the
 * PerfSampler reads once per tick. No aggregation happens here (that is the pure shared `perfMetrics`
 * core) — this only holds bounded ring buffers of genuine measurements. Nothing is simulated: every
 * duration comes from a real `performance.now()` delta around a real IPC call, and the pending count is
 * the real number of in-flight invocations.
 */
import type { IpcChannelStat, RenderComponentStat, RenderSample } from '@neuropause/shared';

/** How many recent IPC durations to keep for percentile math. */
const IPC_RING = 200;
/** How many recent render samples to keep. */
const RENDER_RING = 100;

interface ChannelAgg {
  count: number;
  totalMs: number;
  maxMs: number;
}

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

class PerfRecorder {
  private ipcDurations: number[] = [];
  private ipcPending = 0;
  private channels = new Map<string, ChannelAgg>();
  private renders: RenderSample[] = [];
  private renderComponents = new Map<string, ChannelAgg>();

  /**
   * Mark an IPC call in-flight and return a settle callback. The wrapped IPC `invoke` calls this before
   * the round-trip and invokes the returned callback exactly once when the promise settles.
   */
  ipcStart(channel: string): () => void {
    const t0 = performance.now();
    this.ipcPending += 1;
    let settled = false;
    return () => {
      if (settled) return;
      settled = true;
      this.ipcPending = Math.max(0, this.ipcPending - 1);
      const ms = Math.max(0, performance.now() - t0);
      this.ipcDurations.push(ms);
      if (this.ipcDurations.length > IPC_RING) this.ipcDurations.shift();
      const agg = this.channels.get(channel) ?? { count: 0, totalMs: 0, maxMs: 0 };
      agg.count += 1;
      agg.totalMs += ms;
      agg.maxMs = Math.max(agg.maxMs, ms);
      this.channels.set(channel, agg);
    };
  }

  /** Record a real React render duration (from a Profiler onRender). */
  recordRender(id: string, ms: number): void {
    if (!Number.isFinite(ms) || ms < 0) return;
    this.renders.push({ id, ms });
    if (this.renders.length > RENDER_RING) this.renders.shift();
    const agg = this.renderComponents.get(id) ?? { count: 0, totalMs: 0, maxMs: 0 };
    agg.count += 1;
    agg.totalMs += ms;
    agg.maxMs = Math.max(agg.maxMs, ms);
    this.renderComponents.set(id, agg);
  }

  /** Snapshot the current raw buffers (copies) for the sampler to aggregate. */
  read(): {
    ipcDurationsMs: number[];
    ipcPending: number;
    ipcChannels: IpcChannelStat[];
    renders: RenderSample[];
    renderComponents: RenderComponentStat[];
  } {
    const ipcChannels: IpcChannelStat[] = [];
    this.channels.forEach((a, channel) => {
      ipcChannels.push({
        channel,
        count: a.count,
        avgMs: a.count ? round1(a.totalMs / a.count) : 0,
        maxMs: round1(a.maxMs),
      });
    });
    const renderComponents: RenderComponentStat[] = [];
    this.renderComponents.forEach((a, id) => {
      renderComponents.push({
        id,
        count: a.count,
        avgMs: a.count ? round1(a.totalMs / a.count) : 0,
        maxMs: round1(a.maxMs),
      });
    });
    return {
      ipcDurationsMs: this.ipcDurations.slice(),
      ipcPending: this.ipcPending,
      ipcChannels,
      renders: this.renders.slice(),
      renderComponents,
    };
  }
}

export const perfRecorder = new PerfRecorder();
