/**
 * NeuroCore system-health model (V5.0).
 *
 * NeuroCore is the runtime coordinator: it doesn't re-measure anything, it
 * COMPOSES the health signals the subsystems already produce (platform diagnostics,
 * automation monitor, runtime/voice status) into one scored system-health snapshot
 * for the Runtime Dashboard, Executive Center, and tray. Types + the pure composer
 * live here so they're shared + unit-tested; the wiring lives in main.
 */
import type { DiagnosticStatus } from './platform';
import type { LicenseState } from './license';

/** Coarse health band for a subsystem or the whole system. */
export type SystemHealthLevel = 'healthy' | 'degraded' | 'critical' | 'offline' | 'unknown';

/** Voice runtime lifecycle state (V5.0 managed service). */
export type VoiceRuntimeState =
  'idle' | 'listening' | 'thinking' | 'speaking' | 'disconnected' | 'recovering';

/** One subsystem's health line in the dashboard. */
export interface SubsystemHealth {
  id: 'platform' | 'automation' | 'voice' | 'runtime' | 'backend' | 'license';
  label: string;
  level: SystemHealthLevel;
  detail?: string;
}

/** Backend connectivity state (V5.1 live probe). */
export type BackendState = 'connected' | 'disconnected' | 'recovering' | 'failed';

/** Real process/runtime telemetry (V5.1). */
export interface RuntimeTelemetry {
  cpuPercent: number;
  memoryUsedMb: number;
  memoryTotalMb: number;
  processUptimeMs: number;
  backendLatencyMs: number | null;
  backendState: BackendState;
}

/** The composed system-health snapshot NeuroCore exposes. */
export interface SystemHealthSnapshot {
  generatedAt: string;
  /** 0–100 aggregate score. */
  score: number;
  level: SystemHealthLevel;
  uptimeMs: number;
  subsystems: SubsystemHealth[];
  /** Event-bus throughput surfaced for the dashboard. */
  throughput: {
    eventsPerMinute: number;
    bufferedEvents: number;
    avgDispatchMs: number;
  };
  /** Automation rollup surfaced for the dashboard. */
  automation: {
    completed: number;
    failed: number;
    paused: number;
    running: number;
  };
  voice: VoiceRuntimeState;
  /** Real OS/runtime telemetry (V5.1). */
  telemetry: RuntimeTelemetry;
}

/** Inputs the composer needs — each already produced by an existing subsystem. */
export interface SystemHealthInputs {
  nowMs: number;
  uptimeMs: number;
  /** Platform diagnostics overall + per-check (bus, timeline, probes). */
  platform: {
    overall: DiagnosticStatus;
    eventsPerMinute: number;
    bufferedEvents: number;
    avgDispatchMs: number;
    droppedEvents: number;
  };
  automation: {
    completed: number;
    failed: number;
    paused: number;
    running: number;
  };
  voice: VoiceRuntimeState;
  /** Backend reachability (from the runtime service). */
  backendConnected: boolean;
  /** Real OS/runtime telemetry (V5.1). */
  telemetry: RuntimeTelemetry;
  /**
   * Commercial license health (V6.1), reported by the renderer which holds the
   * active org. Optional/nullable: when absent (not logged in, or not yet
   * reported) the license subsystem is omitted entirely — it never contributes a
   * false alarm, and it is deliberately NOT a supervised subsystem (an expired
   * license is not recoverable by restarting anything).
   */
  license?: { state: LicenseState; graceDaysRemaining: number } | null;
}

/** Map a fine-grained voice session state to the coarse runtime state. Pure. */
export function voiceStateToRuntimeState(state: string): VoiceRuntimeState {
  switch (state) {
    case 'wake':
    case 'listening':
    case 'recognizing':
      return 'listening';
    case 'thinking':
    case 'waiting':
      return 'thinking';
    case 'speaking':
      return 'speaking';
    case 'error':
      return 'disconnected';
    case 'muted':
    case 'completed':
    case 'idle':
    default:
      return 'idle';
  }
}

/** Map a platform DiagnosticStatus onto the system health level. Pure. */
export function levelFromDiagnostic(status: DiagnosticStatus): SystemHealthLevel {
  switch (status) {
    case 'ok':
      return 'healthy';
    case 'degraded':
      return 'degraded';
    case 'down':
      return 'critical';
    default:
      return 'unknown';
  }
}

const LEVEL_SCORE: Record<SystemHealthLevel, number> = {
  healthy: 100,
  degraded: 60,
  unknown: 50,
  critical: 20,
  offline: 0,
};

