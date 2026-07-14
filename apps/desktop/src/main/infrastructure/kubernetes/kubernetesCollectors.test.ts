/**
 * P6.4 — the Kubernetes DomainCollectors: list parsing, `metadata.continue` pagination, run-scoped incremental
 * cursor, ownerReference / spec-ref relationship mapping (Kind/namespace/name refs), the "no secret material"
 * guarantee, and the Resource Graph projection. Pure-node; the bearer transport is faked (canned K8s responses).
 */
import { describe, expect, it } from 'vitest';
import {
  buildResourceGraph,
  makeResourceId,
  toDiscoveryCursor,
  type DiscoveryContext,
  type DiscoveryHttp,
  type DiscoveryRequest,
} from '@neuropause/shared';
import { KUBERNETES_COLLECTORS } from './kubernetesCollectors';

const NOW = '2026-07-13T00:00:00.000Z';
const collector = (id: string) => KUBERNETES_COLLECTORS.find((c) => c.id === id)!;

function fakeK8s(router: (req: DiscoveryRequest) => { status?: number; body: string }): DiscoveryHttp {
  return {
    getJson: async () => ({ data: {}, status: 200, headers: {} }),
    send: async (req) => {
      const r = router(req);
      if (r.status && r.status >= 400) throw Object.assign(new Error('http'), { status: r.status });
      return { status: r.status ?? 200, headers: {}, text: r.body };
    },
  };
}
const ctx = (http: DiscoveryHttp, cursor: string | null = null): DiscoveryContext =>
  ({ platformId: 'kubernetes', accountId: 'prod', region: null, cursor, now: NOW, http });

describe('Kubernetes Pods — health, relationships, run-scoped continue pagination', () => {
  const page1 = JSON.stringify({
    items: [{
      metadata: { name: 'web-abc', namespace: 'default', ownerReferences: [{ kind: 'ReplicaSet', name: 'web-rs' }] },
      spec: { nodeName: 'node-1', serviceAccountName: 'web-sa', volumes: [{ secret: { secretName: 'db-secret' } }, { configMap: { name: 'app-config' } }, { persistentVolumeClaim: { claimName: 'data-pvc' } }] },
      status: { phase: 'Running' },
    }],
    metadata: { continue: 'TOK2' },
  });
  const page2 = JSON.stringify({ items: [{ metadata: { name: 'worker', namespace: 'default' }, spec: {}, status: { phase: 'Failed' } }], metadata: {} });

  it('maps a Pod with runs_on / member_of(owner+namespace) / uses(secret,configmap,pvc,sa) and pages via continue', async () => {
    const http = fakeK8s((req) => ({ body: req.url.includes('continue=TOK2') ? page2 : page1 }));
    const p1 = await collector('k8s_pods').collect(ctx(http));
    expect(p1.resources).toHaveLength(1);
    const pod = p1.resources[0];
    expect(pod.nativeId).toBe('Pod/default/web-abc');
    expect(pod.id).toBe(makeResourceId('kubernetes', 'prod', 'pod', 'Pod/default/web-abc'));
    expect(pod.health).toBe('healthy');
    expect(pod.relationships.map((r) => `${r.type}:${r.targetId}`).sort()).toEqual([
      'member_of:Namespace/default',
      'member_of:ReplicaSet/default/web-rs',
      'runs_on:Node/node-1',
      'uses:ConfigMap/default/app-config',
      'uses:PersistentVolumeClaim/default/data-pvc',
      'uses:Secret/default/db-secret',
      'uses:ServiceAccount/default/web-sa',
    ].sort());
    expect(p1.hasMore).toBe(true);
    expect(JSON.parse(p1.cursor as string)).toEqual({ token: 'TOK2', runAt: NOW });

    const p2 = await collector('k8s_pods').collect(ctx(http, p1.cursor));
    expect(p2.resources[0].name).toBe('worker');
    expect(p2.resources[0].health).toBe('critical'); // Failed
    expect(p2.hasMore).toBe(false);
    expect(p2.cursor).toBeNull();
  });

  it('drops a STALE cross-run continue token', async () => {
    let sawToken = false;
    const http = fakeK8s((req) => {
      if (req.url.includes('continue=TOK2')) sawToken = true;
      return { body: page1 };
    });
    await collector('k8s_pods').collect(ctx(http, toDiscoveryCursor({ token: 'TOK2', runAt: '2020-01-01T00:00:00.000Z' })));
    expect(sawToken).toBe(false);
  });
});

