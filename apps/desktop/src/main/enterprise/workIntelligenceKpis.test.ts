/**
 * P2.5 — Enterprise Work Intelligence executive KPI derivers.
 *
 * Both are pure functions of an existing subsystem's output. These verify the
 * automation success rate (and its no-runs / banding behavior) and the unified
 * knowledge-graph size/connectivity KPI.
 */
import { describe, expect, it } from 'vitest';
import { automationSuccessKpi, knowledgeGraphKpi } from './workIntelligenceKpis';

describe('automationSuccessKpi', () => {
  it('computes the confirmed success rate and bands it', () => {
    const kpi = automationSuccessKpi({ completed: 18, failed: 2, paused: 0, running: 1 });
    expect(kpi.value).toBe(90);
    expect(kpi.display).toBe('90% (18/20)');
    expect(kpi.band).toBe('healthy');
  });

  it('drops to at-risk / critical as failures rise', () => {
    expect(automationSuccessKpi({ completed: 6, failed: 4, paused: 0, running: 0 }).band).toBe('at-risk'); // 60%
    expect(automationSuccessKpi({ completed: 2, failed: 8, paused: 0, running: 0 }).band).toBe('critical'); // 20%
  });

  it('reports "no runs yet" with a null value when nothing has run', () => {
    const kpi = automationSuccessKpi({ completed: 0, failed: 0, paused: 0, running: 0 });
    expect(kpi.value).toBeNull();
    expect(kpi.display).toBe('no runs yet');
  });
});

describe('knowledgeGraphKpi', () => {
  it('summarizes unified graph size + connectivity', () => {
    const kpi = knowledgeGraphKpi({ nodes: 120, edges: 200 });
    expect(kpi.display).toBe('120 entities · 200 links');
    expect(kpi.band).toBe('healthy'); // density 1.67 ≥ 1
    expect(kpi.value).toBeNull(); // a count, not a 0..100 score
  });

  it('is on watch when sparse or empty', () => {
    expect(knowledgeGraphKpi({ nodes: 100, edges: 20 }).band).toBe('watch'); // density 0.2
    expect(knowledgeGraphKpi({ nodes: 0, edges: 0 }).band).toBe('watch');
  });
});
