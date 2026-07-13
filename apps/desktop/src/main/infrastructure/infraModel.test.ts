/**
 * P6 — the pure Cloud & Infrastructure model: the Cloud Platform abstraction, the Resource Graph builder +
 * traversal, the Discovery contracts + resource/cursor factories, and the EKG bridge. Pure-node, no runtime.
 */
import { describe, expect, it } from 'vitest';
import {
  INFRASTRUCTURE_DOMAINS,
  INFRASTRUCTURE_DOMAIN_CATALOG,
  domainDef,
  describeDomains,
  manifestToPlatformDto,
  buildResourceGraph,
  emptyResourceGraph,
  resourceNeighbors,
  resourceDependencyTree,
  resourceImpactAnalysis,
  makeResource,
  makeResourceId,
  describeCloudPlatform,
  parseDiscoveryCursor,
  toDiscoveryCursor,
  resourceGraphBridge,
  edgeTypeForResourceRelation,
  resourceNodeId,
  RESOURCE_NODE_PREFIX,
  type CloudPlatformManifest,
  type CloudPlatformAdapter,
  type CloudResource,
} from '@neuropause/shared';

const NOW = Date.parse('2026-07-13T00:00:00.000Z');

/** A tiny topology: cluster ⟵ node ⟵ pod; instance ⟵ volume; db backed_by volume; two peers connected. */
function topology(): CloudResource[] {
  const mk = (over: Partial<Parameters<typeof makeResource>[0]> & { resourceType: string; nativeId: string; name: string; domain: CloudResource['domain'] }) =>
    makeResource({ platformId: 'k8s', provider: 'kubernetes', accountId: 'clusterA', now: '2026-07-13T00:00:00.000Z', ...over });
  return [
    mk({ resourceType: 'k8s_cluster', nativeId: 'clusterA', name: 'prod', domain: 'containers', health: 'healthy' }),
    mk({ resourceType: 'k8s_node', nativeId: 'node-1', name: 'node-1', domain: 'compute', health: 'healthy', relationships: [{ type: 'member_of', targetId: 'clusterA' }] }),
    mk({ resourceType: 'k8s_pod', nativeId: 'pod-1', name: 'api-abc', domain: 'containers', health: 'degraded', relationships: [{ type: 'runs_on', targetId: 'node-1' }] }),
    mk({ resourceType: 'volume', nativeId: 'vol-1', name: 'data', domain: 'storage', health: 'healthy' }),
    mk({ resourceType: 'instance', nativeId: 'i-1', name: 'db-host', domain: 'compute', health: 'healthy', relationships: [{ type: 'attached_to', targetId: 'vol-1' }] }),
    mk({ resourceType: 'database', nativeId: 'db-1', name: 'orders', domain: 'databases', health: 'critical', relationships: [{ type: 'backed_by', targetId: 'vol-1' }, { type: 'runs_on', targetId: 'i-1' }] }),
  ];
}

describe('Cloud Platform model — domains + manifest projection', () => {
  it('has a presentation def for every one of the 15 infrastructure domains', () => {
    expect(INFRASTRUCTURE_DOMAINS).toHaveLength(15);
    for (const d of INFRASTRUCTURE_DOMAINS) {
      expect(INFRASTRUCTURE_DOMAIN_CATALOG[d].label).toBeTruthy();
      expect(domainDef(d).id).toBe(d);
    }
  });

  it('describeDomains returns defs in catalog order', () => {
    const defs = describeDomains(['storage', 'compute', 'identity']);
    expect(defs.map((d) => d.id)).toEqual(['identity', 'compute', 'storage']); // catalog order, not input order
  });

  it('manifestToPlatformDto yields an unconfigured shell carrying the manifest domains', () => {
    const m: CloudPlatformManifest = {
      id: 'aws', name: 'AWS', provider: 'aws', description: '', website: '', docsUrl: '', brandColor: '#f90',
      version: '0.1.0', authKind: 'iam_role', domains: ['compute', 'storage'], multiAccount: true, accountNoun: 'Account',
    };
    const dto = manifestToPlatformDto(m);
    expect(dto.configured).toBe(false);
    expect(dto.status).toBe('unconfigured');
    expect(dto.domains).toEqual(['compute', 'storage']);
    expect(dto.accounts).toEqual([]);
  });
});

