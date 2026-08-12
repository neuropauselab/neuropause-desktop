/**
 * F22 — A BACKUP THAT BELONGS TO ONE TENANT. P13C ROUND 14.
 *
 * WHAT WAS THERE BEFORE, AND WHY IT COULD NOT BE PATCHED
 *
 * `BackupManager` copies whole files named by `storage/storePaths.ts`. One
 * archive is therefore a verbatim copy of EVERY organization's records, and
 * restore is `fs.copyFile` over the live file — so restoring "tenant A's
 * memory.json" deletes B and C outright. `INSTALL_ARCHIVE` declares that
 * honestly and refuses to pretend otherwise, which is why F22 stayed open for
 * four rounds rather than being closed with a `tenantId` filter.
 *
 * THE THREE THINGS THAT MADE IT HARD, all still true:
 *
 *   1. FOUR OWNER CONVENTIONS. `tenantId`+`workspaceId` (ERP records),
 *      `tenantId` (unified entities), a `MemoryOwner` union plus `sync.orgId`
 *      (memory), and `orgId` (governance, which predates the convention).
 *      Plus the platform timeline's `scopeKind` + system bucket over NDJSON.
 *   2. NO SHARED BASE CLASS. `tenantOwnedStore.ts` says so in its own header:
 *      the stores "share NO base class at all". So there is nothing to hang one
 *      method on.
 *   3. RESTORE IS BIGGER THAN BACKUP. A per-tenant restore is a
 *      read-modify-write MERGE that must preserve every other tenant's rows
 *      exactly — the inverse of the export filter, written per store.
 *
 * THE SHAPE THIS TAKES
 *
 * A `TenantDomainSource` is an ADAPTER, not a base class: each store keeps its
 * own filter and its own file format, and contributes a reader and a merger.
 * That is the only design compatible with (1) and (2) — a generic filter would
 * have to understand four owner conventions and would get one of them wrong.
 *
 * THE HONESTY MECHANISM, which is the part that matters most
 *
 * The Round 12 audit's warning was that a PARTIAL tenant archive is a dangerous
 * object: it looks like "tenant A's backup" while silently omitting A's memory,
 * graph and ERP records. So coverage is DECLARED, per domain, in the manifest —
 * and `TENANT_DERIVED_DOMAINS` below lists every domain that owes an adapter.
 * A domain with no source is `uncovered` in the manifest and named in
 * `tenantArchiveCoverageGaps()`, which the gate test asserts on.
 *
 * An archive therefore cannot quietly claim to be complete. It states what it
 * holds and what it does not, and restore refuses to be described as a full
 * tenant restore while gaps remain. That is the difference between a partial
 * implementation and a dishonest one.
 */
import { createHash } from 'node:crypto';
import type { TenantReadGrant } from '../tenancy/tenantOwnedStore';

/** Schema of the tenant manifest. Bumped when the shape changes. */
export const TENANT_ARCHIVE_SCHEMA_VERSION = 1;

/**
 * Every domain that holds tenant-derived data and therefore owes an adapter.
 *
 * Taken from the Round 12 domain audit. The 106 `enterprise-module-*` files
 * collapse to one entry because they are one class behind one binding point.
 * This list is the DENOMINATOR of F22 coverage: if a name is here and has no
 * registered source, the archive says so and the gate test reports it.
 */
export const TENANT_DERIVED_DOMAINS = [
  'enterprise-module-records',
  'executive-decisions',
  'enterprise-governance',
  'automation-rules',
  'enterprise-health-history',
  'assistant-conversations',
  'workforce-jobs',
  'workforce-governance-audit',
  'companion-device-registry',
  'connector-accounts',
  'workspace-directory',
  'organization-directory',
  'org-license-cache',
  'ai-memory-store',
  'knowledge-graph',
  'unified-entities',
  'platform-timeline',
  'user-feedback',
] as const;

export type TenantDomain = (typeof TENANT_DERIVED_DOMAINS)[number];

/**
 * One store's contribution to a tenant archive.
 *
 * `snapshot` reads only the granted tenant's rows. `merge` writes them back
 * WITHOUT disturbing any other tenant — that is the whole contract, and it is
 * why this is an adapter per store rather than a generic file copy.
 */
