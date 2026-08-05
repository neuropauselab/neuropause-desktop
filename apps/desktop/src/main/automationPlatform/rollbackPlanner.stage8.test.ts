/**
 * Phase 6 Stage 8 — honest rollback planning: workflow-replay always exists for
 * the RUN, version-rollback only when the install service really retains a
 * previous version, and external side effects are declared NOT undoable
 * (kind 'none' + a compensating SUGGESTION) instead of fabricating an undo.
 */
import { describe, expect, it } from 'vitest';
import type { PlaybookDefinition } from '@neuropause/shared';
import { planRollback, rollbackSummary } from './rollbackPlanner';

function pb(steps: PlaybookDefinition['steps']): PlaybookDefinition {
  return {
    id: 'pb-r',
    version: 1,
    name: 'PB',
    description: '',
    category: 'operations',
    steps,
    why: 'w',
    triggeringConditions: ['t'],
    expectedOutcome: 'o',
    affectedSystems: ['workforce'],
    approvalTrigger: 'workforce_side_effect',
    knowledgeRefs: ['sop'],
    policyDefaultsId: 'standard-ops',
  };
}

describe('planRollback', () => {
  it('read-only and approval steps ride the EXISTING orchestrator recovery (workflow-replay)', () => {
    const r = planRollback(
      pb([
        { id: 'a', kind: 'worker', label: 'Read', workerId: 'w1', skillId: 's', dependsOn: [], sideEffects: false, affectedSystems: [] },
        { id: 'g', kind: 'approval', label: 'Gate', approvalPrompt: 'OK?', dependsOn: ['a'], sideEffects: false, affectedSystems: [] },
      ]),
      [],
    );
    expect(r.available).toBe(true);
    expect(r.kinds).toEqual(['workflow-replay']);
    expect(r.steps.map((s) => s.kind)).toEqual(['workflow-replay', 'workflow-replay']);
    expect(r.note).toContain('no external side effects');
  });

  it('a side-effecting step on a worker WITH a retained previous version → version-rollback (worker only, stated)', () => {
    const r = planRollback(
      pb([{ id: 'w', kind: 'worker', label: 'Write', workerId: 'w1', skillId: 's', dependsOn: [], sideEffects: true, affectedSystems: ['crm'] }]),
      [{ id: 'w1', hasPreviousVersion: true }],
    );
    expect(r.kinds).toContain('version-rollback');
    const step = r.steps.find((s) => s.stepId === 'w')!;
    expect(step.kind).toBe('version-rollback');
    expect(step.detail).toContain('not to already-produced external effects');
  });

  it('an external side effect with NO retained version → kind none + compensating SUGGESTION, honestly worded', () => {
    const r = planRollback(
      pb([{ id: 'w', kind: 'worker', label: 'Send message', workerId: 'w1', skillId: 's', dependsOn: [], sideEffects: true, affectedSystems: ['slack'] }]),
      [{ id: 'w1', hasPreviousVersion: false }],
    );
    expect(r.kinds).toContain('none');
    expect(r.kinds).toContain('compensating-suggestion');
    const step = r.steps.find((s) => s.stepId === 'w')!;
    expect(step.kind).toBe('none');
    expect(step.detail).toContain('cannot be undone');
    expect(step.detail).toContain('never auto-run');
    expect(r.note).toContain('NO undo');
  });

  it('a null installed-worker read degrades to the honest external-effect answer (no fabricated version)', () => {
    const r = planRollback(
      pb([{ id: 'w', kind: 'worker', label: 'Write', workerId: 'w1', skillId: 's', dependsOn: [], sideEffects: true, affectedSystems: ['crm'] }]),
      null,
    );
    expect(r.steps[0].kind).toBe('none');
  });
});

describe('rollbackSummary — the one-line Principle D field', () => {
  it('counts non-undoable external effects; otherwise lists the kinds', () => {
    const withNone = planRollback(
      pb([{ id: 'w', kind: 'worker', label: 'W', workerId: 'w1', skillId: 's', dependsOn: [], sideEffects: true, affectedSystems: ['x'] }]),
      [],
    );
    expect(rollbackSummary(withNone)).toContain('1 external effect(s) not undoable');
    const clean = planRollback(
      pb([{ id: 'a', kind: 'worker', label: 'A', workerId: 'w1', skillId: 's', dependsOn: [], sideEffects: false, affectedSystems: [] }]),
      [],
    );
    expect(rollbackSummary(clean)).toContain('workflow-replay available');
  });
});