describe('Resource Graph — builder', () => {
  it('builds nodes + resolved edges, resolving targets by native id, and rolls up health/counts', () => {
    const model = buildResourceGraph({ resources: topology() }, NOW);
    expect(model.resources).toHaveLength(6);
    // 5 relationships across the topology (member_of, runs_on, attached_to, backed_by, runs_on) all resolve.
    expect(model.edges).toHaveLength(5);
    expect(model.counts.byHealth).toEqual({ healthy: 4, degraded: 1, critical: 1, unknown: 0 });
    expect(model.counts.byDomain.containers).toBe(2);
    expect(model.insights.total).toBe(6);
    expect(model.insights.critical).toBe(1);
    expect(model.builtAt).toBe('2026-07-13T00:00:00.000Z');
  });

  it('drops a dangling relationship (target not discovered) and a self-edge', () => {
    const rs = [
      makeResource({ platformId: 'aws', provider: 'aws', accountId: 'a', resourceType: 'instance', nativeId: 'i-1', name: 'i', domain: 'compute', now: '2026-07-13T00:00:00.000Z', relationships: [{ type: 'uses', targetId: 'ghost' }, { type: 'depends_on', targetId: 'i-1' }] }),
    ];
    const model = buildResourceGraph({ resources: rs }, NOW);
    expect(model.edges).toHaveLength(0); // dangling target dropped, self-edge dropped
  });

  it('resolves a native-id target within the declaring resource scope (no cross-account mis-binding)', () => {
    const netAt = (account: string) => makeResource({ platformId: 'aws', provider: 'aws', accountId: account, resourceType: 'net', nativeId: 'default', name: `${account}-default`, domain: 'networking', now: '2026-07-13T00:00:00.000Z' });
    const resources = [
      netAt('B'), // inserted first → would win a GLOBAL first-wins index
      netAt('A'),
      makeResource({ platformId: 'aws', provider: 'aws', accountId: 'A', resourceType: 'instance', nativeId: 'i-1', name: 'i', domain: 'compute', now: '2026-07-13T00:00:00.000Z', relationships: [{ type: 'connected_to', targetId: 'default' }] }),
    ];
    const model = buildResourceGraph({ resources }, NOW);
    const edge = model.edges.find((e) => e.type === 'connected_to');
    // A's instance connects to A's `default`, NOT B's (which sorted first) — native ids are scoped per account.
    expect(edge?.to).toBe(makeResourceId('aws', 'A', 'net', 'default'));
  });

  it('computes blast radius (reverse reachability) and flags orphans', () => {
    const model = buildResourceGraph({ resources: topology() }, NOW);
    // vol-1 is depended on (attached_to + backed_by) by i-1 and db-1 → blast radius >= 2.
    const vol = model.insights.topBlastRadius.find((r) => r.name === 'data');
    expect(vol && vol.blastRadius).toBeGreaterThanOrEqual(2);
    // cluster has an inbound edge (node member_of), pod has an outbound edge → neither orphaned; nothing here is.
    expect(model.insights.orphaned).toBe(0);
  });

  it('dedups by id (a re-discovery replaces the prior copy)', () => {
    const a = makeResource({ platformId: 'aws', provider: 'aws', accountId: 'a', resourceType: 'instance', nativeId: 'i-1', name: 'old', domain: 'compute', now: '2026-07-13T00:00:00.000Z' });
    const b = makeResource({ platformId: 'aws', provider: 'aws', accountId: 'a', resourceType: 'instance', nativeId: 'i-1', name: 'new', domain: 'compute', now: '2026-07-13T00:01:00.000Z' });
    const model = buildResourceGraph({ resources: [a, b] }, NOW);
    expect(model.resources).toHaveLength(1);
    expect(model.resources[0].name).toBe('new');
  });

  it('emptyResourceGraph is a valid empty model', () => {
    const model = emptyResourceGraph(NOW);
    expect(model.resources).toHaveLength(0);
    expect(model.edges).toHaveLength(0);
    expect(model.insights.total).toBe(0);
  });
});

describe('Resource Graph — traversal', () => {
  it('resourceNeighbors returns both directions with the connecting edge', () => {
    const model = buildResourceGraph({ resources: topology() }, NOW);
    const volId = makeResourceId('k8s', 'clusterA', 'volume', 'vol-1');
    const nb = resourceNeighbors(model, volId);
    // vol-1 has two INBOUND edges (instance attached_to, db backed_by).
    expect(nb.every((n) => n.direction === 'in')).toBe(true);
    expect(nb).toHaveLength(2);
  });

  it('resourceDependencyTree follows outbound edges (what a resource runs on / depends on)', () => {
    const model = buildResourceGraph({ resources: topology() }, NOW);
    const dbId = makeResourceId('k8s', 'clusterA', 'database', 'db-1');
    const deps = resourceDependencyTree(model, dbId);
    // db → (backed_by vol-1, runs_on i-1) → i-1 → (attached_to vol-1). Reaches vol-1 and i-1.
    expect(deps).toContain(makeResourceId('k8s', 'clusterA', 'volume', 'vol-1'));
    expect(deps).toContain(makeResourceId('k8s', 'clusterA', 'instance', 'i-1'));
  });

  it('resourceImpactAnalysis returns transitive dependents (blast radius set)', () => {
    const model = buildResourceGraph({ resources: topology() }, NOW);
    const volId = makeResourceId('k8s', 'clusterA', 'volume', 'vol-1');
    const impacted = resourceImpactAnalysis(model, volId);
    const names = impacted.map((r) => r.name).sort();
    expect(names).toContain('db-host'); // i-1 attached_to vol-1
    expect(names).toContain('orders'); // db-1 backed_by vol-1
  });
});

