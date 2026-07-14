/**
 * P7 — the unified Enterprise Graph + Dependency Intelligence + Change-Impact Intelligence: merging the Resource
 * Graph + ERP Relationship Graph into one model with cross-domain edges, Tarjan cycle detection, SPOF /
 * bottleneck / failure-chain ranking, and blast-radius change impact grouped by domain. Pure-node.
 */
import { describe, expect, it } from 'vitest';
import {
  analyzeChangeImpact,
  analyzeDependencies,
  buildEnterpriseGraph,
  buildResourceGraph,
  makeResource,
  makeResourceId,
  type CloudResource,
  type InfrastructureDomain,
  type RelationshipGraphModel,
  type ResourceGraphModel,
} from '@neuropause/shared';

const NOW = '2026-07-14T00:00:00.000Z';
const NOW_MS = Date.parse(NOW);

function res(nativeId: string, opts: { domain?: InfrastructureDomain; type?: string; health?: CloudResource['health']; deps?: string[]; attributes?: Record<string, string | number | boolean | null> } = {}): CloudResource {
  return makeResource({
    platformId: 'aws', provider: 'aws', accountId: 'acct', domain: opts.domain ?? 'compute', resourceType: opts.type ?? 'instance',
    region: null, now: NOW, nativeId, name: nativeId, health: opts.health ?? 'healthy', attributes: opts.attributes ?? {},
    relationships: (opts.deps ?? []).map((d) => ({ type: 'depends_on', targetId: d })),
  });
}
const rid = (nativeId: string, type = 'instance'): string => `res:${makeResourceId('aws', 'acct', type, nativeId)}`;
const rg = (resources: CloudResource[]): ResourceGraphModel => buildResourceGraph({ resources }, NOW_MS);

describe('buildEnterpriseGraph', () => {
  it('merges the Resource Graph + ERP Relationship Graph into ONE model with cross-domain classification', () => {
    const resource = rg([res('web', { deps: ['db'] }), res('db', { domain: 'databases', type: 'database', health: 'critical' })]);
    const relationship = { nodes: [{ id: 'cust-1', kind: 'customer', key: 'c1', label: 'Acme', detail: '', master: true, resolved: true, inDegree: 0, outDegree: 0, degree: 0, value: 5000, activity: 3, risk: 70, health: 'weak', lastUpdated: NOW }], edges: [] } as unknown as RelationshipGraphModel;
    const model = buildEnterpriseGraph({ resource, relationship }, NOW_MS);
    expect(model.nodes).toHaveLength(3);
    expect(model.byDomain.infrastructure).toBe(2);
    expect(model.byDomain.crm).toBe(1);
    const db = model.nodes.find((n) => n.label === 'db')!;
    expect(db.healthState).toBe('critical');
    expect(db.risk).toBeGreaterThan(50); // critical health → high risk
  });
});

describe('analyzeDependencies', () => {
  it('detects a dependency cycle (Tarjan SCC)', () => {
    const resource = rg([res('a', { deps: ['b'] }), res('b', { deps: ['a'] })]);
    const dep = analyzeDependencies(buildEnterpriseGraph({ resource }, NOW_MS), NOW_MS);
    expect(dep.cyclic).toBe(true);
    expect(dep.cycles[0].size).toBe(2);
  });

  it('ranks a shared dependency as the top single point of failure', () => {
    const resource = rg([res('db', { domain: 'databases', type: 'database' }), res('web', { deps: ['db'] }), res('api', { deps: ['db'] }), res('worker', { deps: ['db'] })]);
    const dep = analyzeDependencies(buildEnterpriseGraph({ resource }, NOW_MS), NOW_MS);
    expect(dep.spofs[0].id).toBe(rid('db', 'database'));
    expect(dep.spofs[0].blastRadius).toBe(3); // web, api, worker transitively depend on db
  });

  it('finds a failure chain (longest dependency path)', () => {
    const resource = rg([res('a', { deps: ['b'] }), res('b', { deps: ['c'] }), res('c', { deps: ['d'] }), res('d')]);
    const dep = analyzeDependencies(buildEnterpriseGraph({ resource }, NOW_MS), NOW_MS);
    expect(dep.failureChains[0].length).toBe(4);
  });
});

