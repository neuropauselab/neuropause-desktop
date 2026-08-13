/**
 * Phase 6 Stage 6 — the insight composition root, exercised Electron-free
 * through injected ports: TTL caching, per-source unavailable isolation, the
 * end-to-end correlation chain (connector failure → automation failure →
 * computed incident with cited evidence), the insight.* event chain
 * (edge-triggered, `ins_…` correlation ids), monitor sources producing
 * governed ITEMS only, the verification loop, and the five read-only handlers.
 */
import { describe, expect, it } from 'vitest';
import type { AutomationRunRecord, ConnectorDto, InsightReport, Job } from '@neuropause/shared';
import { IpcChannel } from '@neuropause/shared';
import { initInsight, type InsightSubsystemDeps } from './index';
import type { RawTimelineEvent } from '../enterprise/intelligence/enterpriseIntelligenceSubsystem';

/**
 * P13C ROUND 5 — the composed cache is tenant-keyed, so these suites name a
 * tenant. Every existing TTL and memoization assertion keeps its meaning:
 * repeated reads under ONE tenant must still be a single composition.
 */
const PLATFORM_SCOPE = { tenantId: 'org-test', workspaceId: 'ws-test' };
const scope = (): typeof PLATFORM_SCOPE => PLATFORM_SCOPE;

const T0 = Date.parse('2026-07-31T12:00:00.000Z');
const iso = (msAgo: number): string => new Date(T0 - msAgo).toISOString();

interface Harness {
  deps: InsightSubsystemDeps;
  published: { type: string; correlationId?: string; metadata?: Record<string, unknown> }[];
  registered: string[];
  produce: (key: string) => unknown;
  state: {
    nowMs: number;
    connectors: ConnectorDto[];
    automationRuns: AutomationRunRecord[];
    jobs: Job[];
    events: RawTimelineEvent[];
    jobsThrow: boolean;
  };
}

function connectorDown(): ConnectorDto {
  return {
    id: 'm365',
    name: 'Microsoft 365',
    provider: 'microsoft',
    description: '',
    category: 'productivity',
    website: '',
    docsUrl: '',
    brandColor: '#000',
    version: '1',
    authType: 'oauth2_confidential',
    capabilities: [],
    scopes: [],
    multiAccount: true,
    configured: true,
    status: 'error',
    health: 'down',
    accounts: [
      {
        id: 'a1',
        connectorId: 'm365',
        label: 'ops@x.com',
        externalId: null,
        avatarUrl: null,
        status: 'error',
        health: 'down',
        grantedScopes: [],
        connectedAt: iso(86_400_000),
        lastSyncAt: iso(1_800_000),
        lastSyncState: 'error',
        accessTokenExpiresAt: null,
        error: 'token expired',
      },
    ],
    lastSyncAt: iso(1_800_000),
    setupHint: null,
    lifecycle: 'production',
  } as ConnectorDto;
}

function failedRun(id: string): AutomationRunRecord {
  return {
    id,
    ruleId: 'r1',
    ruleName: 'Invoice sync',
    triggeredBy: 'schedule',
    startedAt: iso(1_200_000),
    completedAt: iso(1_190_000),
    ok: false,
    durationMs: 40,
    actions: [],
    error: 'graph 401',
  };
}

