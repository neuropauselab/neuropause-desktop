/**
 * Phase 6 Stage 10 — the composition root: EXACTLY six read-only estrat:*
 * channels (requireAuth + strategy:read — the EXISTING P14 read scope; zero
 * mutation surface), the 3 s TTL cache, per-source failure isolation (an
 * explicit unavailable entry, never a fabricated value), the strategy-watch
 * source (governed ITEMS from critical/high focus recommendations, deduped),
 * the eleven-question assistant port, and dispose().
 */
import { describe, expect, it } from 'vitest';
import { IpcChannel, type IntelligenceItem, type StrategyDashboard, type StrategyHealthView } from '@neuropause/shared';
import { initStrategyPlatform, type StrategyPlatformDeps } from './index';

const T0 = Date.parse('2026-07-31T12:00:00.000Z');

interface Harness {
  deps: StrategyPlatformDeps;
  sources: string[];
  produceWatch: () => Promise<IntelligenceItem[]>;
  setNow: (ms: number) => void;
  kpiReads: () => number;
}

const MET = (targetId: string) => ({ targetId, status: 'met' as const, detail: `${targetId} within target` });

function mkDeps(over: Partial<StrategyPlatformDeps> = {}): Harness {
  let nowMs = T0;
  let kpiReads = 0;
  const sources: string[] = [];
  let produce: () => Promise<IntelligenceItem[]> = () => Promise.resolve([]);
  const deps: StrategyPlatformDeps = {
    insightDomains: () =>
      ['organization', 'departments', 'projects', 'workflows', 'automations', 'ai', 'connectors', 'approvals'].map((key) => ({
        key,
        band: 'healthy',
        score: 90,
      })),
    insightOverallBand: () => 'healthy',
    insightIncidents: () => [],
    insightOutcomes: () => [{ id: 'rec-1', stage: 'verified' }],
    executiveKpis: () => {
      kpiReads += 1;
      return [
        { key: 'org-health', label: 'Org health', display: '82', band: 'healthy' },
        { key: 'engineering-health', label: 'Engineering health', display: '78', band: 'healthy' },
        { key: 'ai-adoption', label: 'AI adoption', display: '64%', band: 'healthy' },
        { key: 'connector-health', label: 'Connector health', display: '100%', band: 'healthy' },
        { key: 'license-status', label: 'License', display: 'active' },
        { key: 'active-members', label: 'Members', display: '12' },
      ];
    },
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
      ].map(MET),
    readiness: () =>
      ['deployment', 'organization', 'connectors', 'automation', 'workforce', 'ai', 'governance'].map((key) => ({
        key,
        state: 'ready',
        detail: `${key} ready`,
        missing: [],
      })),
    s9Services: () =>
      ['execution-runtime', 'workforce-jobs', 'automation-rules', 'connector-fleet', 'ai-runtime', 'assistant-experience', 'notification-delivery'].map(
        (serviceId) => ({ serviceId, state: 'operational', stateDetail: 'measured healthy' }),
      ),
    capacityPressure: () => 'low',
    playbooks: () => [
      { id: 'daily-ops-review', version: 1 },
      { id: 'incident-first-response', version: 1 },
      { id: 'weekly-maintenance-review', version: 1 },
      { id: 'quarterly-ops-report', version: 1 },
    ],
    apFindings: () => [],
    knowledgeTotals: () => ({ assets: 24, findings: 0 }),
    knowledgeMatch: (refs) => refs.map((ref) => ({ ref, matched: ref === 'sop' })),
    p14Overview: () => ({ goalsOnTrack: 9, goalsTotal: 9, healthBand: 'healthy' }),
    decisions: () => [
      {
        id: 'dec-1',
        title: 'Adopt first-response playbook',
        category: 'operations',
        status: 'completed',
        expectedOutcome: 'Faster recovery.',
        businessImpact: 'Reliability.',
        fromRecommendationId: 'rec-1',
        createdAt: '2026-07-05T00:00:00.000Z',
        updatedAt: '2026-07-20T00:00:00.000Z',
      },
      {
        id: 'dec-2',
        title: 'Growth push',
        category: 'growth',
        status: 'completed',
        expectedOutcome: 'More pipeline.',
        businessImpact: 'Revenue motion.',
        fromRecommendationId: null,
        createdAt: '2026-07-06T00:00:00.000Z',
        updatedAt: '2026-07-21T00:00:00.000Z',
      },
    ],
    projects: () => [{ id: 'p1', title: 'Apollo', syncState: 'active', status: 'active' }],
    minedTypes: () => ['order_to_cash', 'procure_to_pay', 'make_to_complete'],
    compliance: () => [{ status: 'pass' }, { status: 'pass' }],
    units: () => [
      { id: 'u1', name: 'Operations', leadUserId: 'p1' },
      { id: 'u2', name: 'Engineering', leadUserId: null },
      { id: 'u3', name: 'AI Team', leadUserId: null },
      { id: 'u4', name: 'IT', leadUserId: null },
      { id: 'u5', name: 'Business', leadUserId: null },
      { id: 'u6', name: 'Legal', leadUserId: null },
      { id: 'u7', name: 'Support', leadUserId: null },
      { id: 'u8', name: 'Sales', leadUserId: null },
      { id: 'u9', name: 'Marketing', leadUserId: null },
      { id: 'u10', name: 'Finance', leadUserId: null },
    ],
    users: () => [{ id: 'p1', name: 'Ada' }],
    healthHistory: () => [
      { day: '2026-07-01', overall: 70, engineering: 65 },
      { day: '2026-07-20', overall: 80, engineering: 71 },
    ],
    registerSource: (source) => {
      sources.push(source.key);
      produce = () => source.produce() as Promise<IntelligenceItem[]>;
    },
    now: () => nowMs,
    ...over,
  };
  return {
    deps,
    sources,
    produceWatch: () => produce(),
    setNow: (ms) => {
      nowMs = ms;
    },
    kpiReads: () => kpiReads,
  };
}

