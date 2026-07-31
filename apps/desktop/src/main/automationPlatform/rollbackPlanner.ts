/**
 * Phase 6 Stage 8 — honest rollback planning (D-5 of the audit's gap list).
 *
 * The repository has exactly two REAL rollback mechanisms — the orchestrator's
 * `recover()` (replays only failed steps of a run) and the worker-package
 * version rollback (previous version retained by the install service). External
 * connector side effects (a sent message, a created page) have NO undo — this
 * module says so with `kind: 'none'` instead of fabricating one. Compensating
 * steps are SUGGESTIONS only and never auto-run. Pure.
 */
import type { PlaybookDefinition, RollbackAvailability, RollbackKind, RollbackStepPlan } from '@neuropause/shared';

export interface InstalledWorkerInfo {
  id: string;
  /** True when the install service retains a previous version to roll back to. */
  hasPreviousVersion: boolean;
}

export function planRollback(
  playbook: PlaybookDefinition,
  installedWorkers: readonly InstalledWorkerInfo[] | null,
): RollbackAvailability {
  const steps: RollbackStepPlan[] = [];
  const kinds = new Set<RollbackKind>();

  // The EXISTING orchestrator recovery applies to every compiled run.
  kinds.add('workflow-replay');

  for (const s of playbook.steps) {
    if (s.kind === 'approval') {
      steps.push({
        stepId: s.id,
        label: s.label,
        kind: 'workflow-replay',
        detail: 'Approval checkpoint — re-approval via the existing run recovery.',
      });
      continue;
    }
    if (!s.sideEffects) {
      steps.push({
        stepId: s.id,
        label: s.label,
        kind: 'workflow-replay',
        detail: 'Read-only step — the existing orchestrator recovery replays it if it failed.',
      });
      continue;
    }
    const installed = installedWorkers?.find((w) => w.id === s.workerId);
    if (installed?.hasPreviousVersion) {
      kinds.add('version-rollback');
      steps.push({
        stepId: s.id,
        label: s.label,
        kind: 'version-rollback',
        detail: `Worker "${installed.id}" retains a previous version — the EXISTING install-service rollback applies to the worker (not to already-produced external effects).`,
      });
      continue;
    }
    kinds.add('none');
    kinds.add('compensating-suggestion');
    steps.push({
      stepId: s.id,
      label: s.label,
      kind: 'none',
      detail: `External side effect on ${s.affectedSystems.join(', ') || 'a connected system'} — cannot be undone. Compensating action is a SUGGESTION for a human, never auto-run.`,
    });
  }

  const externalCount = steps.filter((s) => s.kind === 'none').length;
  return {
    available: true, // workflow replay always exists for the RUN itself
    kinds: [...kinds].sort(),
    steps,
    note:
      externalCount > 0
        ? `Run recovery replays failed steps; ${externalCount} side-effecting step(s) produce external effects with NO undo (stated honestly).`
        : 'Run recovery replays failed steps; no external side effects requiring undo.',
  };
}

/** One-line Principle-D rollback summary for the explainability envelope. */
export function rollbackSummary(r: RollbackAvailability): string {
  const none = r.steps.filter((s) => s.kind === 'none').length;
  return none > 0
    ? `workflow-replay available; ${none} external effect(s) not undoable`
    : `workflow-replay available (${r.kinds.join(', ')})`;
}
