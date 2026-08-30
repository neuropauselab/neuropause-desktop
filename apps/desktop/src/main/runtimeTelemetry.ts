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
import type {
  BackendProbeError,
  BackendReachability,
  BackendState,
  RuntimeTelemetry,
} from '@neuropause/shared';

const log = createLogger('runtime-telemetry');

/**
 * Classify a probe failure into the coarse public buckets.
 *
 * Returns `null` for anything unrecognized. That is deliberate: an unclassified
 * failure reported as `{ reachable: false, lastError: null }` is honest, whereas
 * guessing the nearest label would put a wrong cause in front of a user and in
 * front of support. Program 13C exists because statuses were assigned by the
 * proxy that was easiest to measure; this is the same mistake in miniature.
 *
 * Reads only `name` and `code`. The error's MESSAGE is never inspected and never
 * propagated — undici embeds host, port and sometimes the resolved address in it,
 * and this value crosses an unauthenticated channel.
 */
export function classifyProbeError(err: unknown): BackendProbeError | null {
  const e = err as { name?: unknown; code?: unknown; cause?: { code?: unknown } } | null;
  if (!e || typeof e !== 'object') return null;
  const name = typeof e.name === 'string' ? e.name : '';
  if (name === 'AbortError' || name === 'TimeoutError') return 'timeout';
  const code = typeof e.code === 'string' ? e.code : typeof e.cause?.code === 'string' ? e.cause.code : '';
  switch (code) {
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return 'dns';
    case 'ECONNREFUSED':
      return 'refused';
    case 'ETIMEDOUT':
    case 'UND_ERR_CONNECT_TIMEOUT':
    case 'UND_ERR_HEADERS_TIMEOUT':
      return 'timeout';
    default:
      return null;
  }
}

export class RuntimeTelemetrySampler {
  private lastCpu = process.cpuUsage();
  private lastCpuAt = Date.now();
  private lastCpuPercent = 0;

  private backendState: BackendState = 'recovering';
  private backendLatencyMs: number | null = null;
  private lastProbeAt = 0;
  private consecutiveFailures = 0;

  // ── F-7 reachability, kept SEPARATE from backendState on purpose ──
  //
  // `setBackendState()` lets other subsystems force the state — notably after an
  // AUTH failure. `reachability()` is served over an unauthenticated channel, so
  // it must answer "did the last /health probe succeed", never "did somebody's
  // sign-in fail". Deriving it from backendState would leak the second through
  // the first. These three fields are written ONLY by probeBackend().
  private lastProbeOk: boolean | null = null;
  private lastProbeCheckedAt: string | null = null;
  private lastProbeError: BackendProbeError | null = null;

  /**
   * `onReachabilityRecovered` fires on the (recovering|disconnected) → connected
   * EDGE (P13C Gate 2). Injected rather than importing the hub directly so the
   * sampler stays dependency-free and unit-testable with a plain spy.
   */
  constructor(
    private readonly now: () => number = Date.now,
    private readonly onReachabilityRecovered?: () => void,
  ) {}

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
      this.lastProbeCheckedAt = new Date(this.now()).toISOString();
      if (res.ok) {
        const wasReachable = this.backendState === 'connected';
        this.backendState = 'connected';
        this.consecutiveFailures = 0;
        this.lastProbeOk = true;
        this.lastProbeError = null;
        // Fire the reachability edge exactly once per recovery — on the
        // transition into connected, never on every healthy probe — so a
        // subscriber (the auth re-restore) reacts to the recovery, not the state.
        if (!wasReachable) this.onReachabilityRecovered?.();
      } else {
        this.registerFailure();
        this.lastProbeOk = false;
        this.lastProbeError = 'http_error';
      }
    } catch (err) {
      this.backendLatencyMs = null;
      this.registerFailure();
      this.lastProbeCheckedAt = new Date(this.now()).toISOString();
      this.lastProbeOk = false;
      this.lastProbeError = classifyProbeError(err);
      log.debug('backend probe failed', { err: String(err) });
    }
  }

  /**
   * F-7 — the pre-authentication reachability answer.
   *
   * Exactly three fields, and it must stay exactly three. No URL, no host, no
   * latency, no failure count, no org. `reachable` is false until a probe has
   * actually succeeded, so "we have not checked yet" never renders as "fine".
   */
  reachability(): BackendReachability {
    return {
      reachable: this.lastProbeOk === true,
      checkedAt: this.lastProbeCheckedAt,
      lastError: this.lastProbeError,
    };
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
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- keep the lazy synchronous builtin load
    return require('node:os').cpus()?.length ?? 1;
  } catch {
    return 1;
  }
}

function totalSystemMemoryBytes(): number {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- keep the lazy synchronous builtin load
    return require('node:os').totalmem() || 0;
  } catch {
    return 0;
  }
}
