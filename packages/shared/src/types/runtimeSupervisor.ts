/**
 * Runtime supervisor model (V5.3).
 *
 * The supervisor evolves NeuroCore from monitoring to recovery: given a composed
 * SystemHealthSnapshot, the recovery policies, and recent attempt history, it
 * decides which subsystems to recover — gated by per-subsystem policy and a
 * backoff so it never spams restarts. The DECISION logic lives here as a pure,
 * unit-tested function; the actual recovery side effects live in main and reuse
 * existing subsystem capabilities (no duplicated restart logic).
 */
import type { SubsystemHealth, SystemHealthLevel } from './systemHealth';

/** Subsystems the supervisor can recover (aligned with SubsystemHealth.id). */
export type SupervisedSubsystem = 'runtime' | 'platform' | 'automation' | 'voice' | 'backend';

/** Per-subsystem recovery policy. */
export type RecoveryPolicy = 'automatic' | 'manual' | 'disabled';

/** A single recovery attempt outcome, persisted to history. */
export interface RecoveryRecord {
  id: string;
  subsystem: SupervisedSubsystem;
  reason: string;
  startedAt: string;
  durationMs: number;
  ok: boolean;
  detail: string | null;
}

/** A recovery the supervisor wants to attempt this tick. */
export interface SupervisorRecoveryAction {
  subsystem: SupervisedSubsystem;
  reason: string;
}

/** The supervisor's decision for one evaluation tick. Pure output. */
export interface SupervisorDecision {
  /** Subsystems to attempt automatic recovery on now. */
  actions: SupervisorRecoveryAction[];
  /** Subsystems unhealthy but set to manual — surfaced, not auto-recovered. */
  needsManual: SupervisedSubsystem[];
  /** Subsystems that keep failing recovery — escalate. */
  escalate: SupervisedSubsystem[];
}

/** Live supervisor status for the dashboard/tray. */
export interface SupervisorStatus {
  policies: Record<SupervisedSubsystem, RecoveryPolicy>;
  recovering: SupervisedSubsystem[];
  lastRecovery: RecoveryRecord | null;
  recoveryCount: number;
  recentFailures: number;
}

export const SUPERVISED_SUBSYSTEMS: SupervisedSubsystem[] = [
  'runtime',
  'platform',
  'automation',
  'voice',
  'backend',
];

/** Default policy: everything auto-recovers unless the user changes it. */
export function defaultRecoveryPolicies(): Record<SupervisedSubsystem, RecoveryPolicy> {
  return {
    runtime: 'automatic',
    platform: 'automatic',
    automation: 'automatic',
    voice: 'automatic',
    backend: 'automatic',
  };
}

/** A subsystem is "failing" when critical or offline (degraded is watch-only). */
export function isFailing(level: SystemHealthLevel): boolean {
  return level === 'critical' || level === 'offline';
}

export interface SupervisorEvalInput {
  subsystems: SubsystemHealth[];
  policies: Record<SupervisedSubsystem, RecoveryPolicy>;
  /** Recent attempts (most recent first is not required). */
  recentAttempts: Array<{ subsystem: SupervisedSubsystem; at: number; ok: boolean }>;
  nowMs: number;
  /** Minimum gap between recovery attempts for the same subsystem. */
  cooldownMs?: number;
  /** Failed attempts within the window before we escalate instead of retrying. */
  maxFailuresBeforeEscalate?: number;
  /** Window for counting recent failures. */
  failureWindowMs?: number;
}

/**
 * Decide recovery actions for this tick (PURE). A failing subsystem is recovered
 * only if its policy is 'automatic', it isn't within the cooldown since its last
 * attempt, and it hasn't exceeded the failure budget (in which case it escalates).
 */
export function evaluateSupervisor(input: SupervisorEvalInput): SupervisorDecision {
  const cooldownMs = input.cooldownMs ?? 30_000;
  const maxFailures = input.maxFailuresBeforeEscalate ?? 3;
  const windowMs = input.failureWindowMs ?? 5 * 60_000;

  const actions: SupervisorRecoveryAction[] = [];
  const needsManual: SupervisedSubsystem[] = [];
  const escalate: SupervisedSubsystem[] = [];

  for (const sub of input.subsystems) {
    const id = sub.id as SupervisedSubsystem;
    if (!SUPERVISED_SUBSYSTEMS.includes(id)) continue;
    if (!isFailing(sub.level)) continue;

    const policy = input.policies[id] ?? 'automatic';
    if (policy === 'disabled') continue;
    if (policy === 'manual') {
      needsManual.push(id);
      continue;
    }

    const attemptsForSub = input.recentAttempts.filter((a) => a.subsystem === id);
    const lastAttempt = attemptsForSub.reduce<number | null>(
      (max, a) => (max === null || a.at > max ? a.at : max),
      null,
    );
    // Backoff: don't retry within the cooldown window.
    if (lastAttempt !== null && input.nowMs - lastAttempt < cooldownMs) continue;

    // Escalate if it keeps failing within the window rather than retrying forever.
    const recentFailures = attemptsForSub.filter(
      (a) => !a.ok && input.nowMs - a.at < windowMs,
    ).length;
    if (recentFailures >= maxFailures) {
      escalate.push(id);
      continue;
    }

    actions.push({ subsystem: id, reason: sub.detail ?? `${sub.label} ${sub.level}` });
  }

  return { actions, needsManual, escalate };
}
