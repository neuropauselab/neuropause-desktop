/**
 * P7 — Drift (merged multi-domain), Capacity, Root Cause + Incident correlation, Recommendation synthesis, and the
 * full `composeEnterpriseIntelligence` report + the subsystem's event mapping. Pure-node.
 */
import { describe, expect, it } from 'vitest';
import {
  analyzeRootCause,
  buildEnterpriseGraph,
  buildResourceGraph,
  buildEnterpriseRecommendations,
  capacityKpis,
  composeEnterpriseIntelligence,
  computeEnterpriseCapacity,
  computeEnterpriseDrift,
  computeEnterpriseHealth,
  computeEnterpriseRisk,
  correlateIncidents,
  diffDomain,
  analyzeDependencies,
  makeResource,
  makeResourceId,
  type CloudResource,
  type CorrelationEvent,
  type InfrastructureDomain,
} from '@neuropause/shared';
import { toCorrelationEvent } from './enterpriseIntelligenceSubsystem';


const NOW = '2026-07-14T00:00:00.000Z';
const NOW_MS = Date.parse(NOW);
function res(nativeId: string, opts: { domain?: InfrastructureDomain; type?: string; health?: CloudResource['health']; deps?: string[]; attributes?: Record<string, string | number | boolean | null> } = {}): CloudResource {
  return makeResource({ platformId: 'aws', provider: 'aws', accountId: 'acct', domain: opts.domain ?? 'compute', resourceType: opts.type ?? 'instance', region: null, now: NOW, nativeId, name: nativeId, health: opts.health ?? 'healthy', attributes: opts.attributes ?? {}, relationships: (opts.deps ?? []).map((d) => ({ type: 'depends_on', targetId: d })) });
}

describe('computeEnterpriseDrift (merged)', () => {
  it('diffs a permission domain and merges it with a precomputed infra domain', () => {
    const perm = diffDomain('permission', [{ key: 'role:admin', signature: 'a,b,c' }], [{ key: 'role:admin', signature: 'a,b' }, { key: 'role:rogue', signature: 'x' }]);
    expect(perm.find((i) => i.key === 'role:admin')!.status).toBe('drifted');
    expect(perm.find((i) => i.key === 'role:rogue')!.status).toBe('unmanaged');
    const report = computeEnterpriseDrift([
      { domain: 'infrastructure', items: [{ key: 'i-1', label: 'i-1', domain: 'infrastructure', status: 'in_sync', detail: '', risk: 0 }] },
      { domain: 'permission', items: perm },
    ], NOW_MS);
    expect(report.totalItems).toBe(3);
    expect(report.totalDrifted).toBe(2);
    expect(report.driftScore).toBe(33); // 1 of 3 in sync
    expect(report.domains.map((d) => d.domain).sort()).toEqual(['infrastructure', 'permission']);
    expect(report.severity).toBeGreaterThan(0); // permission drift is weighted high
  });
});

describe('computeEnterpriseCapacity', () => {
  it('detects pressure nodes, cost, and growth', () => {
    const resources = [
      res('hot', { attributes: { utilization: 95 } }),
      res('warm', { attributes: { utilization: 40 } }),
      res('costly', { attributes: { cost: 5000 } }),
    ];
    const report = computeEnterpriseCapacity({ resources, previousResourceCount: 2 }, NOW_MS);
    expect(report.pressureNodes[0].label).toBe('hot');
    expect(report.pressureNodes[0].pressure).toBe('critical');
    expect(report.costTotal).toBe(5000);
    expect(report.growth.delta).toBe(1);
    expect(report.recommendations.length).toBeGreaterThan(0);
    expect(capacityKpis(report)[0].key).toBe('enterprise.capacity.pressure');
  });
});

