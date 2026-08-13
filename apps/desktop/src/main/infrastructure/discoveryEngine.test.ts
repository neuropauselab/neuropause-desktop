/**
 * P13C Round 7 — these suites act AS one tenant. `ResourceStore` gained a tenant
 * boundary this round (the subsystem had none at all), and an unbound store now
 * denies every read and throws on write. Binding here preserves each existing
 * assertion's single-tenant meaning; A/B/C isolation is asserted separately in
 * `tenancy/e2e/infrastructureTenancy.test.ts`.
 */
/**
 * P6 — the Infrastructure Runtime: the Discovery Engine driving a fake Cloud Platform incrementally into the
 * Resource Store + Resource Graph, with graceful per-domain degrade and Timeline events. Pure-node; the
 * engine's reused HttpClient is stubbed (the fake collectors return canned data). No concrete provider.
 */
import { describe, expect, it } from 'vitest';
import {
  makeResource,
  makeResourceId,
  parseDiscoveryCursor,
  toDiscoveryCursor,
  type CloudPlatformAdapter,
  type DiscoveryContext,
  type DiscoveryHttp,
  type PlatformEventInput,
} from '@neuropause/shared';
import { HttpError, NetworkError, RateLimitError } from '../unified/sync/http';
import { InfrastructureDiscoveryEngine, type DiscoveryEnginePorts } from './discoveryEngine';
import { DiscoveryStateStore } from './discoveryState';
import { ResourceStore } from './resourceStore';
import { registerPlatform, getPlatform, clearPlatforms, describePlatforms } from './platformRegistry';

const NOW = '2026-07-13T00:00:00.000Z';
const stubHttp: DiscoveryHttp = { getJson: async () => ({ data: {}, status: 200, headers: {} }) };

const vm = (ctx: DiscoveryContext, native: string, runsOn?: string) =>
  makeResource({ platformId: ctx.platformId, provider: 'custom', accountId: ctx.accountId, resourceType: 'vm', nativeId: native, name: native, domain: 'compute', health: 'healthy', now: ctx.now, relationships: runsOn ? [{ type: 'runs_on', targetId: runsOn }] : [] });
const disk = (ctx: DiscoveryContext, native: string) =>
  makeResource({ platformId: ctx.platformId, provider: 'custom', accountId: ctx.accountId, resourceType: 'disk', nativeId: native, name: native, domain: 'storage', health: 'healthy', now: ctx.now });

/** A fake platform: compute pages 2 VMs across 2 pages (vm-2 runs_on vm-1); storage yields 1 disk; security degrades. */
function fakePlatform(seenCursors: string[] = []): CloudPlatformAdapter {
  return {
    platformId: 'fake',
    provider: 'custom',
    collectors: [
      {
        id: 'compute', domain: 'compute', label: 'Compute', resourceTypes: ['vm'],
        collect: async (ctx) => {
          seenCursors.push(ctx.cursor ?? 'null');
          const c = parseDiscoveryCursor(ctx.cursor);
          if (!c) return { resources: [vm(ctx, 'vm-1')], cursor: toDiscoveryCursor({ offset: 1 }), hasMore: true };
          return { resources: [vm(ctx, 'vm-2', 'vm-1')], cursor: null, hasMore: false };
        },
      },
      {
        id: 'storage', domain: 'storage', label: 'Storage', resourceTypes: ['disk'],
        collect: async (ctx) => ({ resources: [disk(ctx, 'disk-1')], cursor: null, hasMore: false }),
      },
      {
        id: 'security', domain: 'security', label: 'Security', resourceTypes: ['finding'],
        collect: async () => ({ resources: [], cursor: null, hasMore: false, degraded: { kind: 'unauthorized', reason: 'ISU lacks the security-read policy' } }),
      },
    ],
  };
}