describe('Kubernetes workloads / storage / rbac / secrets mapping', () => {
  it('Deployment health derives from available vs desired replicas', async () => {
    const http = fakeK8s(() => ({ body: JSON.stringify({ items: [{ metadata: { name: 'web', namespace: 'default' }, spec: { replicas: 3 }, status: { availableReplicas: 3 } }], metadata: {} }) }));
    const p = await collector('k8s_deployments').collect(ctx(http));
    expect(p.resources[0].nativeId).toBe('Deployment/default/web');
    expect(p.resources[0].health).toBe('healthy');
    expect(p.resources[0].attributes.replicas).toBe(3);
  });

  it('PVC uses its PersistentVolume + StorageClass', async () => {
    const http = fakeK8s(() => ({ body: JSON.stringify({ items: [{ metadata: { name: 'data-pvc', namespace: 'default' }, spec: { volumeName: 'pv-1', storageClassName: 'fast' }, status: { phase: 'Bound' } }], metadata: {} }) }));
    const p = await collector('k8s_persistent_volume_claims').collect(ctx(http));
    expect(p.resources[0].health).toBe('healthy');
    expect(p.resources[0].relationships.map((r) => `${r.type}:${r.targetId}`).sort()).toEqual(['member_of:Namespace/default', 'uses:PersistentVolume/pv-1', 'uses:StorageClass/fast'].sort());
  });

  it('RoleBinding uses its Role + ServiceAccount subject', async () => {
    const http = fakeK8s(() => ({ body: JSON.stringify({ items: [{ metadata: { name: 'web-rb', namespace: 'default' }, roleRef: { kind: 'Role', name: 'web-role' }, subjects: [{ kind: 'ServiceAccount', name: 'web-sa', namespace: 'default' }] }], metadata: {} }) }));
    const p = await collector('k8s_role_bindings').collect(ctx(http));
    expect(p.resources[0].relationships.map((r) => `${r.type}:${r.targetId}`).sort()).toEqual(['member_of:Namespace/default', 'uses:Role/default/web-role', 'uses:ServiceAccount/default/web-sa'].sort());
  });

  it('a Secret is mapped by metadata only — never the data', async () => {
    const http = fakeK8s(() => ({ body: JSON.stringify({ items: [{ metadata: { name: 'db-secret', namespace: 'default' }, type: 'Opaque', data: { password: 'c2VjcmV0dmFsdWU=' } }], metadata: {} }) }));
    const p = await collector('k8s_secrets').collect(ctx(http));
    expect(p.resources[0].nativeId).toBe('Secret/default/db-secret');
    expect(p.resources[0].attributes.keys).toBe(1);
    expect(p.resources[0].attributes.type).toBe('Opaque');
    expect(JSON.stringify(p.resources[0])).not.toContain('c2VjcmV0dmFsdWU='); // the secret value never leaves
  });
});

describe('Kubernetes Resource Graph projection', () => {
  it('projects Namespace + Node + ReplicaSet + Pod and resolves owner/runs_on/member_of edges (+ blast radius)', async () => {
    const http = fakeK8s((req) => {
      if (req.url.startsWith('/api/v1/namespaces?')) return { body: JSON.stringify({ items: [{ metadata: { name: 'default' }, status: { phase: 'Active' } }], metadata: {} }) };
      if (req.url.startsWith('/api/v1/nodes?')) return { body: JSON.stringify({ items: [{ metadata: { name: 'node-1' }, status: { conditions: [{ type: 'Ready', status: 'True' }] } }], metadata: {} }) };
      if (req.url.startsWith('/apis/apps/v1/replicasets?')) return { body: JSON.stringify({ items: [{ metadata: { name: 'web-rs', namespace: 'default' }, spec: { replicas: 1 }, status: { readyReplicas: 1 } }], metadata: {} }) };
      if (req.url.startsWith('/api/v1/pods?')) return { body: JSON.stringify({ items: [{ metadata: { name: 'web-abc', namespace: 'default', ownerReferences: [{ kind: 'ReplicaSet', name: 'web-rs' }] }, spec: { nodeName: 'node-1' }, status: { phase: 'Running' } }], metadata: {} }) };
      return { body: JSON.stringify({ items: [], metadata: {} }) };
    });
    const resources = [
      ...(await collector('k8s_namespaces').collect(ctx(http))).resources,
      ...(await collector('k8s_nodes').collect(ctx(http))).resources,
      ...(await collector('k8s_replicasets').collect(ctx(http))).resources,
      ...(await collector('k8s_pods').collect(ctx(http))).resources,
    ];
    const model = buildResourceGraph({ resources }, Date.parse(NOW));
    expect(model.resources).toHaveLength(4);
    // rs member_of namespace; pod member_of namespace + member_of rs + runs_on node = 4 resolved edges.
    expect(model.edges).toHaveLength(4);
    expect(model.edges.map((e) => e.type).sort()).toEqual(['member_of', 'member_of', 'member_of', 'runs_on']);
    // The Namespace is the deepest dependency — the whole set transitively belongs to it.
    const nsId = makeResourceId('kubernetes', 'prod', 'namespace', 'Namespace/default');
    expect(model.insights.topBlastRadius.some((r) => r.resourceId === nsId)).toBe(true);
  });
});

describe('Kubernetes platform — one adapter, all domains', () => {
  it('the collectors span the Kubernetes infrastructure domains', () => {
    const domains = new Set(KUBERNETES_COLLECTORS.map((c) => c.domain));
    for (const d of ['identity', 'compute', 'containers', 'networking', 'storage', 'secrets'] as const) {
      expect(domains.has(d)).toBe(true);
    }
    expect(KUBERNETES_COLLECTORS.length).toBeGreaterThanOrEqual(20);
  });
});
