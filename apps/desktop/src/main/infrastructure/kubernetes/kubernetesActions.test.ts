/**
 * P6.4 — Kubernetes automation actions through the SHARED confirmation-gated executor (the same
 * `InfraActionExecutor` P6.1 built for AWS, extended by Azure/GCP). Proves: the confirmation gate refuses a
 * mutation without `confirmed` (and never touches the API server), each action builds the correct relative
 * path / verb / patch body (including the multi-step Drain), the RFC-1123 validators fail closed BEFORE any
 * request, the started→completed|failed audit fan-out, and 403 classification. Pure-node; transport faked.
 */
import { describe, expect, it } from 'vitest';
import type { DiscoveryHttp, DiscoveryRequest, PlatformEventInput } from '@neuropause/shared';
import { AuthError } from '../../unified/sync/http';
import { InfraActionExecutor } from '../executor';
import { KUBERNETES_ACTIONS } from './kubernetesActions';

const NOW = '2026-07-13T00:00:00.000Z';

function harness(router: (req: DiscoveryRequest) => { text?: string; error?: Error }) {
  const events: PlatformEventInput[] = [];
  const requests: DiscoveryRequest[] = [];
  const http: DiscoveryHttp = {
    getJson: async () => ({ data: {}, status: 200, headers: {} }),
    send: async (req) => {
      requests.push(req);
      const r = router(req);
      if (r.error) throw r.error;
      return { status: 200, headers: {}, text: r.text ?? '' };
    },
  };
  const exec = new InfraActionExecutor(
    { makeHttp: () => http, publish: (e) => events.push(e), regionFor: () => null, now: () => NOW },
    KUBERNETES_ACTIONS,
  );
  return { exec, events, requests };
}
const types = (events: PlatformEventInput[]): string[] => events.map((e) => e.type);

describe('confirmation gate', () => {
  it('refuses a mutating action without confirmation and NEVER calls the API server', async () => {
    const { exec, events, requests } = harness(() => ({ text: '{}' }));
    const res = await exec.execute('kubernetes', 'prod', 'k8s_pod_delete', { namespace: 'default', name: 'web' }, false);
    expect(res.ok).toBe(false);
    expect(res.requiresConfirmation).toBe(true);
    expect(requests).toHaveLength(0);
    expect(events).toHaveLength(0);
  });
});

describe('workload actions', () => {
  it('Restart Deployment strategic-merge-patches the restartedAt annotation and audits started→completed', async () => {
    const { exec, events, requests } = harness(() => ({ text: '{}' }));
    const res = await exec.execute('kubernetes', 'prod', 'k8s_deployment_restart', { namespace: 'default', name: 'web' }, true);
    expect(res.ok).toBe(true);
    expect(res.message).toContain('Rolling restart triggered for deployment default/web');
    const req = requests[0];
    expect(req.method).toBe('PATCH');
    expect(req.url).toBe('/apis/apps/v1/namespaces/default/deployments/web');
    expect(req.headers?.['Content-Type']).toBe('application/strategic-merge-patch+json');
    expect(JSON.parse(req.body ?? '{}')).toEqual({ spec: { template: { metadata: { annotations: { 'kubectl.kubernetes.io/restartedAt': NOW } } } } });
    expect(types(events)).toEqual(['infrastructure.action_started', 'infrastructure.action_completed']);
  });

  it('Scale Deployment patches the scale subresource with the replica count', async () => {
    const { exec, requests } = harness(() => ({ text: '{}' }));
    await exec.execute('kubernetes', 'prod', 'k8s_deployment_scale', { namespace: 'default', name: 'web', replicas: '5' }, true);
    expect(requests[0].url).toBe('/apis/apps/v1/namespaces/default/deployments/web/scale');
    expect(JSON.parse(requests[0].body ?? '{}')).toEqual({ spec: { replicas: 5 } });
  });

  it('Restart StatefulSet targets the statefulsets path', async () => {
    const { exec, requests } = harness(() => ({ text: '{}' }));
    await exec.execute('kubernetes', 'prod', 'k8s_statefulset_restart', { namespace: 'default', name: 'db' }, true);
    expect(requests[0].url).toBe('/apis/apps/v1/namespaces/default/statefulsets/db');
  });
});

