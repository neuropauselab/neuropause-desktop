/**
 * What is actually tenant-enforced, measured rather than asserted.
 *
 * WHY THIS IS CODE AND NOT A DOCUMENT
 *
 * A markdown table claiming "CRM: isolated" is a claim that rots the moment
 * someone adds a store. This reads the live registry, counts real records, and
 * reports per store — so the answer is produced by the same objects that enforce
 * the boundary, and a store that loses its binding shows up here rather than in
 * an incident.
 *
 * The statuses are deliberately unflattering. Most of this system is `PARTIAL`
 * or `REQUIRES_MIGRATION` today, and a vocabulary without those words would
 * force every entry into either a lie or a failure. `COMPLETE` means scope is
 * enforced AND no unowned records remain — a store with one unresolved row is
 * `PARTIAL`, not "done with a caveat".
 *
 * THE UNENFORCED STORES ARE LISTED TOO, BY NAME. That is the point of the file:
 * a report that only listed successes would be a worse artefact than no report,
 * because it would read as completeness.
 */
import type {
  TenantMigrationEntry,
  TenantMigrationInventory,
  TenantMigrationStatus,
} from '@neuropause/shared';
import type { EnterpriseModuleRegistry } from '../enterprise/framework/moduleRegistry';

/**
 * Stores that are NOT tenant-enforced, named individually.
 *
 * Hand-maintained, which is a real weakness — a new store will not appear here
 * until someone adds it. It is still worth having, because the alternative is an
 * inventory that silently reports only the stores that were migrated and
 * therefore looks complete. Every entry says what would be exposed.
 */
