/**
 * Cloudflare DomainCollectors (P6.7). Each collector discovers ONE Cloudflare object type via the P6.0
 * `DomainCollector` contract — it lists the objects through the bearer transport, maps each into a `CloudResource`
 * with its typed relationships, and returns a `DiscoveryPage`. The Discovery Engine degrades a domain on 403
 * (a token lacking that product's scope → unauthorized) / 404 (a product not enabled → unprovisioned) and sinks
 * the resources into the Resource Store + Graph.
 *
 * Cloudflare specifics: the ACCOUNT is the discovery scope (`accountId`), and it owns many ZONES. Zone-scoped
 * objects (DNS records, certificates, rulesets, load balancers) are discovered by fanning out per zone; account
 * -scoped objects (Workers, Pages, R2, KV, LB pools, Access apps, Tunnels) per account. Pagination is handled
 * INTERNALLY per collector (`cfList` follows `result_info.total_pages`; R2 uses `cfListCursor`), so each collector
 * returns one complete `DiscoveryPage`. Objects reference each other by id — a zone-scoped resource is
 * `hosted_by` its zone (id), a load balancer `uses` its pools (ids) — and every resource's `nativeId` is that id,
 * so the graph resolves the edges within the account scope. A per-zone / per-account failure that is NOT systemic
 * (a product absent on one zone) is skipped; a systemic auth/offline failure, or ALL sources failing, degrades.
 */
import {
  makeResource,
  type DiscoveryContext,
  type DiscoveryPage,
  type DomainCollector,
  type InfrastructureDomain,
  type ResourceAttributes,
  type ResourceHealth,
  type ResourceRelationship,
} from '@neuropause/shared';
import { AuthError, NetworkError } from '../../unified/sync/http';
import { cfList, cfListCursor } from './cloudflareClient';

type Rec = Record<string, unknown>;
type MappedResource = {
  nativeId: string;
  name: string;
  status?: string | null;
  health?: ResourceHealth;
  tags?: Record<string, string>;
  attributes?: ResourceAttributes;
  relationships?: ResourceRelationship[];
};

/* ── shared helpers ──────────────────────────────────────────────────────────── */

