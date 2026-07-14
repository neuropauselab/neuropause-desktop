/**
 * P6.7 — the Cloudflare DomainCollectors: account/zone resolution (explicit vs `/accounts`+`/zones`), the
 * zone fan-out (`hosted_by` zone), the account fan-out, the load-balancer `uses` pool edges, R2 cursor listing,
 * the fan-out resilience (a systemic auth failure degrades; a per-source 404 is skipped unless ALL sources fail),
 * and the Resource Graph projection. Pure-node; the bearer transport is faked with taxonomy-accurate errors.
 */
import { describe, expect, it } from 'vitest';
import {
  buildResourceGraph,
  makeResourceId,
  type DiscoveryContext,
  type DiscoveryHttp,
  type DiscoveryRequest,
} from '@neuropause/shared';
import { CLOUDFLARE_COLLECTORS } from './cloudflareCollectors';
import { errorFor } from './cloudflareClient';
import { AuthError } from '../../unified/sync/http';

const NOW = '2026-07-13T00:00:00.000Z';
const HEX = 'abcdef0123456789abcdef0123456789'; // a valid 32-hex account id
const collector = (id: string) => CLOUDFLARE_COLLECTORS.find((c) => c.id === id)!;

const env = (result: unknown, resultInfo?: unknown) => JSON.stringify({ success: true, result, result_info: resultInfo });
function fakeCf(router: (path: string, req: DiscoveryRequest) => { status?: number; text?: string } | undefined): DiscoveryHttp {
  return {
    getJson: async () => ({ data: {}, status: 200, headers: {} }),
    send: async (req) => {
      const path = req.url.split('?')[0];
      const r = router(path, req) ?? { text: env([]) };
      if (r.status && r.status >= 400) throw errorFor(r.status, {}, r.text ?? '');
      return { status: r.status ?? 200, headers: {}, text: r.text ?? env([]) };
    },
  };
}
const ctx = (http: DiscoveryHttp, accountId = 'default'): DiscoveryContext => ({ platformId: 'cloudflare', accountId, region: null, cursor: null, now: NOW, http });

describe('Cloudflare Zones + DNS (zone fan-out)', () => {
  it('maps a zone with health from status/paused', async () => {
    const http = fakeCf((path) => (path === '/zones' ? { text: env([{ id: 'zone-1', name: 'example.com', status: 'active', paused: false, name_servers: ['a.ns.cloudflare.com'] }, { id: 'zone-2', name: 'paused.com', status: 'active', paused: true }]) } : undefined));
    const p = await collector('cf_zones').collect(ctx(http));
    const byId = Object.fromEntries(p.resources.map((r) => [r.nativeId, r]));
    expect(byId['zone-1'].health).toBe('healthy');
    expect(byId['zone-1'].id).toBe(makeResourceId('cloudflare', 'default', 'zone', 'zone-1'));
    expect(byId['zone-2'].health).toBe('degraded'); // paused
  });

  it('maps DNS records hosted_by their zone', async () => {
    const http = fakeCf((path) => {
      if (path === '/zones') return { text: env([{ id: 'zone-1', name: 'example.com' }]) };
      if (path === '/zones/zone-1/dns_records') return { text: env([{ id: 'rec-1', type: 'A', name: 'www.example.com', content: '203.0.113.10', proxied: true, ttl: 1 }]) };
      return undefined;
    });
    const p = await collector('cf_dns_records').collect(ctx(http));
    expect(p.resources[0].nativeId).toBe('rec-1');
    expect(p.resources[0].attributes.proxied).toBe(true);
    expect(p.resources[0].relationships).toEqual([{ type: 'hosted_by', targetId: 'zone-1' }]);
  });

  it('maps a load balancer hosted_by its zone and using its pools (default + fallback)', async () => {
    const http = fakeCf((path) => {
      if (path === '/zones') return { text: env([{ id: 'zone-1', name: 'example.com' }]) };
      if (path === '/zones/zone-1/load_balancers') return { text: env([{ id: 'lb-1', name: 'lb', enabled: true, default_pools: ['pool-1', 'pool-2'], fallback_pool: 'pool-3' }]) };
      return undefined;
    });
    const p = await collector('cf_load_balancers').collect(ctx(http));
    expect(p.resources[0].relationships.map((r) => `${r.type}:${r.targetId}`).sort()).toEqual(['hosted_by:zone-1', 'uses:pool-1', 'uses:pool-2', 'uses:pool-3'].sort());
  });
});