export interface TenantDomainSource {
  readonly domain: TenantDomain;
  /** The `declareStoreScope` name, so the archive can be traced to a store. */
  readonly storeName: string;
  /**
   * WHOSE ROW IS THIS? P13C ROUND 14.
   *
   * The adapter answers, because only the adapter knows its store's owner
   * convention — `tenantId`, `orgId`, a `MemoryOwner` union, or a timeline
   * scope bucket. Returns `null` for a row that belongs to nobody (pre-migration
   * rows), which is never restorable.
   *
   * This exists because of a defect these tests found in the first draft: a
   * manifest's `tenantId` is a LABEL, and relabelling B's archive as A's let B's
   * rows through under A's grant. The manifest says whose archive it claims to
   * be; this says whose the rows actually are, and the restore requires both.
   */
  ownerOf(row: unknown): string | null;
  /** Only this tenant's rows, in the store's own row shape. */
  snapshot(grant: TenantReadGrant): Promise<readonly unknown[]>;
  /**
   * Replace this tenant's rows with `rows`, leaving every other tenant's rows
   * byte-identical. Returns how many rows the tenant now has.
   */
  merge(grant: TenantReadGrant, rows: readonly unknown[]): Promise<number>;
  /**
   * Whether the store holds its collection in memory and therefore needs the
   * process restarted (or the store rehydrated) before the merge is safe from
   * the next `persist()`. See `requiresRestart` on the restore result.
   */
  readonly inMemoryCollection: boolean;
}

const sources = new Map<TenantDomain, TenantDomainSource>();

/** Register a domain adapter. Composition root only. */
export function registerTenantDomainSource(source: TenantDomainSource): void {
  sources.set(source.domain, source);
}

/** Test seam. */
export function __resetTenantDomainSourcesForTests(): void {
  sources.clear();
}

export function registeredTenantDomains(): TenantDomain[] {
  return [...sources.keys()].sort();
}

/**
 * Domains that owe an adapter and do not have one.
 *
 * NOT an error by itself — it is the number F22 is measured by, and it is
 * reported in every manifest so no archive can imply a completeness it does not
 * have.
 */
export function tenantArchiveCoverageGaps(): TenantDomain[] {
  return TENANT_DERIVED_DOMAINS.filter((d) => !sources.has(d)).sort();
}

export interface TenantDomainManifestEntry {
  domain: TenantDomain;
  storeName: string;
  recordCount: number;
  /** sha256 over the canonical serialization of THIS DOMAIN'S rows. */
  sha256: string;
}

export interface TenantArchiveManifest {
  backupId: string;
  schemaVersion: number;
  /** WHOSE archive this is. Restore compares this against the grant. */
  tenantId: string;
  createdAt: string;
  domains: TenantDomainManifestEntry[];
  /**
   * Domains that hold tenant data and were NOT captured, by name.
   *
   * The archive states its own incompleteness. A reader that ignores this field
   * and treats the archive as a full tenant backup is making a claim the
   * artifact never made.
   */
  uncoveredDomains: TenantDomain[];
  /** True only when `uncoveredDomains` is empty. */
  complete: boolean;
}

export interface TenantArchive {
  manifest: TenantArchiveManifest;
  /** domain → the tenant's rows for that domain. */
  data: Record<string, readonly unknown[]>;
}

/**
 * Canonical serialization for hashing.
 *
 * Deterministic key order, because a hash over `JSON.stringify` of an object
 * whose key order varies between Node versions is a hash that fails for the
 * wrong reason — and an integrity check that produces false alarms gets
 * disabled, which is worse than not having one.
 */
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
}

export function domainHash(rows: readonly unknown[]): string {
  return createHash('sha256').update(canonical(rows)).digest('hex');
}

/**
 * Build one tenant's archive.
 *
 * PER-DOMAIN INTEGRITY, not a whole-file hash. A whole-file sha256 cannot
 * validate a merge — the file it hashed will legitimately differ after other
 * tenants write — so integrity is computed over each domain's tenant rows,
 * which is the thing that must survive the round trip unchanged.
 */
export async function createTenantArchive(
  grant: TenantReadGrant,
  now: string,
  backupId: string,
): Promise<TenantArchive> {
  const domains: TenantDomainManifestEntry[] = [];
  const data: Record<string, readonly unknown[]> = {};

  for (const domain of TENANT_DERIVED_DOMAINS) {
    const source = sources.get(domain);
    if (!source) continue;
    /**
     * A SNAPSHOT MUST BE A SNAPSHOT. The first draft stored the array the
     * source returned, so an adapter handing back live objects produced an
     * archive that mutated with the store — the integrity hash then failed for
     * the wrong reason, and a "backup" tracked the data it was supposed to
     * preserve. Cloned on the way in, once, here rather than in eighteen
     * adapters.
     */
    const rows = (await source.snapshot(grant)).map((r) => JSON.parse(JSON.stringify(r)) as unknown);
    data[domain] = rows;
    domains.push({
      domain,
      storeName: source.storeName,
      recordCount: rows.length,
      sha256: domainHash(rows),
    });
  }

  const uncoveredDomains = tenantArchiveCoverageGaps();
  return {
    manifest: {
      backupId,
      schemaVersion: TENANT_ARCHIVE_SCHEMA_VERSION,
      tenantId: grant.tenantId,
      createdAt: now,
      domains,
      uncoveredDomains,
      complete: uncoveredDomains.length === 0,
    },
    data,
  };
}