/** Worst (lowest) of two levels, for rollups. Pure. */
export function worstLevel(a: SystemHealthLevel, b: SystemHealthLevel): SystemHealthLevel {
  return LEVEL_SCORE[a] <= LEVEL_SCORE[b] ? a : b;
}

/**
 * Compose the system-health snapshot from existing subsystem signals (PURE).
 * The score is the average of the subsystem scores; the overall level is the
 * worst subsystem level (a single critical subsystem makes the system critical).
 */
export function composeSystemHealth(input: SystemHealthInputs): SystemHealthSnapshot {
  const platformLevel = levelFromDiagnostic(input.platform.overall);

  // Automation is degraded if there are failures, critical if everything failed.
  const autoTotal = input.automation.completed + input.automation.failed;
  const automationLevel: SystemHealthLevel =
    input.automation.failed === 0
      ? 'healthy'
      : autoTotal > 0 && input.automation.completed === 0
        ? 'critical'
        : 'degraded';

  const voiceLevel: SystemHealthLevel =
    input.voice === 'disconnected'
      ? 'offline'
      : input.voice === 'recovering'
        ? 'degraded'
        : 'healthy';

  const backendLevel: SystemHealthLevel =
    input.telemetry.backendState === 'connected'
      ? 'healthy'
      : input.telemetry.backendState === 'recovering'
        ? 'degraded'
        : input.telemetry.backendState === 'disconnected'
          ? 'critical'
          : 'offline';
  // Runtime is a function of backend + platform (the core loop), and degrades
  // under memory pressure (>85% of the sampled heap/rss budget).
  const memPct =
    input.telemetry.memoryTotalMb > 0
      ? input.telemetry.memoryUsedMb / input.telemetry.memoryTotalMb
      : 0;
  const memoryLevel: SystemHealthLevel =
    memPct > 0.9 ? 'critical' : memPct > 0.75 ? 'degraded' : 'healthy';
  const runtimeLevel = worstLevel(worstLevel(platformLevel, backendLevel), memoryLevel);

  const subsystems: SubsystemHealth[] = [
    {
      id: 'runtime',
      label: 'Runtime',
      level: runtimeLevel,
      detail:
        memoryLevel !== 'healthy'
          ? `Memory ${Math.round(memPct * 100)}%`
          : input.telemetry.backendState !== 'connected'
            ? 'Backend unreachable'
            : undefined,
    },
    { id: 'platform', label: 'Platform bus', level: platformLevel },
    {
      id: 'automation',
      label: 'Automation',
      level: automationLevel,
      detail: input.automation.failed > 0 ? `${input.automation.failed} failed` : undefined,
    },
    { id: 'voice', label: 'Voice', level: voiceLevel, detail: input.voice },
    {
      id: 'backend',
      label: 'Backend',
      level: backendLevel,
      detail:
        input.telemetry.backendState === 'connected'
          ? input.telemetry.backendLatencyMs !== null
            ? `${input.telemetry.backendLatencyMs}ms`
            : undefined
          : input.telemetry.backendState,
    },
  ];

  // License (V6.1) — only when the renderer has reported a signal. Visible +
  // scored, but not supervised (no recovery of an expired license).
  if (input.license) {
    const licenseLevel: SystemHealthLevel =
      input.license.state === 'valid'
        ? 'healthy'
        : input.license.state === 'grace'
          ? 'degraded'
          : 'critical';
    subsystems.push({
      id: 'license',
      label: 'License',
      level: licenseLevel,
      detail:
        input.license.state === 'grace'
          ? `Grace — ${input.license.graceDaysRemaining}d left`
          : input.license.state === 'invalid'
            ? 'Inactive'
            : undefined,
    });
  }

  const score = Math.round(
    subsystems.reduce((sum, s) => sum + LEVEL_SCORE[s.level], 0) / subsystems.length,
  );
  const level = subsystems.reduce<SystemHealthLevel>(
    (worst, s) => worstLevel(worst, s.level),
    'healthy',
  );

  return {
    generatedAt: new Date(input.nowMs).toISOString(),
    score,
    level,
    uptimeMs: input.uptimeMs,
    subsystems,
    throughput: {
      eventsPerMinute: input.platform.eventsPerMinute,
      bufferedEvents: input.platform.bufferedEvents,
      avgDispatchMs: input.platform.avgDispatchMs,
    },
    automation: input.automation,
    voice: input.voice,
    telemetry: input.telemetry,
  };
}