const s = (v: unknown): string | null => (v == null ? null : String(v).trim() || null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const arr = <T = Rec>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const rel = (type: ResourceRelationship['type'], targetId: string | null | undefined): ResourceRelationship[] =>
  targetId ? [{ type, targetId: String(targetId) }] : [];
/** Qualify a per-account, NAME-based native id with its owning account, so it stays unique under a multi-account
 *  ('default') scope where every resource is stamped with the scope, not the real account — a Worker script name
 *  / R2 bucket name is unique only WITHIN its account. (Id-based account resources are already globally unique.)
 *  These resources have no graph edges, so the qualified nativeId never affects relationship resolution. */
const qualify = (account: string, id: string | null): string => (id ? (account ? `${account}/${id}` : id) : '');
const page = (resources: DiscoveryPage['resources']): DiscoveryPage => ({ resources, cursor: null, hasMore: false });
/** A systemic transport failure (bad token / offline) — must degrade the domain, never be swallowed per-source. */
const isSystemic = (err: unknown): boolean => err instanceof AuthError || err instanceof NetworkError;
const ACCOUNT_ID_RE = /^[0-9a-f]{32}$/i;

function build(ctx: DiscoveryContext, domain: InfrastructureDomain, resourceType: string, m: MappedResource) {
  return makeResource({
    platformId: ctx.platformId,
    provider: 'cloudflare',
    accountId: ctx.accountId,
    domain,
    resourceType,
    region: null, // Cloudflare is a global edge; the account IS the scope.
    now: ctx.now,
    nativeId: m.nativeId,
    name: m.name,
    status: m.status,
    health: m.health,
    tags: m.tags,
    attributes: m.attributes,
    relationships: m.relationships,
  });
}

/** Resolve the account id(s) the token can act on: the explicit discovery account, else every accessible account. */
async function resolveAccountIds(ctx: DiscoveryContext): Promise<string[]> {
  if (ctx.accountId && ctx.accountId !== 'default' && ACCOUNT_ID_RE.test(ctx.accountId)) return [ctx.accountId];
  return (await cfList(ctx.http, '/accounts')).map((a) => s(a.id)).filter((x): x is string => !!x);
}

/** Resolve the zones under the discovery scope (filtered to the account when the scope is an explicit account id). */
async function resolveZones(ctx: DiscoveryContext): Promise<Rec[]> {
  const scoped = ctx.accountId && ctx.accountId !== 'default' && ACCOUNT_ID_RE.test(ctx.accountId);
  return cfList(ctx.http, scoped ? `/zones?account.id=${ctx.accountId}` : '/zones', 50);
}

/**
 * Fan out a list over sources (zones/accounts), tolerating a per-source non-systemic failure (a product absent on
 * one source) but degrading the domain when the failure is systemic (auth/offline) OR when EVERY source failed.
 */
async function fanOut(sources: string[], listFn: (src: string) => Promise<Rec[]>, onItem: (item: Rec, src: string) => void): Promise<void> {
  let lastErr: unknown = null;
  let errored = 0;
  for (const src of sources) {
    try {
      for (const item of await listFn(src)) onItem(item, src);
    } catch (err) {
      if (isSystemic(err)) throw err;
      lastErr = err;
      errored += 1;
    }
  }
  if (errored > 0 && errored === sources.length && lastErr) throw lastErr; // every source failed → degrade (e.g. 404 unprovisioned)
}

/* ── health mappers ──────────────────────────────────────────────────────────── */

function zoneHealth(status: string | null, paused: boolean): ResourceHealth {
  if (paused) return 'degraded';
  if (status === 'active') return 'healthy';
  if (status === 'deactivated') return 'critical';
  return 'degraded'; // pending / initializing / moved
}
function certHealth(status: string | null): ResourceHealth {
  if (status === 'active') return 'healthy';
  if (status === 'expired' || status === 'deleted') return 'critical';
  return 'degraded'; // pending_validation / initializing
}
function tunnelHealth(status: string | null): ResourceHealth {
  if (status === 'healthy') return 'healthy';
  if (status === 'down') return 'critical';
  if (status === 'degraded') return 'degraded';
  return 'unknown'; // inactive
}
const enabledHealth = (enabled: unknown): ResourceHealth => (enabled === false ? 'degraded' : 'healthy');

/* ── collectors ──────────────────────────────────────────────────────────────── */

/** Zones — the DNS backbone (and the account's root object). */
const zoneCollector: DomainCollector = {
  id: 'cf_zones', domain: 'dns', label: 'Zones', resourceTypes: ['zone'],
  collect: async (ctx) => {
    const zones = await resolveZones(ctx);
    const resources = zones
      .map((z) => {
        const id = s(z.id);
        if (!id) return null;
        const status = s(z.status);
        return build(ctx, 'dns', 'zone', {
          nativeId: id,
          name: s(z.name) || id,
          status,
          health: zoneHealth(status, z.paused === true),
          attributes: { status, paused: z.paused === true, plan: s((z.plan as Rec)?.name), nameServers: arr<string>(z.name_servers).map(String).join(',') || null },
        });
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);
    return page(resources);
  },
};

/** A zone-scoped collector: fan out over zones, each resource `hosted_by` its zone. */
function zoneScoped(spec: { id: string; domain: InfrastructureDomain; label: string; resourceType: string; list: (ctx: DiscoveryContext, zoneId: string) => Promise<Rec[]>; map: (item: Rec, zoneId: string) => MappedResource }): DomainCollector {
  return {
    id: spec.id, domain: spec.domain, label: spec.label, resourceTypes: [spec.resourceType],
    collect: async (ctx) => {
      const zones = await resolveZones(ctx);
      const zoneIds = zones.map((z) => s(z.id)).filter((x): x is string => !!x);
      const out: DiscoveryPage['resources'] = [];
      await fanOut(zoneIds, (zoneId) => spec.list(ctx, zoneId), (item, zoneId) => {
        const m = spec.map(item, zoneId);
        if (m.nativeId) out.push(build(ctx, spec.domain, spec.resourceType, m));
      });
      return page(out);
    },
  };
}

/** An account-scoped collector: fan out over accounts. */
function accountScoped(spec: { id: string; domain: InfrastructureDomain; label: string; resourceType: string; list: (ctx: DiscoveryContext, accountId: string) => Promise<Rec[]>; map: (item: Rec, accountId: string) => MappedResource }): DomainCollector {
  return {
    id: spec.id, domain: spec.domain, label: spec.label, resourceTypes: [spec.resourceType],
    collect: async (ctx) => {
      const accounts = await resolveAccountIds(ctx);
      const out: DiscoveryPage['resources'] = [];
      await fanOut(accounts, (accountId) => spec.list(ctx, accountId), (item, src) => {
        const m = spec.map(item, src);
        if (m.nativeId) out.push(build(ctx, spec.domain, spec.resourceType, m));
      });
      return page(out);
    },
  };
}

const ZONE_SCOPED = [
  zoneScoped({
    id: 'cf_dns_records', domain: 'dns', label: 'DNS Records', resourceType: 'dns_record',
    list: (ctx, zoneId) => cfList(ctx.http, `/zones/${zoneId}/dns_records`, 100),
    map: (r, zoneId) => ({ nativeId: s(r.id) ?? '', name: s(r.name) || 'record', status: s(r.type), health: 'healthy', attributes: { type: s(r.type), content: s(r.content), proxied: r.proxied === true, ttl: num(r.ttl) }, relationships: rel('hosted_by', zoneId) }),
  }),
  zoneScoped({
    id: 'cf_certificates', domain: 'certificates', label: 'Certificates', resourceType: 'certificate_pack',
    list: (ctx, zoneId) => cfList(ctx.http, `/zones/${zoneId}/ssl/certificate_packs?status=all`, 50),
    map: (c, zoneId) => {
      const status = s(c.status);
      return { nativeId: s(c.id) ?? '', name: arr<string>(c.hosts).map(String)[0] || s(c.type) || 'certificate', status, health: certHealth(status), attributes: { type: s(c.type), status, authority: s(c.certificate_authority), hosts: arr<string>(c.hosts).map(String).join(',') || null }, relationships: rel('hosted_by', zoneId) };
    },
  }),
  zoneScoped({
    id: 'cf_rulesets', domain: 'security', label: 'Rulesets (WAF / Firewall)', resourceType: 'ruleset',
    list: (ctx, zoneId) => cfList(ctx.http, `/zones/${zoneId}/rulesets`),
    map: (rs, zoneId) => ({ nativeId: s(rs.id) ?? '', name: s(rs.name) || s(rs.phase) || 'ruleset', status: s(rs.kind), health: 'healthy', attributes: { kind: s(rs.kind), phase: s(rs.phase), version: s(rs.version) }, relationships: rel('hosted_by', zoneId) }),
  }),
  zoneScoped({
    id: 'cf_load_balancers', domain: 'networking', label: 'Load Balancers', resourceType: 'load_balancer',
    list: (ctx, zoneId) => cfList(ctx.http, `/zones/${zoneId}/load_balancers`),
    map: (lb, zoneId) => {
      const pools = [...new Set([...arr(lb.default_pools).map(String), ...(s(lb.fallback_pool) ? [s(lb.fallback_pool) as string] : [])])];
      return { nativeId: s(lb.id) ?? '', name: s(lb.name) || 'load-balancer', status: lb.enabled === false ? 'disabled' : 'enabled', health: enabledHealth(lb.enabled), attributes: { enabled: lb.enabled !== false, proxied: lb.proxied === true, pools: pools.length }, relationships: [...rel('hosted_by', zoneId), ...pools.flatMap((p) => rel('uses', p))] };
    },
  }),
];

const ACCOUNT_SCOPED = [
  accountScoped({
    id: 'cf_lb_pools', domain: 'networking', label: 'Load Balancer Pools', resourceType: 'lb_pool',
    list: (ctx, accountId) => cfList(ctx.http, `/accounts/${accountId}/load_balancers/pools`),
    map: (p) => ({ nativeId: s(p.id) ?? '', name: s(p.name) || 'pool', status: p.enabled === false ? 'disabled' : 'enabled', health: enabledHealth(p.enabled), attributes: { enabled: p.enabled !== false, origins: arr(p.origins).length } }),
  }),
  accountScoped({
    id: 'cf_workers', domain: 'serverless', label: 'Workers', resourceType: 'worker_script',
    list: (ctx, accountId) => cfList(ctx.http, `/accounts/${accountId}/workers/scripts`),
    map: (w, account) => ({ nativeId: qualify(account, s(w.id)), name: s(w.id) || 'worker', health: 'healthy', attributes: { usageModel: s(w.usage_model), modifiedOn: s(w.modified_on) } }),
  }),
  accountScoped({
    id: 'cf_pages', domain: 'serverless', label: 'Pages Projects', resourceType: 'pages_project',
    list: (ctx, accountId) => cfList(ctx.http, `/accounts/${accountId}/pages/projects`),
    map: (pr) => ({ nativeId: s(pr.id) ?? s(pr.name) ?? '', name: s(pr.name) || 'pages', health: 'healthy', attributes: { subdomain: s(pr.subdomain), domains: arr<string>(pr.domains).map(String).join(',') || null, productionBranch: s(pr.production_branch) } }),
  }),
  accountScoped({
    id: 'cf_r2_buckets', domain: 'storage', label: 'R2 Buckets', resourceType: 'r2_bucket',
    list: (ctx, accountId) => cfListCursor(ctx.http, `/accounts/${accountId}/r2/buckets`, 'buckets'),
    map: (b, account) => ({ nativeId: qualify(account, s(b.name)), name: s(b.name) || 'bucket', status: s(b.location), health: 'healthy', attributes: { location: s(b.location), storageClass: s(b.storage_class), createdAt: s(b.creation_date) } }),
  }),
  accountScoped({
    id: 'cf_kv_namespaces', domain: 'storage', label: 'KV Namespaces', resourceType: 'kv_namespace',
    list: (ctx, accountId) => cfList(ctx.http, `/accounts/${accountId}/storage/kv/namespaces`, 100),
    map: (kv) => ({ nativeId: s(kv.id) ?? '', name: s(kv.title) || s(kv.id) || 'namespace', health: 'healthy', attributes: { title: s(kv.title) } }),
  }),
  accountScoped({
    id: 'cf_access_apps', domain: 'security', label: 'Access Applications', resourceType: 'access_app',
    list: (ctx, accountId) => cfList(ctx.http, `/accounts/${accountId}/access/apps`),
    map: (a) => ({ nativeId: s(a.id) ?? '', name: s(a.name) || s(a.domain) || 'access-app', status: s(a.type), health: 'healthy', attributes: { domain: s(a.domain), type: s(a.type) } }),
  }),
  accountScoped({
    id: 'cf_tunnels', domain: 'networking', label: 'Tunnels', resourceType: 'tunnel',
    list: (ctx, accountId) => cfList(ctx.http, `/accounts/${accountId}/cfd_tunnel?is_deleted=false`),
    map: (t) => {
      const status = s(t.status);
      return { nativeId: s(t.id) ?? '', name: s(t.name) || 'tunnel', status, health: tunnelHealth(status), attributes: { status, connections: arr(t.connections).length, configSrc: s(t.config_src) } };
    },
  }),
];

/** Every Cloudflare collector, across the six Cloudflare infrastructure domains. */
export const CLOUDFLARE_COLLECTORS: DomainCollector[] = [zoneCollector, ...ZONE_SCOPED, ...ACCOUNT_SCOPED];
