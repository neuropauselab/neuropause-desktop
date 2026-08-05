import { describe, it, expect } from 'vitest';
import { createEnterpriseRuntime } from '@neuropause/runtime';
import { ManualClock } from '@neuropause/cloud-core';
import { KnowledgeGovernance } from './governance';
import { EvidenceEngine } from './evidence';
import { TrustModel } from './trust';

function setup(startMs = 0): { clock: ManualClock; evidence: EvidenceEngine; trust: TrustModel; gov: KnowledgeGovernance } {
  const clock = new ManualClock(startMs);
  const runtime = createEnterpriseRuntime({ clock });
  const gov = new KnowledgeGovernance(runtime, clock);
  return { clock, evidence: new EvidenceEngine(clock, gov), trust: new TrustModel(clock, gov), gov };
}

describe('EvidenceEngine — provenance, never fabricated', () => {
  it('records evidence with provenance and refuses empty', async () => {
    const { evidence } = setup();
    const e = await evidence.record({ type: 'ai-output', summary: 'model suggests X', source: 'fake-provider', sourceConfidence: 0.7 });
    expect(evidence.provenance([e.id])[0]).toMatchObject({ type: 'ai-output', source: 'fake-provider', verified: false });
    await expect(evidence.record({ type: 'document', summary: '   ', source: 'doc' })).rejects.toThrow(/summary/);
    await expect(evidence.record({ type: 'document', summary: 'x', source: '' })).rejects.toThrow(/source/);
  });

  it('drops unknown ids from provenance instead of inventing them', async () => {
    const { evidence } = setup();
    const e = await evidence.record({ type: 'metric', summary: 'p95 = 120ms', source: 'metrics' });
    expect(evidence.provenance([e.id, 'ev_ghost'])).toHaveLength(1);
  });

  it('verifies evidence and links it to an entity', async () => {
    const { evidence } = setup();
    const e = await evidence.record({ type: 'human-input', summary: 'approved by lead', source: 'sam', about: { kind: 'project', id: 'p1' } });
    await evidence.verify(e.id);
    expect(evidence.get(e.id)?.verified).toBe(true);
    expect(evidence.about({ kind: 'project', id: 'p1' })).toHaveLength(1);
  });
});

describe('TrustModel — explainable, never certain', () => {
  it('returns a weighted breakdown and always caveats that it is a heuristic', () => {
    const { trust } = setup();
    const a = trust.assess({ sourceReliability: 0.9, verified: true, humanApproved: true, auditIntact: true, completeness: 0.8 });
    expect(a.band).toBe('high');
    expect(a.components.length).toBeGreaterThan(0);
    expect(a.caveats).toContain('heuristic indicator — not a probability of correctness');
    // human approval is weighted above AI confidence
    const hw = a.components.find((c) => c.signal === 'humanApproved')!.weight;
    const b = trust.assess({ aiConfidence: 1 });
    const aw = b.components.find((c) => c.signal === 'aiConfidence')!.weight;
    expect(hw).toBeGreaterThan(aw);
  });

  it('decays freshness with age and flags stale data', () => {
    const thirtyDays = 30 * 24 * 60 * 60 * 1000;
    const { trust } = setup(thirtyDays);
    const fresh = trust.assess({ freshnessAt: thirtyDays });
    const stale = trust.assess({ freshnessAt: 0 }); // 30 days old
    const freshVal = fresh.components.find((c) => c.signal === 'freshness')!.value;
    const staleVal = stale.components.find((c) => c.signal === 'freshness')!.value;
    expect(freshVal).toBeGreaterThan(0.99);
    expect(staleVal).toBeCloseTo(0.5, 1);
    expect(stale.caveats).toContain('underlying data is stale');
  });

  it('lists a caveat for every absent signal', () => {
    const { trust } = setup();
    const a = trust.assess({});
    for (const missing of ['source reliability not provided', 'freshness unknown', 'human approval unknown']) {
      expect(a.caveats).toContain(missing);
    }
  });

  it('derives trust from an evidence set', async () => {
    const { evidence, trust } = setup();
    const e1 = await evidence.record({ type: 'human-input', summary: 'lead sign-off', source: 'sam' });
    await evidence.verify(e1.id);
    await evidence.record({ type: 'metric', summary: 'latency ok', source: 'metrics' });
    const a = trust.assessEvidence([evidence.get(e1.id)!, ...evidence.list('metric')]);
    expect(a.components.some((c) => c.signal === 'humanApproved' && c.value === 1)).toBe(true);
    expect(a.score).toBeGreaterThan(0);
  });
});