describe('Cloudflare account fan-out + resolution', () => {
  it('resolves accounts via /accounts when the scope is "default", then lists workers', async () => {
    let listedAccounts = false;
    const http = fakeCf((path) => {
      if (path === '/accounts') { listedAccounts = true; return { text: env([{ id: 'account-1', name: 'Acct' }]) }; }
      if (path === '/accounts/account-1/workers/scripts') return { text: env([{ id: 'my-worker', usage_model: 'standard' }]) };
      return undefined;
    });
    const p = await collector('cf_workers').collect(ctx(http));
    expect(listedAccounts).toBe(true);
    expect(p.resources[0].name).toBe('my-worker');
    expect(p.resources[0].nativeId).toBe('account-1/my-worker'); // qualified by owning account
  });

  it('qualifies same-named account-scoped resources by account so they do not collide under a "default" scope', async () => {
    const http = fakeCf((path) => {
      if (path === '/accounts') return { text: env([{ id: 'acct-A' }, { id: 'acct-B' }]) };
      if (path === '/accounts/acct-A/workers/scripts') return { text: env([{ id: 'api' }]) };
      if (path === '/accounts/acct-B/workers/scripts') return { text: env([{ id: 'api' }]) };
      return undefined;
    });
    const p = await collector('cf_workers').collect(ctx(http));
    expect(p.resources.map((r) => r.nativeId).sort()).toEqual(['acct-A/api', 'acct-B/api']);
    expect(p.resources.every((r) => r.name === 'api')).toBe(true); // both keep the display name; ids stay distinct
  });

  it('uses an EXPLICIT 32-hex account id directly (no /accounts lookup)', async () => {
    let listedAccounts = false;
    const http = fakeCf((path) => {
      if (path === '/accounts') { listedAccounts = true; return { text: env([]) }; }
      if (path === `/accounts/${HEX}/storage/kv/namespaces`) return { text: env([{ id: 'ns-1', title: 'cache' }]) };
      return undefined;
    });
    const p = await collector('cf_kv_namespaces').collect(ctx(http, HEX));
    expect(listedAccounts).toBe(false);
    expect(p.resources[0].name).toBe('cache');
  });

  it('lists R2 buckets via cursor pagination', async () => {
    const http = fakeCf((path, req) => {
      if (path === '/accounts') return { text: env([{ id: 'account-1' }]) };
      if (path === '/accounts/account-1/r2/buckets') {
        return { text: req.url.includes('cursor=') ? JSON.stringify({ success: true, result: { buckets: [{ name: 'b2' }] }, result_info: {} }) : JSON.stringify({ success: true, result: { buckets: [{ name: 'b1' }] }, result_info: { cursor: 'NEXT' } }) };
      }
      return undefined;
    });
    const p = await collector('cf_r2_buckets').collect(ctx(http));
    expect(p.resources.map((r) => r.name)).toEqual(['b1', 'b2']);
    expect(p.resources.map((r) => r.nativeId)).toEqual(['account-1/b1', 'account-1/b2']); // qualified by account
  });
});

