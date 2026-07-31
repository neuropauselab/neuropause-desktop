/**
 * Phase 6 Stage 6 — predictive intelligence (D-4): every heuristic fires on
 * its real, stated condition and stays SILENT otherwise; every prediction
 * carries evidence ids, a horizon, a basis, and a confidence breakdown;
 * insufficient history means no prediction — never a guess.
 */
import { describe, expect, it } from 'vitest';
import type { AutomationRunRecord, Job } from '@neuropause/shared';
import { buildPredictions, type PredictionInput } from './predictions';

const NOW = Date.parse('2026-07-31T12:00:00.000Z');
const iso = (msAgo: number): string => new Date(NOW - msAgo).toISOString();
const day = (daysAgo: number): string => new Date(NOW - daysAgo * 86_400_000).toISOString().slice(0, 10);

function quiet(): PredictionInput {
  return {
    nowMs: NOW,
    healthHistory: null,
    jobs: null,
    automationRuns: null,
    connectors: null,
    projects: null,
    recentEventCount: null,
  };
}

function awaitingJob(id: string, ageMs: number): Job {
  return {
    id,
    workerId: 'w',
    workerRole: 'operations',
    skillId: 's',
    status: 'awaiting_approval',
    input: {},
    requestedBy: 'me',
    summary: null,
    evidence: [],
    proposals: [],
    logs: [],
    error: null,
    grounded: true,
    createdAt: iso(ageMs),
    startedAt: null,
    finishedAt: null,
    durationMs: null,
  } as Job;
}

function run(id: string, ok: boolean): AutomationRunRecord {
  return {
    id,
    ruleId: 'r1',
    ruleName: 'Sync invoices',
    triggeredBy: 'schedule',
    startedAt: iso(3_600_000),
    completedAt: iso(3_500_000),
    ok,
    durationMs: 50,
    actions: [],
    ...(ok ? {} : { error: 'graph 401' }),
  };
}

describe('silence without evidence', () => {
  it('all-null inputs produce zero predictions', () => {
    expect(buildPredictions(quiet())).toEqual([]);
  });

  it('below-threshold conditions stay silent (no guessing)', () => {
    const out = buildPredictions({
      ...quiet(),
      jobs: [awaitingJob('j1', 3_600_000)], // 1 fresh approval — below the ≥3 + >2d rule
      projects: { projects: 2, openTasks: 20, overdueTasks: 2 }, // 10% < 25%
      automationRuns: [run('a', true), run('b', true), run('c', false), run('d', true)], // <5 runs
      healthHistory: [{ day: day(1), overall: 80 }, { day: day(0), overall: 80 }], // <3 points
      recentEventCount: 12,
      connectors: [],
    });
    expect(out).toEqual([]);
  });
});

describe('each heuristic fires on its stated condition with evidence + horizon', () => {
  it('approval backlog: ≥3 parked with one >2 days old', () => {
    const out = buildPredictions({
      ...quiet(),
      jobs: [awaitingJob('j1', 3 * 86_400_000), awaitingJob('j2', 3_600_000), awaitingJob('j3', 3_600_000)],
    });
    const p = out.find((x) => x.kind === 'approval-backlog')!;
    expect(p.evidence).toContain('j1');
    expect(p.horizonDays).toBe(7);
    expect(p.basis).toContain('parked approvals ≥3');
    expect(p.likelihood).toBeGreaterThan(0.4);
    expect(p.confidence.overall).toBeGreaterThan(0);
    expect(p.signals).toEqual(['workforce-jobs']);
  });

  it('project delay: overdue share ≥25% of ≥5 open tasks', () => {
    const out = buildPredictions({ ...quiet(), projects: { projects: 2, openTasks: 12, overdueTasks: 4 } });
    const p = out.find((x) => x.kind === 'project-delay')!;
    expect(p.title).toContain('33%');
    expect(p.evidence).toContain('tasks.overdue=4');
  });

  it('connector instability: degraded/down or account error', () => {
    const out = buildPredictions({
      ...quiet(),
      connectors: [
        { id: 'm365', name: 'Microsoft 365', health: 'degraded', configured: true, accounts: [{ error: null } as never] },
        { id: 'slack', name: 'Slack', health: 'healthy', configured: true, accounts: [{ error: null } as never] },
      ],
    });
    const p = out.find((x) => x.kind === 'connector-instability')!;
    expect(p.evidence).toEqual(['connector:m365=degraded']);
    expect(p.horizonDays).toBe(3);
  });

  it('automation failure: per-rule failure rate ≥40% over ≥5 runs, evidencing the failed run ids', () => {
    const runs = [run('a', false), run('b', false), run('c', true), run('d', false), run('e', true)];
    const out = buildPredictions({ ...quiet(), automationRuns: runs });
    const p = out.find((x) => x.kind === 'automation-failure')!;
    expect(p.id).toBe('pred:automation-failure:r1');
    expect(p.title).toContain('60%');
    expect(p.evidence).toEqual(['a', 'b', 'd']);
    expect(p.suggestedAction).toContain('graph 401');
  });

  it('inactivity: zero events in the trailing week', () => {
    const out = buildPredictions({ ...quiet(), recentEventCount: 0 });
    const p = out.find((x) => x.kind === 'inactivity')!;
    expect(p.evidence).toEqual(['timeline.recentEventCount=0']);
  });

  it('operational drift: current more than 1σ below the window mean', () => {
    const history = [80, 82, 81, 79, 80, 81, 60].map((overall, i) => ({ day: day(6 - i), overall }));
    const out = buildPredictions({ ...quiet(), healthHistory: history });
    const p = out.find((x) => x.kind === 'operational-drift')!;
    expect(p.evidence.some((e) => e.startsWith('health:'))).toBe(true);
    expect(p.basis).toContain('1σ');
  });

  it('risk trend: ≥5-point weekly decline with majority-declining days', () => {
    const history = [85, 82, 80, 78, 76, 74, 72].map((overall, i) => ({ day: day(6 - i), overall }));
    const out = buildPredictions({ ...quiet(), healthHistory: history });
    const p = out.find((x) => x.kind === 'risk-trend')!;
    expect(p.title).toContain('13');
    expect(p.confidence.historicalCoverage).toBeCloseTo(7 / 90, 2);
  });

  it('a steady healthy history fires neither drift nor trend', () => {
    const history = [80, 81, 80, 82, 81, 80, 81].map((overall, i) => ({ day: day(6 - i), overall }));
    const out = buildPredictions({ ...quiet(), healthHistory: history });
    expect(out.find((x) => x.kind === 'operational-drift' || x.kind === 'risk-trend')).toBeUndefined();
  });
});