describe('analyzeRootCause + correlateIncidents', () => {
  const dbId = makeResourceId('aws', 'acct', 'database', 'db');
  const webId = makeResourceId('aws', 'acct', 'instance', 'web');
  const model = buildEnterpriseGraph({ resource: buildResourceGraph({ resources: [res('web', { deps: ['db'] }), res('db', { domain: 'databases', type: 'database', health: 'critical' })] }, NOW_MS) }, NOW_MS);
  const events: CorrelationEvent[] = [
    { id: 'e1', type: 'infrastructure.failed', ts: NOW_MS - 120000, severity: 'critical', resourceId: dbId, correlationId: 'c1', source: 'infra', label: 'db' },
    { id: 'e2', type: 'infrastructure.degraded', ts: NOW_MS - 30000, severity: 'warning', resourceId: webId, correlationId: 'c1', source: 'infra', label: 'web' },
  ];

  it('traces the symptom on web to its upstream dependency db, with confidence', () => {
    const rc = analyzeRootCause({ events, model, targetResourceId: webId }, NOW_MS);
    expect(rc.symptom?.resourceId).toBe(webId);
    expect(rc.candidates[0].resourceId).toBe(dbId); // db is upstream + earlier + critical
    expect(rc.candidates[0].reason).toContain('upstream');
    expect(rc.confidence).toBeGreaterThan(0);
  });

  it('returns an EMPTY report (not an unrelated symptom) when the target resource has no events', () => {
    const rc = analyzeRootCause({ events, model, targetResourceId: makeResourceId('aws', 'acct', 'instance', 'ghost') }, NOW_MS);
    expect(rc.symptom).toBeNull();
    expect(rc.candidates).toHaveLength(0);
    expect(rc.confidence).toBe(0);
  });

  it('correlates the events into one incident with root cause + blast-radius impact', () => {
    const report = correlateIncidents({ events, model }, NOW_MS);
    expect(report.incidents).toHaveLength(1);
    const inc = report.incidents[0];
    expect(inc.severity).toBe('critical');
    expect(inc.correlationId).toBe('c1');
    expect(inc.rootCause?.resourceId).toBe(dbId);
    expect(inc.recommendedActions.length).toBeGreaterThan(0);
  });
});

describe('buildEnterpriseRecommendations', () => {
  it('synthesizes ranked recommendations across engines', () => {
    const m = buildEnterpriseGraph({ resource: buildResourceGraph({ resources: [res('db', { domain: 'databases', type: 'database', health: 'critical' }), res('a', { deps: ['db'] }), res('b', { deps: ['db'] }), res('c', { deps: ['db'] }), res('d', { deps: ['db'] }), res('e', { deps: ['db'] }) ] }, NOW_MS) }, NOW_MS);
    const dependencies = analyzeDependencies(m, NOW_MS);
    const risk = computeEnterpriseRisk({ model: m, dependencies }, NOW_MS);
    const health = computeEnterpriseHealth({ model: m, risk, dependencies }, NOW_MS);
    const drift = computeEnterpriseDrift([], NOW_MS);
    const capacity = computeEnterpriseCapacity({ resources: [] }, NOW_MS);
    const incidents = correlateIncidents({ events: [], model: m }, NOW_MS);
    const recs = buildEnterpriseRecommendations({ health, risk, dependencies, drift, capacity, incidents }, NOW_MS);
    expect(recs.length).toBeGreaterThan(0);
    expect(recs.some((r) => r.category === 'dependency')).toBe(true); // db is a SPOF with 5 dependents
    // sorted by priority
    const rank = { critical: 4, high: 3, medium: 2, low: 1 } as const;
    for (let i = 1; i < recs.length; i++) expect(rank[recs[i - 1].priority]).toBeGreaterThanOrEqual(rank[recs[i].priority]);
  });
});

describe('composeEnterpriseIntelligence', () => {
  it('runs every engine into one report with KPIs + recommendations', () => {
    const resource = buildResourceGraph({ resources: [res('web', { deps: ['db'] }), res('db', { domain: 'databases', type: 'database', health: 'critical' })] }, NOW_MS);
    const report = composeEnterpriseIntelligence({ resource, events: [{ id: 'x', type: 'infrastructure.failed', ts: NOW_MS, severity: 'critical', resourceId: makeResourceId('aws', 'acct', 'database', 'db'), correlationId: null, source: 'infra', label: 'db' }] }, NOW_MS);
    expect(report.graph.nodes).toBe(2);
    expect(report.health.scores).toHaveLength(7);
    expect(report.risk.categories).toHaveLength(6);
    expect(report.kpis.length).toBeGreaterThan(5);
    expect(report.generatedAt).toBe(NOW);
  });

  it('is stable + non-throwing on an empty enterprise', () => {
    const report = composeEnterpriseIntelligence({}, NOW_MS);
    expect(report.graph.nodes).toBe(0);
    expect(report.health.byKey.availability).toBe(100);
    expect(report.incidents.total).toBe(0);
  });
});

describe('toCorrelationEvent', () => {
  it('maps priority + type onto severity', () => {
    expect(toCorrelationEvent({ id: 'a', type: 'infrastructure.action_failed', timestamp: NOW }).severity).toBe('critical');
    expect(toCorrelationEvent({ id: 'b', type: 'connector.sync_degraded', timestamp: NOW, priority: 'high' }).severity).toBe('warning');
    expect(toCorrelationEvent({ id: 'c', type: 'enterprise.record.created', timestamp: NOW }).severity).toBe('info');
    expect(toCorrelationEvent({ id: 'd', type: 'x', timestamp: NOW, resource: { id: 'r1', name: 'Res One' } }).resourceId).toBe('r1');
  });
});