function mkHarness(): Harness {
  const published: Harness['published'] = [];
  const registered: string[] = [];
  const sources = new Map<string, () => unknown>();
  const state: Harness['state'] = {
    nowMs: T0,
    connectors: [connectorDown()],
    automationRuns: [failedRun('run1'), failedRun('run2'), failedRun('run3'), failedRun('run4'), failedRun('run5')],
    jobs: [],
    events: [],
    jobsThrow: false,
  };
  const deps: InsightSubsystemDeps = {
  scope,
    getResourceModel: () => null,
    getRelationshipModel: () => null,
    getEvents: () => state.events,
    entities: () => [],
    jobs: () => {
      if (state.jobsThrow) throw new Error('job store exploded');
      return state.jobs;
    },
    executions: () => [],
    automationRuns: () => state.automationRuns,
    automationRules: () => [
      { id: 'r1', name: 'Invoice sync', status: 'active', trigger: { type: 'connector-event', connectorId: 'm365', event: 'message.received' }, actions: [] },
    ],
    connectors: () => state.connectors,
    workers: () => [],
    conversations: () => [],
    inbox: () => [],
    orgHealth: () => null,
    orgUnits: () => null,
    workforceHealth: () => null,
    systemHealth: () => null,
    automationMonitor: () => ({ completed: 0, failed: 5, paused: 0, running: 0 }),
    healthHistory: () => [],
    decisions: () => [],
    publish: (e) => published.push({ type: e.type, ...(e.correlationId ? { correlationId: e.correlationId } : {}), ...(e.metadata ? { metadata: e.metadata } : {}) }),
    registerSource: (s) => {
      registered.push(s.key);
      sources.set(s.key, () => s.produce());
    },
    now: () => state.nowMs,
  };
  return { deps, published, registered, produce: (key) => sources.get(key)!(), state };
}

describe('initInsight — composition + caching', () => {
  it('registers exactly the five read-only insight channels + two delivery sources', () => {
    const h = mkHarness();
    const sub = initInsight(h.deps);
    expect(sub.handlers.map((d) => d.channel).sort()).toEqual(
      [IpcChannel.InsightReport, IpcChannel.InsightRootCause, IpcChannel.InsightHealth, IpcChannel.InsightPredictions, IpcChannel.InsightDashboard].sort(),
    );
    for (const d of sub.handlers) {
      expect(d.permission).toBe('intelligence:read');
      expect(d.requireAuth).toBe(true);
    }
    expect(h.registered).toEqual(['insight-monitor', 'insight-risk-trend']);
  });

  it('caches for 3 s (same object), rebuilds after the TTL', () => {
    const h = mkHarness();
    const sub = initInsight(h.deps);
    const a = sub.report();
    h.state.nowMs = T0 + 1_000;
    expect(sub.report()).toBe(a);
    h.state.nowMs = T0 + 4_000;
    expect(sub.report()).not.toBe(a);
  });

  it('a throwing port becomes an explicit unavailable signal; the rest still compose', () => {
    const h = mkHarness();
    h.state.jobsThrow = true;
    const sub = initInsight(h.deps);
    const r = sub.report();
    expect(r.unavailable.some((u) => u.system === 'workforce-jobs' && u.reason.includes('exploded'))).toBe(true);
    expect(r.signals.find((s) => s.id === 'workforce-jobs')!.available).toBe(false);
    expect(r.signals.find((s) => s.id === 'connector-health')!.available).toBe(true);
    expect(r.health.domains).toHaveLength(8);
  });
});

describe('the correlation chain (the spec example, computed)', () => {
  it('connector failure + automation failures correlate into an incident with verbatim evidence ids', () => {
    const h = mkHarness();
    const sub = initInsight(h.deps);
    const r: InsightReport = sub.report();
    // Projected graph: rule → connector edge exists, both nodes present.
    expect(r.graph.projectedNodes).toBeGreaterThanOrEqual(2);
    expect(r.graph.projectedEdges).toBeGreaterThanOrEqual(1);
    expect(r.graph.projectedEvents).toBeGreaterThanOrEqual(6); // 1 connector + 5 runs
    // Incidents cite the real record ids.
    expect(r.incidents.length).toBeGreaterThan(0);
    const allEventIds = r.incidents.flatMap((i) => i.eventIds);
    expect(allEventIds).toContain('connector:m365:a1');
    expect(allEventIds.some((id) => id.startsWith('autorun:run'))).toBe(true);
    // A recommendation exists and traces to signals via the dependency graph.
    expect(r.recommendations.length).toBeGreaterThan(0);
    const recoNode = r.dependencies.nodes.find((n) => n.kind === 'recommendation');
    expect(recoNode).toBeTruthy();
    expect(r.dependencies.edges.some((e) => e.from.startsWith('signal:') && e.relation === 'evidence-of')).toBe(true);
  });

  it('targeted root cause over the projected graph ranks the connector as upstream of the automation', () => {
    const h = mkHarness();
    const sub = initInsight(h.deps);
    sub.report();
    // symptom: the automation rule node — its upstream is the m365 connector.
    const handler = sub.handlers.find((d) => d.channel === IpcChannel.InsightRootCause)!;
    const rc = handler.handler({ targetResourceId: 'ops:automation:r1' }) as { candidates: { resourceId: string | null }[] };
    expect(rc.candidates.length).toBeGreaterThan(0);
    expect(rc.candidates.some((c) => c.resourceId === 'ops:connector:m365')).toBe(true);
  });
});

