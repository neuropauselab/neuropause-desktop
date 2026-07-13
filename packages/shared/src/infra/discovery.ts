/**
 * The Discovery Engine contract (P6 — Cloud & Infrastructure Control Plane).
 *
 * Discovery is the infrastructure analog of connector SYNC: a `CloudPlatformAdapter` exposes one
 * `DomainCollector` per infrastructure domain, and each collector pulls one INCREMENTAL page of resources
 * given a durable cursor — exactly the `AdapterResource.pull(ctx) -> SyncPage` shape, so the SAME
 * orchestration primitives (worker pool, scheduling, retry/backoff, rate-gating, cursor persistence,
 * graceful degrade) drive discovery with no duplicated runtime. This module is the pure contract + the
 * resource/cursor factories; the runtime injects the real rate-gated HTTP client and drives the loop.
 *
 * Discovery is INCREMENTAL by construction: a collector returns a cursor, the engine persists it, and the
 * next run resumes from it — never an unnecessary full rescan.
 */
import type { CloudProviderKind, InfrastructureDomain } from './cloudPlatform';
import type { CloudResource, ResourceAttributes, ResourceHealth, ResourceRelationship } from './resourceGraph';

/**
 * The minimal HTTP surface a collector uses. Structurally identical to the connector `HttpClient` the sync
 * runtime already provides (bearer token attached, rate-gated, error-mapped), so the runtime injects that
 * exact client — this interface only keeps the shared contract Electron-free.
 */
export interface DiscoveryHttp {
  getJson<T>(
    url: string,
    opts?: { query?: Record<string, string | number | boolean | undefined>; headers?: Record<string, string> },
  ): Promise<{ data: T; status: number; headers: Record<string, string> }>;
}

/** Everything a collector needs to discover one page of one domain. Mirrors `SyncContext`. */
export interface DiscoveryContext {
  platformId: string;
  /** The account / subscription / project / cluster scope. */
  accountId: string;
  /** Optional region scope (a collector may fan out per region; null = account-global). */
  region: string | null;
  /** Cursor persisted from the previous run of THIS collector (null on first discovery). */
  cursor: string | null;
  /** Logical timestamp for the run (ISO). */
  now: string;
  /** Authenticated, rate-gated HTTP client (token attached by the runtime). */
  http: DiscoveryHttp;
}

/** The result of discovering one page of a domain. Mirrors `SyncPage`. */
export interface DiscoveryPage {
  /** Resources discovered this page. */
  resources: CloudResource[];
  /** Native/resolved ids of resources deleted at the source (soft-removed from the graph). */
  deletedResourceIds?: string[];
  /** Cursor to persist for the next incremental run. */
  cursor: string | null;
  /** Whether more pages remain to pull right now. */
  hasMore: boolean;
  /**
   * Set when a domain returned empty because it was gracefully skipped rather than genuinely empty — a
   * missing permission / disabled API (unauthorized) or a service not enabled for this account
   * (unprovisioned). The runtime records this per domain so the UI shows a degraded module, not a bare "0".
   */
  degraded?: { kind: 'unauthorized' | 'unprovisioned'; reason: string };
}

/** One collector discovers the resources of ONE infrastructure domain incrementally. Mirrors `AdapterResource`. */
export interface DomainCollector {
  /** Stable id, unique within the platform — used as the cursor key. */
  id: string;
  domain: InfrastructureDomain;
  label: string;
  /** The resource types this collector produces (e.g. `ec2_instance`, `ebs_volume`). */
  resourceTypes: string[];
  collect(ctx: DiscoveryContext): Promise<DiscoveryPage>;
}

/** A Cloud Platform adapter — the discovery analog of `ConnectorAdapter`. */
export interface CloudPlatformAdapter {
  platformId: string;
  provider: CloudProviderKind;
  /** Headers applied to every request. */
  baseHeaders?: Record<string, string>;
  collectors: DomainCollector[];
}

/** A platform's discovery capability report (pure projection). Mirrors `AdapterCapability`. */
export interface DiscoveryCapability {
  platformId: string;
  provider: CloudProviderKind;
  domains: InfrastructureDomain[];
  collectors: Array<{ id: string; domain: InfrastructureDomain; label: string; resourceTypes: string[] }>;
  /** Distinct resource types this platform can discover, in first-seen order. */
  resourceTypes: string[];
}

/** Project an adapter into its discovery capability report (which domains + resource types it discovers). Pure. */
export function describeCloudPlatform(adapter: CloudPlatformAdapter): DiscoveryCapability {
  const collectors = adapter.collectors.map((c) => ({ id: c.id, domain: c.domain, label: c.label, resourceTypes: c.resourceTypes }));
  const domains = [...new Set(collectors.map((c) => c.domain))];
  const resourceTypes = [...new Set(collectors.flatMap((c) => c.resourceTypes))];
  return { platformId: adapter.platformId, provider: adapter.provider, domains, collectors, resourceTypes };
}

/* ── Resource factory ────────────────────────────────────────────────────────── */

/** The fields a collector supplies for a resource; the envelope defaults are filled in by `makeResource`. */
export interface ResourceInput {
  platformId: string;
  provider: string;
  accountId: string;
  domain: InfrastructureDomain;
  resourceType: string;
  nativeId: string;
  name: string;
  region?: string | null;
  status?: string | null;
  health?: ResourceHealth;
  tags?: Record<string, string>;
  attributes?: ResourceAttributes;
  relationships?: ResourceRelationship[];
  createdAt?: string;
  /** The run timestamp (becomes `updatedAt`). */
  now: string;
}

/** Deterministic resource id: `platform:account:resourceType:nativeId` (account-scoped, multi-account safe). */
export function makeResourceId(platformId: string, accountId: string, resourceType: string, nativeId: string): string {
  return `${platformId}:${accountId}:${resourceType}:${nativeId}`;
}

/** Build a canonical `CloudResource` with a deterministic id. Mirrors `makeEntity`. */
export function makeResource(i: ResourceInput): CloudResource {
  return {
    id: makeResourceId(i.platformId, i.accountId, i.resourceType, i.nativeId),
    platformId: i.platformId,
    provider: i.provider,
    accountId: i.accountId,
    domain: i.domain,
    resourceType: i.resourceType,
    nativeId: i.nativeId,
    name: i.name || i.nativeId,
    region: i.region ?? null,
    status: i.status ?? null,
    health: i.health ?? 'unknown',
    tags: i.tags ?? {},
    attributes: i.attributes ?? {},
    relationships: i.relationships ?? [],
    createdAt: i.createdAt ?? i.now,
    updatedAt: i.now,
  };
}

/* ── Incremental cursor codec (pure) ─────────────────────────────────────────── */

/** The opaque incremental-discovery cursor a collector encodes (token / offset / etag + a run clock). */
export interface DiscoveryCursor {
  /** A provider continuation token / nextToken / skiptoken. */
  token?: string | null;
  /** An offset for offset-paginated APIs. */
  offset?: number;
  /** An ETag / snapshot marker for conditional re-discovery (skip an unchanged domain entirely). */
  etag?: string | null;
  /** The run clock that minted an in-run offset/token (a fresh run rebuilds, never replays a stale offset). */
  runAt?: string;
}

export function parseDiscoveryCursor(cursor: string | null): DiscoveryCursor | null {
  if (!cursor) return null;
  try {
    return JSON.parse(cursor) as DiscoveryCursor;
  } catch {
    return null;
  }
}

export function toDiscoveryCursor(value: DiscoveryCursor): string {
  return JSON.stringify(value);
}
