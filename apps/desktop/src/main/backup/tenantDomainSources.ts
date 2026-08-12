/**
 * PRODUCTION F22 ADAPTERS. P13C ROUND 15.
 *
 * Round 14 built the mechanism and proved it against fixtures. This connects it
 * to real stores. Each adapter is a FACTORY over an instance rather than a
 * module-level registration, so the composition root decides what is registered
 * and a test can wire its own store to the same code the product runs.
 *
 * WHY THIS FILE IS SHORT, AND WHAT THAT MEANS
 *
 * The Round 12 estimate — repeated in Round 14 — was "about ten mechanical
 * stores". A store-by-store inventory this round showed that number was wrong,
 * and it is worth writing down rather than quietly delivering fewer:
 *
 *   MECHANICAL (an array of rows with an optional `tenantId`, a private
 *   `load()`, and a whole-collection `persist()`) — these three, plus
 *   `workforce-jobs` which additionally maintains a parallel `order[]` index
 *   that `persist()` serializes FROM, so a merge that misses it silently drops
 *   rows.
 *
 *   NOT MECHANICAL, each for a different and real reason:
 *     `workforce-governance-audit`  a SHA-256 hash chain over the whole array.
 *                                   Splicing one tenant's rows invalidates
 *                                   `verifyIntegrity()` for EVERY tenant. The
 *                                   choice is per-tenant chains or accepting
 *                                   that a restore re-blesses tamper evidence —
 *                                   a decision, not an implementation detail.
 *     `connector-accounts`          no tenant field on the row at all; the owner
 *                                   is derived by joining `workspaceId` against
 *                                   the workspace directory, which makes
 *                                   `ownerOf` a function of another store's
 *                                   state rather than of the row.
 *     `organization-directory`      four collections, and `Organization` is
 *                                   owned by its own `id` rather than an
 *                                   `orgId`. Restoring one re-creates a tenant.
 *     `workspace-directory`         owner is `organizationId`, and `load()`
 *                                   seeds a default workspace that a restore
 *                                   would collide with.
 *     `companion-device-registry`   owner is `boundTenantId`, so
 *                                   `TenantOwnership.onlyFor` — which reads
 *                                   `.tenantId` — returns nothing for every row.
 *     `assistant-conversations`     mechanical, but no exported instance: the
 *                                   live store is module-local inside
 *                                   `initAssistant`, so wiring it means widening
 *                                   `AssistantSubsystem` first.
 *     memory / graph / unified / timeline  the four the Round 12 audit already
 *                                   called bespoke, unchanged.
 *
 * So coverage advances honestly and the manifest keeps saying `complete: false`
 * until the rest are done. That is the mechanism working as designed — the
 * denominator is not editable to make the number look better.
 */
import type { TenantDomainSource } from './tenantArchive';
import type { TenantReadGrant } from '../tenancy/tenantOwnedStore';

/** The shape every mechanical store's seam exposes. */
interface GrantSeamStore<T extends { tenantId?: string | null }> {
  snapshotForGrant(grant: TenantReadGrant): T[];
  mergeForGrant(grant: TenantReadGrant, rows: readonly T[]): Promise<number>;
}

/**
 * The mechanical adapter, once.
 *
 * `ownerOf` reads the row's OWN field and returns null for an unowned row —
 * pre-migration rows belong to nobody and must never be restorable, which is the
 * same fail-closed direction `TenantOwnership.mine` takes.
 *
 * Cloning happens on both sides: the store's seam clones, and
 * `createTenantArchive` clones again. That is deliberate redundancy on the axis
 * where the failure is silent — an archive aliasing live state was one of the
 * two defects Round 14's own tests found.
 */
function mechanicalSource<T extends { tenantId?: string | null }>(
  domain: TenantDomainSource['domain'],
  storeName: string,
  store: GrantSeamStore<T>,
): TenantDomainSource {
  return {
    domain,
    storeName,
    inMemoryCollection: true,
    ownerOf: (row) => {
      const owner = (row as T).tenantId;
      return typeof owner === 'string' && owner !== '' ? owner : null;
    },
    snapshot: async (grant) => store.snapshotForGrant(grant),
    merge: async (grant, rows) => store.mergeForGrant(grant, rows as readonly T[]),
  };
}

export function executiveDecisionsSource<T extends { tenantId?: string | null }>(
  store: GrantSeamStore<T>,
): TenantDomainSource {
  return mechanicalSource('executive-decisions', 'executive-decisions', store);
}

export function automationRulesSource<T extends { tenantId?: string | null }>(
  store: GrantSeamStore<T>,
): TenantDomainSource {
  return mechanicalSource('automation-rules', 'automation-rules', store);
}

export function healthHistorySource<T extends { tenantId?: string | null }>(
  store: GrantSeamStore<T>,
): TenantDomainSource {
  return mechanicalSource('enterprise-health-history', 'enterprise-health-history', store);
}