function harness(adapter: CloudPlatformAdapter | null) {
  const store = new ResourceStore(null).bindScope(() => ({ tenantId: 'org-alpha', workspaceId: 'ws-alpha' }));
  const state = new DiscoveryStateStore(null).bindScope(() => ({ tenantId: 'org-alpha', workspaceId: 'ws-alpha' }));
  const events: PlatformEventInput[] = [];
  const ports: DiscoveryEnginePorts = {
    getPlatform: (id) => (adapter && id === adapter.platformId ? adapter : null),
    state,
    makeHttp: () => stubHttp,
    sink: (_p, _a, resources, deletedIds) => store.upsertMany(resources, deletedIds),
    publish: (e) => events.push(e),
    now: () => NOW,
  };
  return { engine: new InfrastructureDiscoveryEngine(ports), store, state, events };
}

describe('Discovery Engine — incremental discovery into the Resource Graph', () => {
  it('drives every collector, pages incrementally, and sinks resources into the store', async () => {
    const seen: string[] = [];
    const { engine, store, events } = harness(fakePlatform(seen));
    const out = await engine.discoverAccount('fake', 'acct1');

    expect(out.hadAdapter).toBe(true);
    expect(out.resources).toBe(3); // vm-1, vm-2, disk-1 (security degraded → 0)
    expect(out.created).toBe(3);
    // Incremental paging WITHIN the run: page 2 of compute received page 1's cursor.
    expect(seen).toEqual(['null', toDiscoveryCursor({ offset: 1 })]);
    expect(store.all()).toHaveLength(3);
    // Lifecycle events published onto the bus (→ Timeline).
    expect(events.map((e) => e.type)).toContain('infrastructure.discovery_started');
    expect(events.map((e) => e.type)).toContain('infrastructure.discovery_completed');
  });

  it('records a per-domain outcome and degrades one domain gracefully without failing the platform', async () => {
    const { engine } = harness(fakePlatform());
    const out = await engine.discoverAccount('fake', 'acct1');
    const byDomain = Object.fromEntries(out.domains.map((d) => [d.domain, d]));
    expect(byDomain.compute.status).toBe('active');
    expect(byDomain.compute.count).toBe(2);
    expect(byDomain.storage.count).toBe(1);
    expect(byDomain.security.status).toBe('unauthorized'); // degraded, not a family failure
    expect(out.ok).toBe(true); // a graceful degrade is not a hard failure
  });

  it('projects the discovered resources into a Resource Graph with resolved edges', async () => {
    const { engine, store } = harness(fakePlatform());
    await engine.discoverAccount('fake', 'acct1');
    const model = store.graph(Date.parse(NOW));
    expect(model.resources).toHaveLength(3);
    // vm-2 runs_on vm-1 → one edge.
    expect(model.edges).toHaveLength(1);
    expect(model.edges[0].type).toBe('runs_on');
    expect(model.edges[0].from).toBe(makeResourceId('fake', 'acct1', 'vm', 'vm-2'));
  });

  it('a second discovery of unchanged resources is idempotent (no store churn)', async () => {
    const { engine, store } = harness(fakePlatform());
    await engine.discoverAccount('fake', 'acct1');
    const r2 = await engine.discoverAccount('fake', 'acct1');
    expect(r2.created).toBe(0);
    expect(r2.updated).toBe(0); // content-signature dedup → unchanged
    expect(store.all()).toHaveLength(3);
  });

  it('records the run and sets the next discovery time (degraded because a domain was unauthorized)', async () => {
    const { engine, state } = harness(fakePlatform());
    await engine.discoverAccount('fake', 'acct1');
    const s = state.get('fake', 'acct1');
    expect(s.status).toBe('degraded');
    expect(s.resourceCount).toBe(3);
    expect(s.nextDiscoveryAt).toBeTruthy();
    // Per-domain cursor state recorded.
    expect(s.domains.security.status).toBe('unauthorized');
    expect(s.domains.compute.resourceCount).toBe(2);
  });

  it('returns hadAdapter:false when no discovery adapter is registered (unconfigured platform)', async () => {
    const { engine, store } = harness(null);
    const out = await engine.discoverAccount('aws', 'acct1');
    expect(out.hadAdapter).toBe(false);
    expect(out.resources).toBe(0);
    expect(store.all()).toHaveLength(0);
  });

  it('isolates a hard domain error (500) as a domain error while other domains still succeed', async () => {
    const adapter: CloudPlatformAdapter = {
      platformId: 'fake', provider: 'custom',
      collectors: [
        { id: 'compute', domain: 'compute', label: 'Compute', resourceTypes: ['vm'], collect: async (ctx) => ({ resources: [vm(ctx, 'vm-1')], cursor: null, hasMore: false }) },
        { id: 'net', domain: 'networking', label: 'Networking', resourceTypes: ['vpc'], collect: async () => { throw new HttpError(500, 'boom', true); } },
      ],
    };
    const { engine, store } = harness(adapter);
    const out = await engine.discoverAccount('fake', 'acct1');
    expect(out.ok).toBe(false); // a 5xx is a hard error
    expect(out.retryable).toBe(true);
    expect(store.all()).toHaveLength(1); // compute still discovered despite networking failing
    expect(out.domains.find((d) => d.domain === 'networking')?.status).toBe('error');
  });

  it('a 404 in a collector degrades that domain as unprovisioned (graceful), not a hard error', async () => {
    const adapter: CloudPlatformAdapter = {
      platformId: 'fake', provider: 'custom',
      collectors: [
        { id: 'serverless', domain: 'serverless', label: 'Serverless', resourceTypes: ['fn'], collect: async () => { throw new HttpError(404, 'not enabled', false); } },
      ],
    };
    const { engine } = harness(adapter);
    const out = await engine.discoverAccount('fake', 'acct1');
    expect(out.ok).toBe(true);
    expect(out.domains[0].status).toBe('unprovisioned');
  });

  it('classifies a 429 (rate limit) and a network error as RETRYABLE, like the sync orchestrator', async () => {
    for (const err of [new RateLimitError(1000), new NetworkError('offline')]) {
      const adapter: CloudPlatformAdapter = {
        platformId: 'fake', provider: 'custom',
        collectors: [{ id: 'c', domain: 'compute', label: 'C', resourceTypes: ['vm'], collect: async () => { throw err; } }],
      };
      const { engine } = harness(adapter);
      const out = await engine.discoverAccount('fake', 'acct1');
      expect(out.ok).toBe(false);
      expect(out.retryable).toBe(true); // was false before the fix (429/network aren't HttpError)
    }
  });
});