describe('insight.* chain events (edge-triggered, ins_ correlation ids)', () => {
  it('publishes detected/recommended/approval_requested once per id, all under ins_ chains', () => {
    const h = mkHarness();
    const sub = initInsight(h.deps);
    sub.report();
    const types = h.published.map((e) => e.type);
    expect(types).toContain('insight.detected');
    expect(types).toContain('insight.recommended');
    expect(types).toContain('insight.approval_requested');
    for (const e of h.published) expect(e.correlationId).toMatch(/^ins_/);
    // Edge-triggered: a second build publishes nothing new for the same findings.
    const count = h.published.length;
    h.state.nowMs = T0 + 5_000;
    sub.report();
    expect(h.published.length).toBe(count);
  });

  it('verification loop: a cleared condition publishes insight.outcome_verified and lands in the dashboard', () => {
    const h = mkHarness();
    const sub = initInsight(h.deps);
    sub.report();
    // The connector recovers and the automation stops failing.
    h.state.connectors = [{ ...connectorDown(), health: 'healthy', status: 'connected', accounts: [] } as ConnectorDto];
    h.state.automationRuns = [];
    h.state.nowMs = T0 + 10_000;
    sub.report();
    const verified = h.published.filter((e) => e.type === 'insight.outcome_verified');
    expect(verified.length).toBeGreaterThan(0);
    const dash = sub.dashboard();
    expect(dash.recentlyVerified.length).toBeGreaterThan(0);
  });
});

describe('monitoring sources (D-6) — governed items, never actions', () => {
  it('insight-monitor produces items for new critical/high recommendations, once, with governance', () => {
    const h = mkHarness();
    initInsight(h.deps);
    const items = h.produce('insight-monitor') as { id: string; priority: string; governance?: { evidence: string[]; recommendedAction: string } }[];
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(['high', 'critical']).toContain(item.priority);
      expect(item.governance?.evidence.length).toBeGreaterThan(0);
      expect(item.governance?.recommendedAction).toBeTruthy();
    }
    // Same recommendations → no re-delivery flood.
    expect(h.produce('insight-monitor')).toEqual([]);
  });

  it('insight-risk-trend is silent when health is fine and no trend prediction fires', () => {
    const h = mkHarness();
    h.state.connectors = [];
    h.state.automationRuns = [];
    initInsight(h.deps);
    expect(h.produce('insight-risk-trend')).toEqual([]);
  });

  it('the subsystem exposes no execution surface (read-only by construction)', () => {
    const h = mkHarness();
    const sub = initInsight(h.deps);
    expect(Object.keys(sub).sort()).toEqual(['answerQuestion', 'dashboard', 'dispose', 'handlers', 'report']);
    for (const d of sub.handlers) {
      // Every handler is a pure read: invoking it twice mutates nothing observable.
      const first = JSON.stringify(d.handler({} as never));
      expect(JSON.stringify(d.handler({} as never))).toBe(first);
    }
  });
});

describe('the assistant port', () => {
  it('answers a matched question with an intelligence report and returns null otherwise', () => {
    const h = mkHarness();
    const sub = initInsight(h.deps);
    const answer = sub.answerQuestion('show operational anomalies', new Date(T0).toISOString());
    expect(answer).not.toBeNull();
    expect(answer!.kind).toBe('intelligence');
    expect(answer!.sections.length).toBeGreaterThan(0);
    expect(sub.answerQuestion('draft an email to sam', new Date(T0).toISOString())).toBeNull();
  });
});
