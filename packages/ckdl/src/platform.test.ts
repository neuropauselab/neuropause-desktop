import { describe, it, expect } from 'vitest';
import { createEnterpriseRuntime } from '@neuropause/runtime';
import { ManualClock, type CloudEvent } from '@neuropause/cloud-core';
import { createKnowledgeLayer } from './index';

describe('createKnowledgeLayer (integration)', () => {
  it('runs an evidence-bound, governed, replayable decision end-to-end', async () => {
    const clock = new ManualClock(0);
    const runtime = createEnterpriseRuntime({ clock });
    const ckdl = createKnowledgeLayer(runtime, { clock });

    const events: string[] = [];
    runtime.events().subscribe('ckdl.activity', (e: CloudEvent) => void events.push((e.payload as { action: string }).action));

    // graph of references (no copies) + a first-class relationship
    await ckdl.knowledgeGraph().register({ kind: 'project', id: 'p1', label: 'Launch' });
    await ckdl.knowledgeGraph().register({ kind: 'task', id: 't1', label: 'Pick datastore' });
    await ckdl.relationships().relate({ kind: 'project', id: 'p1' }, { kind: 'task', id: 't1' }, 'contributes-to');

    // evidence → decision (evidence enforced) → approve → execute
    const ev = await ckdl.evidence().record({ type: 'human-input', summary: 'review complete', source: 'sam', about: { kind: 'task', id: 't1' } });
    const decision = await ckdl.decisions().propose({
      purpose: 'Choose Postgres',
      context: 'scale',
      alternatives: [{ label: 'pg', chosen: true, rationale: 'mature' }],
      evidenceIds: [ev.id],
      owner: 'sam',
      linkedTasks: [{ kind: 'task', id: 't1' }],
    });
    await ckdl.decisions().decide(decision.id, true, 'lead');
    await ckdl.decisions().execute(decision.id, 'chosen', 'sam');

    // governed on the ONE audit chain + bus + timeline
    expect(runtime.audit().verify().valid).toBe(true);
    expect(events).toEqual(expect.arrayContaining(['register.project', 'record.human-input', 'propose', 'approve', 'execute']));
    expect(runtime.timeline().all().some((e) => e.type === 'ckdl.activity')).toBe(true);

    // replayable: exact lifecycle + provenance
    const replay = ckdl.decisions().replay(decision.id);
    expect(replay.timeline.map((e) => e.action)).toEqual(['proposed', 'approved', 'executed']);
    expect(replay.provenance[0]?.source).toBe('sam');

    // decision graph view exposes the links
    expect(ckdl.decisionGraph().node(decision.id)?.linkedTaskKeys).toEqual(['task:t1']);
  });

  it('constitutional search enriches an existing match with governed context', async () => {
    const clock = new ManualClock(0);
    const ckdl = createKnowledgeLayer(createEnterpriseRuntime({ clock }), { clock });
    await ckdl.knowledgeGraph().register({ kind: 'task', id: 't1', label: 'Pick datastore' });
    await ckdl.evidence().record({ type: 'metric', summary: 'p95 fine', source: 'metrics', about: { kind: 'task', id: 't1' } });
    const ev = await ckdl.evidence().record({ type: 'human-input', summary: 'ok', source: 'sam' });
    await ckdl.decisions().propose({
      purpose: 'p',
      context: 'c',
      alternatives: [{ label: 'A', chosen: true }],
      evidenceIds: [ev.id],
      owner: 'sam',
      linkedTasks: [{ kind: 'task', id: 't1' }],
    });
    const [result] = ckdl.search().enrich([{ kind: 'task', id: 't1' }]);
    expect(result?.label).toBe('Pick datastore');
    expect(result?.evidenceCount).toBe(1); // evidence "about" this task
    expect(result?.decisionIds).toHaveLength(1); // a decision links this task
    expect(result?.trust?.band).toBeDefined(); // trust indicator attached
  });

  it('exposes the full knowledge-layer API', () => {
    const ckdl = createKnowledgeLayer(createEnterpriseRuntime({ clock: new ManualClock(0) }), { clock: new ManualClock(0) });
    expect(ckdl.version).toContain('preview');
    for (const fn of [
      ckdl.knowledgeGraph,
      ckdl.decisionGraph,
      ckdl.objectives,
      ckdl.evidence,
      ckdl.trust,
      ckdl.relationships,
      ckdl.decisions,
      ckdl.analysis,
      ckdl.search,
      ckdl.governance,
    ]) {
      expect(typeof fn).toBe('function');
    }
  });
});
