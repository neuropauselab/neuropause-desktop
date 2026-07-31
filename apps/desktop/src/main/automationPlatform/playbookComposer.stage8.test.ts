/**
 * Phase 6 Stage 8 — playbook → EXISTING WorkflowSpec compilation (D-2 +
 * Principle C): a checkpoint is inserted BEFORE every side-effecting step (the
 * step's dependencies reroute through its gate), unknown workers/skills and
 * dangling deps are DECLARED issues, all four registry playbooks compile
 * cleanly against the real worker surface, and the simulation compile emits a
 * valid EnterpriseScenarioSpec for the existing sandbox runner (D-7).
 */
import { describe, expect, it } from 'vitest';
import type { PlaybookDefinition } from '@neuropause/shared';
import { PLAYBOOK_REGISTRY } from './automationRegistry';
import { compilePlaybook, compileSimulation, simulationScenarioKey, type KnownWorker } from './playbookComposer';

const REAL_WORKERS: KnownWorker[] = [{ id: 'worker:operations', skills: ['briefing', 'recommend', 'remind', 'note'] }];

function pb(steps: PlaybookDefinition['steps']): PlaybookDefinition {
  return {
    id: 'test-pb',
    version: 1,
    name: 'Test playbook',
    description: 'test',
    category: 'operations',
    steps,
    why: 'test',
    triggeringConditions: ['manual'],
    expectedOutcome: 'test outcome',
    affectedSystems: ['workforce'],
    approvalTrigger: 'workforce_side_effect',
    knowledgeRefs: ['sop'],
    policyDefaultsId: 'standard-ops',
  };
}

describe('Principle C — a human checkpoint guards EVERY side-effecting step', () => {
  it('inserts a gate before the side-effecting step and reroutes its dependencies', () => {
    const compiled = compilePlaybook(
      pb([
        { id: 'read', kind: 'worker', label: 'Read', workerId: 'worker:operations', skillId: 'briefing', dependsOn: [], sideEffects: false, affectedSystems: [] },
        { id: 'write', kind: 'worker', label: 'Write note', workerId: 'worker:operations', skillId: 'note', dependsOn: ['read'], sideEffects: true, affectedSystems: ['memory'] },
      ]),
      REAL_WORKERS,
    );
    expect(compiled.issues).toEqual([]);
    expect(compiled.insertedApprovals).toEqual(['write:approval']);
    const ids = compiled.workflow.steps.map((s) => s.id);
    expect(ids).toEqual(['read', 'write:approval', 'write']);
    const gate = compiled.workflow.steps.find((s) => s.id === 'write:approval')!;
    expect(gate.kind).toBe('approval');
    expect(gate.dependsOn).toEqual(['read']); // the gate inherits the original deps…
    const write = compiled.workflow.steps.find((s) => s.id === 'write')!;
    expect(write.dependsOn).toEqual(['write:approval']); // …and the step now depends on its gate
    expect(gate.approvalPrompt).toContain('Write note');
    expect(gate.approvalPrompt).toContain('memory');
  });

  it('read-only steps get NO gate; explicit approval steps pass through', () => {
    const compiled = compilePlaybook(
      pb([
        { id: 'a', kind: 'worker', label: 'A', workerId: 'worker:operations', skillId: 'briefing', dependsOn: [], sideEffects: false, affectedSystems: [] },
        { id: 'gate', kind: 'approval', label: 'Sign off', approvalPrompt: 'OK?', dependsOn: ['a'], sideEffects: false, affectedSystems: [] },
      ]),
      REAL_WORKERS,
    );
    expect(compiled.insertedApprovals).toEqual([]);
    expect(compiled.workflow.steps.map((s) => s.kind)).toEqual(['worker', 'approval']);
    expect(compiled.workflow.steps[1].approvalPrompt).toBe('OK?');
  });

  it('every registry playbook compiles with zero issues against the real worker surface', () => {
    for (const playbook of PLAYBOOK_REGISTRY) {
      const compiled = compilePlaybook(playbook, REAL_WORKERS);
      expect(compiled.issues, playbook.id).toEqual([]);
      const sideEffecting = playbook.steps.filter((s) => s.sideEffects).length;
      expect(compiled.insertedApprovals, playbook.id).toHaveLength(sideEffecting);
      // Approval steps in the OUTPUT ≥ side-effecting steps (explicit gates add more).
      const approvals = compiled.workflow.steps.filter((s) => s.kind === 'approval').length;
      expect(approvals).toBeGreaterThanOrEqual(sideEffecting);
      expect(compiled.workflow.id).toBe(`pb:${playbook.id}@v${playbook.version}`);
    }
  });

  it('the quarterly report compiles its explicit gate PLUS the inserted record gate', () => {
    const q = PLAYBOOK_REGISTRY.find((p) => p.id === 'quarterly-ops-report')!;
    const compiled = compilePlaybook(q, REAL_WORKERS);
    const approvals = compiled.workflow.steps.filter((s) => s.kind === 'approval').map((s) => s.id);
    expect(approvals).toContain('gate'); // authored sign-off
    expect(approvals).toContain('record:approval'); // inserted Principle C gate
  });
});

