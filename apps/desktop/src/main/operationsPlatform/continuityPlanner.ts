/**
 * Phase 6 Stage 9 — continuity composition (D-6): the federation DR store
 * (posture, replicas, recorded recovery validations), the local backup manager
 * (sha256-manifest backups), and the recovery MECHANISMS that already exist
 * (runtime supervisor, execution interruption recovery, workflow replay,
 * safety-snapshot restore). HONEST ZERO everywhere: unconfigured is zero,
 * unvalidated is null — observed RPO comes ONLY from the last recorded
 * validation, never from targets or estimates. Pure.
 */
import type { ContinuityMechanism, ContinuityView, OperationsUnavailable } from '@neuropause/shared';

export interface ContinuityInput {
  nowIso: string;
  posture: {
    haEnabled: boolean;
    multiRegion: boolean;
    rpoTargetSeconds: number;
    rtoTargetSeconds: number;
    lastDrillAt: string | null;
    score: number;
  } | null;
  replicas: { status: string }[] | null;
  validations: { status: 'pass' | 'fail'; rpoSeconds: number; validatedAt: string }[] | null;
  localBackups: { createdAt: string; valid: boolean | null }[] | null;
  supervisor: { recoveryCount: number; recentFailures: number } | null;
  failures: Record<string, string>;
}

export function buildContinuityView(input: ContinuityInput): ContinuityView {
  const unavailable: OperationsUnavailable[] = Object.entries(input.failures).map(([system, reason]) => ({
    system,
    reason,
  }));

  const replication = input.replicas
    ? {
        replicas: input.replicas.length,
        inSync: input.replicas.filter((r) => r.status === 'in_sync').length,
        lagging: input.replicas.filter((r) => r.status !== 'in_sync').length,
      }
    : null;

  const sortedValidations = [...(input.validations ?? [])].sort((a, b) => (a.validatedAt < b.validatedAt ? 1 : -1));
  const lastValidation = sortedValidations[0] ?? null;
  const validations = input.validations
    ? {
        total: input.validations.length,
        lastAt: lastValidation?.validatedAt ?? null,
        lastStatus: lastValidation?.status ?? null,
        // Observed RPO ONLY from a recorded validation — never the target.
        rpoObservedSeconds: lastValidation ? lastValidation.rpoSeconds : null,
      }
    : null;

  const sortedBackups = [...(input.localBackups ?? [])].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const localBackups = input.localBackups
    ? {
        count: input.localBackups.length,
        lastAt: sortedBackups[0]?.createdAt ?? null,
        lastValid: sortedBackups[0]?.valid ?? null,
      }
    : null;

  // The recovery mechanisms that EXIST in the repository — capability
  // statements citing their real surfaces, never fabricated resilience claims.
  const mechanisms: ContinuityMechanism[] = [
    {
      name: 'Runtime supervisor recovery',
      kind: 'recovery',
      detail: input.supervisor
        ? `${input.supervisor.recoveryCount} recovery record(s); ${input.supervisor.recentFailures} failed in the last 5 min.`
        : 'Supervisor status unavailable this read.',
      evidence: input.supervisor ? ['runtime-supervisor'] : [],
    },
    {
      name: 'Execution interruption recovery',
      kind: 'recovery',
      detail: 'The ExecuteEngine re-marks interrupted sessions on startup (existing behavior — composed, not added).',
      evidence: ['execute-engine'],
    },
    {
      name: 'Workflow replay',
      kind: 'recovery',
      detail: 'The existing orchestrator recover() replays only the failed steps of a run.',
      evidence: ['orchestrator'],
    },
    {
      name: 'Local sha256-manifest backups',
      kind: 'backup',
      detail: localBackups
        ? localBackups.count > 0
          ? `${localBackups.count} backup(s); latest ${localBackups.lastAt ?? 'n/a'}${localBackups.lastValid === null ? ' (integrity not yet checked)' : localBackups.lastValid ? ' (integrity ok)' : ' (INTEGRITY FAILED)'}.`
          : 'ZERO local backups exist — the manager is available but nothing has been backed up (honest zero).'
        : 'Backup manager unavailable this read.',
      evidence: localBackups && localBackups.count > 0 ? ['backup-manager'] : [],
    },
    {
      name: 'Cross-region replication',
      kind: 'replication',
      detail: replication
        ? replication.replicas > 0
          ? `${replication.inSync}/${replication.replicas} replica(s) in sync.`
          : 'ZERO replicas configured (honest zero — no replication resilience exists yet).'
        : 'DR store unavailable this read.',
      evidence: replication && replication.replicas > 0 ? ['dr-store'] : [],
    },
    {
      name: 'Sandbox-validated recovery',
      kind: 'validation',
      detail: validations
        ? validations.total > 0
          ? `${validations.total} recorded validation(s); last ${validations.lastStatus ?? 'n/a'} at ${validations.lastAt ?? 'n/a'} with observed RPO ${validations.rpoObservedSeconds ?? 'n/a'} s.`
          : 'ZERO recovery validations recorded — observed RPO is unknown (never assumed from targets).'
        : 'DR store unavailable this read.',
      evidence: validations && validations.total > 0 ? ['dr-validations'] : [],
    },
  ];

  return {
    generatedAt: input.nowIso,
    posture: input.posture,
    replication,
    validations,
    localBackups,
    supervisor: input.supervisor,
    mechanisms,
    unavailable,
  };
}
