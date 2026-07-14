/**
 * P6.3 — the GCP DomainCollectors: plain-list + Compute aggregatedList parsing, pageToken pagination, run-scoped
 * incremental cursor, selfLink-normalized relationship mapping, and the Resource Graph projection. Pure-node; the
 * bearer transport is faked (canned GCP responses), so the mapping logic is fully covered without a live project.
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
import { GCP_COLLECTORS } from './gcpCollectors';

const NOW = '2026-07-13T00:00:00.000Z';
const collector = (id: string) => GCP_COLLECTORS.find((c) => c.id === id)!;

function fakeGcp(router: (req: DiscoveryRequest) => { status?: number; body: string }): DiscoveryHttp {
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
  ({ platformId: 'gcp', accountId: 'proj-1', region: null, cursor, now: NOW, http });

const SL = 'https://www.googleapis.com/compute/v1/projects/proj-1';

describe('GCP compute (aggregatedList) — mapping, health, relationships, run-scoped pagination', () => {
  const netRef = `${SL}/global/networks/default`;
  const subRef = `${SL}/regions/us-central1/subnetworks/sub1`;
  const agg1 = JSON.stringify({
    items: {
      'zones/us-central1-a': { instances: [{ name: 'vm1', selfLink: `${SL}/zones/us-central1-a/instances/vm1`, zone: `${SL}/zones/us-central1-a`, status: 'RUNNING', machineType: `${SL}/zones/us-central1-a/machineTypes/e2-medium`, networkInterfaces: [{ network: netRef, subnetwork: subRef }] }] },
      'zones/us-east1-b': { warning: { code: 'NO_RESULTS_ON_PAGE' } }, // scope with no instances is skipped
    },
    nextPageToken: 'TOK2',
  });
  const agg2 = JSON.stringify({ items: { 'zones/us-central1-a': { instances: [{ name: 'vm2', selfLink: `${SL}/zones/us-central1-a/instances/vm2`, zone: `${SL}/zones/us-central1-a`, status: 'TERMINATED' }] } } });

  it('maps an instance with health + member_of/uses relationships and pages via pageToken', async () => {
    const http = fakeGcp((req) => ({ body: req.url.includes('pageToken=TOK2') ? agg2 : agg1 }));
    const p1 = await collector('gcp_compute_instances').collect(ctx(http));
    expect(p1.resources).toHaveLength(1);
    const vm = p1.resources[0];
    expect(vm.nativeId).toBe('projects/proj-1/zones/us-central1-a/instances/vm1');
    expect(vm.id).toBe(makeResourceId('gcp', 'proj-1', 'compute_instance', 'projects/proj-1/zones/us-central1-a/instances/vm1'));
    expect(vm.name).toBe('vm1');
    expect(vm.region).toBe('us-central1-a');
    expect(vm.health).toBe('healthy');
    expect(vm.attributes.machineType).toBe('e2-medium');
    expect(vm.relationships.map((r) => `${r.type}:${r.targetId}`).sort()).toEqual(['member_of:projects/proj-1/global/networks/default', 'uses:projects/proj-1/regions/us-central1/subnetworks/sub1']);
    expect(p1.hasMore).toBe(true);
    expect(JSON.parse(p1.cursor as string)).toEqual({ token: 'TOK2', runAt: NOW });

    const p2 = await collector('gcp_compute_instances').collect(ctx(http, p1.cursor));
    expect(p2.resources[0].name).toBe('vm2');
    expect(p2.resources[0].health).toBe('degraded'); // TERMINATED
    expect(p2.hasMore).toBe(false);
    expect(p2.cursor).toBeNull();
  });

  it('drops a STALE cross-run page token', async () => {
    let sawToken = false;
    const http = fakeGcp((req) => {
      if (req.url.includes('pageToken=TOK2')) sawToken = true;
      return { body: agg1 };
    });
    await collector('gcp_compute_instances').collect(ctx(http, toDiscoveryCursor({ token: 'TOK2', runAt: '2020-01-01T00:00:00.000Z' })));
    expect(sawToken).toBe(false);
  });
});

describe('GCP identity + networking + secrets', () => {
  it('discovers service accounts against the IAM host', async () => {
    let host = '';
    const http = fakeGcp((req) => {
      host = new URL(req.url).hostname;
      return { body: JSON.stringify({ accounts: [{ name: 'projects/proj-1/serviceAccounts/sa@proj-1.iam.gserviceaccount.com', email: 'sa@proj-1.iam.gserviceaccount.com', displayName: 'CI SA', disabled: false }, { name: 'projects/proj-1/serviceAccounts/old@x', email: 'old@x', disabled: true }] }) };
    });
    const p = await collector('gcp_service_accounts').collect(ctx(http));
    expect(host).toBe('iam.googleapis.com');
    expect(p.resources.map((r) => r.name)).toEqual(['CI SA', 'old@x']);
    expect(p.resources[0].health).toBe('healthy');
    expect(p.resources[1].health).toBe('degraded'); // disabled
  });

  it('maps subnetworks (aggregatedList) with member_of network', async () => {
    const http = fakeGcp(() => ({ body: JSON.stringify({ items: { 'regions/us-central1': { subnetworks: [{ name: 'sub1', selfLink: `${SL}/regions/us-central1/subnetworks/sub1`, region: `${SL}/regions/us-central1`, ipCidrRange: '10.0.0.0/20', network: `${SL}/global/networks/default` }] } } }) }));
    const p = await collector('gcp_subnetworks').collect(ctx(http));
    expect(p.resources[0].region).toBe('us-central1');
    expect(p.resources[0].relationships).toEqual([{ type: 'member_of', targetId: 'projects/proj-1/global/networks/default' }]);
  });

  it('maps Secret Manager secrets by relative name and never emits secret material', async () => {
    const http = fakeGcp(() => ({ body: JSON.stringify({ secrets: [{ name: 'projects/proj-1/secrets/db-pass', replication: { automatic: {} }, rotation: { nextRotationTime: '2026-01-01T00:00:00Z' } }] }) }));
    const p = await collector('gcp_secrets').collect(ctx(http));
    expect(p.resources[0].nativeId).toBe('projects/proj-1/secrets/db-pass');
    expect(p.resources[0].name).toBe('db-pass');
    expect(p.resources[0].attributes.rotationEnabled).toBe(true);
    expect(JSON.stringify(p.resources[0])).not.toMatch(/value|payload|secretData/i);
  });
});

describe('GCP per-location fan-out (APIs that reject the `-` wildcard)', () => {
  it('lists Cloud Run services per-location, never using the `-` aggregate wildcard', async () => {
    const paths: string[] = [];
    const http = fakeGcp((req) => {
      const p = new URL(req.url).pathname;
      paths.push(p);
      if (p.endsWith('/locations')) return { body: JSON.stringify({ locations: [{ locationId: 'us-central1' }, { locationId: 'europe-west1' }] }) };
      if (p.includes('/locations/us-central1/services')) return { body: JSON.stringify({ services: [{ name: 'projects/proj-1/locations/us-central1/services/api', uri: 'https://api-x.run.app', terminalCondition: { type: 'Ready', state: 'CONDITION_SUCCEEDED' } }] }) };
      return { body: JSON.stringify({ services: [] }) }; // europe-west1 is empty
    });
    const p = await collector('gcp_cloud_run_services').collect(ctx(http));
    expect(p.resources.map((r) => r.name)).toEqual(['api']);
    expect(p.resources[0].region).toBe('us-central1');
    expect(p.resources[0].health).toBe('healthy');
    expect(p.hasMore).toBe(false);
    expect(p.cursor).toBeNull();
    expect(paths.some((x) => x.endsWith('/locations'))).toBe(true); // enumerated locations
    expect(paths.some((x) => x.includes('/locations/-/'))).toBe(false); // and NEVER hit the rejected wildcard
  });
});

describe('GCP Resource Graph projection', () => {
  it('projects VPC + subnetwork + instance and resolves every edge (+ blast radius)', async () => {
    const netSelf = `${SL}/global/networks/default`;
    const subSelf = `${SL}/regions/us-central1/subnetworks/sub1`;
    const vmSelf = `${SL}/zones/us-central1-a/instances/vm1`;
    const http = fakeGcp((req) => {
      if (req.url.includes('/global/networks')) return { body: JSON.stringify({ items: [{ name: 'default', selfLink: netSelf }] }) };
      if (req.url.includes('/aggregated/subnetworks')) return { body: JSON.stringify({ items: { 'regions/us-central1': { subnetworks: [{ name: 'sub1', selfLink: subSelf, region: `${SL}/regions/us-central1`, network: netSelf }] } } }) };
      if (req.url.includes('/aggregated/instances')) return { body: JSON.stringify({ items: { 'zones/us-central1-a': { instances: [{ name: 'vm1', selfLink: vmSelf, zone: `${SL}/zones/us-central1-a`, status: 'RUNNING', networkInterfaces: [{ network: netSelf, subnetwork: subSelf }] }] } } }) };
      return { body: JSON.stringify({}) };
    });
    const resources = [
      ...(await collector('gcp_vpc_networks').collect(ctx(http))).resources,
      ...(await collector('gcp_subnetworks').collect(ctx(http))).resources,
      ...(await collector('gcp_compute_instances').collect(ctx(http))).resources,
    ];
    const model = buildResourceGraph({ resources }, Date.parse(NOW));
    expect(model.resources).toHaveLength(3);
    // subnetwork member_of network; instance member_of network + uses subnetwork = 3 resolved edges.
    expect(model.edges).toHaveLength(3);
    expect(model.edges.map((e) => e.type).sort()).toEqual(['member_of', 'member_of', 'uses']);
    // The network is the deepest dependency — the whole topology transitively depends on it.
    const netId = makeResourceId('gcp', 'proj-1', 'vpc_network', 'projects/proj-1/global/networks/default');
    expect(model.insights.topBlastRadius.some((r) => r.resourceId === netId)).toBe(true);
  });
});

describe('GCP platform — one adapter, all domains', () => {
  it('the collectors span the GCP infrastructure domains', () => {
    const domains = new Set(GCP_COLLECTORS.map((c) => c.domain));
    for (const d of ['identity', 'compute', 'networking', 'storage', 'databases', 'containers', 'serverless', 'monitoring', 'secrets', 'certificates', 'dns'] as const) {
      expect(domains.has(d)).toBe(true);
    }
    expect(GCP_COLLECTORS.length).toBeGreaterThanOrEqual(20);
  });
});
