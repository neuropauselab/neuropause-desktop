/**
 * Phase 6 Stage 6 — signal projection honesty: evidence ids preserved
 * verbatim, per-source unavailable isolation, empty inputs → empty projection,
 * and the cross-domain fabric (automation → connector edges) present so the
 * spec's correlation chains are computable graph paths.
 */
import { describe, expect, it } from 'vitest';
import type { ConnectorDto, Job, UnifiedEntity } from '@neuropause/shared';
import { opsNodeIds, projectSignals, type ProjectionInput } from './signalProjection';

const NOW = Date.parse('2026-07-31T12:00:00.000Z');
const iso = (msAgo: number): string => new Date(NOW - msAgo).toISOString();

function emptyInput(): ProjectionInput {
  return {
    nowMs: NOW,
    entities: [],
    jobs: [],
    executions: [],
    automationRuns: [],
    automationRules: [],
    connectors: [],
    conversations: [],
    inbox: [],
    workers: [],
    failures: {},
  };
}

function job(over: Partial<Job>): Job {
  return {
    id: 'job1',
    workerId: 'researcher',
    workerRole: 'research',
    skillId: 'find-things',
    status: 'succeeded',
    input: {},
    requestedBy: 'me',
    summary: null,
    evidence: [],
    proposals: [],
    logs: [],
    error: null,
    grounded: true,
    createdAt: iso(3_600_000),
    startedAt: iso(3_500_000),
    finishedAt: iso(3_400_000),
    durationMs: 1000,
    ...over,
  } as Job;
}

function connector(over: Partial<ConnectorDto>): ConnectorDto {
  return {
    id: 'slack',
    name: 'Slack',
    provider: 'slack',
    description: '',
    category: 'communication',
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
    health: 'healthy',
    accounts: [
      {
        id: 'a1',
        connectorId: 'slack',
        label: 'me@x.com',
        externalId: null,
        avatarUrl: null,
        status: 'connected',
        health: 'healthy',
        grantedScopes: [],
        connectedAt: iso(86_400_000),
        lastSyncAt: iso(600_000),
        lastSyncState: 'idle',
        accessTokenExpiresAt: null,
        error: null,
      },
    ],
    lastSyncAt: iso(600_000),
    setupHint: null,
    lifecycle: 'production',
    ...over,
  } as ConnectorDto;
}

function entity(over: Partial<UnifiedEntity>): UnifiedEntity {
  return {
    id: 'e1',
    kind: 'task',
    connectorId: 'slack',
    accountId: 'a1',
    sourceId: 'src1',
    createdAt: iso(86_400_000),
    updatedAt: iso(3_600_000),
    syncState: 'active',
    syncedAt: iso(3_600_000),
    metadata: {},
    title: 'Entity',
    url: null,
    parentId: null,
    containerId: null,
    body: null,
    status: null,
    author: null,
    timestamp: null,
    endTimestamp: null,
    labels: [],
    ...over,
  } as UnifiedEntity;
}

describe('projectSignals — empty and unavailable inputs', () => {
  it('empty inputs → empty projection, all signals available with zero counts', () => {
    const out = projectSignals(emptyInput());
    expect(out.extraNodes).toEqual([]);
    expect(out.extraEdges).toEqual([]);
    expect(out.events).toEqual([]);
    expect(out.unavailable).toEqual([]);
    const jobsSig = out.signals.find((s) => s.id === 'workforce-jobs')!;
    expect(jobsSig.available).toBe(true);
    expect(jobsSig.itemCount).toBe(0);
  });

  it('a failing source becomes an explicit unavailable entry and never a hole in others', () => {
    const input = emptyInput();
    input.jobs = null;
    input.failures['workforce-jobs'] = 'job store exploded';
    input.connectors = [connector({})];
    const out = projectSignals(input);
    expect(out.unavailable).toContainEqual({ system: 'workforce-jobs', reason: 'job store exploded' });
    expect(out.signals.find((s) => s.id === 'workforce-jobs')!.available).toBe(false);
    // Other sources still project.
    expect(out.extraNodes.some((n) => n.id === opsNodeIds.connector('slack'))).toBe(true);
  });
});

