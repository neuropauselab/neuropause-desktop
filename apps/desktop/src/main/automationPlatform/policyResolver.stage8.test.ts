/**
 * Phase 6 Stage 8 — policy resolution (D-4 + Principle C): the reused P19
 * invariant decides auto-execution (explicit allow AND ungoverned, default
 * false), approval chains ALWAYS win, the critical-response defaults override
 * even an explicit allow, execution windows evaluate on the local wall clock,
 * and the approval preview projects the real chain steps with role names.
 */
import { describe, expect, it } from 'vitest';
import type { ApprovalChain, PlaybookDefinition, RollbackAvailability } from '@neuropause/shared';
import { POLICY_DEFAULTS_BY_ID } from './automationRegistry';
import { approvalsForTrigger, previewApprovals, resolvePolicy, windowOpenAt } from './policyResolver';

const NO_ROLLBACK: RollbackAvailability = { available: true, kinds: ['workflow-replay'], steps: [], note: 'n/a' };

function chain(over: Partial<ApprovalChain> = {}): ApprovalChain {
  return {
    id: 'chain-1',
    orgId: 'org-1',
    name: 'Ops approvals',
    description: '',
    appliesTo: 'workforce_side_effect',
    steps: [
      { id: 's2', name: 'Security review', roleId: 'role-sec', order: 2 },
      { id: 's1', name: 'Team lead', roleId: 'role-lead', order: 1 },
    ],
    enabled: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

function playbook(): PlaybookDefinition {
  return {
    id: 'pb-1',
    version: 1,
    name: 'PB',
    description: '',
    category: 'operations',
    steps: [],
    why: 'w',
    triggeringConditions: ['t'],
    expectedOutcome: 'o',
    affectedSystems: ['workforce'],
    approvalTrigger: 'workforce_side_effect',
    knowledgeRefs: ['sop'],
    policyDefaultsId: 'standard-ops',
  };
}

const STANDARD = POLICY_DEFAULTS_BY_ID.get('standard-ops')!;
const CRITICAL = POLICY_DEFAULTS_BY_ID.get('critical-response')!;
// A local Wednesday 10:00 — inside standard-ops' weekday 08:00–18:00 window.
const WED_10 = new Date(2026, 6, 15, 10, 0).getTime();

describe('approvalsForTrigger — the reused P19 requirement shape', () => {
  it('ungoverned trigger → the explicit ungoverned marker (never silence)', () => {
    expect(approvalsForTrigger('spend', [chain()])).toEqual([
      { trigger: 'spend', governed: false, chainName: null, steps: 0 },
    ]);
  });
  it('a governing enabled chain projects its name and step count; disabled chains do not govern', () => {
    expect(approvalsForTrigger('workforce_side_effect', [chain()])).toEqual([
      { trigger: 'workforce_side_effect', governed: true, chainName: 'Ops approvals', steps: 2 },
    ]);
    expect(approvalsForTrigger('workforce_side_effect', [chain({ enabled: false })])[0].governed).toBe(false);
  });
});

describe('resolvePolicy — Principle C composition (chains ALWAYS win)', () => {
  it('default: no allow, no chain → NOT auto-executable', () => {
    const r = resolvePolicy({ playbook: playbook(), trigger: 'workforce_side_effect', defaults: STANDARD, chains: [], autoAllowedTriggers: [], rollback: NO_ROLLBACK, nowMs: WED_10 });
    expect(r.autoExecutable).toBe(false);
    expect(r.basis.join(' ')).toContain('default: approval required');
  });
  it('explicit allow + ungoverned → auto-executable (the ONLY path)', () => {
    const r = resolvePolicy({ playbook: playbook(), trigger: 'workforce_side_effect', defaults: STANDARD, chains: [], autoAllowedTriggers: ['workforce_side_effect'], rollback: NO_ROLLBACK, nowMs: WED_10 });
    expect(r.autoExecutable).toBe(true);
  });
  it('a governing chain defeats an explicit allow — governance always wins', () => {
    const r = resolvePolicy({ playbook: playbook(), trigger: 'workforce_side_effect', defaults: STANDARD, chains: [chain()], autoAllowedTriggers: ['workforce_side_effect'], rollback: NO_ROLLBACK, nowMs: WED_10 });
    expect(r.autoExecutable).toBe(false);
    expect(r.requiredApprovals[0].governed).toBe(true);
  });
  it('critical-response defaults override even an explicit ungoverned allow', () => {
    const r = resolvePolicy({ playbook: playbook(), trigger: 'workforce_side_effect', defaults: CRITICAL, chains: [], autoAllowedTriggers: ['workforce_side_effect'], rollback: NO_ROLLBACK, nowMs: WED_10 });
    expect(r.autoExecutable).toBe(false);
    expect(r.basis.join(' ')).toContain('forces human approval');
  });
  it('projects the defaults (window/retry/escalation/connectors) and the rollback verbatim', () => {
    const r = resolvePolicy({ playbook: playbook(), trigger: 'workforce_side_effect', defaults: STANDARD, chains: [], autoAllowedTriggers: [], rollback: NO_ROLLBACK, nowMs: WED_10 });
    expect(r.executionWindow).toEqual(STANDARD.executionWindow);
    expect(r.retry).toEqual(STANDARD.retry);
    expect(r.escalation).toEqual(STANDARD.escalation);
    expect(r.rollback).toBe(NO_ROLLBACK);
    expect(r.playbookId).toBe('pb-1');
  });
});

describe('windowOpenAt — local wall-clock windows', () => {
  it('standard-ops: open Wednesday 10:00, closed Wednesday 19:00, closed Sunday 10:00', () => {
    expect(windowOpenAt(STANDARD, WED_10)).toBe(true);
    expect(windowOpenAt(STANDARD, new Date(2026, 6, 15, 19, 0).getTime())).toBe(false);
    expect(windowOpenAt(STANDARD, new Date(2026, 6, 19, 10, 0).getTime())).toBe(false); // Sunday
  });
  it('no window → always open (critical-response)', () => {
    expect(windowOpenAt(CRITICAL, new Date(2026, 6, 19, 3, 0).getTime())).toBe(true);
  });
});

describe('previewApprovals — read-only routing preview (D-6/D-9)', () => {
  it('projects the governing chain steps in order with resolved role names', () => {
    const p = previewApprovals('workforce_side_effect', [chain()], [{ id: 'role-lead', name: 'Team Lead' }], false);
    expect(p.governed).toBe(true);
    expect(p.chainName).toBe('Ops approvals');
    expect(p.steps.map((s) => s.order)).toEqual([1, 2]); // sorted, not authoring order
    expect(p.steps[0].roleName).toBe('Team Lead');
    expect(p.steps[1].roleName).toBeNull(); // unknown role stays null — never invented
    expect(p.note).toContain('governance always wins');
  });
  it('ungoverned + not auto → the honest default note', () => {
    const p = previewApprovals('spend', [], null, false);
    expect(p.governed).toBe(false);
    expect(p.steps).toEqual([]);
    expect(p.note).toContain('default remains human approval');
  });
  it('ungoverned + explicitly allowed → says so', () => {
    const p = previewApprovals('spend', [], null, true);
    expect(p.note).toContain('explicit global-governance autonomous allow');
  });
});
