/**
 * Phase 6 Stage 6 — performance bench (6.12 budgets, D-10), REAL timings at
 * 5 k entities / 5 k events:
 *   correlation ≤ 100 ms · health framework ≤ 100 ms · root cause ≤ 200 ms ·
 *   full dashboard compose ≤ 500 ms.
 * The numbers print so the implementation report can cite executed evidence.
 */
import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import type { ConnectorDto, Job, UnifiedEntity } from '@neuropause/shared';
import { buildEnterpriseGraph, correlateIncidents } from '@neuropause/shared';
import { initInsight, type InsightSubsystemDeps } from './index';
import type { RawTimelineEvent } from '../enterprise/intelligence/enterpriseIntelligenceSubsystem';
import { projectSignals, type ProjectionInput } from './signalProjection';
import { composeHealthFramework } from './healthFramework';

/** P13C Round 5 — the composed cache is tenant-keyed. */
const PLATFORM_SCOPE = { tenantId: 'org-test', workspaceId: 'ws-test' };
const scope = (): typeof PLATFORM_SCOPE => PLATFORM_SCOPE;

const T0 = Date.parse('2026-07-31T12:00:00.000Z');
const iso = (msAgo: number): string => new Date(T0 - msAgo).toISOString();

const N_ENTITIES = 5_000;
const N_EVENTS = 5_000;

function entities(): UnifiedEntity[] {
  const out: UnifiedEntity[] = [];
  for (let i = 0; i < N_ENTITIES; i += 1) {
    const isProject = i % 50 === 0;
    out.push({
      id: `e${i}`,
      kind: isProject ? 'project' : i % 3 === 0 ? 'task' : 'message',
      connectorId: 'slack',
      accountId: 'a1',
      sourceId: `s${i}`,
      createdAt: iso((i % 500) * 60_000),
      updatedAt: iso((i % 500) * 60_000),
      syncState: 'active',
      syncedAt: iso(60_000),
      metadata: {},
      title: `Entity ${i}`,
      url: null,
      parentId: null,
      containerId: isProject ? null : `e${Math.floor(i / 50) * 50}`,
      body: null,
      status: i % 7 === 0 ? 'completed' : 'open',
      author: null,
      timestamp: iso((i % 300) * 60_000),
      endTimestamp: i % 11 === 0 ? iso(3_600_000) : new Date(T0 + 86_400_000).toISOString(),
      labels: [],
    } as UnifiedEntity);
  }
  return out;
}

function timelineEvents(): RawTimelineEvent[] {
  const out: RawTimelineEvent[] = [];
  for (let i = 0; i < N_EVENTS; i += 1) {
    out.push({
      id: `evt${i}`,
      type: i % 9 === 0 ? 'automation.failed' : i % 4 === 0 ? 'worker.job_succeeded' : 'knowledge.entity_updated',
      timestamp: iso((i % 1_400) * 60_000),
      priority: i % 9 === 0 ? 'high' : 'normal',
      correlationId: `corr${i % 400}`,
      source: 'bench',
      resource: { type: 'record', id: `e${i % N_ENTITIES}`, name: `Entity ${i % N_ENTITIES}` },
    });
  }
  return out;
}

function jobs(): Job[] {
  const out: Job[] = [];
  for (let i = 0; i < 300; i += 1) {
    out.push({
      id: `job${i}`,
      workerId: `w${i % 6}`,
      workerRole: 'operations',
      skillId: 'skill',
      status: i % 10 === 0 ? 'awaiting_approval' : i % 7 === 0 ? 'failed' : 'succeeded',
      input: {},
      requestedBy: 'me',
      summary: null,
      evidence: [],
      proposals: [],
      logs: [],
      error: i % 7 === 0 ? 'boom' : null,
      grounded: true,
      createdAt: iso((i % 200) * 60_000),
      startedAt: iso((i % 200) * 60_000),
      finishedAt: i % 10 === 0 ? null : iso((i % 190) * 60_000),
      durationMs: 100,
    } as Job);
  }
  return out;
}

function connectors(): ConnectorDto[] {
  return ['slack', 'm365', 'github'].map(
    (id, i) =>
      ({
        id,
        name: id,
        provider: id,
        description: '',
        category: 'productivity',
        website: '',
        docsUrl: '',
        brandColor: '#000',
        version: '1',
        authType: 'oauth2_pkce',
        capabilities: [],
        scopes: [],
        multiAccount: false,
        configured: true,
        status: 'connected',
        health: i === 1 ? 'degraded' : 'healthy',
        accounts: [
          {
            id: `acc-${id}`,
            connectorId: id,
            label: `${id}@x.com`,
            externalId: null,
            avatarUrl: null,
            status: 'connected',
            health: i === 1 ? 'degraded' : 'healthy',
            grantedScopes: [],
            connectedAt: iso(86_400_000),
            lastSyncAt: iso(600_000),
            lastSyncState: 'success',
            accessTokenExpiresAt: null,
            error: null,
          },
        ],
        lastSyncAt: iso(600_000),
        setupHint: null,
        lifecycle: 'production',
      }) as ConnectorDto,
  );
}

