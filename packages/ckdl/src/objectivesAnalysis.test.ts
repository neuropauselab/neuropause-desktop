import { describe, it, expect } from 'vitest';
import { createEnterpriseRuntime } from '@neuropause/runtime';
import { ManualClock } from '@neuropause/cloud-core';
import { createKnowledgeLayer, type KnowledgeLayer } from './platform';

function layer(): KnowledgeLayer {
  const clock = new ManualClock(0);
  return createKnowledgeLayer(createEnterpriseRuntime({ clock }), { clock });
}

describe('PurposeModel — objectives with derived progress', () => {
  it('derives progress from key results and rolls up', async () => {
    const ckdl = layer();
    const obj = await ckdl.objectives().create({
      kind: 'goal',
      title: 'Ship v1',
      owner: 'sam',
      keyResults: [
        { description: 'tests', target: 100, current: 50 },
        { description: 'docs', target: 10, current: 10 },
      ],
    });
    expect(ckdl.objectives().progress(obj.id)).toBeCloseTo(0.75); // (0.5 + 1.0)/2
    expect(ckdl.objectives().rollup('goal').progress).toBeCloseTo(0.75);
  });

  it('updates a key result and reflects new progress', async () => {
    const ckdl = layer();
    const obj = await ckdl.objectives().create({ kind: 'goal', title: 'G', owner: 'sam', keyResults: [{ description: 'x', target: 4, current: 1 }] });
    const krId = obj.keyResults[0]!.id;
    await ckdl.objectives().updateKeyResult(obj.id, krId, 4);
    expect(ckdl.objectives().progress(obj.id)).toBeCloseTo(1);
  });

  it('rejects a dependency cycle among objectives', async () => {
    const ckdl = layer();
    const a = await ckdl.objectives().create({ kind: 'objective', title: 'A', owner: 's' });
    const b = await ckdl.objectives().create({ kind: 'objective', title: 'B', owner: 's' });
    await ckdl.objectives().addDependency(a.id, b.id);
    await expect(ckdl.objectives().addDependency(b.id, a.id)).rejects.toThrow(/cycle/);
  });
});

describe('DecisionIntelligence — every output references evidence', () => {
  async function seeded(): Promise<{ ckdl: KnowledgeLayer; e1: string; d1: string; d2: string }> {
    const ckdl = layer();
    const e1 = (await ckdl.evidence().record({ type: 'human-input', summary: 'scale review', source: 'sam' })).id;
    const d1 = (
      await ckdl.decisions().propose({ purpose: 'adopt postgres database', context: 'scale', alternatives: [{ label: 'pg', chosen: true }], evidenceIds: [e1], owner: 'sam' })
    ).id;
    const d2 = (
      await ckdl.decisions().propose({ purpose: 'adopt postgres for scale', context: 'growth', alternatives: [{ label: 'pg', chosen: true }], evidenceIds: [e1], owner: 'sam' })
    ).id;
    return { ckdl, e1, d1, d2 };
  }

  it('ranks similar decisions with an explanation and shared evidence', async () => {
    const { ckdl, e1, d1 } = await seeded();
    const similar = ckdl.analysis().similarDecisions(d1);
    expect(similar[0]?.sharedEvidenceIds).toContain(e1);
    expect(similar[0]?.why).toMatch(/shared evidence/);
    expect(similar[0]!.score).toBeGreaterThan(0);
  });

  it('computes dependency and impact from first-class relationships', async () => {
    const ckdl = layer();
    await ckdl.knowledgeGraph().register({ kind: 'task', id: 't1', label: 'A' });
    await ckdl.knowledgeGraph().register({ kind: 'task', id: 't2', label: 'B' });
    await ckdl.relationships().relate({ kind: 'task', id: 't1' }, { kind: 'task', id: 't2' }, 'depends-on');
    expect(ckdl.analysis().dependencyAnalysis({ kind: 'task', id: 't1' })).toEqual(['task:t2']);
    expect(ckdl.analysis().impactAnalysis({ kind: 'task', id: 't2' }).affectedKeys).toEqual(['task:t1']);
  });

  it('surfaces missing evidence honestly', async () => {
    const ckdl = layer();
    const e = (await ckdl.evidence().record({ type: 'ai-output', summary: 'model says go', source: 'fake' })).id;
    const d = await ckdl.decisions().propose({ purpose: 'p', context: 'c', alternatives: [{ label: 'A', chosen: true }], evidenceIds: [e], owner: 'sam' });
    const gaps = ckdl.analysis().missingEvidence(d.id).map((g) => g.kind);
    expect(gaps).toEqual(expect.arrayContaining(['human-input', 'verification', 'metric', 'rationale', 'confidence']));
  });

  it('explains a recommendation with provenance and trust, and refuses one without evidence', async () => {
    const { ckdl, e1 } = await seeded();
    const explained = ckdl.analysis().explainRecommendation({ statement: 'use postgres', evidenceIds: [e1] });
    expect(explained.provenance).toHaveLength(1);
    expect(explained.trust.caveats).toContain('heuristic indicator — not a probability of correctness');
    expect(() => ckdl.analysis().explainRecommendation({ statement: 'x', evidenceIds: [] })).toThrow(/must reference evidence/);
  });
});