describe('Resource Store — scoped native-id deletion', () => {
  it('deletes a native-id resource ONLY within the discovering scope (no cross-account deletion)', async () => {
    const store = new ResourceStore(null).bindScope(() => ({ tenantId: 'org-alpha', workspaceId: 'ws-alpha' }));
    const admin = (account: string) => makeResource({ platformId: 'aws', provider: 'aws', accountId: account, resourceType: 'role', nativeId: 'AdminRole', name: `${account}-admin`, domain: 'identity', now: NOW });
    await store.upsertMany([admin('A'), admin('B')]);
    expect(store.all()).toHaveLength(2);
    // B's collector reports AdminRole deleted → only B's is removed; A's identically-named role survives.
    const r = await store.upsertMany([], ['AdminRole'], { platformId: 'aws', accountId: 'B' });
    expect(r.deleted).toBe(1);
    expect(store.all().map((x) => x.accountId)).toEqual(['A']);
  });
});

describe('Cloud Platform registry — mirrors the adapter registry', () => {
  it('registers, resolves, and describes platform discovery adapters', () => {
    clearPlatforms();
    expect(getPlatform('fake')).toBeNull();
    registerPlatform(fakePlatform());
    expect(getPlatform('fake')?.platformId).toBe('fake');
    const caps = describePlatforms();
    expect(caps).toHaveLength(1);
    expect(caps[0].domains).toEqual(['compute', 'storage', 'security']);
    clearPlatforms();
  });
});