describe('node actions', () => {
  it('Cordon patches unschedulable on the node', async () => {
    const { exec, requests } = harness(() => ({ text: '{}' }));
    await exec.execute('kubernetes', 'prod', 'k8s_node_cordon', { nodeName: 'node-1' }, true);
    expect(requests[0].url).toBe('/api/v1/nodes/node-1');
    expect(JSON.parse(requests[0].body ?? '{}')).toEqual({ spec: { unschedulable: true } });
  });

  it('Drain cordons, lists the node pods, and evicts the eligible ones (skipping DaemonSet-managed)', async () => {
    const podsBody = JSON.stringify({
      items: [
        { metadata: { name: 'app-1', namespace: 'default' } },
        { metadata: { name: 'ds-1', namespace: 'kube-system', ownerReferences: [{ kind: 'DaemonSet', name: 'kube-proxy' }] } },
      ],
      metadata: {},
    });
    const { exec, requests } = harness((req) => (req.method === 'GET' && req.url.includes('/api/v1/pods') ? { text: podsBody } : { text: '{}' }));
    const res = await exec.execute('kubernetes', 'prod', 'k8s_node_drain', { nodeName: 'node-1' }, true);
    expect(res.ok).toBe(true);
    expect(res.data).toMatchObject({ node: 'node-1', evicted: 1, skipped: 1 });
    // cordon patch
    const cordon = requests.find((r) => r.method === 'PATCH' && r.url === '/api/v1/nodes/node-1');
    expect(JSON.parse(cordon?.body ?? '{}')).toEqual({ spec: { unschedulable: true } });
    // exactly one eviction — the DaemonSet pod is skipped
    const evictions = requests.filter((r) => r.method === 'POST' && r.url.includes('/eviction'));
    expect(evictions).toHaveLength(1);
    expect(evictions[0].url).toBe('/api/v1/namespaces/default/pods/app-1/eviction');
    expect(JSON.parse(evictions[0].body ?? '{}')).toMatchObject({ kind: 'Eviction' });
  });

  it('Drain follows the pod-list continue token (multi-page) and tallies a blocked eviction without aborting', async () => {
    const page1 = JSON.stringify({ items: [{ metadata: { name: 'app-1', namespace: 'default' } }], metadata: { continue: 'NEXT' } });
    const page2 = JSON.stringify({ items: [{ metadata: { name: 'app-2', namespace: 'default' } }, { metadata: { name: 'blocked', namespace: 'default' } }], metadata: {} });
    const { exec, requests } = harness((req) => {
      if (req.method === 'GET' && req.url.includes('/api/v1/pods')) return { text: req.url.includes('continue=NEXT') ? page2 : page1 };
      if (req.method === 'POST' && req.url.includes('/pods/blocked/eviction')) return { error: new Error('pdb blocked') };
      return { text: '{}' };
    });
    const res = await exec.execute('kubernetes', 'prod', 'k8s_node_drain', { nodeName: 'node-1' }, true);
    // app-1 (page 1) + app-2 (page 2) evicted; the blocked pod is tallied, the drain does NOT abort.
    expect(res.data).toMatchObject({ node: 'node-1', evicted: 2, skipped: 0, failed: 1 });
    expect(res.ok).toBe(false); // a blocked eviction surfaces as a non-ok partial drain
    const evictions = requests.filter((r) => r.method === 'POST' && r.url.includes('/eviction')).map((r) => r.url);
    expect(evictions).toEqual([
      '/api/v1/namespaces/default/pods/app-1/eviction',
      '/api/v1/namespaces/default/pods/app-2/eviction',
      '/api/v1/namespaces/default/pods/blocked/eviction',
    ]);
  });
});

describe('pod + secret deletion + guards + classification', () => {
  it('Delete Pod / Delete Secret issue DELETE on the right paths', async () => {
    const { exec, requests } = harness(() => ({ text: '{}' }));
    await exec.execute('kubernetes', 'prod', 'k8s_pod_delete', { namespace: 'default', name: 'web-abc' }, true);
    await exec.execute('kubernetes', 'prod', 'k8s_secret_delete', { namespace: 'default', name: 'db-secret' }, true);
    expect(requests[0].method).toBe('DELETE');
    expect(requests[0].url).toBe('/api/v1/namespaces/default/pods/web-abc');
    expect(requests[1].url).toBe('/api/v1/namespaces/default/secrets/db-secret');
  });

  it('rejects an invalid namespace/name BEFORE any request (path-injection defense)', async () => {
    const { exec, requests, events } = harness(() => ({ text: '{}' }));
    const res = await exec.execute('kubernetes', 'prod', 'k8s_pod_delete', { namespace: 'bad/../ns', name: 'x' }, true);
    expect(res.ok).toBe(false);
    expect(res.message).toContain('Invalid namespace');
    expect(requests).toHaveLength(0);
    expect(types(events)).toEqual(['infrastructure.action_started', 'infrastructure.action_failed']);
  });

  it('rejects a non-integer replica count', async () => {
    const { exec, requests } = harness(() => ({ text: '{}' }));
    const res = await exec.execute('kubernetes', 'prod', 'k8s_deployment_scale', { namespace: 'default', name: 'web', replicas: 'lots' }, true);
    expect(res.message).toContain('Invalid replica count');
    expect(requests).toHaveLength(0);
  });

  it('a provider 403 becomes a least-privilege message and audits started→failed', async () => {
    const { exec, events } = harness(() => ({ error: new AuthError('Forbidden', 403) }));
    const res = await exec.execute('kubernetes', 'prod', 'k8s_pod_delete', { namespace: 'default', name: 'web' }, true);
    expect(res.ok).toBe(false);
    expect(res.message).toContain('Permission denied by the cloud provider');
    expect(types(events)).toEqual(['infrastructure.action_started', 'infrastructure.action_failed']);
  });

  it('lists exactly the seven high-privilege Kubernetes actions', () => {
    const { exec } = harness(() => ({ text: '{}' }));
    const cat = exec.list('kubernetes');
    expect(cat.map((a) => a.id).sort()).toEqual(['k8s_deployment_restart', 'k8s_deployment_scale', 'k8s_node_cordon', 'k8s_node_drain', 'k8s_pod_delete', 'k8s_secret_delete', 'k8s_statefulset_restart'].sort());
    expect(cat.every((a) => a.mutates && a.risk === 'high' && a.platformId === 'kubernetes')).toBe(true);
  });
});