describe('Discovery contracts — factories + capability + cursor codec', () => {
  it('makeResource builds a deterministic id and fills envelope defaults', () => {
    const r = makeResource({ platformId: 'aws', provider: 'aws', accountId: 'acct-1', resourceType: 'ec2_instance', nativeId: 'i-0abc', name: '', domain: 'compute', now: '2026-07-13T00:00:00.000Z' });
    expect(r.id).toBe('aws:acct-1:ec2_instance:i-0abc');
    expect(r.name).toBe('i-0abc'); // falls back to native id
    expect(r.health).toBe('unknown');
    expect(r.tags).toEqual({});
    expect(r.createdAt).toBe(r.updatedAt);
  });

  it('describeCloudPlatform projects domains + deduped resource types', () => {
    const adapter: CloudPlatformAdapter = {
      platformId: 'aws',
      provider: 'aws',
      collectors: [
        { id: 'compute', domain: 'compute', label: 'Compute', resourceTypes: ['ec2_instance', 'ebs_volume'], collect: async () => ({ resources: [], cursor: null, hasMore: false }) },
        { id: 'net', domain: 'networking', label: 'Networking', resourceTypes: ['vpc', 'ebs_volume'], collect: async () => ({ resources: [], cursor: null, hasMore: false }) },
      ],
    };
    const cap = describeCloudPlatform(adapter);
    expect(cap.domains).toEqual(['compute', 'networking']);
    expect(cap.resourceTypes).toEqual(['ec2_instance', 'ebs_volume', 'vpc']); // deduped, first-seen order
  });

  it('cursor codec round-trips and returns null on garbage', () => {
    expect(toDiscoveryCursor({ token: 'abc', offset: 100 })).toContain('abc');
    expect(parseDiscoveryCursor(toDiscoveryCursor({ token: 'abc' }))?.token).toBe('abc');
    expect(parseDiscoveryCursor(null)).toBeNull();
    expect(parseDiscoveryCursor('not json')).toBeNull();
  });
});

describe('EKG bridge — Resource Graph → the ONE knowledge graph', () => {
  it('maps the nine relations onto the ten generic edge types (containment/dependency/usage/peer)', () => {
    expect(edgeTypeForResourceRelation('runs_on')).toBe('depends_on');
    expect(edgeTypeForResourceRelation('depends_on')).toBe('depends_on');
    expect(edgeTypeForResourceRelation('hosted_by')).toBe('belongs_to');
    expect(edgeTypeForResourceRelation('member_of')).toBe('belongs_to');
    expect(edgeTypeForResourceRelation('attached_to')).toBe('belongs_to');
    expect(edgeTypeForResourceRelation('uses')).toBe('references');
    expect(edgeTypeForResourceRelation('backed_by')).toBe('references');
    expect(edgeTypeForResourceRelation('protected_by')).toBe('references');
    expect(edgeTypeForResourceRelation('connected_to')).toBe('linked_to');
  });

  it('projects resources into prefixed cloud_resource nodes + edges that preserve the precise relation', () => {
    const model = buildResourceGraph({ resources: topology() }, NOW);
    const proj = resourceGraphBridge(model, '2026-07-13T00:00:00.000Z');
    expect(proj.nodes).toHaveLength(6);
    expect(proj.nodes.every((n) => n.type === 'cloud_resource' && n.id.startsWith(RESOURCE_NODE_PREFIX))).toBe(true);
    // A pod runs_on a node → a generic depends_on edge carrying the precise relation in label + metadata.
    const podNode = resourceNodeId(makeResourceId('k8s', 'clusterA', 'k8s_pod', 'pod-1'));
    const runsOn = proj.edges.find((e) => e.from === podNode);
    expect(runsOn?.type).toBe('depends_on');
    expect(runsOn?.metadata.relation).toBe('runs_on');
    expect(runsOn?.metadata.overlay).toBe('infrastructure');
    // Node ids are namespaced so they never alias a UDM unified id.
    expect(proj.nodes[0].sourceKind).toBe('infrastructure');
    expect(proj.nodes[0].connectorId).toBe('k8s');
  });

  it('keeps two DISTINCT relations between the same pair as two edges (no generic-type collapse)', () => {
    const db = makeResource({ platformId: 'aws', provider: 'aws', accountId: 'x', resourceType: 'db', nativeId: 'db', name: 'orders', domain: 'databases', now: '2026-07-13T00:00:00.000Z', relationships: [{ type: 'backed_by', targetId: 'key' }, { type: 'protected_by', targetId: 'key' }] });
    const key = makeResource({ platformId: 'aws', provider: 'aws', accountId: 'x', resourceType: 'key', nativeId: 'key', name: 'kms', domain: 'security', now: '2026-07-13T00:00:00.000Z' });
    const proj = resourceGraphBridge(buildResourceGraph({ resources: [db, key] }, NOW), '2026-07-13T00:00:00.000Z');
    // backed_by + protected_by both → generic `references`, but the precise relation keeps them distinct.
    const refs = proj.edges.filter((e) => e.type === 'references');
    expect(refs).toHaveLength(2);
    expect(new Set(refs.map((e) => e.id)).size).toBe(2); // distinct edge ids (was 1 before the fix)
    expect(refs.map((e) => e.metadata.relation).sort()).toEqual(['backed_by', 'protected_by']);
  });
});
