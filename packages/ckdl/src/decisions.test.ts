import { describe, it, expect } from 'vitest';
import { createEnterpriseRuntime, type EnterpriseRuntime } from '@neuropause/runtime';
import { ManualClock } from '@neuropause/cloud-core';
import { KnowledgeGovernance } from './governance';
import { EvidenceEngine } from './evidence';
import { DecisionStore } from './decisions';

async function setup(): Promise<{ runtime: EnterpriseRuntime; evidence: EvidenceEngine; decisions: DecisionStore; evId: string }> {
  const clock = new ManualClock(0);
  const runtime = createEnterpriseRuntime({ clock });
  const gov = new KnowledgeGovernance(runtime, clock);
  const evidence = new EvidenceEngine(clock, gov);
  const decisions = new DecisionStore(clock, gov, evidence);
  const ev = await evidence.record({ type: 'human-input', summary: 'stakeholders aligned', source: 'sam' });
  return { runtime, evidence, decisions, evId: ev.id };
}

describe('DecisionStore — evidence-bound and replayable', () => {
  it('refuses a decision with no evidence or unknown evidence', async () => {
    const { decisions } = await setup();
    await expect(
      decisions.propose({ purpose: 'p', context: 'c', alternatives: [{ label: 'A', chosen: true }], evidenceIds: [], owner: 'sam' }),
    ).rejects.toThrow(/at least one piece of evidence/);
    await expect(
      decisions.propose({ purpose: 'p', context: 'c', alternatives: [{ label: 'A', chosen: true }], evidenceIds: ['ev_ghost'], owner: 'sam' }),
    ).rejects.toThrow(/unknown evidence/);
  });

  it('requires a chosen alternative', async () => {
    const { decisions, evId } = await setup();
    await expect(
      decisions.propose({ purpose: 'p', context: 'c', alternatives: [{ label: 'A', chosen: false }], evidenceIds: [evId], owner: 'sam' }),
    ).rejects.toThrow(/chosen/);
  });

  it('runs the full governed lifecycle and replays it with provenance', async () => {
    const { runtime, decisions, evId } = await setup();
    const d = await decisions.propose({
      purpose: 'Adopt Postgres',
      context: 'scale needs',
      alternatives: [
        { label: 'Postgres', chosen: true, rationale: 'mature' },
        { label: 'Mongo', chosen: false, rationale: 'less relational' },
      ],
      evidenceIds: [evId],
      owner: 'sam',
      confidence: 0.8,
    });
    await decisions.decide(d.id, true, 'lead');
    await decisions.execute(d.id, 'migrated', 'sam');
    const replay = decisions.replay(d.id);
    expect(replay.timeline.map((e) => e.action)).toEqual(['proposed', 'approved', 'executed']);
    expect(replay.provenance).toHaveLength(1);
    expect(replay.decision.status).toBe('executed');
    expect(runtime.audit().verify().valid).toBe(true);
  });

  it('refuses to execute an unapproved decision', async () => {
    const { decisions, evId } = await setup();
    const d = await decisions.propose({ purpose: 'p', context: 'c', alternatives: [{ label: 'A', chosen: true }], evidenceIds: [evId], owner: 'sam' });
    await expect(decisions.execute(d.id, 'done', 'sam')).rejects.toThrow(/approved/);
  });
});
