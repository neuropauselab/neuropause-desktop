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

/** Coarse health band for a subsystem or the whole system. */
export type SystemHealthLevel = 'healthy' | 'degraded' | 'critical' | 'offline' | 'unknown';

/** Voice runtime lifecycle state (V5.0 managed service). */
export type VoiceRuntimeState =
  'idle' | 'listening' | 'thinking' | 'speaking' | 'disconnected' | 'recovering';

/** One subsystem's health line in the dashboard. */
export interface SubsystemHealth {
  id: 'platform' | 'automation' | 'voice' | 'runtime' | 'backend';
  label: string;
  level: SystemHealthLevel;
  detail?: string;
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

  const backendLevel: SystemHealthLevel = input.backendConnected ? 'healthy' : 'critical';
  // Runtime is a function of backend + platform (the core loop).
  const runtimeLevel = worstLevel(platformLevel, backendLevel);

  const subsystems: SubsystemHealth[] = [
    {
      id: 'runtime',
      label: 'Runtime',
      level: runtimeLevel,
      detail: input.backendConnected ? undefined : 'Backend unreachable',
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
      detail: input.backendConnected ? undefined : 'Disconnected',
    },
  ];

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
  };
}