function benchDeps(): InsightSubsystemDeps {
  const ents = entities();
  const evts = timelineEvents();
  const jbs = jobs();
  const conns = connectors();
  return {
    scope,
    getResourceModel: () => null,
    getRelationshipModel: () => null,
    getEvents: () => evts,
    entities: () => ents,
    jobs: () => jbs,
    executions: () => [],
    automationRuns: () =>
      Array.from({ length: 200 }, (_, i) => ({
        id: `run${i}`,
        ruleId: `r${i % 8}`,
        ruleName: `Rule ${i % 8}`,
        triggeredBy: 'schedule' as const,
        startedAt: iso((i % 300) * 60_000),
        completedAt: iso((i % 300) * 60_000),
        ok: i % 5 !== 0,
        durationMs: 50,
        actions: [],
        ...(i % 5 === 0 ? { error: 'boom' } : {}),
      })),
    automationRules: () =>
      Array.from({ length: 8 }, (_, i) => ({
        id: `r${i}`,
        name: `Rule ${i}`,
        status: 'active' as const,
        trigger: { type: 'connector-event' as const, connectorId: 'm365', event: 'message.received' },
        actions: [],
      })),
    connectors: () => conns,
    workers: () => Array.from({ length: 6 }, (_, i) => ({ id: `w${i}`, name: `Worker ${i}`, role: 'operations' })),
    conversations: () => Array.from({ length: 40 }, (_, i) => ({ id: `c${i}`, title: `Conv ${i}`, updatedAt: iso(60_000), waitingSteps: i % 9 === 0 ? 1 : 0 })),
    inbox: () => Array.from({ length: 150 }, (_, i) => ({ id: `n${i}`, sourceKey: 'work-complete', at: iso((i % 100) * 60_000), read: i % 2 === 0 })),
    orgHealth: () => ({ activity: 70, adoption: 60, engineering: 75, reliability: 80, aiUsage: 55, connectorHealth: 85, licenseHealth: 90, security: 70, operational: 72, overall: 73 }),
    orgUnits: () => ({ units: 5, leadershipCoverage: 0.8 }),
    workforceHealth: () => ({ totalWorkers: 6, healthy: 5, degraded: 1, unhealthy: 0, unknown: 0, meanSuccessRate: 0.88, totalJobsRun: 250, totalJobsFailed: 30, state: 'degraded' }),
    systemHealth: () => ({ score: 84, level: 'healthy' }),
    automationMonitor: () => ({ completed: 160, failed: 40, paused: 1, running: 0 }),
    healthHistory: () => Array.from({ length: 60 }, (_, i) => ({ day: new Date(T0 - (59 - i) * 86_400_000).toISOString().slice(0, 10), overall: 70 + (i % 9), engineering: 68 })),
    decisions: () => [],
    publish: () => undefined,
    registerSource: () => undefined,
    now: () => T0,
  };
}

describe('Stage 6 performance budgets (5k entities / 5k events)', () => {
  it('correlation ≤ 100 ms · health ≤ 100 ms · root cause ≤ 200 ms · dashboard ≤ 500 ms', () => {
    const deps = benchDeps();

    /* projection + graph once (shared fixture for the engine benches) */
    const projInput: ProjectionInput = {
      nowMs: T0,
      entities: deps.entities(),
      jobs: deps.jobs(),
      executions: [],
      automationRuns: deps.automationRuns(),
      automationRules: deps.automationRules(),
      connectors: deps.connectors(),
      conversations: deps.conversations(),
      inbox: deps.inbox(),
      workers: deps.workers(),
      failures: {},
    };
    const tProj0 = performance.now();
    const projection = projectSignals(projInput);
    const projMs = performance.now() - tProj0;

    const events = deps.getEvents('', 0).map((e) => ({
      id: e.id,
      type: e.type,
      ts: Date.parse(e.timestamp),
      severity: 'warning' as const,
      resourceId: e.resource?.id ?? null,
      correlationId: e.correlationId ?? null,
      source: 'bench',
      label: e.resource?.name ?? e.type,
    }));
    const model = buildEnterpriseGraph({ extraNodes: projection.extraNodes, extraEdges: projection.extraEdges }, T0);

    /* correlation budget */
    const tCorr0 = performance.now();
    const incidents = correlateIncidents({ events: [...events, ...projection.events], model }, T0);
    const corrMs = performance.now() - tCorr0;

    /* health budget */
    const tHealth0 = performance.now();
    const health = composeHealthFramework({
      nowMs: T0,
      org: deps.orgHealth(),
      orgUnits: deps.orgUnits(),
      projects: { projects: 100, openTasks: 1200, overdueTasks: 180 },
      workflows: { completed: 40, failed: 4 },
      automation: deps.automationMonitor(),
      workforce: deps.workforceHealth(),
      system: deps.systemHealth(),
      connectors: deps.connectors(),
      approvals: { pending: 30, oldestCreatedAt: iso(3 * 86_400_000) },
      historyDays: 60,
      failures: {},
    });
    const healthMs = performance.now() - tHealth0;

    /* full subsystem: dashboard + root cause budgets */
    const sub = initInsight(deps);
    const tDash0 = performance.now();
    const dashboard = sub.dashboard();
    const dashMs = performance.now() - tDash0;

    const rcHandler = sub.handlers.find((d) => String(d.channel) === 'insight:rootCause')!;
    const tRc0 = performance.now();
    const rc = rcHandler.handler({ targetResourceId: 'ops:automation:r0' }) as { builtAt: string };
    const rcMs = performance.now() - tRc0;

    // eslint-disable-next-line no-console
    console.log(
      `[stage6-bench] projection=${projMs.toFixed(1)}ms correlation=${corrMs.toFixed(1)}ms (${incidents.total} incidents) ` +
        `health=${healthMs.toFixed(1)}ms dashboard=${dashMs.toFixed(1)}ms (${dashboard.recommendations.length} recos) rootCause=${rcMs.toFixed(1)}ms`,
    );

    expect(incidents.total).toBeGreaterThan(0);
    expect(health.domains).toHaveLength(8);
    expect(rc.builtAt).toBeTruthy();
    expect(corrMs).toBeLessThanOrEqual(100);
    expect(healthMs).toBeLessThanOrEqual(100);
    expect(rcMs).toBeLessThanOrEqual(200);
    expect(dashMs).toBeLessThanOrEqual(500);
  });
});