describe('honest compile issues (declared, never repaired)', () => {
  it('unknown worker, unknown skill, and dangling deps become issues', () => {
    const compiled = compilePlaybook(
      pb([
        { id: 'x', kind: 'worker', label: 'X', workerId: 'worker:ghost', skillId: 'briefing', dependsOn: ['nope'], sideEffects: false, affectedSystems: [] },
        { id: 'y', kind: 'worker', label: 'Y', workerId: 'worker:operations', skillId: 'teleport', dependsOn: [], sideEffects: false, affectedSystems: [] },
      ]),
      REAL_WORKERS,
    );
    const messages = compiled.issues.map((i) => i.message).join(' | ');
    expect(messages).toContain('unknown worker "worker:ghost"');
    expect(messages).toContain('no skill "teleport"');
    expect(messages).toContain('dangling dependsOn "nope"');
    // The workflow still compiles (the orchestrator surface decides what to do) — nothing silently dropped.
    expect(compiled.workflow.steps.map((s) => s.id)).toEqual(['x', 'y']);
  });

  it('a null worker registry skips worker validation without fabricating a pass/fail', () => {
    const compiled = compilePlaybook(
      pb([{ id: 'x', kind: 'worker', label: 'X', workerId: 'worker:ghost', skillId: 'nope', dependsOn: [], sideEffects: false, affectedSystems: [] }]),
      null,
    );
    expect(compiled.issues).toEqual([]);
  });
});

describe('D-7 — the simulation compile (sandbox reuse)', () => {
  it('emits a valid enterprise scenario: automation channel, triggerAutomation steps, zero fabricated assertions', () => {
    const q = PLAYBOOK_REGISTRY.find((p) => p.id === 'daily-ops-review')!;
    const spec = compileSimulation(q);
    expect(spec.kind).toBe('enterprise');
    expect(spec.category).toBe('automation');
    expect(spec.defaultChannel).toBe('automation');
    expect(spec.steps.length).toBe(q.steps.filter((s) => s.kind === 'worker').length);
    for (const s of spec.steps) {
      expect(s.action).toBe('triggerAutomation');
      expect(s.channel).toBe('automation');
    }
    // Steps chain linearly (sim order preserved) and assertions are NOT invented.
    expect(spec.steps[0].dependsOn).toEqual([]);
    expect(spec.steps[1].dependsOn).toEqual([`sim-${q.steps[0].id}`]);
    expect(spec.assertions).toEqual([]);
    expect(spec.expected).toEqual([]);
    expect(spec.approval.required).toBe(false);
    expect(spec.metadata.description).toContain('no scenario assertions are fabricated');
  });

  it('the scenario key is deterministic and versioned', () => {
    const q = PLAYBOOK_REGISTRY[0];
    expect(simulationScenarioKey(q)).toBe(`ap-sim:${q.id}@v${q.version}`);
  });
});
