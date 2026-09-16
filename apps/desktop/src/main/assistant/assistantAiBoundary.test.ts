/**
 * NeuroPause OS — Wave 2 / Increment 1 — the AI boundary invariant (source-level).
 *
 * AI IS NOT AUTHORITY. The assistant may understand, retrieve, summarize, recommend, draft, and PROPOSE — it may
 * NOT directly cause a consequential external effect, self-approve, or mint admission. This test pins that boundary
 * at the assistant PLAN layer (`buildPlan`, pure): the only executable step kinds AI can dispatch are `automation`
 * and `worker` (both of which enter the workforce proposal → approval → trusted-dispatcher mint → Boundary-B →
 * governed-execution path), plus non-executable `null` (navigate/search). There is NO `connector` step kind — AI
 * cannot dispatch a direct M365/connector write — and every side-effecting step is approval-gated and mode-gated.
 *
 * Complements the Boundary-B enforcement tests (which prove an un-approved binding without a valid claim is denied
 * with zero effect): together they establish AI → proposal → governance → approval → admission → execution, never
 * AI → connector → effect.
 */
import { describe, expect, it } from 'vitest';
import { buildPlan } from './assistantModel';
import type { AssistantIntentId, AssistantMode, AssistantPlan } from '@neuropause/shared';

const NOW = '2026-01-01T00:00:00.000Z';
const AUTOMATION = { id: 'a1', name: 'Weekly digest', actionCount: 2, active: true };
const WORKER = { id: 'w1', name: 'Researcher', role: 'research' };

/** Every plan `buildPlan` can produce across the executable intents/modes, for invariant scanning. */
function allPlans(): AssistantPlan[] {
  const cases: Array<[AssistantIntentId, AssistantMode, Record<string, unknown>]> = [
    ['automation', 'execute', { automation: AUTOMATION }],
    ['automation', 'ask', { automation: AUTOMATION }],
    ['workflow', 'execute', { automation: AUTOMATION }],
    ['execution', 'execute', { worker: WORKER }],
    ['execution', 'ask', { worker: WORKER }],
    ['navigation', 'ask', { navigate: { section: 'search', query: null } }],
    ['search', 'ask', { searchQuery: 'overdue invoices' }],
  ];
  return cases
    .map(([intent, mode, targets]) => buildPlan(intent, mode, 'asst_test', targets, NOW))
    .filter((p): p is AssistantPlan => p !== null);
}

describe('AI boundary — the assistant proposes, it never directly effects', () => {
  it('no plan step is a direct consequential connector kind (only automation / worker / null)', () => {
    for (const plan of allPlans()) {
      for (const step of plan.steps) {
        expect(step.executionKind).not.toBe('connector');
        expect([null, 'automation', 'worker']).toContain(step.executionKind);
      }
    }
  });

  it('every side-effecting step is approval-gated (AI cannot self-execute a consequential action)', () => {
    let sideEffecting = 0;
    for (const plan of allPlans()) {
      for (const step of plan.steps) {
        if (step.sideEffects) {
          sideEffecting += 1;
          expect(step.needsApproval).toBe(true);
        }
      }
    }
    expect(sideEffecting).toBeGreaterThan(0); // the scan is non-vacuous
  });

  it('a consequential automation step in Execute mode requires approval and waits (never auto-runs)', () => {
    const plan = buildPlan('automation', 'execute', 'asst_a', { automation: AUTOMATION }, NOW)!;
    const step = plan.steps.find((s) => s.executionKind === 'automation')!;
    expect(step.needsApproval).toBe(true);
    expect(step.state).toBe('waiting'); // proposed, not executed
  });

  it('side-effecting steps are DISABLED outside Execute mode (Ask mode does not run them)', () => {
    const plan = buildPlan('automation', 'ask', 'asst_b', { automation: AUTOMATION }, NOW)!;
    const step = plan.steps.find((s) => s.sideEffects)!;
    expect(step.state).toBe('skipped');
  });

  it('a plan step carries no authority fields — no confirmed / binding / claim (mint happens post-approval only)', () => {
    for (const plan of allPlans()) {
      for (const step of plan.steps) {
        const s = step as unknown as Record<string, unknown>;
        expect('confirmed' in s).toBe(false);
        expect('binding' in s).toBe(false);
        expect('claim' in s).toBe(false);
      }
    }
  });
});
