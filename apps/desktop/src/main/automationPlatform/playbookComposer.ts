/**
 * Phase 6 Stage 8 — playbook → EXISTING `WorkflowSpec` compilation (D-2).
 *
 * The orchestrator (Stages 4–8's ONLY workflow runtime) executes what this
 * module emits — runs still start exclusively through the EXISTING
 * `WorkforceWorkflowRun` path. Compilation is pure and honest:
 *
 *   - every side-effecting step gets a human approval checkpoint inserted
 *     BEFORE it (Principle C — preparation is free, execution is gated; the
 *     orchestrator's own proposal parking still applies on top),
 *   - unknown workers/skills and dangling dependencies become DECLARED compile
 *     issues, never silent repairs,
 *   - the compiler adds no scheduling, no persistence, and no execution.
 *
 * D-7: `compileSimulation` emits a valid `EnterpriseScenarioSpec` for the
 * EXISTING sandbox runner (`triggerAutomation` steps over the automation
 * channel) so a playbook can be simulated without touching production; actual
 * sandbox runs stay behind the existing `sandbox:manage` surface.
 */
import type {
  EnterpriseScenarioSpec,
  PlaybookCompileIssue,
  PlaybookDefinition,
  WorkflowSpec,
  WorkflowStep,
} from '@neuropause/shared';

export interface KnownWorker {
  id: string;
  skills: string[];
}

export interface CompiledPlaybook {
  workflow: WorkflowSpec;
  issues: PlaybookCompileIssue[];
  /** Ids of the checkpoints the compiler inserted (one per side-effecting step). */
  insertedApprovals: string[];
}

/** Compile a playbook into the EXISTING WorkflowSpec shape. Pure. */
export function compilePlaybook(
  playbook: PlaybookDefinition,
  knownWorkers: readonly KnownWorker[] | null,
): CompiledPlaybook {
  const issues: PlaybookCompileIssue[] = [];
  const insertedApprovals: string[] = [];
  const steps: WorkflowStep[] = [];
  const byId = new Map(playbook.steps.map((s) => [s.id, s]));

  for (const s of playbook.steps) {
    for (const dep of s.dependsOn) {
      if (!byId.has(dep)) issues.push({ stepId: s.id, message: `dangling dependsOn "${dep}"` });
    }
    if (s.kind === 'worker' && knownWorkers) {
      const worker = knownWorkers.find((w) => w.id === s.workerId);
      if (!worker) {
        issues.push({ stepId: s.id, message: `unknown worker "${s.workerId ?? ''}" (not in the live registry)` });
      } else if (s.skillId && !worker.skills.includes(s.skillId)) {
        issues.push({ stepId: s.id, message: `worker "${worker.id}" has no skill "${s.skillId}"` });
      }
    }

    if (s.kind === 'approval') {
      steps.push({
        id: s.id,
        kind: 'approval',
        dependsOn: [...s.dependsOn],
        approvalPrompt: s.approvalPrompt ?? s.label,
      });
      continue;
    }

    let dependsOn = [...s.dependsOn];
    if (s.sideEffects) {
      // Principle C: a human checkpoint guards EVERY side-effecting step.
      const gateId = `${s.id}:approval`;
      steps.push({
        id: gateId,
        kind: 'approval',
        dependsOn,
        approvalPrompt: `Approve: ${s.label}${s.affectedSystems.length > 0 ? ` (affects ${s.affectedSystems.join(', ')})` : ''}?`,
      });
      insertedApprovals.push(gateId);
      dependsOn = [gateId];
    }
    steps.push({
      id: s.id,
      kind: 'worker',
      workerId: s.workerId,
      skillId: s.skillId,
      input: s.input ?? {},
      dependsOn,
      retry: s.retry ?? 0,
      timeoutMs: s.timeoutMs ?? 60_000,
    });
  }

  return {
    workflow: {
      id: `pb:${playbook.id}@v${playbook.version}`,
      name: playbook.name,
      description: playbook.description,
      steps,
    },
    issues,
    insertedApprovals,
  };
}

/* ── D-7: simulation compile (sandbox reuse — no production side effects) ─── */

export function simulationScenarioKey(playbook: PlaybookDefinition): string {
  return `ap-sim:${playbook.id}@v${playbook.version}`;
}

/**
 * Compile the playbook into a valid EnterpriseScenarioSpec for the EXISTING
 * sandbox enterprise runner. Steps ride the `automation` channel via
 * `triggerAutomation`; no assertions are fabricated — the v1 verdict is
 * "the compiled flow runs in the sandbox", stated in the metadata.
 */
export function compileSimulation(playbook: PlaybookDefinition): EnterpriseScenarioSpec {
  return {
    kind: 'enterprise',
    category: 'automation',
    metadata: {
      title: `Simulate playbook: ${playbook.name}`,
      description: `${playbook.description} — compiled by the Automation Platform; verdict = the flow executes in the sandbox (no scenario assertions are fabricated).`,
      owner: 'automation-platform',
      version: `v${playbook.version}`,
    },
    tags: ['automation-platform', playbook.category, playbook.id],
    preconditions: [],
    variables: { playbookId: playbook.id, playbookVersion: playbook.version },
    dataset: null,
    steps: playbook.steps
      .filter((s) => s.kind === 'worker')
      .map((s, i) => ({
        id: `sim-${s.id}`,
        name: s.label,
        action: 'triggerAutomation' as const,
        channel: 'automation' as const,
        input: {
          playbookId: playbook.id,
          stepId: s.id,
          workerId: s.workerId ?? '',
          skillId: s.skillId ?? '',
          sideEffects: s.sideEffects,
        },
        dependsOn: i === 0 ? [] : [`sim-${playbook.steps.filter((x) => x.kind === 'worker')[i - 1].id}`],
      })),
    assertions: [],
    expected: [],
    artifacts: [],
    cleanup: [],
    metrics: [],
    dependsOn: [],
    defaultChannel: 'automation',
    retry: { maxAttempts: 1 },
    approval: { required: false },
    timeoutMs: 120_000,
  };
}
