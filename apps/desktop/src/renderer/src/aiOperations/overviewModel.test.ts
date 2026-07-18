import { describe, it, expect } from 'vitest';
import { EMPTY_LENS, type OpLens } from './aiOperationsModel';
import {
  LOOP_ORDER,
  operatingLoop,
  summarizeOrchestration,
  summarizeMemory,
  type OpsTab,
} from './overviewModel';

const lensWith = (stat: OpLens['stats'][number], gaps = 0): OpLens => ({
  stats: [stat],
  groups: [],
  gaps: Array.from({ length: gaps }, (_, i) => ({ capability: `g${i}`, requires: 'x' })),
  links: [],
});

describe('operatingLoop', () => {
  it('emits one stage per LOOP_ORDER entry, in order', () => {
    const stages = operatingLoop({});
    expect(stages).toHaveLength(LOOP_ORDER.length);
    expect(stages.map((s) => s.key)).toEqual(LOOP_ORDER.map((l) => l.key));
  });

  it('uses the first stat as headline and counts gaps', () => {
    const lenses: Partial<Record<OpsTab, OpLens>> = {
      planning: lensWith({ icon: 'checklist', label: 'Plans', value: '3', tone: 'green' }, 2),
    };
    const plan = operatingLoop(lenses).find((s) => s.key === 'planning')!;
    expect(plan.headline).toBe('Plans: 3');
    expect(plan.gaps).toBe(2);
    expect(plan.tone).toBe('green');
  });

  it('shows an honest empty headline and gray tone when a lens is absent', () => {
    const reason = operatingLoop({}).find((s) => s.key === 'reasoning')!;
    expect(reason.headline).toBe('No live data yet');
    expect(reason.tone).toBe('gray');
    expect(reason.gaps).toBe(0);
  });
});

describe('summarizeOrchestration', () => {
  it('derives real orchestrator/flow/success/bottleneck signals', () => {
    const lens = summarizeOrchestration({
      orchestration: { orchestrators: [{}, {}], flows: [{}] },
      workforce: { overallSuccessRate: 0.9, execution: { totals: { total: 10, failed: 1 } }, bottlenecks: [{}] },
    });
    expect(lens.stats.find((s) => s.label === 'Orchestrators')?.value).toBe('2');
    expect(lens.stats.find((s) => s.label === 'Coordination flows')?.value).toBe('1');
    expect(lens.stats.find((s) => s.label === 'Delegated success rate')?.value).toBe('90%');
    expect(lens.stats.find((s) => s.label === 'Bottlenecks')?.value).toBe('1');
  });

  it('is honest when empty but always lists gaps and reuse links', () => {
    const lens = summarizeOrchestration({});
    expect(lens.stats.find((s) => s.label === 'Orchestrators')?.value).toBe('0');
    expect(lens.stats.some((s) => s.label === 'Delegated success rate')).toBe(false); // no rate when no signal
    expect(lens.gaps).toHaveLength(4);
    expect(lens.links?.map((l) => l.section)).toEqual(['orchestration-center', 'workforce-center']);
  });
});

describe('summarizeMemory', () => {
  it('derives real memory/graph counts', () => {
    const lens = summarizeMemory({ memory: { total: 42, lastBuiltAt: '2026-01-01' }, graph: { nodes: 10, edges: 20 } });
    expect(lens.stats.find((s) => s.label === 'Memory items')?.value).toBe('42');
    expect(lens.stats.find((s) => s.label === 'Graph nodes')?.value).toBe('10');
    expect(lens.stats.find((s) => s.label === 'Graph edges')?.value).toBe('20');
  });

  it('is honest when empty but always lists gaps and reuse links', () => {
    const lens = summarizeMemory({});
    expect(lens.stats.find((s) => s.label === 'Memory items')?.value).toBe('0');
    expect(lens.gaps).toHaveLength(2);
    expect(lens.links?.map((l) => l.section)).toEqual(['knowledge', 'knowledge-center']);
  });

  it('EMPTY_LENS sanity (shared contract)', () => {
    expect(EMPTY_LENS.gaps).toEqual([]);
  });
});
