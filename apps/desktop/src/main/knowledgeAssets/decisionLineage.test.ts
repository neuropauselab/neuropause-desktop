/**
 * Phase 6 Stage 7 — decision lineage tests (7.3): a full chain composes from
 * real fragments; partial chains stay honestly partial (absent stages, lower
 * coverage confidence); heuristic joins declare reduced per-stage confidence;
 * unknown decisions are honest.
 */
import { describe, expect, it } from 'vitest';
import type { ExecutiveDecision } from '@neuropause/shared';
import { composeDecisionLineage, type LineageInput } from './decisionLineage';

function decision(over: Partial<ExecutiveDecision> = {}): ExecutiveDecision {
  return {
    id: 'dec:1',
    title: 'Adopt service mesh architecture',
    category: 'engineering',
    description: 'Adopt a mesh',
    reasoning: 'Latency',
    evidence: ['doc-1', 'mem-1'],
    sourceSystems: ['github'],
    confidence: 0.8,
    businessImpact: 'High',
    expectedOutcome: 'Stability',
    owner: 'Ava Chen',
    priority: 'high',
    status: 'completed',
    createdAt: '2026-07-01T10:00:00.000Z',
    updatedAt: '2026-07-28T10:00:00.000Z',
    fromRecommendationId: 'reco:9',
    history: [
      { at: '2026-07-01T10:00:00.000Z', actor: 'system', kind: 'created', newState: 'suggested' },
      { at: '2026-07-02T10:00:00.000Z', actor: 'ceo', kind: 'status_changed', previousState: 'suggested', newState: 'accepted' },
      { at: '2026-07-27T10:00:00.000Z', actor: 'ceo', kind: 'status_changed', previousState: 'in_progress', newState: 'completed' },
    ],
    ...over,
  };
}

function fullInput(over: Partial<LineageInput> = {}): LineageInput {
  return {
    decision: decision(),
    conversations: [{ id: 'conv-1', title: 'Service mesh architecture review', updatedAt: '2026-07-01T15:00:00.000Z' }],
    discussedIn: [{ id: 'node-conv-9', label: 'Mesh kickoff thread', at: '2026-06-30T10:00:00.000Z' }],
    citingMemories: [{ id: 'mem-1', title: 'Mesh rationale', updatedAt: '2026-07-03T10:00:00.000Z' }],
    approvalEvents: [{ id: 'evt-1', correlationId: 'asst_dec:1', at: '2026-07-02T10:00:30.000Z' }],
    executions: [{ label: 'Adopt service mesh architecture rollout', state: 'completed', startedAt: '2026-07-10T10:00:00.000Z' }],
    verifiedEvents: [{ id: 'evt-v1', recommendationId: 'reco:9', at: '2026-07-29T10:00:00.000Z' }],
    ...over,
  };
}

describe('decision lineage — full chain', () => {
  it('composes all seven stages from real fragments, each cited', () => {
    const l = composeDecisionLineage('dec:1', fullInput());
    expect(l.found).toBe(true);
    expect(l.stages).toHaveLength(7);
    expect(l.stages.map((s) => s.stage)).toEqual([
      'origin',
      'discussion',
      'evidence',
      'approval',
      'implementation',
      'verification',
      'status',
    ]);
    for (const s of l.stages) {
      expect(s.present).toBe(true);
      expect(s.evidence.length).toBeGreaterThan(0);
    }
    const origin = l.stages[0];
    expect(origin.summary).toContain('reco:9');
    const approval = l.stages[3];
    expect(approval.evidence[0]).toContain('history:accepted');
    expect(approval.evidence).toContain('evt-1'); // correlated timeline approval
    const verification = l.stages[5];
    expect(verification.evidence).toContain('evt-v1'); // insight.outcome_verified join
    expect(l.currentStatus).toBe('completed');
    expect(l.lifecycle).toBe('approved');
    expect(l.overallConfidence).toBeGreaterThan(0.6);
  });

  it('direct discussion records score higher confidence than title-overlap-only joins', () => {
    const direct = composeDecisionLineage('dec:1', fullInput());
    const heuristicOnly = composeDecisionLineage(
      'dec:1',
      fullInput({ discussedIn: [], citingMemories: [] }),
    );
    const d = direct.stages.find((s) => s.stage === 'discussion');
    const h = heuristicOnly.stages.find((s) => s.stage === 'discussion');
    expect(d?.confidence).toBe(0.9);
    expect(h?.confidence).toBe(0.6); // declared heuristic
  });

  it('implementation via execution label overlap declares heuristic confidence 0.6', () => {
    const l = composeDecisionLineage('dec:1', fullInput());
    const impl = l.stages.find((s) => s.stage === 'implementation');
    expect(impl?.confidence).toBe(0.6);
    expect(impl?.evidence[0]).toContain('execution:');
  });
});

describe('decision lineage — honest partials', () => {
  it('a draft decision has absent discussion/evidence/approval/implementation/verification stages', () => {
    const l = composeDecisionLineage(
      'dec:2',
      fullInput({
        decision: decision({
          id: 'dec:2',
          title: 'Unrelated topic entirely',
          status: 'draft',
          evidence: [],
          fromRecommendationId: undefined,
          history: [{ at: '2026-07-01T10:00:00.000Z', actor: 'me', kind: 'created', newState: 'draft' }],
        }),
        conversations: [],
        discussedIn: [],
        citingMemories: [],
        executions: [],
        verifiedEvents: [],
      }),
    );
    const byStage = new Map(l.stages.map((s) => [s.stage, s]));
    expect(byStage.get('origin')?.present).toBe(true);
    expect(byStage.get('discussion')?.present).toBe(false);
    expect(byStage.get('evidence')?.present).toBe(false);
    expect(byStage.get('evidence')?.summary).toMatch(/quality finding/);
    expect(byStage.get('approval')?.present).toBe(false);
    expect(byStage.get('approval')?.summary).toMatch(/pre-approval/);
    expect(byStage.get('implementation')?.present).toBe(false);
    expect(byStage.get('verification')?.present).toBe(false);
    expect(byStage.get('status')?.present).toBe(true);
    expect(l.overallConfidence).toBeLessThan(0.5); // coverage-scaled, never overclaimed
  });

  it('completed WITHOUT an outcome_verified event falls back to the operator-completed record (0.8)', () => {
    const l = composeDecisionLineage('dec:1', fullInput({ verifiedEvents: [] }));
    const v = l.stages.find((s) => s.stage === 'verification');
    expect(v?.present).toBe(true);
    expect(v?.confidence).toBe(0.8);
    expect(v?.evidence[0]).toContain('history:completed');
  });

  it('an unknown decision id is honest: found=false, no stages', () => {
    const l = composeDecisionLineage('dec:404', fullInput({ decision: null }));
    expect(l.found).toBe(false);
    expect(l.stages).toEqual([]);
    expect(l.overallConfidence).toBe(0);
  });
});