describe('the IPC surface (D-9) — six read-only channels under the EXISTING strategy:read scope', () => {
  it('registers EXACTLY the six estrat:* channels, all requireAuth + strategy:read', () => {
    const p = initStrategyPlatform(mkDeps().deps);
    expect(p.handlers.map((d) => d.channel).sort()).toEqual(
      [
        IpcChannel.EstratObjectives,
        IpcChannel.EstratPortfolio,
        IpcChannel.EstratPlanning,
        IpcChannel.EstratHealth,
        IpcChannel.EstratDashboard,
        IpcChannel.EstratReport,
      ].sort(),
    );
    for (const d of p.handlers) {
      expect(String(d.channel).startsWith('estrat:'), String(d.channel)).toBe(true);
      expect(d.requireAuth, String(d.channel)).toBe(true);
      expect(d.permission, String(d.channel)).toBe('strategy:read');
    }
  });

  it('never touches the P14 strategy:* namespace and no channel name implies mutation', () => {
    const p = initStrategyPlatform(mkDeps().deps);
    for (const d of p.handlers) {
      expect(String(d.channel).startsWith('strategy:')).toBe(false);
      expect(String(d.channel)).not.toMatch(/save|set|run\b|delete|execute|create|update|cancel|convert/);
    }
  });

  it('the portfolio handler returns portfolio + business value together', async () => {
    const p = initStrategyPlatform(mkDeps().deps);
    const h = p.handlers.find((d) => d.channel === IpcChannel.EstratPortfolio)!.handler;
    const resp = (await h({})) as { portfolio: { initiatives: unknown[] }; value: { decisions: unknown[] } };
    expect(resp.portfolio.initiatives).toHaveLength(6);
    expect(resp.value.decisions).toHaveLength(2);
  });
});

describe('the composed views (healthy fixture)', () => {
  it('objectives all on-track; portfolio all done; capability map covers twelve; risks quiet', () => {
    const p = initStrategyPlatform(mkDeps().deps);
    expect(p.objectives().totals).toEqual({ onTrack: 11, atRisk: 0, offTrack: 0, unknown: 0 });
    expect(p.portfolio().totals.done).toBe(6);
    expect(p.capabilityMap().capabilities).toHaveLength(12);
    const health: StrategyHealthView = p.health();
    expect(health.risks.every((r) => !r.substantiated)).toBe(true);
    expect(health.layers.find((l) => l.layer === 'p14-strategy')!.state).toBe('on-track');
  });

  it('the dashboard and board report compose the same pass and carry the disclosures', () => {
    const p = initStrategyPlatform(mkDeps().deps);
    const d: StrategyDashboard = p.dashboard();
    expect(d.objectives.onTrack).toBe(11);
    expect(d.kpis).toHaveLength(6);
    expect(d.disclosures.length).toBe(3);
    expect(p.boardReport().sections.length).toBe(6);
    // A verified outcome + improving history → the operations decision delivered.
    expect(d.value.delivered).toBe(1);
  });
});

describe('the 3 s TTL cache', () => {
  it('reads within the TTL reuse one build; advancing the clock rebuilds', () => {
    const h = mkDeps();
    const p = initStrategyPlatform(h.deps);
    p.objectives();
    p.dashboard();
    p.health();
    expect(h.kpiReads()).toBe(1);
    h.setNow(T0 + 2_999);
    p.boardReport();
    expect(h.kpiReads()).toBe(1);
    h.setNow(T0 + 3_001);
    p.objectives();
    expect(h.kpiReads()).toBe(2);
  });

  it('dispose() drops the cache so the next read rebuilds', () => {
    const h = mkDeps();
    const p = initStrategyPlatform(h.deps);
    p.objectives();
    expect(h.kpiReads()).toBe(1);
    p.dispose();
    p.objectives();
    expect(h.kpiReads()).toBe(2);
  });
});