export type TenantRestoreRefusal =
  | 'SCHEMA_MISMATCH'
  | 'TENANT_MISMATCH'
  | 'INTEGRITY_MISMATCH'
  | 'MISSING_DOMAIN_DATA'
  | 'UNKNOWN_DOMAIN'
  | 'ROW_OWNER_MISMATCH';

export interface TenantRestoreResult {
  ok: boolean;
  refusal?: TenantRestoreRefusal;
  detail?: string;
  restoredDomains: TenantDomain[];
  /**
   * P13C ROUND 14. Whether the process must restart before the merge is safe.
   *
   * Round 12 found the latent version of this: every store holds its collection
   * in memory and `persist()` writes the whole thing, so a disk-level restore is
   * reverted by the next live write. Whole-install restore had the same problem
   * and no signal; per-tenant restore makes it CERTAIN, because per-tenant
   * restore is precisely the case where other tenants stay live and keep
   * writing. An adapter that merges through the live store sets
   * `inMemoryCollection: false` and does not contribute to this flag.
   */
  requiresRestart: boolean;
}

/**
 * Restore one tenant's rows, preserving every other tenant.
 *
 * VALIDATION ORDER IS DELIBERATE AND FAILS CLOSED. Schema, then tenant, then
 * integrity, then presence — and nothing is written until every check on every
 * domain has passed. A refusal must never half-restore, which is the same rule
 * the existing `BackupManager.restore` pre-flight follows.
 */
export async function restoreTenantArchive(
  grant: TenantReadGrant,
  archive: TenantArchive,
): Promise<TenantRestoreResult> {
  const empty: TenantDomain[] = [];
  const fail = (refusal: TenantRestoreRefusal, detail: string): TenantRestoreResult => ({
    ok: false,
    refusal,
    detail,
    restoredDomains: empty,
    requiresRestart: false,
  });

  const m = archive.manifest;
  if (m.schemaVersion !== TENANT_ARCHIVE_SCHEMA_VERSION) {
    return fail('SCHEMA_MISMATCH', `archive schema ${m.schemaVersion}`);
  }
  /**
   * THE CROSS-TENANT DENIAL, and it is one comparison because it should be.
   * The grant names who the caller was authorized for; the manifest names whose
   * archive this is. A platform operator restoring B's archive must hold a grant
   * FOR B — `authorizeTenantRead` will mint one, and that is the audited act.
   */
  if (m.tenantId !== grant.tenantId) {
    return fail('TENANT_MISMATCH', `archive belongs to a different organization`);
  }

  // Pre-flight EVERY domain before writing ANY of them.
  for (const entry of m.domains) {
    const source = sources.get(entry.domain);
    if (!source) return fail('UNKNOWN_DOMAIN', `no source registered for ${entry.domain}`);
    const rows = archive.data[entry.domain];
    if (!Array.isArray(rows)) return fail('MISSING_DOMAIN_DATA', `no rows for ${entry.domain}`);
    if (rows.length !== entry.recordCount) {
      return fail('INTEGRITY_MISMATCH', `${entry.domain}: record count`);
    }
    if (domainHash(rows) !== entry.sha256) {
      return fail('INTEGRITY_MISMATCH', `${entry.domain}: content hash`);
    }
    /**
     * THE MANIFEST'S TENANT IS A LABEL; THIS IS THE PROOF.
     *
     * Relabelling `manifest.tenantId` produces a self-consistent archive — the
     * hashes still match, because the rows were not touched. Without this check
     * an operator holding a grant for A could restore B's archive by editing one
     * string, and B's rows would be written back carrying B's owner. Every row
     * must actually belong to the granted tenant.
     */
    for (const row of rows) {
      const owner = source.ownerOf(row);
      if (owner !== grant.tenantId) {
        return fail(
          'ROW_OWNER_MISMATCH',
          `${entry.domain}: a row belongs to a different organization`,
        );
      }
    }
  }

  const restoredDomains: TenantDomain[] = [];
  let requiresRestart = false;
  for (const entry of m.domains) {
    const source = sources.get(entry.domain)!;
    await source.merge(grant, archive.data[entry.domain]!);
    restoredDomains.push(entry.domain);
    if (source.inMemoryCollection) requiresRestart = true;
  }
  return { ok: true, restoredDomains, requiresRestart };
}
