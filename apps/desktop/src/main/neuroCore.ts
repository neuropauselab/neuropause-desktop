/**
 * NeuroCore (V5.0) — the runtime coordinator.
 *
 * NeuroCore does not re-implement any subsystem; it COMPOSES the health signals
 * they already emit (platform diagnostics, automation monitor, runtime/voice
 * status) into one scored SystemHealthSnapshot for the Runtime Dashboard,
 * Executive Center, and tray. All measurement stays in the subsystems; NeuroCore
 * is aggregation + a thin IPC surface.
 */
import {
  composeSystemHealth,
  type DiagnosticsReport,
  type SystemHealthSnapshot,
  type VoiceRuntimeState,
} from '@neuropause/shared';
import { createLogger } from './logger';
import { RuntimeTelemetrySampler } from './runtimeTelemetry';

const log = createLogger('neurocore');

export interface NeuroCoreDeps {
  /** Platform diagnostics report (bus/timeline/probes) — already implemented. */
  diagnostics: () => Promise<DiagnosticsReport>;
  /** Automation monitor rollup — from the automation subsystem. */
  automationMonitor: () => {
    completed: number;
    failed: number;
    paused: number;
    running: number;
  };
  /** Current voice runtime state. */
  voiceState: () => VoiceRuntimeState;
  /** Process start time for uptime. */
  startedAtMs: number;
  /** Optional publisher for telemetry platform events (V5.1). */
  publish?: (input: {
    type: string;
    category: string;
    source: string;
    priority?: string;
    metadata?: Record<string, string | number | boolean | null>;
  }) => void;
}

export class NeuroCore {
  private lastSnapshot: SystemHealthSnapshot | null = null;
  private readonly telemetry = new RuntimeTelemetrySampler();

  constructor(private readonly deps: NeuroCoreDeps) {}

  /** Compose a fresh system-health snapshot from live subsystem signals. */
  async snapshot(): Promise<SystemHealthSnapshot> {
    const now = Date.now();
    // Refresh the backend probe (throttled internally) before reading telemetry.
    await this.telemetry.probeBackend();
    const telemetry = this.telemetry.read();

    let report: DiagnosticsReport | null = null;
    try {
      report = await this.deps.diagnostics();
    } catch (err) {
      log.warn('diagnostics unavailable', { err: String(err) });
    }

    const snap = composeSystemHealth({
      nowMs: now,
      uptimeMs: now - this.deps.startedAtMs,
      platform: {
        overall: report?.overall ?? 'unknown',
        eventsPerMinute: report?.metrics.eventsPerMinute ?? 0,
        bufferedEvents: report?.metrics.bufferedEvents ?? 0,
        avgDispatchMs: report?.metrics.avgDispatchMs ?? 0,
        droppedEvents: report?.metrics.droppedEvents ?? 0,
      },
      automation: this.deps.automationMonitor(),
      voice: this.deps.voiceState(),
      backendConnected: telemetry.backendState === 'connected',
      telemetry,
    });

    this.emitTelemetryEvents(snap);
    this.lastSnapshot = snap;
    return snap;
  }

  /** Emit runtime telemetry platform events when notable state changes (V5.1). */
  private emitTelemetryEvents(snap: SystemHealthSnapshot): void {
    const prev = this.lastSnapshot;
    const publish = this.deps.publish;
    if (!publish) return;

    // Backend connectivity transitions.
    if (prev && prev.telemetry.backendState !== snap.telemetry.backendState) {
      const connected = snap.telemetry.backendState === 'connected';
      publish({
        type: connected ? 'runtime.backend.connected' : 'runtime.backend.disconnected',
        category: 'runtime',
        source: 'neurocore',
        priority: connected ? 'normal' : 'high',
        metadata: { latencyMs: snap.telemetry.backendLatencyMs ?? -1 },
      });
    }
    // Overall health transitions.
    if (prev && prev.level !== snap.level) {
      publish({
        type: 'runtime.health.changed',
        category: 'runtime',
        source: 'neurocore',
        priority: snap.level === 'critical' ? 'high' : 'normal',
        metadata: { level: snap.level, score: snap.score },
      });
    }
    // Voice state transitions.
    if (prev && prev.voice !== snap.voice) {
      publish({
        type: 'runtime.voice.changed',
        category: 'runtime',
        source: 'neurocore',
        metadata: { state: snap.voice },
      });
    }
    // High resource pressure (edge-triggered).
    const memPct =
      snap.telemetry.memoryTotalMb > 0
        ? snap.telemetry.memoryUsedMb / snap.telemetry.memoryTotalMb
        : 0;
    const prevMemPct =
      prev && prev.telemetry.memoryTotalMb > 0
        ? prev.telemetry.memoryUsedMb / prev.telemetry.memoryTotalMb
        : 0;
    if (memPct > 0.9 && prevMemPct <= 0.9) {
      publish({
        type: 'runtime.memory.warning',
        category: 'runtime',
        source: 'neurocore',
        priority: 'high',
        metadata: { memoryUsedMb: snap.telemetry.memoryUsedMb, percent: Math.round(memPct * 100) },
      });
    }
  }

  /** The last composed snapshot, if any (cheap read for the tray). */
  last(): SystemHealthSnapshot | null {
    return this.lastSnapshot;
  }

  /**
   * V5.3 recovery hook: force an immediate backend re-probe (bypassing the
   * throttle) and report whether the backend is reachable again. Reused by the
   * RuntimeSupervisor's backend recovery executor — no duplicate probe logic.
   */
  async forceBackendProbe(): Promise<boolean> {
    await this.telemetry.probeBackend(0);
    return this.telemetry.read().backendState === 'connected';
  }
}
