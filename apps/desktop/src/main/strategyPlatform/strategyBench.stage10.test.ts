/**
 * Phase 6 Stage 10 — composition budgets (D-10), measured over a realistic
 * seeded fixture AFTER a warmup pass (the Stage 8/9 bench pattern):
 * objectives / portfolio / planning / health builds ≤ 100 ms each; the full
 * dashboard and the board report ≤ 500 ms. The 3 s TTL amortizes production
 * reads; the bench disables it by advancing the injected clock.
 */
import { describe, expect, it } from 'vitest';
import { initStrategyPlatform, type StrategyPlatformDeps } from './index';

const T0 = Date.parse('2026-07-31T12:00:00.000Z');

function mkDeps(): { deps: StrategyPlatformDeps; tick: () => void } {
  let nowMs = T0;
  // Realistic volume: 90 history days, 60 decisions, 250 projects.
  const history = Array.from({ length: 90 }, (_, i) => ({
    day: new Date(Date.UTC(2026, 4, 2 + i)).toISOString().slice(0, 10),
    overall: 70 + (i % 11),
    engineering: 65 + (i % 9),
  }));
  const decisions = Array.from({ length: 60 }, (_, i) => ({
    id: `dec-${i}`,
    title: `Decision ${i}`,
    category: ['engineering', 'organization', 'governance', 'operations', 'growth', 'other'][i % 6],
    status: ['completed', 'in_progress', 'accepted', 'rejected'][i % 4],
    expectedOutcome: 'Outcome.',
    businessImpact: 'Impact.',
    fromRecommendationId: i % 3 === 0 ? `rec-${i}` : null,
    createdAt: new Date(T0 - i * 86_400_000).toISOString(),
    updatedAt: new Date(T0).toISOString(),
  }));
  const outcomes = decisions
    .filter((d) => d.fromRecommendationId)
    .map((d, i) => ({ id: d.fromRecommendationId as string, stage: (['recommended', 'approved', 'executed', 'verified'] as const)[i % 4] }));
  const projects = Array.from({ length: 250 }, (_, i) => ({
    id: `p-${i}`,
    title: `Project ${i}`,
    syncState: i % 5 === 0 ? 'archived' : 'active',
    status: 'active',
  }));
  const deps: StrategyPlatformDeps = {
    insightDomains: () =>
      ['organization', 'departments', 'projects', 'workflows', 'automations', 'ai', 'connectors', 'approvals'].map((key, i) => ({
        key,
        band: i % 3 === 0 ? 'watch' : 'healthy',
        score: 60 + i,
      })),
    insightOverallBand: () => 'healthy',
    insightIncidents: () => [{ domain: 'connectors', severity: 'warning' }],
    insightOutcomes: () => outcomes,
    executiveKpis: () => [
      { key: 'org-health', label: 'Org health', display: '82', band: 'healthy' },
      { key: 'engineering-health', label: 'Engineering health', display: '71', band: 'watch' },
      { key: 'ai-adoption', label: 'AI adoption', display: '64%', band: 'healthy' },
      { key: 'connector-health', label: 'Connector health', display: '85%', band: 'watch' },
      { key: 'license-status', label: 'License', display: 'active' },
      { key: 'active-members', label: 'Members', display: '12' },
    ],
    slaStatuses: () =>
      [
        'exec-success-rate',
        'exec-avg-runtime',
        'jobs-queue-depth',
        'approval-age',
        'automation-failure-ratio',
        'connector-healthy-ratio',
        'ai-engine-ready',
        'assistant-response-latency',
        'notification-latency',
      ].map((targetId, i) => ({
        targetId,
        status: (i % 4 === 0 ? 'breached' : i % 5 === 0 ? 'unmeasurable' : 'met') as 'met' | 'breached' | 'unmeasurable',
        detail: `${targetId} measured`,
      })),
    readiness: () =>
      ['deployment', 'organization', 'connectors', 'automation', 'workforce', 'ai', 'governance'].map((key, i) => ({
        key,
        state: i % 3 === 0 ? 'degraded' : 'ready',
        detail: `${key} assessed`,
        missing: i % 3 === 0 ? ['one gap'] : [],
      })),
    s9Services: () =>
      ['execution-runtime', 'workforce-jobs', 'automation-rules', 'connector-fleet', 'ai-runtime', 'assistant-experience', 'notification-delivery'].map(
        (serviceId, i) => ({ serviceId, state: i % 4 === 0 ? 'degraded' : 'operational', stateDetail: 'measured' }),
      ),
    capacityPressure: () => 'high',
    playbooks: () => [
      { id: 'daily-ops-review', version: 2 },
      { id: 'incident-first-response', version: 1 },
      { id: 'weekly-maintenance-review', version: 1 },
      { id: 'quarterly-ops-report', version: 1 },
    ],
    apFindings: () => [
      { kind: 'stuck-execution', severity: 'critical' },
      { kind: 'failed-run', severity: 'high' },
      { kind: 'awaiting-approval', severity: 'medium' },
    ],
    knowledgeTotals: () => ({ assets: 40, findings: 3 }),
    knowledgeMatch: (refs) => refs.map((ref) => ({ ref, matched: ref.length % 2 === 0 })),
    p14Overview: () => ({ goalsOnTrack: 6, goalsTotal: 9, healthBand: 'watch' }),
    decisions: () => decisions,
    projects: () => projects,
    minedTypes: () => ['order_to_cash', 'procure_to_pay'],
    compliance: () => [{ status: 'pass' }, { status: 'warn' }, { status: 'pass' }],
    units: () =>
      ['Product & Engineering', 'Engineering', 'Platform Team', 'AI Team', 'Design', 'Business', 'Sales', 'Marketing', 'Finance', 'Legal', 'Operations', 'IT', 'Support'].map(
        (name, i) => ({ id: `u-${i}`, name, leadUserId: i % 2 === 0 ? `p-${i}` : null }),
      ),
    users: () => Array.from({ length: 13 }, (_, i) => ({ id: `p-${i}`, name: `Person ${i}` })),
    healthHistory: () => history,
    registerSource: () => {},
    now: () => nowMs,
  };
  return { deps, tick: () => (nowMs += 10_000) };
}