describe('failure isolation — explicit unavailability, never fabricated values', () => {
  it('a throwing source becomes an unavailable entry on the affected views; siblings stay computed', () => {
    const h = mkDeps({
      slaStatuses: () => {
        throw new Error('sla composition offline');
      },
    });
    const p = initStrategyPlatform(h.deps);
    const o = p.objectives();
    expect(o.unavailable.some((u) => u.system === 'sla-framework' && u.reason.includes('offline'))).toBe(true);
    // SLA-measured objectives degrade to unknown; KPI/domain-measured ones stay computed.
    expect(o.totals.unknown).toBeGreaterThan(0);
    expect(o.totals.onTrack).toBeGreaterThan(0);
    // The dashboard aggregates the declared miss exactly once.
    const d = p.dashboard();
    expect(d.unavailable.filter((u) => u.system === 'sla-framework')).toHaveLength(1);
  });

  it('a throwing P14 overview degrades ONLY the p14 layer (composed input, isolated)', () => {
    const h = mkDeps({
      p14Overview: () => {
        throw new Error('p14 offline');
      },
    });
    const p = initStrategyPlatform(h.deps);
    const health = p.health();
    expect(health.layers.find((l) => l.layer === 'p14-strategy')!.state).toBe('unknown');
    expect(health.layers.find((l) => l.layer === 'operations')!.state).toBe('on-track');
    expect(health.unavailable.some((u) => u.system === 'p14-strategy')).toBe(true);
  });

  it('a throwing knowledge join is probed up front and declared — capabilities read unmatched, never crash', () => {
    const h = mkDeps({
      knowledgeMatch: () => {
        throw new Error('knowledge join broken');
      },
    });
    const p = initStrategyPlatform(h.deps);
    const m = p.capabilityMap();
    expect(m.lackingStandards).toHaveLength(12);
    expect(m.unavailable.some((u) => u.system === 'knowledge-standards')).toBe(true);
  });
});

describe('the strategy-watch source — governed items, never actions', () => {
  it('registers exactly one source and stays quiet when nothing needs focus', async () => {
    const h = mkDeps();
    initStrategyPlatform(h.deps);
    expect(h.sources).toEqual(['strategy-watch']);
    expect(await h.produceWatch()).toEqual([]);
  });

  it('critical/high focus recommendations become governed items once (deduped across produces)', async () => {
    const h = mkDeps({
      slaStatuses: () =>
        [
          { targetId: 'exec-success-rate', status: 'breached' as const, detail: 'success 82% BREACHED' },
          { targetId: 'exec-avg-runtime', status: 'breached' as const, detail: 'runtime over bar' },
          ...['jobs-queue-depth', 'approval-age', 'automation-failure-ratio', 'connector-healthy-ratio', 'ai-engine-ready'].map(MET),
        ],
      insightDomains: () =>
        ['organization', 'departments', 'projects', 'workflows', 'automations', 'ai', 'connectors', 'approvals'].map((key) => ({
          key,
          band: key === 'workflows' ? 'at-risk' : 'healthy',
          score: key === 'workflows' ? 40 : 90,
        })),
    });
    initStrategyPlatform(h.deps);
    const items = await h.produceWatch();
    expect(items.length).toBeGreaterThan(0);
    for (const it_ of items) {
      expect(it_.id.startsWith('estrat:stratrec:')).toBe(true);
      expect(it_.governance?.evidence.length ?? 0).toBeGreaterThan(0);
      expect(it_.deepLink).toBe('strategy');
    }
    // Same conditions again → already delivered → no duplicates.
    expect(await h.produceWatch()).toEqual([]);
  });
});

describe('the assistant port — eleven questions, sync, same composed pass', () => {
  it('routes a matched question to a grounded intelligence report; unmatched → null', () => {
    const p = initStrategyPlatform(mkDeps().deps);
    const r = p.answerQuestion('Which business capability is weakest?', new Date(T0).toISOString());
    expect(r?.kind).toBe('intelligence');
    expect(r?.grounded).toBe(true);
    expect(p.answerQuestion('draft an email', new Date(T0).toISOString())).toBeNull();
  });

  it('the board brief answer reflects the live composition', () => {
    const p = initStrategyPlatform(mkDeps().deps);
    const r = p.answerQuestion('Prepare the board brief', new Date(T0).toISOString())!;
    expect(r.title).toContain('board brief');
    expect(r.sections.length).toBeGreaterThan(0);
  });
});
