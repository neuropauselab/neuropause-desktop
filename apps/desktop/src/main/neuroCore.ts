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
  /** Whether the backend is currently reachable. */
  backendConnected: () => boolean;
  /** Process start time for uptime. */
  startedAtMs: number;
}

export class NeuroCore {
  private lastSnapshot: SystemHealthSnapshot | null = null;

  constructor(private readonly deps: NeuroCoreDeps) {}

  /** Compose a fresh system-health snapshot from live subsystem signals. */
  async snapshot(): Promise<SystemHealthSnapshot> {
    const now = Date.now();
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
      backendConnected: this.deps.backendConnected(),
    });

    this.lastSnapshot = snap;
    return snap;
  }

  /** The last composed snapshot, if any (cheap read for the tray). */
  last(): SystemHealthSnapshot | null {
    return this.lastSnapshot;
  }
}