describe('ERP edge direction (regression: no inverted business SPOF)', () => {
  it('imports ERP relationship edges as non-directional so a leaf payment is never ranked a SPOF', () => {
    const n = (id: string, kind: string, risk: number) => ({ id, kind, key: id, label: id, detail: '', master: kind === 'customer', resolved: true, inDegree: 0, outDegree: 0, degree: 1, value: 1000, activity: 1, risk, health: 'healthy', lastUpdated: NOW });
    const e = (from: string, to: string) => ({ id: `${from}-${to}`, from, to, type: 'links', direction: 'out', confidence: 1, weight: 1, count: 1, strength: 1, activity: 1, risk: 0, health: 'healthy', lastUpdated: NOW });
    // O2C chain customer→order→invoice→payment (ERP orients master→transaction; naively importing as depends_on
    // would rank the leaf payment as the top SPOF).
    const relationship = { nodes: [n('cust', 'customer', 70), n('ord', 'order', 20), n('inv', 'invoice', 40), n('pay', 'payment', 10)], edges: [e('cust', 'ord'), e('ord', 'inv'), e('inv', 'pay')] } as unknown as RelationshipGraphModel;
    const model = buildEnterpriseGraph({ relationship }, NOW_MS);
    expect(model.edges.length).toBe(3);
    expect(model.edges.every((x) => x.category === 'relates')).toBe(true); // non-directional
    const dep = analyzeDependencies(model, NOW_MS);
    expect(dep.spofs).toHaveLength(0); // no inverted business SPOF
    expect(dep.cyclic).toBe(false);
  });
});

describe('failure chains (regression: memo not poisoned by the cycle guard)', () => {
  it('computes the true longest chain for a later root even when an earlier root pruned a back-edge', () => {
    // r→a→b→c, c→a (cycle), c→d, s→c. From s the true longest chain is s→c→a→b (length 4).
    const resource = rg([res('r', { deps: ['a'] }), res('a', { deps: ['b'] }), res('b', { deps: ['c'] }), res('c', { deps: ['a', 'd'] }), res('d'), res('s', { deps: ['c'] })]);
    const dep = analyzeDependencies(buildEnterpriseGraph({ resource }, NOW_MS), NOW_MS);
    const sChain = dep.failureChains.find((c) => c.path[0] === rid('s'));
    expect(sChain?.length).toBe(4); // was 3 (truncated [s,c,d]) before the taint fix
    expect(dep.cyclic).toBe(true); // a-b-c cycle still detected
  });
});

describe('analyzeChangeImpact', () => {
  it('computes the blast radius of a change grouped by domain + a confidence', () => {
    const resource = rg([res('db', { domain: 'databases', type: 'database' }), res('web', { deps: ['db'] }), res('api', { deps: ['db'] })]);
    const model = buildEnterpriseGraph({ resource }, NOW_MS);
    const impact = analyzeChangeImpact(model, rid('db', 'database'), NOW_MS);
    expect(impact.blastRadius).toBe(2);
    expect(impact.directDependents).toBe(2);
    expect(impact.affectedByDomain.infrastructure).toBe(2);
    expect(impact.confidence).toBeGreaterThan(0.5);
  });

  it('returns an empty impact + zero confidence for an unknown node', () => {
    const model = buildEnterpriseGraph({ resource: rg([res('x')]) }, NOW_MS);
    const impact = analyzeChangeImpact(model, 'res:does-not-exist', NOW_MS);
    expect(impact.blastRadius).toBe(0);
    expect(impact.confidence).toBe(0);
  });
});
