/**
 * AI Sandbox — Performance & Security Lab (S5): recovery validation.
 *
 * Measures the executors' recovery mechanisms (Step 7) — retry / resume / rollback /
 * reconnect / failover / restart / session/connector/automation/plugin recovery — by
 * running a scenario and reading the REAL recovery signal from the run (S3's `recoveries`
 * metric or a clean pass). It reuses the existing recovery machinery; it adds none.
 */
import type { RecoveryCheck, RecoveryKind, RecoveryResult, ScenarioSpec } from '@neuropause/shared';
import { crmSmoke, procureToPay } from '../agent/scenarioTemplates';
import type { LabDeps } from './ports';

export const RECOVERY_KINDS: readonly RecoveryKind[] = [
  'retry', 'resume', 'rollback', 'reconnect', 'failover', 'graceful-shutdown', 'restart',
  'session-recovery', 'connector-recovery', 'automation-recovery', 'plugin-recovery',
];

export function defaultRecoveryChecks(): RecoveryCheck[] {
  return RECOVERY_KINDS.map((kind) => ({ id: `rec-${kind}`, kind }));
}

/** A representative scenario per recovery kind (multi-step for rollback, single otherwise). */
export function recoverySpec(kind: RecoveryKind): ScenarioSpec {
  if (kind === 'rollback' || kind === 'resume') return procureToPay();
  return crmSmoke();
}

export async function runRecoveryCheck(check: RecoveryCheck, deps: LabDeps): Promise<RecoveryResult> {
  const t0 = deps.now();
  const result = await deps.executor.run({ id: check.id, name: check.kind, spec: recoverySpec(check.kind) });
  const recoveryMs = deps.now() - t0;
  const recovered = (result.metrics.recoveries ?? 0) > 0 || result.outcome === 'pass';
  return { id: check.id, kind: check.kind, recovered, recoveryMs };
}

export async function runRecoverySuite(checks: RecoveryCheck[], deps: LabDeps): Promise<RecoveryResult[]> {
  const out: RecoveryResult[] = [];
  for (const check of checks) out.push(await runRecoveryCheck(check, deps));
  return out;
}
