/**
 * Runtime telemetry sampler (V5.1).
 *
 * Produces the REAL OS/runtime signals NeuroCore needs, replacing V5.0's
 * placeholders: CPU% from process.cpuUsage() deltas, memory from
 * process.memoryUsage(), and backend state + latency from a lightweight periodic
 * probe of the backend /health endpoint. Sampling is throttled (cached, refreshed
 * on demand) so reading the snapshot never spikes the very metrics it measures.
 */
import { config } from './config';
import { createLogger } from './logger';
import type { BackendState, RuntimeTelemetry } from '@neuropause/shared';

const log = createLogger('runtime-telemetry');

export class RuntimeTelemetrySampler {
  private lastCpu = process.cpuUsage();
  private lastCpuAt = Date.now();
  private lastCpuPercent = 0;

  private backendState: BackendState = 'recovering';
  private backendLatencyMs: number | null = null;
  private lastProbeAt = 0;
  private consecutiveFailures = 0;

  constructor(private readonly now: () => number = Date.now) {}

  /** CPU% since the last sample, normalized by elapsed wall-clock + core count. */
  private sampleCpuPercent(): number {
    const nowMs = this.now();
    const elapsedMs = nowMs - this.lastCpuAt;
    if (elapsedMs <= 0) return this.lastCpuPercent;
    const usage = process.cpuUsage(this.lastCpu); // micros since lastCpu
    const usedMs = (usage.user + usage.system) / 1000;
    const cores = Math.max(1, cpuCount());
    const pct = (usedMs / (elapsedMs * cores)) * 100;
    this.lastCpu = process.cpuUsage();
    this.lastCpuAt = nowMs;
    this.lastCpuPercent = Math.max(0, Math.min(100, Math.round(pct)));
    return this.lastCpuPercent;
  }

  private sampleMemory(): { usedMb: number; totalMb: number } {
    const m = process.memoryUsage();
    // usedMb is what this process resident-holds; totalMb is the HOST's memory, so
    // the percentage reflects genuine host memory pressure. (Previously total was
    // rss+external, which is ~rss, making the ratio a constant ~100% and falsely
    // flagging the runtime as critical every tick.)
    const usedMb = Math.round(m.rss / 1024 / 1024);
    const totalMb = Math.round(totalSystemMemoryBytes() / 1024 / 1024) || usedMb;
    return { usedMb, totalMb };
  }

  /**
   * Probe the backend /health endpoint. Throttled to at most once per minInterval;
   * returns cached state otherwise. Transitions: ok → connected; a failure after a
   * good state → recovering, then disconnected after repeated failures.
   */
  async probeBackend(minIntervalMs = 15_000): Promise<void> {
    const nowMs = this.now();
    if (nowMs - this.lastProbeAt < minIntervalMs) return;
    this.lastProbeAt = nowMs;
    const started = Date.now();
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4000);
      const res = await fetch(`${config.backendUrl}/health`, {
        method: 'GET',
        signal: controller.signal,
      });
      clearTimeout(timeout);
      this.backendLatencyMs = Date.now() - started;
      if (res.ok) {
        this.backendState = 'connected';
        this.consecutiveFailures = 0;
      } else {
        this.registerFailure();
      }
    } catch (err) {
      this.backendLatencyMs = null;
      this.registerFailure();
      log.debug('backend probe failed', { err: String(err) });
    }
  }

  private registerFailure(): void {
    this.consecutiveFailures += 1;
    // One blip → recovering; sustained failures → disconnected.
    this.backendState = this.consecutiveFailures >= 3 ? 'disconnected' : 'recovering';
  }

  /** Force the backend state (e.g. after an auth failure elsewhere). */
  setBackendState(state: BackendState): void {
    this.backendState = state;
  }

  /** The current telemetry reading (samples CPU + memory synchronously). */
  read(): RuntimeTelemetry {
    const mem = this.sampleMemory();
    return {
      cpuPercent: this.sampleCpuPercent(),
      memoryUsedMb: mem.usedMb,
      memoryTotalMb: mem.totalMb,
      processUptimeMs: Math.round(process.uptime() * 1000),
      backendLatencyMs: this.backendLatencyMs,
      backendState: this.backendState,
    };
  }
}

function cpuCount(): number {
  try {
    // Lazy require so this module stays cheap to import.

    return require('node:os').cpus()?.length ?? 1;
  } catch {
    return 1;
  }
}

function totalSystemMemoryBytes(): number {
  try {
    return require('node:os').totalmem() || 0;
  } catch {
    return 0;
  }
}
