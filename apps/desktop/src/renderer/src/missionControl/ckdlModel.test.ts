import { describe, it, expect } from 'vitest';
import {
  trustBadge,
  decisionHistory,
  decisionsAwaitingApproval,
  evidenceCoverage,
  purposeRollup,
  entityContext,
  lowTrustEntities,
  riskPanel,
  type CkdlSnapshot,
} from './ckdlModel';

function snap(): CkdlSnapshot {
  return {
    decisions: [
      { id: 'd1', purpose: 'Adopt Postgres', status: 'executed', owner: 'sam', approval: 'approved', evidenceCount: 3, trustBand: 'high', trustScore: 0.82, at: 300, linkedWorkKeys: ['task:t1'] },
      { id: 'd2', purpose: 'Pick vendor', status: 'proposed', owner: 'ada', approval: 'pending', evidenceCount: 1, trustBand: 'moderate', trustScore: 0.55, at: 200, linkedWorkKeys: [] },
      { id: 'd3', purpose: 'Rush hotfix', status: 'proposed', owner: 'cy', approval: 'pending', evidenceCount: 0, trustBand: 'low', trustScore: 0.2, at: 100, linkedWorkKeys: [] },
    ],
    objectives: [
      { id: 'o1', kind: 'goal', title: 'Ship v1', owner: 'sam', progress: 0.8 },
      { id: 'o2', kind: 'goal', title: 'Cut latency', owner: 'ada', progress: 0.3 },
    ],
    entities: [
      { key: 'task:t1', label: 'Spec', kind: 'task', evidenceCount: 2, trustBand: 'high', trustScore: 0.8, decisionIds: ['d1'], objectiveIds: ['o1'], linkedWorkKeys: ['project:p1'], riskKeys: [] },
      { key: 'task:t2', label: 'Migration', kind: 'task', evidenceCount: 0, trustBand: 'low', trustScore: 0.1, decisionIds: [], objectiveIds: [], linkedWorkKeys: [], riskKeys: ['risk:r1'] },
    ],
    risks: [
      { key: 'risk:r1', label: 'Data loss', linkedDecisionIds: ['d1', 'd2'] },
      { key: 'risk:r2', label: 'Cost overrun', linkedDecisionIds: ['d2'] },
    ],
  };
}

describe('Mission Control × CKDL projection', () => {
  it('maps trust band + score to a display badge', () => {
    expect(trustBadge('high', 0.82)).toMatchObject({ tone: 'ok', percent: 82 });
    expect(trustBadge('low', 0.2).tone).toBe('crit');
  });

  it('orders decision history newest-first and filters by status', () => {
    const hist = decisionHistory(snap());
    expect(hist.map((d) => d.id)).toEqual(['d1', 'd2', 'd3']);
    expect(decisionHistory(snap(), { status: 'proposed' }).map((d) => d.id)).toEqual(['d2', 'd3']);
  });

  it('surfaces decisions awaiting approval', () => {
    expect(decisionsAwaitingApproval(snap()).map((d) => d.id)).toEqual(['d2', 'd3']);
  });

  it('reports evidence coverage honestly, weakest first', () => {
    const cov = evidenceCoverage(snap());
    expect(cov.decisions).toBe(3);
    expect(cov.unbacked).toBe(1); // d3 has 0 evidence
    expect(cov.avgEvidence).toBeCloseTo(4 / 3);
    expect(cov.weakest[0]?.id).toBe('d3');
  });

  it('rolls up purpose and flags at-risk objectives', () => {
    const roll = purposeRollup(snap());
    expect(roll.objectives).toBe(2);
    expect(roll.avgProgress).toBeCloseTo(0.55);
    expect(roll.atRisk.map((o) => o.id)).toEqual(['o2']);
  });

  it('returns an entity context and flags low-trust entities', () => {
    expect(entityContext(snap(), 'task:t1')?.decisionIds).toEqual(['d1']);
    expect(lowTrustEntities(snap()).map((e) => e.key)).toEqual(['task:t2']);
  });

  it('orders the risk panel by decision exposure', () => {
    expect(riskPanel(snap()).map((r) => r.key)).toEqual(['risk:r1', 'risk:r2']);
  });
});