function measure(fn: () => unknown): number {
  const started = performance.now();
  fn();
  return performance.now() - started;
}

describe('composition budgets (D-10) — measured, after warmup', () => {
  it('objectives / portfolio / planning / health cold builds ≤ 100 ms; dashboard / board ≤ 500 ms', () => {
    const { deps, tick } = mkDeps();
    const p = initStrategyPlatform(deps);
    p.dashboard(); // warmup pass (module + JIT)

    tick();
    const objectives = measure(() => p.objectives()); // cold build (fresh TTL window)
    tick();
    const portfolio = measure(() => p.portfolio());
    tick();
    const planning = measure(() => p.planning());
    tick();
    const health = measure(() => p.health());
    tick();
    const dashboard = measure(() => p.dashboard());
    tick();
    const board = measure(() => p.boardReport());

    expect(objectives, `objectives build ${objectives.toFixed(1)}ms`).toBeLessThanOrEqual(100);
    expect(portfolio, `portfolio build ${portfolio.toFixed(1)}ms`).toBeLessThanOrEqual(100);
    expect(planning, `planning build ${planning.toFixed(1)}ms`).toBeLessThanOrEqual(100);
    expect(health, `health build ${health.toFixed(1)}ms`).toBeLessThanOrEqual(100);
    expect(dashboard, `dashboard build ${dashboard.toFixed(1)}ms`).toBeLessThanOrEqual(500);
    expect(board, `board report build ${board.toFixed(1)}ms`).toBeLessThanOrEqual(500);
  });

  it('a warm read (inside the TTL) is near-instant (≤ 20 ms)', () => {
    const { deps, tick } = mkDeps();
    const p = initStrategyPlatform(deps);
    tick();
    p.dashboard(); // build
    const warm = measure(() => p.dashboard());
    expect(warm, `warm read ${warm.toFixed(1)}ms`).toBeLessThanOrEqual(20);
  });
});