const UNENFORCED: readonly { store: string; status: TenantMigrationStatus; note: string }[] = [
  {
    store: 'documents (documentStore)',
    status: 'PARTIAL',
    note: 'P12 — DocumentRecord carries a scope; `get`, `all`, `count` and `existingByHash` are all scoped, so the content-hash oracle is closed and an identical upload by a second tenant produces its own record. The BLOB POOL remains shared and content-addressed by design, so the reference count spans tenants (deleting one tenant\u2019s record must not delete bytes another still names). Pre-P12 documents are unresolved and visible to nobody.',
  },
  {
    store: 'relationships (relationshipStore)',
    status: 'PARTIAL',
    note: 'Link CREATION is now scoped, because the resolver builds its candidate index from a scoped `store.list()`. Existing links written before P11 are not scoped, and `outgoing`/`incoming` still scan every link, so a pre-existing cross-tenant edge would still traverse.',
  },
  {
    store: 'provenance (ProvenanceStore)',
    status: 'PARTIAL',
    note: 'P13A — ProvenanceRecord and ImportResult carry a scope, stamped from the active scope on write and never from the payload. Both indexes are keyed (tenant, key), so the `byExternal` collision is closed: two tenants syncing the same provider account now get one row each, and the second no longer adopts and overwrites the first’s. `forRecord`, `forPlan`, `forConnection`, `forExternalKey`, `history`, `run`, `counts` and `countForModule` are all scoped, and eviction is confined to the writing tenant. Rows written before P13A are unresolved and visible to nobody.',
  },
  {
    store: 'decisions / holds',
    status: 'PARTIAL',
    note: 'P12 — HoldRecord and DecisionRecord carry a scope, and every read goes through the base class\u2019s `visible()`. The subject de-dupe is now (scope, subject), so two tenants holding `record:X` get two holds. `resolveSubject` cannot reach across. Pre-P12 rows are unresolved. APPROVALS (erp/approvalStore) are still unscoped \u2014 listed separately.',
  },
  {
    store: 'erp document lines (DocumentLineStore)',
    status: 'REQUIRES_MIGRATION',
    note: 'No scope field; `forDocument` filters on documentType + documentId over one global array. The `enterprise:module.lines` channel now refuses an out-of-scope record id, which closes the reachable read — but the store itself is unscoped, so any future reader of it is a new exposure.',
  },
  {
    store: 'erp approvals (approvalStore)',
    status: 'REQUIRES_MIGRATION',
    note: 'Keyed `moduleId/documentId` with no scope. The approval and approve channels gate on a scoped `store.get` first, so the reachable paths are covered; the store is not.',
  },
  {
    store: 'memory (memoryStore + vectorStore + liveSync bridge)',
    status: 'PARTIAL',
    note: 'P13A \u2014 MemoryItem carries an owner (SYSTEM / TENANT / WORKSPACE / PERSONAL) stamped by `remember` from the resolved viewer; `remember` throws rather than create an unowned memory. `filterFor` enforces it and every retrieval leg resolves through it \u2014 lexical, semantic, the hybrid union and the degraded fallback \u2014 so the isolated vector half is no longer defeated by the union. `get`, `update`, `forget`, `counts`, `allItems` (backfill egress) and `syncedItems` (sync egress) are scoped; the outbound bridge enqueues under each memory\u2019s OWN org rather than the active one, and an inbound apply is refused unless the payload carries an owner the viewer may read. PROJECTED memories inherit the projecting viewer\u2019s tenant because their source \u2014 the unified store \u2014 is still unscoped, so memory is no better isolated than what it projects from. Memories written before P13A are unresolved and visible to nobody.',
  },
  {
    store: 'AI context (contextBuilder, enterpriseSearch)',
    status: 'REQUIRES_MIGRATION',
    note: 'The deterministic-answer path now reads scoped records, because it goes through `store.list()`. Retrieval is PARTLY scoped: P13A made `EnterpriseSearchSources.memoryScope` a REQUIRED field, so a fan-out that has resolved no tenant returns an empty memory group instead of every tenant’s memories, and the memory leg is bounded by the store’s own viewer rather than by anything the caller passes. The UNIFIED INDEX and the GRAPH legs remain unscoped, so this entry stays REQUIRES_MIGRATION. `RetrievalPorts.governanceFilter` is the seam for those two and is still wired nowhere.',
  },
  {
    store: 'unified store + local search index',
    status: 'REQUIRES_MIGRATION',
    note: 'UnifiedEntity has no scope field. `query({limit: 1_000_000})` is the input to every briefing, finding and analytics rollup.',
  },
  {
    store: 'graph (graphStore)',
    status: 'REQUIRES_MIGRATION',
    note: 'Nodes and edges carry no scope. Adjacency is one global edge set, so `subgraph`, `neighbors` and `path` traverse across tenants; every bound is cardinality, not ownership.',
  },
  {
    store: 'notifications (inboxStore)',
    status: 'PARTIAL',
    note: 'P12 — items carry a scope; the de-dupe key is (scope, id) so the stable-per-subject ids no longer collide across tenants; `page`, `unreadCount` and `markRead("all")` are scoped. A delivery with no tenant is refused rather than stored unowned. The DELIVERY ENGINE upstream still has no tenant context, so what gets produced is not yet scoped \u2014 see background jobs.',
  },
  {
    store: 'audit reads (governanceStore)',
    status: 'PARTIAL',
    note: 'P12 — `auditEntries` and `auditCount` take a scope and filter the OUTPUT (never the array: the tamper-evident chain is order-sensitive). The renderer channel, the trust model and the medical-device reader all pass the active scope. Entries written before P11 have no workspaceId and are visible to nobody. Approval chains and compliance rules remain global.',
  },
  {
    store: 'import plan cache (dataPlane)',
    status: 'REQUIRES_MIGRATION',
    note: 'Plans are held in a Map keyed by planId with no owner, so any caller holding a planId can preview or execute it. The ids are uuids, so this is a capability with no holder rather than a guessable one.',
  },
  {
    store: 'TTL model caches (relationship / trust / process-mining providers)',
    status: 'BLOCKED',
    note: 'Each is a single keyless `let cache` with a ~2.5s TTL, built by fanning out reads across dozens of stores. Their INPUTS are now scoped, so a cache built by tenant A holds A’s data — but it is then served to whoever asks within the TTL. Blocked rather than partial: keying them requires a scope-aware invalidation design, not a filter.',
  },
  {
    store: 'background jobs (9 of 10 timers)',
    status: 'REQUIRES_MIGRATION',
    note: 'Only the connector sync has a principal. The delivery engine, scheduled backup, graph and memory reprojections, webhook dispatcher, health monitor and update checker run with no actor, no tenant and no permission.',
  },
  {
    store: 'medical device pack (LotService / TraceService / TraceEdgeStore)',
    status: 'PARTIAL',
    note: 'P12 — `deviceTenantId()` returned the literal string \u2018default\u2019, so the pack\u2019s real and tested isolation machinery filtered every read on a value that never changed. It now reads the live resolver, falling back to \u2018default\u2019 only when no tenant resolves so existing lots stay readable during cold start. `TraceEdgeStore` itself is still unscoped. This surface was absent from the Program 11 inventory.',
  },
  {
    store: 'the filesystem itself',
    status: 'BLOCKED',
    note: 'Every tenant\u2019s records live in one mode-0600 JSON file per module under userData. The boundary is a same-process, same-OS-user filter: anyone who can read those files reads every tenant directly and bypasses all of the above. Inherent to a desktop app, and it caps what this program can honestly claim.',
  },
];