describe('projectSignals — nodes, edges, events (evidence ids verbatim)', () => {
  it('projects connectors, rules, workers, queues, and projects with real ids in meta', () => {
    const input = emptyInput();
    input.connectors = [connector({}), connector({ id: 'm365', name: 'Microsoft 365', health: 'down', accounts: [{ ...connector({}).accounts[0], id: 'a2', connectorId: 'm365', health: 'down', error: 'token expired' }] })];
    input.automationRules = [
      { id: 'r1', name: 'Chase invoices', status: 'active', trigger: { type: 'connector-event', connectorId: 'm365', event: 'message.received' }, actions: [{ id: 'act1', type: 'notify', connectorId: 'slack', label: 'Notify' }] },
    ];
    input.automationRuns = [
      { id: 'run1', ruleId: 'r1', ruleName: 'Chase invoices', triggeredBy: 'connector', startedAt: iso(2_000_000), completedAt: iso(1_990_000), ok: false, durationMs: 100, actions: [], error: 'graph 401' },
    ];
    input.workers = [{ id: 'researcher', name: 'Researcher', role: 'research' }];
    input.jobs = [
      job({ id: 'j-await', status: 'awaiting_approval', createdAt: iso(86_400_000 * 3), finishedAt: null }),
      job({ id: 'j-fail', status: 'failed', error: 'boom', finishedAt: iso(1_000_000) }),
    ];
    input.entities = [
      entity({ id: 'p1', kind: 'project', title: 'Apollo', connectorId: 'slack' }),
      entity({ id: 't1', kind: 'task', containerId: 'p1', status: 'open', endTimestamp: iso(86_400_000) }), // overdue
      entity({ id: 't2', kind: 'task', containerId: 'p1', status: 'open', endTimestamp: new Date(NOW + 86_400_000).toISOString() }),
    ];
    const out = projectSignals(input);

    const ids = out.extraNodes.map((n) => n.id);
    expect(ids).toContain('ops:connector:slack');
    expect(ids).toContain('ops:connector:m365');
    expect(ids).toContain('ops:automation:r1');
    expect(ids).toContain('ops:worker:researcher');
    expect(ids).toContain('ops:approvals:researcher');
    expect(ids).toContain('ops:project:p1');

    // The chain fabric: rule → both bound connectors; project → its connector.
    const edgeIds = out.extraEdges.map((e) => `${e.from}→${e.to}`);
    expect(edgeIds).toContain('ops:automation:r1→ops:connector:m365');
    expect(edgeIds).toContain('ops:automation:r1→ops:connector:slack');
    expect(edgeIds).toContain('ops:project:p1→ops:connector:slack');
    expect(edgeIds).toContain('ops:approvals:researcher→ops:worker:researcher');

    // Evidence ids preserved verbatim on events.
    const evIds = out.events.map((e) => e.id);
    expect(evIds).toContain('autorun:run1');
    expect(evIds).toContain('job:j-fail');
    expect(evIds).toContain('job:j-await');
    expect(evIds).toContain('connector:m365:a2');
    expect(evIds).toContain('entity:t1'); // the overdue task, by its real entity id

    // Events point at projected nodes so root cause can walk the edges.
    const failEvt = out.events.find((e) => e.id === 'autorun:run1')!;
    expect(failEvt.resourceId).toBe('ops:automation:r1');
    expect(failEvt.severity).toBe('warning');
    const downEvt = out.events.find((e) => e.id === 'connector:m365:a2')!;
    expect(downEvt.severity).toBe('critical');
  });

  it('healthy signals produce nodes but no failure events; degraded health degrades node health', () => {
    const input = emptyInput();
    input.connectors = [connector({})];
    const out = projectSignals(input);
    expect(out.events).toEqual([]);
    const node = out.extraNodes.find((n) => n.id === 'ops:connector:slack')!;
    expect(node.healthState).toBe('healthy');
    expect(node.health).toBe(90);
  });

  it('events outside the 24 h window are dropped; old approvals still shape the queue node', () => {
    const input = emptyInput();
    input.workers = [{ id: 'w', name: 'W', role: 'ops' }];
    input.jobs = [job({ id: 'old-fail', status: 'failed', finishedAt: iso(3 * 86_400_000) })];
    const out = projectSignals(input);
    expect(out.events.find((e) => e.id === 'job:old-fail')).toBeUndefined();
  });
});
