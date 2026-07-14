/**
 * P7 — the Risk Engine (unifies infra + business + identity + dependency risk into 6 normalized categories) and
 * the global Health Engine (the 7 mission scores: health, risk, confidence, availability, security, performance,
 * compliance). Pure-node.
 */
import { describe, expect, it } from 'vitest';
import {
  analyzeDependencies,
  buildEnterpriseGraph,
  buildResourceGraph,
  computeEnterpriseHealth,
  computeEnterpriseRisk,
  healthKpis,
  makeResource,
  riskKpis,
  type CloudResource,
  type InfrastructureDomain,
} from '@neuropause/shared';

const NOW = '2026-07-14T00:00:00.000Z';
const NOW_MS = Date.parse(NOW);
function res(nativeId: string, domain: InfrastructureDomain, health: CloudResource['health'], deps: string[] = []): CloudResource {
  return makeResource({ platformId: 'aws', provider: 'aws', accountId: 'acct', domain, resourceType: 't', region: null, now: NOW, nativeId, name: nativeId, health, relationships: deps.map((d) => ({ type: 'depends_on', targetId: d })) });
}
function model() {
  const resource = buildResourceGraph({ resources: [
    res('web', 'compute', 'healthy', ['db']),
    res('api', 'compute', 'healthy', ['db']),
    res('db', 'databases', 'critical'),
    res('gw', 'networking', 'degraded'),
    res('iam', 'identity', 'degraded'),
    res('kms', 'security', 'critical'),
  ] }, NOW_MS);
  return buildEnterpriseGraph({ resource }, NOW_MS);
}

describe('computeEnterpriseRisk', () => {
  it('produces all six normalized risk categories with contributors', () => {
    const m = model();
    const risk = computeEnterpriseRisk({ model: m, dependencies: analyzeDependencies(m, NOW_MS) }, NOW_MS);
    expect(risk.categories.map((c) => c.category).sort()).toEqual(['business', 'dependency', 'identity', 'infrastructure', 'operational', 'security'].sort());
    expect(risk.byCategory.infrastructure).toBeGreaterThan(0); // db critical lifts infra risk
    expect(risk.byCategory.security).toBeGreaterThan(0); // kms critical lifts security risk
    expect(risk.overall).toBeGreaterThan(0);
    expect(risk.confidence).toBeGreaterThan(0);
    expect(risk.confidence).toBeLessThanOrEqual(1);
    expect(riskKpis(risk)[0].key).toBe('enterprise.risk.overall');
  });

  it('lifts dependency risk from SPOFs + drift severity', () => {
    const m = model();
    const withDrift = computeEnterpriseRisk({ model: m, dependencies: analyzeDependencies(m, NOW_MS), driftSeverity: 80 }, NOW_MS);
    expect(withDrift.byCategory.dependency).toBeGreaterThanOrEqual(80);
  });
});

describe('computeEnterpriseHealth', () => {
  it('derives the 7 scores; risk mirrors the risk engine; availability reflects the health mix', () => {
    const m = model();
    const dependencies = analyzeDependencies(m, NOW_MS);
    const risk = computeEnterpriseRisk({ model: m, dependencies }, NOW_MS);
    const health = computeEnterpriseHealth({ model: m, risk, dependencies }, NOW_MS);
    expect(health.scores.map((s) => s.key).sort()).toEqual(['availability', 'compliance', 'confidence', 'health', 'performance', 'risk', 'security'].sort());
    expect(health.byKey.risk).toBe(risk.overall);
    expect(health.byKey.availability).toBeGreaterThan(0);
    expect(health.byKey.availability).toBeLessThan(100); // 2 unhealthy of 6
    expect(health.overall).toBeGreaterThan(0);
    expect(health.overall).toBeLessThanOrEqual(100);
    expect(healthKpis(health)).toHaveLength(7);
  });

  it('is fully healthy when every node is healthy', () => {
    const resource = buildResourceGraph({ resources: [res('a', 'compute', 'healthy'), res('b', 'compute', 'healthy')] }, NOW_MS);
    const m = buildEnterpriseGraph({ resource }, NOW_MS);
    const risk = computeEnterpriseRisk({ model: m }, NOW_MS);
    const health = computeEnterpriseHealth({ model: m, risk }, NOW_MS);
    expect(health.byKey.availability).toBe(100);
    expect(health.band).toBe('healthy');
  });
});