describe('Cloudflare fan-out resilience', () => {
  it('a systemic auth failure (403) during the zone fan-out degrades the domain', async () => {
    const http = fakeCf((path) => {
      if (path === '/zones') return { text: env([{ id: 'zone-1' }]) };
      if (path === '/zones/zone-1/dns_records') return { status: 403, text: '{"errors":[{"code":10000,"message":"denied"}]}' };
      return undefined;
    });
    await expect(collector('cf_dns_records').collect(ctx(http))).rejects.toBeInstanceOf(AuthError);
  });

  it('a single zone\'s non-systemic 404 is skipped; other zones still enumerate', async () => {
    const http = fakeCf((path) => {
      if (path === '/zones') return { text: env([{ id: 'zone-1' }, { id: 'zone-2' }]) };
      if (path === '/zones/zone-1/dns_records') return { status: 404, text: '{}' };
      if (path === '/zones/zone-2/dns_records') return { text: env([{ id: 'rec-2', name: 'ok' }]) };
      return undefined;
    });
    const p = await collector('cf_dns_records').collect(ctx(http));
    expect(p.resources.map((r) => r.nativeId)).toEqual(['rec-2']);
  });

  it('degrades when EVERY source fails (a product not provisioned)', async () => {
    const http = fakeCf((path) => {
      if (path === '/accounts') return { text: env([{ id: 'account-1' }]) };
      if (path === '/accounts/account-1/r2/buckets') return { status: 404, text: '{}' };
      return undefined;
    });
    await expect(collector('cf_r2_buckets').collect(ctx(http))).rejects.toBeInstanceOf(Error);
  });
});

describe('Cloudflare Resource Graph projection', () => {
  it('projects Zone + DNS + Load Balancer + Pool and resolves hosted_by / uses (+ blast radius)', async () => {
    const http = fakeCf((path) => {
      if (path === '/zones') return { text: env([{ id: 'zone-1', name: 'example.com', status: 'active', paused: false }]) };
      if (path === '/zones/zone-1/dns_records') return { text: env([{ id: 'rec-1', type: 'A', name: 'www', content: '1.2.3.4' }]) };
      if (path === '/zones/zone-1/load_balancers') return { text: env([{ id: 'lb-1', name: 'lb', enabled: true, default_pools: ['pool-1'] }]) };
      if (path === '/zones/zone-1/ssl/certificate_packs') return { text: env([]) };
      if (path === '/zones/zone-1/rulesets') return { text: env([]) };
      if (path === '/accounts') return { text: env([{ id: 'account-1' }]) };
      if (path === '/accounts/account-1/load_balancers/pools') return { text: env([{ id: 'pool-1', name: 'pool', enabled: true, origins: [{ name: 'o1' }] }]) };
      return undefined;
    });
    const resources = [
      ...(await collector('cf_zones').collect(ctx(http))).resources,
      ...(await collector('cf_dns_records').collect(ctx(http))).resources,
      ...(await collector('cf_load_balancers').collect(ctx(http))).resources,
      ...(await collector('cf_lb_pools').collect(ctx(http))).resources,
    ];
    const model = buildResourceGraph({ resources }, Date.parse(NOW));
    expect(model.resources).toHaveLength(4);
    // rec-1 hosted_by zone-1, lb-1 hosted_by zone-1, lb-1 uses pool-1 = 3 resolved edges.
    expect(model.edges).toHaveLength(3);
    expect(model.edges.map((e) => e.type).sort()).toEqual(['hosted_by', 'hosted_by', 'uses']);
    const zoneId = makeResourceId('cloudflare', 'default', 'zone', 'zone-1');
    expect(model.insights.topBlastRadius.some((r) => r.resourceId === zoneId)).toBe(true);
  });
});

describe('Cloudflare platform — one adapter, six domains', () => {
  it('the collectors span dns / certificates / networking / security / serverless / storage', () => {
    const domains = new Set(CLOUDFLARE_COLLECTORS.map((c) => c.domain));
    for (const d of ['dns', 'certificates', 'networking', 'security', 'serverless', 'storage'] as const) expect(domains.has(d)).toBe(true);
    expect(CLOUDFLARE_COLLECTORS).toHaveLength(12);
  });
});