export interface MigrationInventoryDeps {
  registry: EnterpriseModuleRegistry;
  now: () => string;
}

export async function buildMigrationInventory(
  deps: MigrationInventoryDeps,
): Promise<TenantMigrationInventory> {
  const entries: TenantMigrationEntry[] = [];

  /**
   * The 106 module stores, counted individually.
   *
   * Rolled up per store rather than as one "ERP" line, because "ERP is
   * migrated" is exactly the kind of summary that hides the one module that
   * is not.
   */
  for (const module of deps.registry.list()) {
    await module.store.load();
    const counts = module.store.ownershipCounts();
    const scoped = module.store.hasScope();
    const status: TenantMigrationStatus = !scoped
      ? 'REQUIRES_MIGRATION'
      : counts.unresolved > 0
        ? 'PARTIAL'
        : 'COMPLETE';
    entries.push({
      store: `enterprise module: ${module.descriptor.id}`,
      status,
      total: counts.total,
      assigned: counts.assigned,
      unresolved: counts.unresolved,
      note: !scoped
        ? 'No tenant boundary is bound to this store. It denies every read until one is.'
        : counts.unresolved > 0
          ? `${counts.unresolved} record(s) predate tenant ownership. They are visible to no tenant until claimed explicitly.`
          : /**
             * `COMPLETE` is scoped to THIS STORE and says so.
             *
             * It would otherwise read as "this module is isolated", which is
             * false: the same records are projected into the unified store, the
             * graph, memory and the search index, and all four are
             * REQUIRES_MIGRATION on this same page. `hasScope()` is also only
             * evidence that `bindScope` was CALLED — it cannot prove the source
             * ever returns a scope.
             */
            'Every read of this store is scoped and every record has a known owner. Projections of these records into search, the graph and AI context are listed separately and are NOT scoped.',
    });
  }

  for (const u of UNENFORCED) {
    entries.push({ store: u.store, status: u.status, total: 0, assigned: 0, unresolved: 0, note: u.note });
  }

  /**
   * Totals summed from the rows, never counted separately.
   *
   * A headline computed independently from the detail is a headline that can
   * disagree with it, and when they disagree the headline is the one people
   * quote.
   */
  /**
   * Totals cover the ROWS THAT CAN BE COUNTED, and the name says which.
   *
   * The unenforced entries carry zeros because their stores expose no ownership
   * count, so a plain "records" total would silently exclude documents,
   * provenance, the graph, the unified store and notifications — and read as a
   * whole-system figure.
   */
  const totals = entries.reduce(
    (acc, e) => ({
      stores: acc.stores + 1,
      records: acc.records + e.total,
      assigned: acc.assigned + e.assigned,
      unresolved: acc.unresolved + e.unresolved,
    }),
    { stores: 0, records: 0, assigned: 0, unresolved: 0 },
  );

  return { generatedAt: deps.now(), entries, totals };
}

/** Counts by status, for a one-line summary that agrees with the rows. */
export function summarizeInventory(
  inventory: TenantMigrationInventory,
): Record<TenantMigrationStatus, number> {
  const out: Record<TenantMigrationStatus, number> = {
    COMPLETE: 0,
    PARTIAL: 0,
    REQUIRES_MIGRATION: 0,
    BLOCKED: 0,
  };
  for (const e of inventory.entries) out[e.status] += 1;
  return out;
}
