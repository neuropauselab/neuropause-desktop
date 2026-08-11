/**
 * P13C Round 7 — these suites act AS one tenant. `ResourceStore` gained a tenant
 * boundary this round (the subsystem had none at all), and an unbound store now
 * denies every read and throws on write. Binding here preserves each existing
 * assertion's single-tenant meaning; A/B/C isolation is asserted separately in
 * `tenancy/e2e/infrastructureTenancy.test.ts`.
 */
/**
 * P6.1 — global infrastructure search over the Resource Store. In-memory (null path), so it runs under the
 * node vitest gate. Proves matching across name / native id / type / region / tags / attributes, name-first
 * ranking, platform + domain filters, the display cap with a true total, and the empty-query short-circuit.
 */
import { describe, expect, it } from 'vitest';
import { makeResource, type CloudResource } from '@neuropause/shared';
import { ResourceStore } from './resourceStore';

const NOW = '2026-07-13T00:00:00.000Z';
function res(over: Partial<Parameters<typeof makeResource>[0]> & { nativeId: string; resourceType: string; domain: CloudResource['domain'] }): CloudResource {
  return makeResource({ platformId: 'aws', provider: 'aws', accountId: '111', name: over.nativeId, now: NOW, ...over });
}

async function seed(resources: CloudResource[]): Promise<ResourceStore> {
  const store = new ResourceStore(null).bindScope(() => ({ tenantId: 'org-alpha', workspaceId: 'ws-alpha' }));
  await store.load();
  await store.upsertMany(resources);
  return store;
}

describe('ResourceStore.search', () => {
  it('matches across fields and reports WHICH field matched', async () => {
    const store = await seed([
      res({ resourceType: 'ec2_instance', domain: 'compute', nativeId: 'i-1', name: 'web-prod', region: 'us-east-1', tags: { Team: 'payments' }, attributes: { privateIp: '10.0.0.9' } }),
      res({ resourceType: 's3_bucket', domain: 'storage', nativeId: 'logs-bucket', name: 'logs-bucket' }),
    ]);
    expect((await store.search('web-prod')).hits[0].matchedOn).toBe('name');
    expect((await store.search('i-1')).hits[0].matchedOn).toBe('nativeId');
    expect((await store.search('payments')).hits[0].matchedOn).toBe('tag:Team');
    expect((await store.search('10.0.0.9')).hits[0].matchedOn).toBe('attr:privateIp');
    expect((await store.search('us-east-1')).hits.some((h) => h.matchedOn === 'region')).toBe(true);
    expect((await store.search('bucket')).hits.map((h) => h.nativeId)).toContain('logs-bucket');
  });

  it('is case-insensitive and ranks name matches ahead of tag/attribute matches', () => {
    return seed([
      res({ resourceType: 'ec2_instance', domain: 'compute', nativeId: 'i-9', name: 'analytics', tags: {} }),
      res({ resourceType: 'ec2_instance', domain: 'compute', nativeId: 'i-8', name: 'worker', tags: { role: 'analytics' } }),
    ]).then((store) => {
      const hits = store.search('ANALYTICS').hits;
      expect(hits).toHaveLength(2);
      expect(hits[0].name).toBe('analytics'); // name match ranked first
      expect(hits[0].matchedOn).toBe('name');
      expect(hits[1].matchedOn).toBe('tag:role');
    });
  });

  it('filters by platform and domain', async () => {
    const store = await seed([
      res({ resourceType: 'ec2_instance', domain: 'compute', nativeId: 'i-1', name: 'shared' }),
      res({ resourceType: 's3_bucket', domain: 'storage', nativeId: 'b-1', name: 'shared' }),
      makeResource({ platformId: 'azure', provider: 'azure', accountId: 'sub', domain: 'compute', resourceType: 'vm', nativeId: 'vm-1', name: 'shared', now: NOW }),
    ]);
    expect((await store.search('shared')).total).toBe(3);
    expect((await store.search('shared', { platformId: 'aws' })).total).toBe(2);
    expect((await store.search('shared', { platformId: 'aws', domain: 'storage' })).hits.map((h) => h.nativeId)).toEqual(['b-1']);
  });

  it('caps hits at the limit but reports the true total', async () => {
    const store = await seed(Array.from({ length: 5 }, (_v, i) => res({ resourceType: 'ec2_instance', domain: 'compute', nativeId: `i-${i}`, name: `node-${i}` })));
    const r = await store.search('node', undefined, 2);
    expect(r.total).toBe(5);
    expect(r.hits).toHaveLength(2);
  });

  it('an empty / whitespace query short-circuits to no hits', async () => {
    const store = await seed([res({ resourceType: 'ec2_instance', domain: 'compute', nativeId: 'i-1', name: 'x' })]);
    expect((await store.search('   ')).total).toBe(0);
    expect((await store.search('')).hits).toEqual([]);
  });
});
